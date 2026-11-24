import { useEffect, useState } from 'react';
import { HeadphonesIcon } from '../components/Icons';
import { currentTrack, usePlayer } from '../player/player';
import { useCuenta } from '../server/cuenta';

/**
 * App de PC: muestra en Discord lo que suena ("Escuchando Edowave · canción", con artista, carátula y tiempo).
 * La conexión con Discord la hace la parte de Rust (escritorio-pc\app\src-tauri\src\discord.rs); aquí solo se le
 * avisa qué suena. En pausa o sin canción se quita. Se puede apagar en Configuración (encendido por defecto).
 */
type Tauri = { core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
const tauri = () => (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

const CLAVE = 'discordActividad';
const leerActivo = () => {
  try {
    return localStorage.getItem(CLAVE) !== 'off';
  } catch {
    return true;
  }
};
let activo = leerActivo();
const avisos = new Set<() => void>();

/** Se monta una vez en la vista de PC: sigue al reproductor y le cuenta a Discord. */
export function useDiscordPc() {
  useEffect(() => {
    const t = tauri();
    if (!t) return;
    let ultimo = '';
    const mandar = () => {
      const s = usePlayer.getState();
      const track = currentTrack(s);
      if (!activo || !track || !s.playing) {
        if (ultimo !== 'nada') void t.core.invoke('discord_actividad', { cancion: null }).catch(() => {});
        ultimo = 'nada';
        return;
      }
      // La barra de tiempo: cuándo empezó (ahora menos lo que ya sonó) y cuándo termina.
      const inicio = Date.now() - Math.round(s.position * 1000);
      const dur = s.duration || track.duration || 0;
      // Solo cuando cambia algo que se ve: canción, play/pausa o un salto (adelantar/retroceder).
      const clave = `${track.id}|${Math.round(inicio / 3000)}`;
      if (clave === ultimo) return;
      ultimo = clave;
      const base = useCuenta.getState().base;
      const portada = track.coverId?.startsWith('p:') && base.startsWith('https://') ? `${base}/api/portadas/${encodeURIComponent(track.coverId.slice(2))}` : null;
      void t.core
        .invoke('discord_actividad', {
          cancion: {
            titulo: track.title,
            artista: track.artist,
            album: track.album || null,
            portada,
            inicio,
            fin: dur > 0 ? inicio + Math.round(dur * 1000) : null,
          },
        })
        .catch(() => {});
    };
    // La posición cambia varias veces por segundo: se revisa como mucho cada 2 s (la clave filtra lo repetido).
    let espera: ReturnType<typeof setTimeout> | undefined;
    const pronto = () => {
      if (espera) return;
      espera = setTimeout(() => {
        espera = undefined;
        mandar();
      }, 2000);
    };
    const quitar = usePlayer.subscribe((s, a) => {
      if (s.queue[s.index] !== a.queue[a.index] || s.playing !== a.playing) mandar();
      else pronto();
    });
    avisos.add(mandar);
    mandar();
    return () => {
      quitar();
      avisos.delete(mandar);
      clearTimeout(espera);
    };
  }, []);
}

/** Configuración, solo en la app de PC: "Mostrar en Discord lo que escucho". */
export function DiscordPc() {
  const [on, setOn] = useState(activo);
  if (!tauri()) return null;
  const cambiar = () => {
    activo = !activo;
    setOn(activo);
    try {
      localStorage.setItem(CLAVE, activo ? 'on' : 'off');
    } catch {
      /* sin almacenamiento: vale hasta cerrar la app */
    }
    for (const f of avisos) f();
  };
  return (
    <button className="settings-row" role="switch" aria-checked={on} onClick={cambiar}>
      <span className="settings-icon">
        <HeadphonesIcon />
      </span>
      <span className="track-text">
        <span className="settings-label">Mostrar en Discord lo que escucho</span>
        <span className="settings-sub">Tu perfil de Discord dice qué canción suena (con Discord abierto en este PC)</span>
      </span>
      <span className={`switch ${on ? 'on' : ''}`} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}
