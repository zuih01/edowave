import { useEffect } from 'react';
import { create } from 'zustand';
import { openCreatePlaylist, openSaveToPlaylist, showSnack } from '../components/PlaylistSheets';
import { LIKED_ID } from '../library/playlists';
import { anclarAlCentro } from '../components/menuContextual';
import { closeAllOverlaysThen, closeOverlay, openOverlay, useNav } from '../nav';
import { useVolumen } from '../player/equalizer';
import { currentTrack, usePlayer } from '../player/player';
import { useSocial } from '../server/social';
import { useParty } from '../server/party';
import { useLetraUi } from '../player/letras';
import type { Track } from '../types';

/**
 * Atajos de teclado de la versión de PC (app y web en computador), parecidos a los de Spotify.
 * No se activan mientras escribes en un campo (salvo Ctrl + K / Ctrl + L, que van al buscador).
 * Ctrl + / (o ?) muestra la lista.
 */

type Panel = 'ahora' | 'fila' | null;

/** Canciones elegidas en la lista que se está viendo (la registra useSeleccion mientras hay algo elegido). */
let elegidasActivas: (() => Track[]) | null = null;
export function registrarElegidas(f: (() => Track[]) | null, solo?: () => Track[]) {
  if (f === null && solo && elegidasActivas !== solo) return; // otra lista ya registró las suyas
  elegidasActivas = f;
}

/** Las elegidas si hay; si no, la que suena. */
function cancionesObjetivo(): Track[] {
  const elegidas = elegidasActivas?.() ?? [];
  if (elegidas.length) return elegidas;
  const t = currentTrack(usePlayer.getState());
  return t ? [t] : [];
}

export const ATAJOS: { grupo: string; filas: [string[][], string][] }[] = [
  {
    grupo: 'Reproducción',
    filas: [
      [[['Espacio']], 'Reproducir o pausar'],
      [[['Ctrl', '→'], ['Ctrl', '←']], 'Canción siguiente / anterior'],
      [[['Shift', '→'], ['Shift', '←']], 'Adelantar / retroceder 5 segundos (también → ←)'],
      [[['Ctrl', '↑'], ['Ctrl', '↓']], 'Subir / bajar el volumen (también ↑ ↓)'],
      [[['Ctrl', 'S']], 'Aleatorio'],
      [[['Ctrl', 'R']], 'Repetir'],
      [[['Alt', 'Shift', 'B']], 'Me gusta (las elegidas o la que suena)'],
      [[['P']], 'Guardar en playlist (las elegidas o la que suena)'],
    ],
  },
  {
    grupo: 'Navegación',
    filas: [
      [[['Ctrl', 'K'], ['Ctrl', 'L']], 'Buscar'],
      [[['Alt', '←'], ['Alt', '→']], 'Atrás / adelante'],
      [[['Alt', 'Shift', 'H']], 'Inicio'],
      [[['Alt', 'Shift', 'S']], 'Música que te gustó'],
      [[['Alt', 'Shift', '0']], 'Tu biblioteca'],
      [[['Alt', 'Shift', 'Q']], 'Mostrar u ocultar la fila'],
      [[['Alt', 'Shift', 'L']], 'Mostrar u ocultar la letra'],
      [[['Alt', 'Shift', 'R']], 'Mostrar u ocultar lo que suena'],
      [[['Alt', 'Shift', 'P']], 'Nueva playlist'],
      [[['Ctrl', ',']], 'Configuración'],
      [[['Ctrl', '/']], 'Ver estos atajos'],
    ],
  },
  {
    grupo: 'En una lista de canciones',
    filas: [
      [[['Ctrl', 'A']], 'Elegir todas'],
      [[['Shift', '↑'], ['Shift', '↓']], 'Elegir varias seguidas'],
      [[['Enter']], 'Reproducir las elegidas'],
      [[['Esc']], 'Soltar la selección o cerrar'],
    ],
  },
];

/** Ventana con la lista de atajos (Ctrl + /). */
export const useAyudaAtajos = create<{ open: boolean }>(() => ({ open: false }));
export function abrirAyuda() {
  if (useAyudaAtajos.getState().open) return closeOverlay();
  useAyudaAtajos.setState({ open: true });
  openOverlay(() => useAyudaAtajos.setState({ open: false }));
}

export function AyudaAtajos() {
  const open = useAyudaAtajos((s) => s.open);
  if (!open) return null;
  return (
    <div className="sheet-backdrop esc-atajos-velo" onClick={closeOverlay}>
      <div className="esc-atajos" role="dialog" aria-label="Atajos de teclado" onClick={(e) => e.stopPropagation()}>
        <div className="esc-atajos-cab">
          <h2>Atajos de teclado</h2>
          <button className="pill" onClick={closeOverlay}>
            Cerrar
          </button>
        </div>
        <div className="esc-atajos-cuerpo">
          {ATAJOS.map((g) => (
            <section key={g.grupo}>
              <h3>{g.grupo}</h3>
              {g.filas.map(([combos, texto]) => (
                <div key={texto} className="esc-atajo">
                  <span>{texto}</span>
                  <span className="esc-atajo-teclas">
                    {combos.map((c, i) => (
                      <span key={i} className="esc-atajo-combo">
                        {c.map((k) => (
                          <kbd key={k}>{k}</kbd>
                        ))}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function useAtajos(buscar: () => void, alternarPanel: (p: Exclude<Panel, null>) => void) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const escribiendo = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const altShift = e.altKey && e.shiftKey && !ctrl;
      const ir = (fn: () => void) => {
        e.preventDefault();
        closeAllOverlaysThen(fn);
      };

      // Buscar: funciona siempre, incluso escribiendo en otro campo.
      if (ctrl && !e.altKey && (k === 'k' || k === 'l')) return ir(buscar);
      if (escribiendo && !(el as HTMLInputElement).type?.match(/range/)) return;

      // Con un menú o ventana encima, las teclas son de esa ventana (salvo la ayuda, que se cierra con Ctrl + /).
      if (e.key === 'Escape' && useAyudaAtajos.getState().open) {
        e.preventDefault();
        return closeOverlay();
      }
      const ayuda = ctrl && (e.key === '/' || e.code === 'Slash');
      const encima = !!document.querySelector('.sheet-backdrop, .eq-screen, .esc-perfil-velo');
      if (ayuda || (!ctrl && !e.altKey && e.key === '?' && !encima)) {
        e.preventDefault();
        return abrirAyuda();
      }
      if (encima) return;

      // ---- Navegación
      const nav = useNav.getState();
      if (e.altKey && !ctrl && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (e.key === 'ArrowLeft' && nav.stack.length) history.back();
        else if (e.key === 'ArrowRight' && nav.adelante.length) nav.forward();
        return;
      }
      if (ctrl && !e.altKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        if (e.key === '[' && nav.stack.length) history.back();
        else if (e.key === ']' && nav.adelante.length) nav.forward();
        return;
      }
      if (ctrl && !e.altKey && e.key === ',') return ir(() => nav.push({ type: 'settings' }));
      if (altShift) {
        // e.code: con Alt + Shift algunas teclas cambian de letra según el teclado.
        switch (e.code) {
          case 'KeyH':
            return ir(() => nav.setTab('home'));
          case 'KeyS':
            return ir(() => nav.push({ type: 'playlist', id: LIKED_ID }));
          case 'Digit0':
            return ir(() => nav.setTab('library'));
          case 'KeyQ':
            e.preventDefault();
            return alternarPanel('fila');
          case 'KeyR':
            e.preventDefault();
            return alternarPanel('ahora');
          case 'KeyL':
            e.preventDefault();
            usePlayer.getState().setExpanded(false);
            return useLetraUi.getState().alternar();
          case 'KeyP':
            return ir(() => openCreatePlaylist());
          case 'KeyB': {
            e.preventDefault();
            const ts = cancionesObjetivo();
            if (!ts.length) return;
            const p = usePlayer.getState();
            if (ts.length === 1) {
              const ya = p.ratings[ts[0].id] === 1;
              p.rate(ts[0].id, 1);
              return showSnack(ya ? 'Quitada de Música que te gustó' : 'Guardada en Música que te gustó');
            }
            const faltan = ts.filter((t) => p.ratings[t.id] !== 1);
            if (faltan.length) {
              faltan.forEach((t) => p.rate(t.id, 1));
              return showSnack(`${faltan.length} ${faltan.length === 1 ? 'canción guardada' : 'canciones guardadas'} en Música que te gustó`);
            }
            ts.forEach((t) => p.rate(t.id, 1)); // ya estaban todas: se quitan
            return showSnack(`${ts.length} canciones quitadas de Música que te gustó`);
          }
        }
        return;
      }

      // P: guardar en playlist (las elegidas o la que suena)
      if (!ctrl && !e.altKey && !e.shiftKey && k === 'p') {
        const ts = cancionesObjetivo();
        if (!ts.length) return;
        e.preventDefault();
        anclarAlCentro();
        return openSaveToPlaylist(ts.length === 1 ? ts[0] : ts);
      }

      // ---- Reproducción
      const p = usePlayer.getState();
      if (!currentTrack(p)) return;
      const siguiendo = useSocial.getState().siguiendo !== null; // escuchando con alguien: no se cambia su música
      if (ctrl && !e.altKey && !e.shiftKey && (k === 's' || k === 'r')) {
        e.preventDefault(); // (en el navegador: no guarda la página ni recarga)
        if (siguiendo) return;
        if (useParty.getState().party) return p.setRepeat(); // avisa que en la Party no se usan
        if (k === 's') {
          p.toggleShuffle();
          showSnack(usePlayer.getState().shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado');
        } else {
          p.setRepeat();
          const r = usePlayer.getState().repeat;
          showSnack(r === 'off' ? 'Repetir desactivado' : r === 'all' ? 'Repetir todo' : 'Repetir esta canción');
        }
        return;
      }
      if (e.altKey) return;
      if (e.code === 'Space' && !ctrl) {
        e.preventDefault();
        p.toggle();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (ctrl) (dir > 0 ? p.next : p.prev)();
        else p.seek(Math.max(0, Math.min(p.duration || 0, p.position + dir * 5)));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (e.shiftKey) return; // Shift + ↑ ↓ es para elegir canciones
        e.preventDefault();
        const vol = useVolumen.getState();
        vol.set(Math.max(0, Math.min(1, Math.round((vol.v + (e.key === 'ArrowUp' ? 0.05 : -0.05)) * 100) / 100)));
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [buscar, alternarPanel]);
}
