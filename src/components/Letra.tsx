import { useEffect, useRef, useState } from 'react';
import type { Track } from '../types';
import { currentTrack, playerPos, usePlayer } from '../player/player';
import { useLetra, useLetraUi, useLineaActual, type Linea } from '../player/letras';
import { useAutomix } from '../player/automixStore';
import { useSocial } from '../server/social';
import { Cover, fallbackBackground } from './Cover';
import { useCover } from '../library/useCover';
import { useDominantColor } from '../player/useDominantColor';
import { ChevronDownIcon, LetraIcon } from './Icons';
import { useExit } from './useExit';
import { closeOverlay, openOverlay } from '../nav';
import { FondoLetra } from './FondoLetra';

/** Cuánto dura una línea para el llenado: hasta la siguiente, pero sin pasarse de lo que toma cantarla. */
function duracion(lineas: Linea[], i: number): number {
  const l = lineas[i];
  const sig = lineas[i + 1]?.t ?? l.t + 6;
  if (l.pausa) return Math.max(0.5, sig - l.t);
  return Math.max(0.4, Math.min(sig - l.t, 1 + l.texto.length * 0.1));
}

/**
 * Una línea partida en palabras para llenarla de izquierda a derecha. LRCLIB solo da el inicio de cada línea, así que
 * el tiempo se reparte entre las palabras según su largo: cada una sabe en qué tramo (--a a --a + 1/--k) se enciende.
 */
function Palabras({ texto }: { texto: string }) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const total = palabras.reduce((n, w) => n + w.length + 1, 0) || 1;
  let hecho = 0;
  return (
    <>
      {palabras.map((w, i) => {
        const a = hecho / total;
        hecho += w.length + 1;
        const k = total / (w.length + 1);
        return (
          <span key={i}>
            {i > 0 && ' '}
            <span className="palabra" style={{ '--a': a.toFixed(4), '--k': k.toFixed(4) } as React.CSSProperties}>
              {w}
            </span>
          </span>
        );
      })}
    </>
  );
}

/**
 * Letra de la canción que suena (estética de "Beautiful Lyrics"): lo que no suena va a medio brillo y algo borroso
 * según lo lejos que esté; la línea actual crece un poco y se llena de blanco de izquierda a derecha, palabra por palabra, mientras se canta, con
 * un brillo suave. Las pausas son tres puntos que se encienden de a uno. Tocar una línea salta a ese momento.
 */
export function LetraLista({ track, activa }: { track: Track; activa: boolean }) {
  const letra = useLetra(track);
  const actual = useLineaActual(letra.lineas, activa && letra.sincronizada);
  const automix = useAutomix((s) => s.on);
  const siguiendo = useSocial((s) => s.siguiendo !== null);
  const bloqueado = automix || siguiendo;
  const caja = useRef<HTMLDivElement>(null);
  const [libre, setLibre] = useState(false); // la persona movió la letra a mano: no la seguimos por un rato
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const soltar = () => {
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setLibre(false), 4000);
  };
  const mover = () => {
    setLibre(true);
    soltar();
  };

  // La línea actual se mantiene a un tercio del alto, con desplazamiento suave.
  useEffect(() => {
    const c = caja.current;
    if (!c || actual < 0 || libre) return;
    const el = c.querySelector<HTMLElement>(`[data-i="${actual}"]`);
    if (!el) return;
    c.scrollTo({ top: Math.max(0, el.offsetTop - c.clientHeight * 0.4 + el.offsetHeight / 2), behavior: 'smooth' });
  }, [actual, libre]);
  // Llenado de la línea actual: se escribe directo en el estilo (sin repintar React ~60 veces por segundo)
  useEffect(() => {
    const c = caja.current;
    if (!c || actual < 0 || !letra.sincronizada) return;
    const el = c.querySelector<HTMLElement>(`[data-i="${actual}"]`);
    const l = letra.lineas[actual];
    if (!el || !l) return;
    const dur = duracion(letra.lineas, actual);
    let raf = 0;
    let previo = -1;
    const tick = () => {
      const p = Math.max(0, Math.min(1, (playerPos() + 0.15 - l.t) / dur));
      if (Math.abs(p - previo) > 0.004) {
        el.style.setProperty('--p', p.toFixed(3));
        previo = p;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.style.removeProperty('--p');
    };
  }, [actual, letra]);
  // Al cambiar de canción, vuelve arriba
  useEffect(() => {
    caja.current?.scrollTo({ top: 0 });
    setLibre(false);
  }, [track.id]);

  if (letra.estado === 'cargando') return <div className="letra-estado">Buscando la letra…</div>;
  if (letra.estado === 'error') return <div className="letra-estado">No se pudo cargar la letra. Revisa tu conexión.</div>;
  if (letra.estado === 'instrumental') return <div className="letra-estado">Instrumental</div>;
  if (letra.estado === 'sin') return <div className="letra-estado">No hay letra para esta canción.</div>;

  return (
    <div className={`letra-caja ${letra.sincronizada ? 'sincronizada' : ''} ${libre ? 'libre' : ''}`} ref={caja} onWheel={mover} onTouchMove={mover} onPointerDown={mover}>
      <div className="letra-relleno" />
      {letra.sincronizada
        ? letra.lineas.map((l, i) => {
            const clase = i === actual ? 'actual' : i < actual ? 'pasada' : 'futura';
            const lejos = { '--d': Math.min(Math.abs(i - Math.max(actual, 0)), 4) } as React.CSSProperties;
            return l.pausa ? (
              <div key={i} data-i={i} className={`letra-linea pausa ${clase}`} style={lejos} aria-hidden="true">
                <span style={{ '--n': 0 } as React.CSSProperties} />
                <span style={{ '--n': 1 } as React.CSSProperties} />
                <span style={{ '--n': 2 } as React.CSSProperties} />
              </div>
            ) : (
              <button
                key={i}
                data-i={i}
                className={`letra-linea ${clase}`}
                style={lejos}
                disabled={bloqueado}
                onClick={() => {
                  usePlayer.getState().seek(l.t);
                  setLibre(false);
                }}
              >
                <Palabras texto={l.texto} />
              </button>
            );
          })
        : letra.texto.map((t, i) => (
            <div key={i} className={`letra-linea plana ${t ? '' : 'vacia'}`}>
              {t || ' '}
            </div>
          ))}
      <div className="letra-relleno final" />
      {libre && letra.sincronizada && actual >= 0 && (
        <button className="letra-volver" onClick={() => setLibre(false)}>
          Volver a la letra
        </button>
      )}
    </div>
  );
}

/** Teléfono: la letra sube desde abajo como una hoja; se cierra deslizando hacia abajo o con "atrás". */
export function LetraHoja({ color }: { color: string }) {
  const abierta = useLetraUi((s) => s.abierta);
  const track = usePlayer(currentTrack);
  const { shown, closing } = useExit(abierta && track ? true : null, 260);
  const abiertoEnHistorial = useRef(false);
  const hoja = useRef<HTMLDivElement>(null);
  const [dy, setDy] = useState(0);
  const arrastre = useRef<{ y0: number; t0: number; activo: boolean } | null>(null);
  const playing = usePlayer((s) => s.playing);
  const portada = useCover(track?.coverId);

  // "Atrás" del teléfono (y el gesto de atrás de iOS/Android) cierra la hoja
  useEffect(() => {
    if (abierta && !abiertoEnHistorial.current) {
      abiertoEnHistorial.current = true;
      openOverlay(() => {
        abiertoEnHistorial.current = false;
        useLetraUi.getState().cerrar();
      });
    }
    if (!abierta) abiertoEnHistorial.current = false;
  }, [abierta]);

  if (!shown || !track) return null;
  const cerrar = () => (abiertoEnHistorial.current ? closeOverlay() : useLetraUi.getState().cerrar());

  const empezar = (e: React.TouchEvent) => {
    const enLista = (e.target as HTMLElement).closest('.letra-caja') as HTMLElement | null;
    // Desde la cabecera siempre; desde la letra solo si está arriba del todo
    arrastre.current = { y0: e.touches[0].clientY, t0: performance.now(), activo: !enLista || enLista.scrollTop <= 0 };
  };
  const arrastrar = (e: React.TouchEvent) => {
    const a = arrastre.current;
    if (!a?.activo) return;
    const d = e.touches[0].clientY - a.y0;
    if (d > 0) setDy(d);
  };
  const terminar = () => {
    const a = arrastre.current;
    arrastre.current = null;
    if (!a?.activo) return;
    const v = dy / Math.max(1, performance.now() - a.t0); // px por ms
    if (dy > 140 || (dy > 40 && v > 0.6)) cerrar();
    setDy(0);
  };

  return (
    <div className={`letra-hoja ${closing ? 'cerrando' : ''}`} style={{ '--hoja-color': color } as React.CSSProperties}>
      <FondoLetra url={portada} color={color} />
      <div className="letra-mini">
        <Cover coverId={track.coverId} seed={track.album + track.artist} className="letra-mini-portada" />
        <div className="letra-mini-texto">
          <div className="letra-mini-titulo">{track.title}</div>
          <div className="letra-mini-artista">{track.artist}</div>
        </div>
        <button className="icon-btn" onClick={() => usePlayer.getState().toggle()} aria-label={playing ? 'Pausar' : 'Reproducir'}>
          {playing ? '❚❚' : '▶'}
        </button>
      </div>
      <div
        ref={hoja}
        className={`letra-panel ${dy ? 'arrastrando' : ''}`}
        style={{ transform: dy ? `translate3d(0, ${dy}px, 0)` : undefined }}
        onTouchStart={empezar}
        onTouchMove={arrastrar}
        onTouchEnd={terminar}
        onTouchCancel={terminar}
      >
        <div className="letra-agarre" aria-hidden="true" />
        <header className="letra-cab">
          <h2>Letra</h2>
          <button className="icon-btn" onClick={cerrar} aria-label="Cerrar la letra">
            <ChevronDownIcon size={28} />
          </button>
        </header>
        <LetraListaConAudio track={track} />
      </div>
    </div>
  );
}

const LetraListaConAudio = ({ track }: { track: Track }) => <LetraLista track={track} activa />;

/** PC: la letra ocupa el centro, con el color de la carátula de fondo. Esc o el botón de abajo la cierran. */
export function VistaLetra() {
  const track = usePlayer(currentTrack);
  const url = useCover(track?.coverId);
  const color = useDominantColor(url, track ? fallbackBackground(track.album + track.artist) : undefined);
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && useLetraUi.getState().cerrar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);
  if (!track) return null;
  return (
    <section className="esc-letra" style={{ '--tinte': color } as React.CSSProperties} aria-label="Letra de la canción">
      <FondoLetra url={url} color={color} />
      <header className="esc-letra-cab">
        <strong>{track.title}</strong>
        <span>{track.artist}</span>
        <button className="icon-btn" onClick={() => useLetraUi.getState().cerrar()} title="Cerrar (Esc)" aria-label="Cerrar la letra">
          <ChevronDownIcon size={26} />
        </button>
      </header>
      <LetraLista track={track} activa />
    </section>
  );
}

/** Botón "Letra" junto a los pulgares (teléfono): se oculta si ya se sabe que la canción no tiene letra. */
export function BotonLetra({ track }: { track: Track }) {
  const letra = useLetra(track);
  if (letra.estado === 'sin') return null;
  return (
    <button className="letra-pildora" onClick={() => useLetraUi.getState().abrir()}>
      <LetraIcon size={20} /> Letra
    </button>
  );
}
