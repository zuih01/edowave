import { useEffect, useRef } from 'react';
import { fallbackColors } from '../components/Cover';
import { useCover } from '../library/useCover';
import type { Track } from '../types';
import { audio, usePlayer } from './player';
import { deckBusy, deckHold, deckNudge, deckOwns, deckRelease, deckVel } from './scratch';
import { grabarGesto, useSocial } from '../server/social';

export { useVinyl, viniloDisponible } from './scratch';

const RPM = 45;
const MAX_SPEED = (360 * RPM) / 60; // 270 grados por segundo = 1 segundo de música por cada 3/4 de vuelta
// (Solo si el motor no está disponible) el disco frena usando la velocidad del reproductor normal:
const STOP_TIME = 0.45;
const START_TIME = 0.6;
const MIN_RATE = 0.07;

/**
 * Disco de vinilo que gira a 45 rpm mientras suena. La etiqueta del centro es la portada.
 *
 * El sonido lo hace el tocadiscos (scratch.ts): el disco solo dibuja lo que hace el motor y le pasa los
 * movimientos del dedo. Apoyar el dedo lo frena, moverlo hace scratch, levantarlo deja que el plato lo
 * arrastre de nuevo a velocidad. Nunca se cambia de reproductor, así que no hay pausas.
 *
 * Si el motor todavía está preparando la canción (o el navegador no lo permite), el disco solo frena
 * y arranca usando la velocidad del reproductor normal.
 */
export function Vinyl({ track }: { track: Track }) {
  const playing = usePlayer((s) => s.playing);
  const coverUrl = useCover(track.coverId);
  const discRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Estado del giro fuera de React (se actualiza 60 veces por segundo).
  const st = useRef({
    angle: 0,
    speed: playing ? MAX_SPEED : 0,
    held: false,
    /** El dedo está sobre el disco y el motor del tocadiscos tiene el sonido. */
    onDeck: false,
    /** (sin motor) al soltar se reanuda con la velocidad del reproductor normal. */
    resumeOnRelease: false,
    finger: 0,
    raf: 0,
    last: 0,
    safety: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    const s = st.current;
    const tick = (now: number) => {
      const dt = s.last ? Math.min(0.05, (now - s.last) / 1000) : 0;
      s.last = now;

      if (deckOwns()) {
        // El disco gira exactamente a la velocidad a la que suena (adelante o atrás).
        s.speed = deckVel() * MAX_SPEED;
      } else {
        const target = !s.held && playingRef.current ? MAX_SPEED : 0;
        const rate = MAX_SPEED / (target > s.speed ? START_TIME : STOP_TIME);
        s.speed = target > s.speed ? Math.min(target, s.speed + rate * dt) : Math.max(target, s.speed - rate * dt);
        if (s.held || (s.resumeOnRelease && s.speed < MAX_SPEED)) {
          const r = Math.max(MIN_RATE, s.speed / MAX_SPEED);
          if (Math.abs(audio.playbackRate - r) > 0.005) audio.playbackRate = r;
          if (s.held && s.speed <= MAX_SPEED * MIN_RATE && !audio.paused) audio.pause();
        } else if (audio.playbackRate !== 1) {
          audio.playbackRate = 1;
          s.resumeOnRelease = false;
        }
      }
      s.angle = (((s.angle + s.speed * dt) % 360) + 360) % 360;
      if (discRef.current) discRef.current.style.transform = `rotate(${s.angle}deg)`;
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);

    // Si la pantalla se apaga o cambias de app con el dedo encima, se suelta el disco.
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      if (s.onDeck) deckRelease();
      else if (s.held && !audio.paused) audio.pause();
      s.held = false;
      s.onDeck = false;
      s.resumeOnRelease = false;
      audio.playbackRate = 1;
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (s.onDeck) deckRelease();
      clearTimeout(s.safety);
      cancelAnimationFrame(s.raf);
      audio.playbackRate = 1;
    };
  }, []);

  /** Ángulo del dedo alrededor del centro del disco (grados, sentido horario) y qué tan lejos del centro está. */
  const fingerAt = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return { angle: (Math.atan2(dy, dx) * 180) / Math.PI, dist: Math.hypot(dx, dy) / (r.width / 2) };
  };

  // Escuchando con un amigo: el disco es suyo (gira y hace su scratch), aquí no se puede tocar.
  const bloqueado = useSocial((s) => s.siguiendo !== null);

  const press = (e: React.PointerEvent) => {
    if (useSocial.getState().siguiendo !== null) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // seguir el dedo aunque salga del disco
    } catch {
      /* puntero no capturable: no pasa nada */
    }
    const s = st.current;
    s.held = true;
    s.finger = fingerAt(e).angle;
    clearTimeout(s.safety);
    if (deckOwns()) {
      s.onDeck = true;
      deckHold();
      grabarGesto('h'); // los amigos que escuchan contigo oyen tu scratch
      return;
    }
    if (deckBusy()) {
      // El tocadiscos está preparando la canción (un instante): el toque no hace nada todavía.
      s.held = false;
      return;
    }
    // Sin motor: solo frena con la velocidad del reproductor normal.
    s.onDeck = false;
    s.resumeOnRelease = playingRef.current;
    audio.preservesPitch = false; // el tono baja al frenar, como en un tocadiscos
    s.safety = setTimeout(() => {
      if (s.held && !audio.paused) audio.pause();
    }, (STOP_TIME + 0.15) * 1000);
  };

  const move = (e: React.PointerEvent) => {
    const s = st.current;
    if (!s.held || !s.onDeck) return;
    const { angle, dist } = fingerAt(e);
    let d = ((angle - s.finger + 540) % 360) - 180; // cuánto giró el dedo desde el último movimiento
    s.finger = angle;
    // Cerca del centro un movimiento pequeño cambia mucho el ángulo: ahí se suaviza para que sea cómodo.
    d *= Math.max(0.3, Math.min(1, dist / 0.45));
    d = Math.max(-40, Math.min(40, d));
    if (Math.abs(d) > 0.1) {
      deckNudge(d / MAX_SPEED);
      grabarGesto('n', d / MAX_SPEED);
    }
  };

  const release = () => {
    const s = st.current;
    if (!s.held) return;
    s.held = false;
    clearTimeout(s.safety);
    if (s.onDeck) {
      s.onDeck = false;
      deckRelease(); // el plato lo vuelve a arrastrar (o queda quieto si está detenido)
      grabarGesto('r');
      return;
    }
    if (s.resumeOnRelease) {
      audio.playbackRate = Math.max(MIN_RATE, s.speed / MAX_SPEED);
      if (audio.paused) usePlayer.getState().toggle();
      s.safety = setTimeout(() => {
        s.resumeOnRelease = false;
        audio.playbackRate = 1;
        audio.preservesPitch = true;
      }, (START_TIME + 0.6) * 1000);
    }
  };

  const [a, b] = fallbackColors(track.album + track.artist);
  return (
    <div
      ref={boxRef}
      className={`vinyl ${bloqueado ? 'bloqueado' : ''}`}
      role="button"
      aria-disabled={bloqueado}
      aria-label={bloqueado ? 'Disco de vinilo de tu amigo (no se puede tocar)' : 'Disco de vinilo: mantén presionado para frenarlo y muévelo para hacer scratch'}
      onPointerDown={press}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="vinyl-disc" ref={discRef}>
        <div
          className="vinyl-label"
          style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : { background: `linear-gradient(135deg, ${a}, ${b})` }}
        />
        <div className="vinyl-hole" />
      </div>
      {/* El reflejo de luz no gira: así se nota el movimiento como en un disco real */}
      <div className="vinyl-sheen" aria-hidden="true" />
    </div>
  );
}
