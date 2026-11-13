/*
 * Mini-wrapper de IndexedDB.
 * Traduce la API por eventos (IDBRequest) a promesas encadenables.
 * Se carga en la página con <script> y en el Service Worker con importScripts.
 * Las funciones quedan en el ámbito global de cada hilo.
 */

const DB_NAME = 'pwa-outbox-db';
const DB_VERSION = 1;
const STORE_NAME = 'transacciones_pendientes';

function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Único momento válido para crear o borrar object stores.
    // Si la base ya existe con esta versión, este evento no se dispara.
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

function guardarRegistro(datos) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(datos);
      let idGenerado;

      // onsuccess entrega el id, pero el disco aún puede no haber confirmado la escritura.
      req.onsuccess = (event) => {
        idGenerado = event.target.result;
      };

      // oncomplete confirma que la transacción terminó de persistir.
      tx.oncomplete = () => resolve(idGenerado);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

function obtenerTodosLosRegistros() {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = (event) => resolve(event.target.result);
      req.onerror = (event) => reject(event.target.error);
    });
  });
}

function eliminarRegistro(id) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      store.delete(id);

      tx.oncomplete = () => resolve(true);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

function actualizarEstadoRegistro(id, nuevoEstado) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      // get y put viven en la misma transacción readwrite:
      // readonly permitiría leer, pero put lanzaría un error de modo.
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const reqGet = store.get(id);
      let fallo = false;

      reqGet.onsuccess = (event) => {
        const registro = event.target.result;
        if (!registro) {
          fallo = true;
          reject(new Error('No se encontró el registro con ID: ' + id));
          return;
        }

        registro.estado = nuevoEstado;
        registro.fechaSincronizacion = Date.now();
        store.put(registro);
      };

      tx.oncomplete = () => {
        if (!fallo) resolve(true);
      };
      tx.onerror = (event) => reject(event.target.error);
      reqGet.onerror = (event) => reject(event.target.error);
    });
  });
}
