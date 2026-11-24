import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useLibrary } from '../library/store';
import { useNav } from '../nav';
import { usePlayer } from '../player/player';
import { api } from '../server/cuenta';
import type { Track } from '../types';
import { PlayIcon } from './Icons';
import { PlaylistCover } from './PlaylistCover';

/**
 * Listas que arma el buscador cuando lo que escribes es una época o un estilo ("80s", "reggaetón viejo",
 * "r&b de los 90", "2015 popular"). Las arma el servidor (src/reco/consulta.ts); aquí la tarjeta que aparece
 * arriba de los resultados y su página.
 */
export interface ListaBusqueda {
  q: string;
  titulo: string;
  descripcion: string;
  ids: string[];
}

/** Las últimas listas recibidas, por búsqueda (así la página abre al instante). */
export const useListasBusqueda = create<Record<string, ListaBusqueda>>(() => ({}));
export const guardarListaBusqueda = (l: ListaBusqueda) => useListasBusqueda.setState({ [l.q]: l });

function useCanciones(ids: string[] | undefined) {
  const tracks = useLibrary((s) => s.tracks);
  if (!ids) return [];
  const byId = new Map(tracks.map((t) => [t.id, t]));
  return ids.map((i) => byId.get(i)).filter((t): t is Track => !!t);
}

/** Tarjeta arriba de los resultados: abre la lista; el botón la pone a sonar. */
export function TarjetaListaBusqueda({ lista, alUsar }: { lista: ListaBusqueda; alUsar?: () => void }) {
  const push = useNav((s) => s.push);
  const canciones = useCanciones(lista.ids);
  if (!canciones.length) return null;
  const abrir = () => {
    alUsar?.();
    push({ type: 'lista', q: lista.q });
  };
  return (
    <div className="lista-busq" role="button" tabIndex={0} onClick={abrir} onKeyDown={(e) => e.key === 'Enter' && abrir()}>
      <PlaylistCover id={`lista:${lista.q}`} tracks={canciones} className="lista-busq-portada" />
      <div className="lista-busq-texto">
        <div className="lista-busq-titulo">{lista.titulo}</div>
        <div className="lista-busq-sub">Lista • {canciones.length} canciones</div>
      </div>
      <button
        className="lista-busq-play"
        aria-label={`Reproducir ${lista.titulo}`}
        onClick={(e) => {
          e.stopPropagation();
          alUsar?.();
          usePlayer.getState().playTracks(canciones, 0, { shuffle: false });
        }}
      >
        <PlayIcon size={22} />
      </button>
    </div>
  );
}

/** La lista completa. Si no está guardada (por ejemplo, al volver atrás tras recargar), se pide de nuevo. */
export function useListaBusqueda(q: string) {
  const lista = useListasBusqueda((s) => s[q]);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (lista) return;
    let vigente = true;
    api<ListaBusqueda>(`/api/lista-busqueda?q=${encodeURIComponent(q)}`)
      .then((l) => vigente && guardarListaBusqueda(l))
      .catch(() => vigente && setError(true));
    return () => {
      vigente = false;
    };
  }, [q, lista]);
  return { lista, error, canciones: useCanciones(lista?.ids) };
}
