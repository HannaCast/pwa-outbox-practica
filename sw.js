importScripts('./db-helper.js');

const CACHE_STATIC_NAME = 'static-outbox-v7';
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const ENDPOINT_REPORTES = 'https://jsonplaceholder.typicode.com/posts';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nombres) => {
        const obsoletas = nombres.filter((nombre) => nombre !== CACHE_STATIC_NAME);
        return Promise.all(obsoletas.map((nombre) => caches.delete(nombre)));
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((enCache) => {
      if (enCache) {
        return enCache;
      }

      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Sin conexión', {
          status: 503,
          statusText: 'Offline'
        });
      });
    })
  );
});

function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      clientes.forEach((cliente) => {
        cliente.postMessage({
          tipo: 'OUTBOX_SINCRONIZADO',
          timestamp: Date.now()
        });
      });
    });
}

function sincronizarPendientesSW() {
  console.log('[SW-Sync] Ejecutando barrido de transacciones pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[SW-Sync] Cola limpia. Nada por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT_REPORTES, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.titulo,
            body: item.descripcion
          })
        })
          .then((respuesta) => {
            if (!respuesta.ok) {
              throw new Error('Error HTTP ' + respuesta.status + ' al sincronizar ID ' + item.id);
            }
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio)
        .then(() => notificarClientesActualizacion());
    });
}

self.addEventListener('sync', (event) => {
  console.log('[SW-Sync] Evento sync disparado con etiqueta:', event.tag);

  if (event.tag === 'sync-reportes') {
    event.waitUntil(
      sincronizarPendientesSW()
        .catch((error) => {
          console.error('[SW-Sync] Falla en sincronización; el navegador reintentará luego:', error);
          throw error;
        })
    );
  }
});
