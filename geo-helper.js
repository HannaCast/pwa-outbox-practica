function traducirErrorGeolocalizacion(error) {
  switch (error.code) {
    case 1:
      return 'Permiso de ubicación denegado. Puedes ingresar tu zona manualmente.';
    case 2:
      return 'No fue posible determinar tu ubicación (señal GPS o Wi-Fi no disponible).';
    case 3:
      return 'Se agotó el tiempo de espera intentando obtener las coordenadas.';
    default:
      return 'Ocurrió un error inesperado al consultar la ubicación.';
  }
}

function obtenerUbicacionActual(opcionesPersonalizadas) {
  const opciones = Object.assign(
    {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 30000
    },
    opcionesPersonalizadas
  );

  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Este navegador no soporta la API de Geolocalización.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        resolve({
          latitud: posicion.coords.latitude,
          longitud: posicion.coords.longitude,
          precisionMetros: Math.round(posicion.coords.accuracy),
          timestamp: posicion.timestamp,
          origen: 'dispositivo'
        });
      },
      (error) => {
        const fallo = new Error(traducirErrorGeolocalizacion(error));
        fallo.code = error.code;
        reject(fallo);
      },
      opciones
    );
  });
}

function consultarEstadoPermisoGeo() {
  if (!('permissions' in navigator)) {
    return Promise.resolve('prompt');
  }

  return navigator.permissions.query({ name: 'geolocation' })
    .then((resultado) => resultado.state)
    .catch(() => 'prompt');
}
