/*
 * Interfaz de la bandeja de salida.
 * El reenvío principal vive en sw.js (Background Sync).
 * Este archivo solo reintenta si el navegador no tiene SyncManager.
 */

const ENDPOINT_REPORTES = 'https://jsonplaceholder.typicode.com/posts';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((registro) => {
      console.log('[SW] Registrado. Scope:', registro.scope);
    })
    .catch((error) => {
      console.error('[SW] No se pudo registrar:', error);
    });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      mostrarEstado('El Service Worker sincronizó la bandeja en segundo plano.');
      renderizarColaOutbox();
    }
  });
}

function actualizarIndicadorRed() {
  const badge = document.getElementById('badge-red');
  if (navigator.onLine) {
    badge.textContent = 'En Línea';
    badge.className = 'badge online';
  } else {
    badge.textContent = 'Sin Red';
    badge.className = 'badge offline';
  }
}

function mostrarEstado(mensaje) {
  const aviso = document.getElementById('estado-app');
  aviso.textContent = mensaje;
}

function formatearHora(timestamp) {
  return new Date(timestamp).toLocaleString('es-MX', {
    dateStyle: 'short',
    timeStyle: 'medium'
  });
}

function renderizarColaOutbox() {
  const lista = document.getElementById('lista-outbox');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      lista.textContent = '';

      if (!registros.length) {
        const vacio = document.createElement('li');
        vacio.className = 'vacio';
        vacio.textContent = 'La bandeja está vacía. Los reportes locales aparecerán aquí.';
        lista.appendChild(vacio);
        return;
      }

      const ordenados = registros.slice().sort((a, b) => {
        return (b.fechaCreacion || 0) - (a.fechaCreacion || 0);
      });

      ordenados.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'item';

        const cabeza = document.createElement('div');
        cabeza.className = 'item-top';

        const titulo = document.createElement('strong');
        titulo.textContent = item.titulo;

        const chip = document.createElement('span');
        chip.className = 'chip ' + item.estado;
        chip.textContent = item.estado;

        cabeza.appendChild(titulo);
        cabeza.appendChild(chip);

        const descripcion = document.createElement('p');
        descripcion.className = 'item-desc';
        descripcion.textContent = item.descripcion;

        const meta = document.createElement('p');
        meta.className = 'item-meta';
        meta.textContent = 'ID ' + item.id + ' · ' + formatearHora(item.fechaCreacion);

        li.appendChild(cabeza);
        li.appendChild(descripcion);
        li.appendChild(meta);
        lista.appendChild(li);
      });
    })
    .catch((error) => {
      console.error('[Outbox] No se pudo leer IndexedDB:', error);
      mostrarEstado('No se pudo leer la bandeja local.');
    });
}

function procesarEnvioReporte(datosFormulario) {
  return fetch(ENDPOINT_REPORTES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) {
        throw new Error('Error HTTP del servidor');
      }
      return respuesta.json();
    })
    .then(() => {
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      }).then(() => 'sincronizado');
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              })
              .catch((error) => {
                console.error('[Outbox] No se pudo registrar la etiqueta sync:', error);
              });
          }
        })
        .then(() => 'pendiente');
    })
    .then((estado) => {
      return renderizarColaOutbox().then(() => estado);
    });
}

function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT_REPORTES, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) {
              throw new Error('Falla al reintentar envío');
            }
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

function purgarSincronizados() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      const enviados = registros.filter((item) => item.estado === 'sincronizado');
      const borrados = enviados.map((item) => eliminarRegistro(item.id));
      return Promise.all(borrados).then(() => enviados.length);
    })
    .then((cantidad) => {
      if (cantidad === 0) {
        mostrarEstado('No había registros sincronizados para purgar.');
      } else {
        mostrarEstado('Se eliminaron ' + cantidad + ' registros ya sincronizados.');
      }
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error al purgar:', error);
      mostrarEstado('No se pudo purgar la bandeja.');
    });
}

function conectarFormulario() {
  const form = document.getElementById('form-incidencia');

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const datos = {
      titulo: document.getElementById('titulo').value.trim(),
      descripcion: document.getElementById('descripcion').value.trim()
    };
    const boton = form.querySelector('button[type="submit"]');
    boton.disabled = true;
    mostrarEstado('Procesando reporte...');

    procesarEnvioReporte(datos)
      .then((estado) => {
        form.reset();
        if (estado === 'pendiente') {
          mostrarEstado('Sin red: el reporte quedó pendiente en IndexedDB.');
        } else {
          mostrarEstado('Reporte enviado. Quedó registrado como sincronizado.');
        }
      })
      .catch((error) => {
        console.error('[Outbox] No se pudo procesar el reporte:', error);
        mostrarEstado('No se pudo guardar el reporte.');
      })
      .then(() => {
        boton.disabled = false;
      });
  });
}

function iniciar() {
  actualizarIndicadorRed();
  conectarFormulario();

  document.getElementById('btn-purgar').addEventListener('click', () => {
    purgarSincronizados();
  });

  // Esta lectura es la que recupera la cola al abrir la página, con o sin red.
  renderizarColaOutbox()
    .then(() => {
      if (navigator.onLine && !('SyncManager' in window)) {
        return sincronizarPendientesFallback();
      }
    });
}

window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Solo el hilo de la página sincroniza si no existe Background Sync.
  // En Chrome lo hace sw.js, para no mandar el mismo POST dos veces.
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

document.addEventListener('DOMContentLoaded', iniciar);
