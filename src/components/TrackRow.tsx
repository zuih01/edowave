import { puedeSonar, usePlayer } from '../player/player';
import { useConexion } from '../server/conexion';
import type { Track } from '../types';
import { Cover } from './Cover';
import { MarcaDescarga } from './Descargas';
import { MoreIcon, PlayIcon } from './Icons';
import { openTrackMenu } from './TrackMenu';
import { escritorioActivo } from '../escritorio/activo';
import { clasesFila, empezarArrastre, menuDeFila, useListaSeleccion } from '../escritorio/seleccion';

export function formatDuration(sec: number) {
  if (!sec || !Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Barras animadas que indican la canción que está sonando. */
export function NowPlayingBars({ paused }: { paused?: boolean }) {
  return (
    <span className={`np-bars ${paused ? 'paused' : ''}`} aria-label="Sonando">
      <i />
      <i />
      <i />
    </span>
  );
}

export function TrackRow({
  track,
  showAlbum = true,
  index,
  onPlay,
  playlist,
  fila,
  orden,
  onAsa,
}: {
  track: Track;
  showAlbum?: boolean;
  index?: number;
  onPlay?: () => void;
  /** Si la fila está dentro de una playlist: su menú ofrece "Quitar de esta playlist". */
  playlist?: { id: string; index: number };
  /** Posición en la `ListaSeleccionable` que la envuelve: en PC se puede elegir con clic, Shift y Ctrl. */
  fila?: number;
  /** Teléfono, en una playlist propia: posición para ordenar y el ≡ que se arrastra. */
  orden?: number;
  onAsa?: (e: React.PointerEvent) => void;
}) {
  const lista = useListaSeleccion();
  // En PC, dentro de una lista: clic elige, doble clic (o la carátula) toca, y se puede arrastrar a una playlist.
  const pc = escritorioActivo();
  const sel = pc && lista && fila !== undefined ? lista.sel : null;
  const isCurrent = usePlayer((s) => s.queue[s.index] === track.id);
  const playing = usePlayer((s) => s.playing);
  const disliked = usePlayer((s) => s.ratings[track.id] === -1);
  // Sin conexión con el servidor: las canciones que no están en el teléfono se ven en gris.
  const noDisponible = useConexion((s) => s.largo && s.guardadas >= 0 && !puedeSonar(track.id));

  const botonTocar = sel && (
            <button
              className="thumb-tocar"
              onClick={(e) => {
                e.stopPropagation();
                if (isCurrent) usePlayer.getState().toggle();
                else onPlay?.();
              }}
              aria-label={`Reproducir ${track.title}`}
            >
              <PlayIcon size={20} />
            </button>
  );

  return (
    <div
      className={`track-row ${isCurrent ? 'current' : ''} ${disliked ? 'disliked' : ''} ${noDisponible ? 'no-disponible' : ''} ${sel ? `elegible ${clasesFila(sel, fila!)}` : ''}`}
      onClick={sel ? (e) => sel.clic(fila!, e) : onPlay}
      onDoubleClick={sel ? (e) => !e.shiftKey && !e.ctrlKey && !e.metaKey && onPlay?.() : undefined}
      onContextMenu={
        pc
          ? (e) => {
              e.preventDefault();
              if (sel) menuDeFila(sel, lista!.tracks, fila!, playlist);
              else openTrackMenu(track, { playlist });
            }
          : undefined
      }
      onPointerDown={pc ? (e) => empezarArrastre(e, () => (sel ? sel.arrastrables(fila!).map((n) => lista!.tracks[n]) : [track])) : undefined}
      data-fila={sel ? fila : undefined}
      data-orden={orden}
      aria-selected={sel ? sel.elegidas.has(fila!) : undefined}
      aria-disabled={noDisponible || undefined}
    >
      {index !== undefined ? (
        <span className="track-index">
          {isCurrent ? <NowPlayingBars paused={!playing} /> : index}
          {botonTocar}
        </span>
      ) : (
        <div className="thumb-wrap">
          <Cover coverId={track.coverId} seed={track.album + track.artist} className="thumb" />
          {isCurrent && (
            <div className="thumb-overlay">
              <NowPlayingBars paused={!playing} />
            </div>
          )}
          {botonTocar}
        </div>
      )}
      <div className="track-text">
        <div className="track-title">{track.title}</div>
        <div className="track-sub">
          <MarcaDescarga id={track.id} />
          {track.artist}
          {showAlbum && ` • ${track.album}`}
        </div>
      </div>
      <span className="track-dur">{formatDuration(track.duration)}</span>
      <button
        className="icon-btn more"
        aria-label="Más opciones"
        onClick={(e) => {
          e.stopPropagation();
          if (sel) menuDeFila(sel, lista!.tracks, fila!, playlist);
          else openTrackMenu(track, { playlist });
        }}
      >
        <MoreIcon />
      </button>
      {onAsa && !pc && (
        <span className="fila-asa" role="button" aria-label={`Mover ${track.title}`} onClick={(e) => e.stopPropagation()} onPointerDown={onAsa}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M4 8h16v2H4zm0 6h16v2H4z" />
          </svg>
        </span>
      )}
    </div>
  );
}
