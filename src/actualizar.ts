import { Capacitor, registerPlugin } from '@capacitor/core';
import { create } from 'zustand';
import { SERVIDOR_FIJO } from './server/cuenta';
import { eventosHooks } from './server/social';

/**
 * Solo en la app de Android: se actualiza sola cuando se publica una versión nueva en el servidor
 * (scripts/compilar-apk.ps1 -Publicar sube /android/version.json, la interfaz .zip y el .apk).
 *
 *  - Cambió solo la interfaz (lo normal): se baja en silencio y se usa la PRÓXIMA vez que abras la app.
 *  - Cambió la parte de Android (permisos, notificación, ícono): aparece el aviso "Hay una versión nueva"
 *    con el botón Actualizar, que baja el .apk y abre el instalador de Android.
 */

/** Con qué versión se armó ESTA interfaz (las pone el script al compilar). */
const VERSION_WEB: string = import.meta.env.VITE_VERSION_WEB ?? '';
const VERSION_NATIVA: string = import.meta.env.VITE_VERSION_NATIVA ?? '';

interface Version {
  web: string;
  nativa: string;
  interfaz: string; // archivo .zip
  apk: string; // archivo .apk
}

interface Actualizacion {
  descargarInterfaz(o: { url: string; version: string }): Promise<{ ruta: string }>;
  instalarApk(o: { url: string }): Promise<{ permiso?: boolean }>;
}
const Nativo = registerPlugin<Actualizacion>('Actualizacion');

/** Aviso en pantalla cuando hace falta instalar un .apk nuevo. */
export const useActualizacion = create<{ apk: string | null; bajando: boolean; error: string; cerrado: boolean }>(() => ({
  apk: null,
  bajando: false,
  error: '',
  cerrado: false,
}));

const url = (archivo: string) => `${SERVIDOR_FIJO}/android/${encodeURIComponent(archivo)}`;
let interfazBajada = '';
let revisando = false;

async function revisar() {
  if (revisando) return;
  revisando = true;
  try {
    const r = await fetch(`${SERVIDOR_FIJO}/android/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const v = (await r.json()) as Version;
    if (v.nativa && v.apk && v.nativa !== VERSION_NATIVA) {
      // Cambió la parte de Android: hace falta el .apk nuevo (con su interfaz adentro).
      useActualizacion.setState({ apk: v.apk });
      return;
    }
    if (v.web && v.interfaz && v.web !== VERSION_WEB && v.web !== interfazBajada) {
      await Nativo.descargarInterfaz({ url: url(v.interfaz), version: v.web });
      interfazBajada = v.web; // lista para la próxima vez que se abra la app
    }
  } catch {
    /* sin conexión o sin versión publicada: se revisa la próxima vez */
  } finally {
    revisando = false;
  }
}

/** Botón "Actualizar" del aviso. */
export async function instalarVersionNueva() {
  const { apk } = useActualizacion.getState();
  if (!apk) return;
  useActualizacion.setState({ bajando: true, error: '' });
  try {
    await Nativo.instalarApk({ url: url(apk) });
  } catch (e) {
    useActualizacion.setState({ error: (e as Error).message || 'No se pudo bajar la versión nueva.' });
  } finally {
    useActualizacion.setState({ bajando: false });
  }
}

export function iniciarActualizaciones() {
  if (!Capacitor.isNativePlatform() || !SERVIDOR_FIJO) return;
  // Un momento después de abrir (que primero cargue tu música) y cada vez que vuelves a la app.
  setTimeout(() => void revisar(), 4000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void revisar());
  // El servidor avisa en vivo cuando se publica una versión: se revisa al tiro.
  eventosHooks.evento.push((ev) => {
    if (ev.tipo !== 'version-nueva') return false;
    if (ev.plataforma === 'android') void revisar();
    return ev.plataforma === 'android';
  });
}
