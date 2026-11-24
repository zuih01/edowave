import { instalarVersionNueva, useActualizacion } from '../actualizar';

/** Aviso de la app de Android: hay un .apk nuevo para instalar. */
export function ActualizacionAviso() {
  const { apk, bajando, error, cerrado } = useActualizacion();
  if (!apk || cerrado) return null;
  return (
    <div className="actualizacion-aviso" role="status">
      <div className="actualizacion-texto">
        <strong>Hay una versión nueva</strong>
        <span>{error || (bajando ? 'Bajando… Android te pedirá confirmar la instalación.' : 'Instálala para tener lo último.')}</span>
      </div>
      <button className="actualizacion-cerrar" onClick={() => useActualizacion.setState({ cerrado: true })} aria-label="Ahora no">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" />
        </svg>
      </button>
      <button className="actualizacion-btn" onClick={() => void instalarVersionNueva()} disabled={bajando}>
        {bajando ? 'Bajando…' : 'Actualizar'}
      </button>
    </div>
  );
}
