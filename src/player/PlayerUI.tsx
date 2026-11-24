import { useParty } from '../server/party';
import { useLayoutEffect, useRef, useState } from 'react';
import { useVolumen } from './equalizer';
import { Cover, fallbackBackground } from '../components/Cover';
import {
  ChevronDownIcon,
  CloseIcon,
  MoreIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  ShuffleIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from '../components/Icons';
import { openTrackMenu } from '../components/TrackMenu';
import { formatDuration, NowPlayingBars } from '../components/TrackRow';
import { useCover } from '../library/useCover';
import { useExit } from '../components/useExit';
import { closeAllOverlaysThen, closeOverlay, openOverlay, useNav } from '../nav';
import { useLibrary } from '../library/store';
import { useEqScreen } from '../components/Equalizer';
import { useRackScreen } from '../components/Rack';
import { currentTrack, trackById, usePlayer } from './player';
import { useDominantColor } from './useDominantColor';
/**
 * Interfaz "de app" (hoja de la cola que sube desde abajo, fondo del color de la portada, deslizar la portada):
 * igual en la app de Android y en la web.
 */
const esAppNativa = true;
import { cargarHistorial } from '../server/datosCuenta';
import { GuardarColaBoton } from '../components/GuardarCola';
import type { Track } from '../types';
import { useAutomix } from './automixStore';
import { useSocial } from '../server/social';
import { useVinyl, Vinyl } from './Vinyl';

export function openPlayer() {
  usePlayer.getState().setExpanded(true);
  openOverlay(() => usePlayer.getState().setExpanded(false));
}

/** Barra fija sobre la navegación inferior, como en YT Music. */
export function MiniPlayer() {
  const track = usePlayer(currentTrack);
  const playing = usePlayer((s) => s.playing);
  const pct = usePlayer((s) => (s.duration ? (s.position / s.duration) * 100 : 0));
  const { toggle, next } = usePlayer.getState();
  const siguiendo = useSocial((s) => s.siguiendo !== null);
  if (!track) return null;

  return (
    <div
      className="mini-player"
      // Sobre el ecualizador: primero se cierra (puede venir del reproductor) y luego se abre el reproductor.
      onClick={() => (useEqScreen.getState().open || useRackScreen.getState().open ? closeAllOverlaysThen(openPlayer) : openPlayer())}
    >
      <div className="mini-progress" style={{ width: `${pct}%` }} />
      <Cover key={track.id} coverId={track.coverId} seed={track.album + track.artist} className="mini-cover swap" />
      <div className="track-text swap" key={'t' + track.id}>
        <div className="track-title">{track.title}</div>
        <div className="track-sub">{track.artist}</div>
      </div>
      <button
        className="icon-btn"
        aria-label={playing ? 'Pausar' : 'Reproducir'}
        aria-disabled={siguiendo}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        {playing ? <PauseIcon size={30} /> : <PlayIcon size={30} />}
      </button>
      <button
        className="icon-btn"
        aria-label="Siguiente"
        aria-disabled={siguiendo}
        onClick={(e) => {
          e.stopPropagation();
          next();
        }}
      >
        <NextIcon size={28} />
      </button>
    </div>
  );
}

/** Reproductor a pantalla completa. */
export function FullPlayer() {
  const expanded = usePlayer((s) => s.expanded);
  const track = usePlayer(currentTrack);
  const [view, setView] = useState<'now' | 'queue'>('now');
  const vinyl = useVinyl((s) => s.on);
  const coverUrl = useCover(track?.coverId);
  const color = useDominantColor(coverUrl, track ? fallbackBackground(track.album + track.artist) : undefined);

  const gestoPortada = useGestoPortada();
  const { shown, closing } = useExit(expanded && track ? true : null, 220);
  if (!shown || !track) return null;

  return (
    <div
      className={`full-player ${closing ? 'closing' : ''} ${esAppNativa ? 'con-hoja' : ''}`}
      style={
        esAppNativa
          ? // App de Android: TODO el fondo (reproductor y cola) es un solo color, la portada oscurecida.
            ({ '--fondo': `color-mix(in srgb, ${color} 38%, #0b0b0b)` } as React.CSSProperties)
          : { background: `linear-gradient(180deg, ${color} 0%, #0a0a0a 85%)` }
      }
    >
      <div className="fp-top">
        {/* Cierra el reproductor de una vez, aunque la lista "A continuación" esté abierta. */}
        <button className="icon-btn" onClick={() => closeAllOverlaysThen(() => {})} aria-label="Cerrar reproductor">
          <ChevronDownIcon />
        </button>
        {esAppNativa ? (
          <span />
        ) : (
          <div className="fp-tabs">
            <button className={view === 'now' ? 'active' : ''} onClick={() => setView('now')}>
              Canción
            </button>
            <button className={view === 'queue' ? 'active' : ''} onClick={() => setView('queue')}>
              A continuación
            </button>
          </div>
        )}
        <button className="icon-btn" onClick={() => openTrackMenu(track, { fromPlayer: true })} aria-label="Más opciones">
          <MoreIcon />
        </button>
      </div>

      {view === 'now' ? (
        <div className="fp-art" {...(esAppNativa && !vinyl ? gestoPortada : {})}>
          {vinyl ? (
            <Vinyl key={track.id} track={track} />
          ) : (
            <Cover key={track.id} coverId={track.coverId} seed={track.album + track.artist} className="fp-cover swap" />
          )}
        </div>
      ) : (
        <div className="fp-cola-web">
          <ColaNombreWeb />
          <QueueList />
        </div>
      )}

      <div className="fp-bottom">
        <TitleAndRating />
        <SeekBar />
        <Controls />
        <Volumen />
      </div>
      {esAppNativa && <ColaHoja color={color} />}
    </div>
  );
}

function TitleAndRating() {
  const track = usePlayer(currentTrack)!;
  const rating = usePlayer((s) => s.ratings[track.id]);
  const rate = usePlayer((s) => s.rate);
  return (
    <div className="fp-title-row">
      <div className="track-text">
        <div className="fp-title">{track.title}</div>
        <button className="fp-artist fp-artist-link" onClick={() => irAlArtista(track.artist)}>
          {track.artist}
        </button>
      </div>
      <button className={`icon-btn round-btn ${rating === -1 ? 'on' : ''}`} onClick={() => rate(track.id, -1)} aria-label="No me gusta">
        <ThumbDownIcon filled={rating === -1} />
      </button>
      <button className={`icon-btn round-btn ${rating === 1 ? 'on' : ''}`} onClick={() => rate(track.id, 1)} aria-label="Me gusta">
        <ThumbUpIcon filled={rating === 1} />
      </button>
    </div>
  );
}

function SeekBar() {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  // Automix: la mezcla la decide la app, así que la barra se ve pero no se puede mover.
  // Escuchando con un amigo: él lleva la canción, así que tampoco se puede mover.
  const siguiendo = useSocial((s) => s.siguiendo !== null);
  const locked = useAutomix((s) => s.on) || siguiendo;
  // Mientras arrastras, la barra muestra tu dedo y no la posición real.
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? position;
  const pct = duration ? (value / duration) * 100 : 0;
  return (
    <div className={`seek ${locked ? 'locked' : ''}`}>
      <input
        type="range"
        disabled={locked}
        min={0}
        max={duration || 1}
        step={0.1}
        value={value}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        aria-label="Posición"
      />
      <div className="seek-times">
        <span>{formatDuration(value)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  );
}

/**
 * Volumen de la app, de 0 a 100%. Abajo, donde llega el pulgar: barra gruesa y fácil de agarrar, con un
 * parlante bajo a la izquierda y uno alto a la derecha (tocarlos baja o sube de a 10%). El porcentaje solo
 * aparece mientras lo mueves.
 */
function Volumen() {
  const v = useVolumen((s) => s.v);
  const set = useVolumen((s) => s.set);
  const [moviendo, setMoviendo] = useState(false);
  const pct = Math.round(v * 100);
  const parlante = (alto: boolean) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9z" />
      {alto ? <path d="M14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6zM14 8.5a4.5 4.5 0 0 1 0 7z" /> : <path d="M14 8.5a4.5 4.5 0 0 1 0 7z" />}
    </svg>
  );
  return (
    <div className={`volumen ${moviendo ? 'moviendo' : ''}`}>
      <button className="volumen-btn" onClick={() => set((Math.round(useVolumen.getState().v * 10) - 1) / 10)} aria-label="Bajar volumen">
        {parlante(false)}
      </button>
      <div className="volumen-barra">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          style={{ '--pct': `${pct}%` } as React.CSSProperties}
          onChange={(e) => set(Number(e.target.value) / 100)}
          onPointerDown={() => setMoviendo(true)}
          onPointerUp={() => setMoviendo(false)}
          onPointerCancel={() => setMoviendo(false)}
          onBlur={() => setMoviendo(false)}
          aria-label="Volumen"
          aria-valuetext={`${pct}%`}
        />
        <span className="volumen-burbuja" style={{ left: `calc(${pct}% + ${11 - pct * 0.22}px)` }} aria-hidden="true">
          {pct}%
        </span>
      </div>
      <button className="volumen-btn" onClick={() => set((Math.round(useVolumen.getState().v * 10) + 1) / 10)} aria-label="Subir volumen">
        {parlante(true)}
      </button>
    </div>
  );
}

function Controls() {
  const playing = usePlayer((s) => s.playing);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const { toggle, next, prev, setRepeat, toggleShuffle } = usePlayer.getState();
  const siguiendo = useSocial((s) => s.siguiendo !== null);
  const sinModos = useParty((s) => !!s.party) || siguiendo;
  return (
    <div className={`fp-controls ${siguiendo ? 'juntos' : ''}`}>
      <button className={`icon-btn ${shuffle ? 'on' : 'dim'}`} onClick={toggleShuffle} aria-label="Aleatorio" disabled={sinModos}>
        <ShuffleIcon />
      </button>
      <button className="icon-btn" onClick={prev} aria-label="Anterior" aria-disabled={siguiendo}>
        <PrevIcon size={36} />
      </button>
      <button className="play-big" onClick={toggle} aria-label={playing ? 'Pausar' : 'Reproducir'} aria-disabled={siguiendo}>
        {playing ? <PauseIcon size={36} /> : <PlayIcon size={36} />}
      </button>
      <button className="icon-btn" onClick={next} aria-label="Siguiente" aria-disabled={siguiendo}>
        <NextIcon size={36} />
      </button>
      <button
        className={`icon-btn ${repeat !== 'off' ? 'on' : 'dim'}`}
        onClick={setRepeat}
        disabled={sinModos}
        aria-label={repeat === 'off' ? 'Repetir: no' : repeat === 'all' ? 'Repetir: todo' : 'Repetir: una'}
      >
        <RepeatIcon one={repeat === 'one'} />
      </button>
    </div>
  );
}

export function QueueList() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const { jumpTo, removeAt } = usePlayer.getState();
  const upcoming = queue.length - index - 1;
  // La lista arranca en la canción que suena (las ya escuchadas quedan arriba, por si quieres volver a verlas).
  const lista = useRef<HTMLDivElement>(null);
  const actual = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = lista.current;
    const row = actual.current;
    if (!box || !row) return;
    box.scrollTop = Math.max(0, row.offsetTop - box.offsetTop - 8);
  }, [index]);
  return (
    <div className="fp-queue" ref={lista}>
      <div className="list-count">
        {upcoming > 0 ? `${upcoming} ${upcoming === 1 ? 'canción' : 'canciones'} a continuación` : 'No hay más canciones en la cola'}
      </div>
      {queue.map((id, i) => {
        const t = trackById(id);
        if (!t) return null;
        const isCur = i === index;
        return (
          <div
            key={`${id}-${i}`}
            ref={isCur ? actual : undefined}
            className={`track-row ${isCur ? 'current' : ''} ${i < index ? 'played' : ''}`}
            onClick={() => !isCur && jumpTo(i)}
          >
            <div className="thumb-wrap">
              <Cover coverId={t.coverId} seed={t.album + t.artist} className="thumb" />
              {isCur && (
                <div className="thumb-overlay">
                  <NowPlayingBars paused={!playing} />
                </div>
              )}
            </div>
            <div className="track-text">
              <div className="track-title">{t.title}</div>
              <div className="track-sub">{t.artist}</div>
            </div>
            {!isCur && (
              <button
                className="icon-btn more"
                aria-label="Quitar de la cola"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(i);
                }}
              >
                <CloseIcon />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Web: nombre de la radio ("Mix de …") arriba de la cola, con el botón para guardarla como playlist. */
function ColaNombreWeb() {
  const colaNombre = usePlayer((s) => s.colaNombre);
  if (!colaNombre) return null;
  return (
    <div className="cola-nombre-web">
      <span>{colaNombre}</span>
      <GuardarColaBoton />
    </div>
  );
}

// ================= App de Android: "A continuación" como hoja que sube desde abajo =================

/** Sigue al dedo aunque salga del elemento (si el navegador no puede, se sigue igual sin eso). */
function capturar(e: React.PointerEvent) {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* sin captura */
  }
}

/** Alto de la franja que asoma abajo del reproductor ("Mix de …") con la hoja cerrada. */
const ASOMA = 68;

/**
 * Cola en una hoja que se desliza desde abajo (solo en la app de Android). Se abre tocando la franja o
 * deslizándola hacia arriba; se cierra deslizando hacia abajo o con "atrás". Arriba de la hoja quedan siempre
 * la canción y los controles. Filtros "conocidas / por descubrir", arrastrar ≡ para reordenar y deslizar una
 * canción hacia la izquierda para quitarla.
 */
function ColaHoja({ color }: { color: string }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const colaNombre = usePlayer((s) => s.colaNombre);
  const [abierta, setAbierta] = useState(false);
  const hoja = useRef<HTMLDivElement>(null);
  const titulo = colaNombre ?? 'A continuación';
  const siguiente = trackById(queue[index + 1]);

  // ---- Arrastrar la hoja (sigue al dedo; al soltar se abre o se cierra con un pequeño rebote) ----
  // Abierta llega solo hasta la MITAD: justo debajo de los controles del reproductor (portada, título, barra y
  // controles siguen a la vista arriba).
  const [abiertaY, setAbiertaY] = useState(0);
  /** La hoja abierta llega a la mitad de la pantalla (un poco más abajo). */
  const medirAbierta = () => Math.round((hoja.current?.parentElement?.clientHeight ?? 800) * 0.54);
  // Con la hoja abierta, el título, la barra y los controles suben hasta quedar justo encima de ella, y la
  // portada queda atrás, más tenue, como fondo (lo hace el CSS con --subir).
  useLayoutEffect(() => {
    const fp = hoja.current?.parentElement;
    if (!fp) return;
    if (abierta) {
      const ctrl = fp.querySelector('.fp-bottom .fp-controls');
      const fin = ctrl ? ctrl.getBoundingClientRect().bottom - fp.getBoundingClientRect().top : abiertaY;
      fp.style.setProperty('--subir', `${Math.max(0, Math.round(fin - abiertaY + 10))}px`);
    }
    fp.classList.toggle('cola-abierta', abierta);
  }, [abierta, abiertaY]);
  const drag = useRef<{ y0: number; base: number; t0: number; y: number; cerrada: number; arriba: number } | null>(null);
  const cerradaY = () => (hoja.current?.parentElement?.clientHeight ?? 800) - ASOMA;
  const poner = (y: number | null) => {
    const el = hoja.current;
    if (!el) return;
    el.style.transition = y === null ? '' : 'none';
    el.style.transform = y === null ? '' : `translate3d(0, ${y}px, 0)`;
  };
  // Completa: la lista ocupa TODA la pantalla. Se llega solo deslizando con fuerza hacia arriba desde la mitad.
  const [completa, setCompleta] = useState(false);
  /** Cuánto hay que pasar la mitad (con el dedo) para que quede completa: tiene que ser a propósito. */
  const FORZAR = 140;
  const abrir = () => {
    if (abierta) return;
    setAbiertaY(medirAbierta());
    setAbierta(true);
    openOverlay(() => {
      setAbierta(false);
      setCompleta(false);
    });
  };
  const cerrar = () => {
    if (abierta) closeOverlay();
  };
  const empezar = (e: React.PointerEvent) => {
    const cerrada = cerradaY();
    const arriba = medirAbierta();
    drag.current = { y0: e.clientY, base: !abierta ? cerrada : completa ? 0 : arriba, t0: performance.now(), y: e.clientY, cerrada, arriba };
    capturar(e);
  };
  const moverHoja = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.y = e.clientY;
    const dy = e.clientY - d.y0;
    if (Math.abs(dy) < 4) return;
    let y = d.base + dy;
    // Pasada la mitad hacia arriba la hoja resiste (cuesta subirla: así no se abre completa sin querer);
    // en el tope de arriba y en el de abajo, rebota como una goma.
    if (!completa && y < d.arriba) y = d.arriba - (d.arriba - y) / 2.2;
    if (y < 0) y = y / 4;
    if (y > d.cerrada) y = d.cerrada + (y - d.cerrada) / 4;
    poner(y);
  };
  const soltar = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dy = d.y - d.y0;
    poner(null);
    if (Math.abs(dy) < 6) {
      if (!abierta) abrir(); // fue un toque
      return;
    }
    const vel = dy / Math.max(1, performance.now() - d.t0); // px por ms (negativo = hacia arriba)
    const final = d.base + dy;
    if (completa) {
      // Completa → bajando un poco queda a la mitad; bajando mucho se cierra.
      if (final > (d.arriba + d.cerrada) / 2 || vel > 1.2) {
        setCompleta(false);
        cerrar();
      } else if (final > d.arriba * 0.35 || vel > 0.4) setCompleta(false);
      return;
    }
    if (abierta && (d.arriba - final > FORZAR || (vel < -1.1 && d.arriba - final > 60))) {
      setCompleta(true); // empujón fuerte hacia arriba: lista completa
      return;
    }
    if (vel < -0.4 || (vel < 0.4 && final < (d.arriba + d.cerrada) / 2)) abrir();
    else cerrar();
  };
  const arrastre = { onPointerDown: empezar, onPointerMove: moverHoja, onPointerUp: soltar, onPointerCancel: soltar };

  return (
    <div
      ref={hoja}
      className={`cola-hoja ${abierta ? 'abierta' : ''} ${abierta && completa ? 'completa' : ''}`}
      style={{ '--hoja-color': color, '--asoma': `${ASOMA}px`, '--abierta-y': `${abiertaY}px` } as React.CSSProperties}
    >
      {/* Franja que asoma con la hoja cerrada */}
      <div className="cola-asoma" {...arrastre} role="button" aria-label={`${titulo}: abrir la cola`}>
        <span className="cola-manija" aria-hidden="true" />
        <span className="cola-asoma-titulo">{titulo}</span>
        {siguiente && <span className="cola-asoma-sig">Sigue: {siguiente.title}</span>}
      </div>

      {/* Hoja abierta: la manija para bajarla (arriba siguen la portada, la barra y los controles) */}
      <div className="cola-cabecera" {...arrastre} aria-label="Bajar la cola" role="button">
        <span className="cola-manija" aria-hidden="true" />
      </div>

      {abierta && <ColaLista titulo={titulo} />}
    </div>
  );
}

type Filtro = 'todas' | 'conocidas' | 'nuevas';
const ALTO_FILA = 64;

function ColaLista({ titulo }: { titulo: string }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const ratings = usePlayer((s) => s.ratings);
  const { jumpTo, removeAt, mover } = usePlayer.getState();
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [escuchadas, setEscuchadas] = useState<Set<string>>(new Set());
  useLayoutEffect(() => {
    let vivo = true;
    void cargarHistorial(1000).then((h) => {
      if (vivo) setEscuchadas(new Set(h.filter((p) => p.completed || p.listened >= 30).map((p) => p.trackId)));
    });
    return () => {
      vivo = false;
    };
  }, []);
  const conocida = (id: string) => escuchadas.has(id) || ratings[id] === 1;

  // La lista arranca en la canción que suena.
  const lista = useRef<HTMLDivElement>(null);
  const actual = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = lista.current;
    const row = actual.current;
    if (box && row) box.scrollTop = Math.max(0, row.offsetTop - box.offsetTop - 8);
  }, [index, filtro]);

  // ---- Reordenar arrastrando ≡ ----
  const [moviendo, setMoviendoEstado] = useState<{ de: number; dy: number } | null>(null);
  const moviendoRef = useRef<{ de: number; dy: number } | null>(null);
  const setMoviendo = (m: { de: number; dy: number } | null) => {
    moviendoRef.current = m;
    setMoviendoEstado(m);
  };
  const y0 = useRef(0);
  const destino = (m: { de: number; dy: number }) => Math.max(0, Math.min(queue.length - 1, m.de + Math.round(m.dy / ALTO_FILA)));
  const desplazamiento = (i: number) => {
    if (!moviendo || moviendo.de === i) return 0;
    const a = destino(moviendo);
    if (moviendo.de < i && i <= a) return -ALTO_FILA;
    if (moviendo.de > i && i >= a) return ALTO_FILA;
    return 0;
  };

  // ---- Deslizar una canción a la izquierda para quitarla ----
  const [quitando, setQuitando] = useState<{ i: number; dx: number } | null>(null);
  const x0 = useRef({ x: 0, y: 0, horizontal: false });

  const visibles = queue
    .map((id, i) => ({ id, i, t: trackById(id) }))
    .filter((x): x is { id: string; i: number; t: Track } => !!x.t)
    .filter((x) => x.i === index || filtro === 'todas' || (filtro === 'conocidas' ? conocida(x.id) : !conocida(x.id)));

  const chip = (f: Filtro, texto: string) => (
    <button className={`cola-chip ${filtro === f ? 'activo' : ''}`} onClick={() => setFiltro(filtro === f ? 'todas' : f)}>
      {texto}
    </button>
  );
  const quedan = queue.length - index - 1;

  return (
    <div className="cola-cuerpo">
      <div className="cola-titulo">
        <h2>{titulo}</h2>
        <span className="cola-cuenta">{quedan > 0 ? `${quedan} a continuación` : 'Última de la cola'}</span>
        <GuardarColaBoton />
      </div>
      <div className="cola-chips">
        {chip('conocidas', 'Canciones conocidas')}
        {chip('nuevas', 'Canciones por descubrir')}
      </div>
      <div className="cola-lista" ref={lista}>
        {visibles.map(({ id, i, t }, n) => {
          const isCur = i === index;
          const levantada = moviendo?.de === i;
          const dx = quitando?.i === i ? quitando.dx : 0;
          return (
            <div
              key={`${id}-${i}`}
              ref={isCur ? actual : undefined}
              className={`cola-fila ${isCur ? 'actual' : ''} ${i < index ? 'pasada' : ''} ${levantada ? 'levantada' : ''} ${moviendo || dx ? 'sin-transicion' : ''}`}
              style={{
                transform: `translate3d(${dx}px, ${levantada ? moviendo!.dy : desplazamiento(i)}px, 0)`,
                animationDelay: `${Math.min(n, 12) * 18}ms`,
                opacity: dx ? Math.max(0.2, 1 + dx / 260) : undefined,
              }}
              onClick={() => {
                if (!isCur && !moviendo && !x0.current.horizontal) jumpTo(i);
              }}
              onPointerDown={(e) => {
                x0.current = { x: e.clientX, y: e.clientY, horizontal: false };
              }}
              onPointerMove={(e) => {
                if (isCur || moviendo || e.buttons === 0) return;
                const mx = e.clientX - x0.current.x;
                const my = e.clientY - x0.current.y;
                if (!x0.current.horizontal && Math.abs(mx) > 14 && Math.abs(mx) > Math.abs(my) * 1.5) {
                  x0.current.horizontal = true;
                  capturar(e);
                }
                if (x0.current.horizontal) setQuitando({ i, dx: Math.min(0, mx) });
              }}
              onPointerUp={() => {
                if (quitando?.i === i) {
                  if (quitando.dx < -110) removeAt(i);
                  setQuitando(null);
                }
              }}
              onPointerCancel={() => setQuitando(null)}
            >
              <div className="thumb-wrap">
                <Cover coverId={t.coverId} seed={t.album + t.artist} className="thumb" />
                {isCur && (
                  <div className="thumb-overlay">
                    <NowPlayingBars paused={!playing} />
                  </div>
                )}
              </div>
              <div className="track-text">
                <div className="track-title">{t.title}</div>
                <div className="track-sub">
                  {t.artist} · {formatDuration(t.duration)}
                </div>
              </div>
              {!isCur && (
                <span
                  className="cola-mover"
                  aria-label={`Mover ${t.title}`}
                  role="button"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    capturar(e);
                    y0.current = e.clientY;
                    setMoviendo({ de: i, dy: 0 });
                  }}
                  onPointerMove={(e) => {
                    if (moviendoRef.current?.de === i) setMoviendo({ de: i, dy: e.clientY - y0.current });
                  }}
                  onPointerUp={() => {
                    const m2 = moviendoRef.current;
                    if (m2?.de === i) mover(i, destino(m2));
                    setMoviendo(null);
                  }}
                  onPointerCancel={() => setMoviendo(null)}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M4 8h16v2H4zm0 6h16v2H4z" />
                  </svg>
                </span>
              )}
            </div>
          );
        })}
        {visibles.length <= 1 && filtro !== 'todas' && (
          <p className="cola-vacia">{filtro === 'conocidas' ? 'No hay canciones que ya conozcas en esta cola.' : 'Todas las de esta cola ya las conoces.'}</p>
        )}
      </div>
    </div>
  );
}

// ================= App de Android: deslizar la portada para cambiar de canción =================

/**
 * En el reproductor (app de Android), deslizar la portada de derecha a izquierda pasa a la SIGUIENTE canción
 * (y de izquierda a derecha, a la anterior). La portada sigue al dedo; si no llegas lejos, vuelve con un rebote.
 * (Deslizar desde el mismo borde izquierdo sigue siendo "atrás".)
 */
function useGestoPortada() {
  const g = useRef<{ x0: number; y0: number; dx: number; el: HTMLElement | null; horizontal: boolean | null } | null>(null);
  const LIMITE = 80;
  const mover = (el: HTMLElement | null, dx: number, animado: boolean) => {
    if (!el) return;
    el.style.transition = animado ? 'transform 0.35s var(--rebote), opacity 0.25s' : 'none';
    el.style.transform = dx ? `translate3d(${dx}px, 0, 0) rotate(${dx / 40}deg)` : '';
    el.style.opacity = dx ? String(Math.max(0.35, 1 - Math.abs(dx) / 400)) : '';
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.clientX <= 24) return; // el borde izquierdo es "atrás"
      const el = (e.currentTarget as HTMLElement).firstElementChild as HTMLElement | null;
      g.current = { x0: e.clientX, y0: e.clientY, dx: 0, el, horizontal: null };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = g.current;
      if (!d) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (d.horizontal === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        d.horizontal = Math.abs(dx) > Math.abs(dy) * 1.3;
        if (!d.horizontal) return;
        capturar(e);
      }
      if (!d.horizontal) return;
      d.dx = dx;
      mover(d.el, dx, false);
    },
    onPointerUp: () => {
      const d = g.current;
      g.current = null;
      if (!d?.horizontal) return;
      const p = usePlayer.getState();
      if (d.dx < -LIMITE) {
        mover(d.el, -window.innerWidth, true); // sale por la izquierda; la nueva entra sola
        navigator.vibrate?.(8);
        p.next();
      } else if (d.dx > LIMITE) {
        mover(d.el, window.innerWidth, true);
        navigator.vibrate?.(8);
        p.prev();
      } else mover(d.el, 0, true); // no llegó: vuelve a su lugar
    },
    onPointerCancel: () => {
      if (g.current) mover(g.current.el, 0, true);
      g.current = null;
    },
  };
}

/**
 * Toca el artista en el reproductor → se cierra el reproductor y se abre su página (álbumes y canciones).
 * En una colaboración ("The Weeknd y Ariana Grande") va al primero que tenga página propia.
 */
export function irAlArtista(nombre: string) {
  const artistas = useLibrary.getState().artists;
  const existe = (n: string) => artistas.find((a) => a.name.toLowerCase() === n.trim().toLowerCase())?.name;
  const destino =
    existe(nombre) ??
    nombre
      .split(/\s*(?:,|&|\+|\bfeat\.?|\bft\.?|\s+x\s+|\s+y\s+|\s+and\s+|\s+con\s+)\s*/i)
      .map(existe)
      .find((x): x is string => !!x);
  if (!destino) return;
  closeAllOverlaysThen(() => useNav.getState().push({ type: 'artist', name: destino }));
}
