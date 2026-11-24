import { useEffect, useState } from 'react';

/**
 * App de PC (Tauri): avisa cuando hay una versión nueva publicada. "Descargar" abre la página de descarga en el
 * navegador: ahí se baja el instalador nuevo y se instala encima (la música, la sesión y los ajustes se quedan).
 * La app NO descarga ni ejecuta instaladores por su cuenta: Windows Defender marcaba como troyano a las versiones
 * que lo hacían (ver escritorio-pc\app\src-tauri\src\main.rs). En el navegador no aparece.
 */
type Tauri = { core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
const tauri = () => (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

const CADA = 6 * 60 * 60 * 1000; // con la app abierta mucho rato, vuelve a revisar cada 6 h

export function ActualizacionPc() {
  const [nueva, setNueva] = useState<string | null>(null);
  const [estado, setEstado] = useState<'aviso' | 'abierta' | 'error'>('aviso');
  const [error, setError] = useState('');
  const [oculto, setOculto] = useState(false);

  useEffect(() => {
    const t = tauri();
    if (!t) return;
    const revisar = () =>
      t.core
        .invoke<string | null>('buscar_actualizacion')
        .then((v) => v && setNueva(v))
        .catch(() => {}); // sin conexión: se intenta la próxima vez
    const primera = setTimeout(revisar, 4000);
    const cada = setInterval(revisar, CADA);
    return () => {
      clearTimeout(primera);
      clearInterval(cada);
    };
  }, []);

  if (!nueva || oculto) return null;
  const descargar = () => {
    tauri()
      ?.core.invoke('abrir_descarga')
      .then(() => setEstado('abierta'))
      .catch((e) => {
        setError(String(e));
        setEstado('error');
      });
  };

  return (
    <div className="esc-actualizar" role="status">
      <div className="esc-actualizar-texto">
        {estado === 'abierta' ? (
          <>
            <b>Se abrió la página de descarga</b>
            <span>Abre el instalador que se bajó para instalar la versión {nueva}</span>
          </>
        ) : estado === 'error' ? (
          <>
            <b>No se pudo abrir la página</b>
            <span>{error}</span>
          </>
        ) : (
          <>
            <b>Hay una versión nueva</b>
            <span>Versión {nueva}</span>
          </>
        )}
      </div>
      <button className="esc-actualizar-luego" onClick={() => setOculto(true)}>
        {estado === 'abierta' ? 'Cerrar' : 'Más tarde'}
      </button>
      {estado !== 'abierta' && (
        <button className="esc-actualizar-btn" onClick={descargar}>
          {estado === 'error' ? 'Reintentar' : 'Descargar'}
        </button>
      )}
    </div>
  );
}
