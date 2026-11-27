import { useEffect, useState } from 'react';
import { eventosHooks } from '../server/social';

/**
 * App de PC (Tauri): avisa cuando hay una versión nueva publicada. "Descargar" abre la página de descarga en el
 * navegador: ahí se baja el instalador nuevo y se instala encima (la música, la sesión y los ajustes se quedan).
 * La app NO descarga ni ejecuta instaladores por su cuenta: Windows Defender marcaba como troyano a las versiones
 * que lo hacían (ver escritorio-pc\app\src-tauri\src\main.rs). En el navegador no aparece.
 */
type Tauri = { core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
const tauri = () => (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

/**
 * Cuándo se revisa: al abrir, apenas el servidor avisa que se publicó una versión (aviso en vivo "version-nueva"),
 * al reconectarse, al volver a la ventana y, por si acaso, cada 15 min.
 */
const CADA = 15 * 60 * 1000;
let alAvisar: (() => void) | null = null;
eventosHooks.evento.push((ev) => {
  if (ev.tipo !== 'version-nueva') return false;
  if (ev.plataforma === 'pc') alAvisar?.();
  return ev.plataforma === 'pc';
});
eventosHooks.conectado.push(() => alAvisar?.());

export function ActualizacionPc() {
  const [nueva, setNueva] = useState<string | null>(null);
  const [estado, setEstado] = useState<'aviso' | 'abierta' | 'error'>('aviso');
  const [error, setError] = useState('');
  const [oculto, setOculto] = useState(false);

  useEffect(() => {
    const t = tauri();
    if (!t) return;
    let ultima = 0;
    const revisar = () => {
      if (Date.now() - ultima < 3000) return; // varios motivos juntos: una sola consulta
      ultima = Date.now();
      t.core
        .invoke<string | null>('buscar_actualizacion')
        .then((v) => {
          if (v && v !== nueva) {
            setNueva(v);
            setOculto(false); // una versión todavía más nueva vuelve a avisar aunque hayas dicho "Más tarde"
            setEstado('aviso');
          }
        })
        .catch(() => {}); // sin conexión: se intenta la próxima vez
    };
    alAvisar = revisar;
    const primera = setTimeout(revisar, 4000);
    const cada = setInterval(revisar, CADA);
    window.addEventListener('focus', revisar);
    return () => {
      alAvisar = null;
      clearTimeout(primera);
      clearInterval(cada);
      window.removeEventListener('focus', revisar);
    };
  }, [nueva]);

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
