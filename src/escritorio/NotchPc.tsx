import { useEffect, useState } from 'react';
import { fallbackBackground } from '../components/Cover';
import { loadCover } from '../library/useCover';
import { currentTrack, usePlayer } from '../player/player';

/**
 * App de PC: el notch (Configuración → Este PC, apagado por defecto). Una píldora arriba al centro de la pantalla con
 * la carátula, play/pausa y siguiente; se esconde sola y se abre al pasar el mouse. Es otra ventana con su propia
 * página (notch.html, src/notch/notch.ts); la parte de Rust está en escritorio-pc\app\src-tauri\src\notch.rs.
 * Aquí se le manda lo que suena y se atienden sus botones.
 */
type Ventana = { show: () => Promise<void>; unminimize: () => Promise<void>; setFocus: () => Promise<void> };
type Tauri = {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
  event: {
    emit: (nombre: string, datos?: unknown) => Promise<void>;
    listen: <T>(nombre: string, f: (e: { payload: T }) => void) => Promise<() => void>;
  };
  window: { getCurrentWindow: () => Ventana };
};
const tauri = () => (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

const CLAVE = 'notchPc';
const leer = () => {
  try {
    return localStorage.getItem(CLAVE) === 'on';
  } catch {
    return false;
  }
};
let activo = leer();
const avisos = new Set<() => void>();

/** La carátula achicada a 96 px como imagen dentro del texto (la otra ventana no puede leer las de esta). */
const caratulas = new Map<string, string | null>();
async function caratulaChica(coverId: string | undefined): Promise<string | null> {
  if (!coverId) return null;
  if (caratulas.has(coverId)) return caratulas.get(coverId)!;
  let out: string | null = null;
  try {
    const url = await loadCover(coverId);
    if (url) {
      const img = new Image();
      img.src = url;
      await img.decode();
      const lado = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      c.getContext('2d')!.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, 96, 96);
      out = c.toDataURL('image/jpeg', 0.85);
    }
  } catch {
    out = null;
  }
  if (caratulas.size > 50) caratulas.clear();
  caratulas.set(coverId, out);
  return out;
}

/** Se monta una vez en la vista de PC. */
export function useNotchPc() {
  useEffect(() => {
    const t = tauri();
    if (!t) return;
    let vivo = true;
    let ultimo = '';
    const mandar = async (siempre = false) => {
      if (!activo) return;
      const s = usePlayer.getState();
      const track = currentTrack(s);
      const clave = `${track?.id ?? ''}|${s.playing}`;
      if (!siempre && clave === ultimo) return;
      ultimo = clave;
      const caratula = await caratulaChica(track?.coverId);
      if (!vivo) return;
      const acento = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff4e6a';
      void t.event
        .emit('notch-estado', {
          id: track?.id ?? null,
          titulo: track?.title ?? '',
          artista: track?.artist ?? '',
          caratula,
          color: track ? fallbackBackground(track.album + track.artist) : '#333',
          sonando: !!track && s.playing,
          acento,
        })
        .catch(() => {});
    };
    const aplicar = () => {
      void t.core.invoke('notch', { activar: activo }).catch(() => {});
      ultimo = '';
      void mandar(true);
    };
    const quitar = usePlayer.subscribe((s, a) => {
      if (s.queue[s.index] !== a.queue[a.index] || s.playing !== a.playing) void mandar();
    });
    const escuchas = [
      t.event.listen('notch-listo', () => void mandar(true)),
      t.event.listen<{ accion: string }>('notch-accion', ({ payload }) => {
        const p = usePlayer.getState();
        if (payload.accion === 'alternar') p.toggle();
        else if (payload.accion === 'siguiente') p.next();
        else if (payload.accion === 'mostrar') {
          const v = t.window.getCurrentWindow();
          void v.unminimize().then(() => v.show()).then(() => v.setFocus()).catch(() => {});
        }
      }),
    ];
    avisos.add(aplicar);
    aplicar();
    return () => {
      vivo = false;
      quitar();
      avisos.delete(aplicar);
      for (const e of escuchas) void e.then((f) => f()).catch(() => {});
    };
  }, []);
}

/** Configuración → Este PC (solo en la app de PC). */
export function NotchPc() {
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
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v14h14V5h-3.2a2.6 2.6 0 0 1-2.6 2.4h-2.4A2.6 2.6 0 0 1 8.2 5H5z" />
        </svg>
      </span>
      <span className="track-text">
        <span className="settings-label">Notch arriba de la pantalla</span>
        <span className="settings-sub">Carátula, pausa y siguiente arriba al centro. Se esconde solo: pasa el mouse por la rayita para verlo</span>
      </span>
      <span className={`switch ${on ? 'on' : ''}`} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}
