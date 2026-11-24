import { trackById, usePlayer } from '../player/player';
import { PlaylistAddIcon } from './Icons';
import { guardarComoPlaylist } from './PlaylistSheets';

/**
 * Botón "Guardar como playlist" de una radio (la cola con nombre, "Mix de …"): guarda TODO lo que la radio
 * generó hasta ahora (lo que ya sonó y lo que viene). Solo aparece cuando la cola es una radio.
 */
export function GuardarColaBoton({ className = '' }: { className?: string }) {
  const colaNombre = usePlayer((s) => s.colaNombre);
  const queue = usePlayer((s) => s.queue);
  if (!colaNombre) return null;
  return (
    <button
      className={`icon-btn guardar-cola ${className}`}
      aria-label="Guardar como playlist"
      title="Guardar como playlist"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void guardarComoPlaylist(colaNombre, queue.filter((id) => !!trackById(id)), `${colaNombre}|${queue[0]}`);
      }}
    >
      <PlaylistAddIcon />
    </button>
  );
}
