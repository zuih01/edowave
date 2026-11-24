import { useCuenta } from '../server/cuenta';
import { useConexion } from '../server/conexion';

/** "Sin conexión con el servidor": arriba del mini reproductor mientras el servidor no contesta. */
export function ConexionBanner() {
  const conSesion = useCuenta((s) => !!s.token);
  const caido = useConexion((s) => s.largo); // solo tras 1:30 sin servidor
  if (!conSesion || !caido) return null;
  return (
    <div className="conexion-banner" role="status">
      <span className="conexion-punto" aria-hidden="true" />
      <span className="juntos-texto">
        <b>Sin conexión con el servidor</b> · solo suenan tus descargas y la música del teléfono
      </span>
    </div>
  );
}
