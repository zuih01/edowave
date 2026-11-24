import { create } from 'zustand';
import { closeOverlay, openOverlay } from '../nav';
import { descargar, descargasDisponibles, esDelServidor, estaDescargada, estaEnDescarga, quitarDescargas, useDescargas } from '../server/biblioteca';
import type { Track } from '../types';
import { DownloadedIcon, DownloadIcon } from './Icons';
import { showSnack } from './PlaylistSheets';
import { useExit } from './useExit';

const canciones = (n: number) => `${n} ${n === 1 ? 'canción' : 'canciones'}`;

/** Estado de descarga de una canción ('no' | 'cola' | 'lista'), que se redibuja al cambiar. */
export function useEstadoDescarga(id: string | undefined) {
  return useDescargas((s) => {
    void s.v;
    if (!id) return 'no' as const;
    if (estaDescargada(id)) return 'lista' as const;
    return s.actual === id || s.cola.includes(id) ? ('cola' as const) : ('no' as const);
  });
}

/** Ícono chico junto al artista: la canción está descargada (o bajando). */
export function MarcaDescarga({ id }: { id: string }) {
  const e = useEstadoDescarga(id);
  if (e === 'no' || !descargasDisponibles) return null;
  return (
    <span className={`marca-descarga ${e}`} aria-label={e === 'lista' ? 'Descargada' : 'Descargando'} title={e === 'lista' ? 'Descargada' : 'Descargando…'}>
      {e === 'lista' ? <DownloadedIcon size={14} /> : <DownloadIcon size={14} />}
    </span>
  );
}

/** Descarga o quita la descarga de una sola canción (menú ⋮). */
export function alternarDescarga(t: Track) {
  if (estaDescargada(t.id) || estaEnDescarga(t.id)) return pedirQuitar([t.id], `"${t.title}"`);
  if (descargar([t.id])) showSnack('Descargando… quedará guardada en este aparato');
}

/**
 * Botón de descarga de un álbum, artista o playlist: baja todas sus canciones del servidor. Ya descargado
 * entero: tocarlo pregunta si quitar la descarga.
 */
export function BotonDescargar({ tracks, nombre, className = 'pill icono', size = 20 }: { tracks: Track[]; nombre: string; className?: string; size?: number }) {
  const ids = tracks.filter((t) => esDelServidor(t.id)).map((t) => t.id);
  // Se devuelve un texto (no un objeto) para que zustand solo redibuje cuando cambian los números.
  const k = useDescargas((s) => {
    void s.v;
    let listas = 0;
    let bajando = 0;
    for (const id of ids) {
      if (estaDescargada(id)) listas++;
      else if (s.actual === id || s.cola.includes(id)) bajando++;
    }
    return `${listas}|${bajando}`;
  });
  const [listas, bajando] = k.split('|').map(Number);
  if (!ids.length || !descargasDisponibles) return null; // app de PC: sin descargas
  const todo = listas === ids.length;
  const titulo = todo ? 'Descargada · tocar para quitar' : bajando ? `Descargando ${listas}/${ids.length}` : 'Descargar';
  return (
    <button
      className={`${className} boton-descarga ${todo ? 'lista' : bajando ? 'bajando' : ''}`}
      aria-label={titulo}
      title={titulo}
      onClick={() => {
        if (todo || bajando) return pedirQuitar(ids, nombre);
        const n = descargar(ids);
        showSnack(n ? `Descargando ${canciones(n)}` : 'Ya está descargada');
      }}
    >
      {todo ? <DownloadedIcon size={size} /> : <DownloadIcon size={size} />}
      {bajando > 0 && !todo && <span className="descarga-progreso">{listas}/{ids.length}</span>}
    </button>
  );
}

// ---------------- Confirmar "Quitar descarga" (sin ventanas del navegador) ----------------

const useQuitar = create<{ pedido: { ids: string[]; nombre: string } | null }>(() => ({ pedido: null }));

export function pedirQuitar(ids: string[], nombre: string) {
  useQuitar.setState({ pedido: { ids, nombre } });
  openOverlay(() => useQuitar.setState({ pedido: null }));
}

export function ConfirmarQuitarDescarga() {
  const { shown: pedido, closing } = useExit(useQuitar((s) => s.pedido), 180);
  if (!pedido) return null;
  const n = pedido.ids.length;
  return (
    <div className={`sheet-backdrop ${closing ? 'closing' : ''}`} onClick={closing ? undefined : closeOverlay}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-box">
          <h3>¿Quitar la descarga?</h3>
          <p>
            {n === 1 ? `${pedido.nombre} se borrará` : `${canciones(n)} de ${pedido.nombre} se borrarán`} de este aparato. Seguirá en la
            biblioteca y podrás escucharla con conexión o volver a descargarla.
          </p>
          <div className="pl-form-buttons">
            <button className="pill" onClick={closeOverlay}>
              Cancelar
            </button>
            <button
              className="pill primary"
              onClick={() => {
                void quitarDescargas(pedido.ids);
                closeOverlay();
                showSnack(n === 1 ? 'Se quitó la descarga' : `Se quitaron ${canciones(n)}`);
              }}
            >
              Quitar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
