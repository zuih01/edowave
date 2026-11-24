import { useEffect, useState } from 'react';
import { usePlaylists } from '../library/playlists';
import { useLibrary } from '../library/store';
import { faltantesDe, quitarFaltante, type Faltante } from '../server/playlistsCuenta';
import { formatDuration } from './TrackRow';

/**
 * Playlist importada de Spotify: las canciones que todavía no están en el servidor se muestran en su lugar, en
 * gris, como "Canción no disponible". Cuando alguien las sube, el servidor las pone ahí mismo y dejan de verse
 * así. Se pueden quitar de la espera con la ×.
 */
export function useFaltantes(id: string | null) {
  const p = usePlaylists((s) => (id ? s.list.find((x) => x.id === id) : undefined));
  const tracks = useLibrary((s) => s.tracks);
  const faltan = p?.faltan ?? 0;
  const [lista, setLista] = useState<Faltante[]>([]);

  useEffect(() => {
    if (!id || !faltan) {
      setLista([]);
      return;
    }
    let vivo = true;
    faltantesDe(id)
      .then((l) => vivo && setLista(l))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [id, faltan, p?.updatedAt]);

  // Cada faltante va después de la canción que le sigue en Spotify; si esa no se ve, al final.
  const visibles = new Set(tracks.map((t) => t.id));
  const enLista = new Set((p?.trackIds ?? []).filter((t) => visibles.has(t)));
  const inicio: Faltante[] = [];
  const final: Faltante[] = [];
  const tras = new Map<string, Faltante[]>();
  for (const f of lista) {
    if (f.despuesDe === '') inicio.push(f);
    else if (f.despuesDe && enLista.has(f.despuesDe)) tras.set(f.despuesDe, [...(tras.get(f.despuesDe) ?? []), f]);
    else final.push(f);
  }
  const yaPuestas = new Set<string>();

  const quitar = async (f: Faltante) => {
    if (!id) return;
    setLista((l) => l.filter((x) => x.id !== f.id));
    try {
      await quitarFaltante(id, f.id);
      const actual = usePlaylists.getState().list.find((x) => x.id === id);
      if (actual) await usePlaylists.getState().applyRemote([{ ...actual, faltan: Math.max(0, (actual.faltan ?? 1) - 1) || undefined }], []);
    } catch {
      setLista((l) => [...l, f]);
    }
  };

  return {
    total: lista.length,
    inicio,
    final,
    /** Las que van después de esta canción (solo la primera vez que aparece, por si está repetida). */
    tras: (trackId: string) => {
      if (yaPuestas.has(trackId)) return [];
      yaPuestas.add(trackId);
      return tras.get(trackId) ?? [];
    },
    quitar,
  };
}

const Quitar = ({ f, onQuitar }: { f: Faltante; onQuitar: (f: Faltante) => void }) => (
  <button className="icon-btn" onClick={() => onQuitar(f)} title="Quitar de la playlist" aria-label={`Quitar ${f.titulo} de la playlist`}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  </button>
);

/** Fila gris en el teléfono. */
export function FilaFaltante({ f, onQuitar }: { f: Faltante; onQuitar: (f: Faltante) => void }) {
  return (
    <div className="track-row faltante" aria-disabled title="Todavía no está en el servidor: se agrega sola cuando la suban">
      <span className="faltante-portada" aria-hidden="true" />
      <div className="track-text">
        <div className="track-title">{f.titulo}</div>
        <div className="track-sub">
          <span className="faltante-marca">Canción no disponible</span> • {f.artistas.join(', ')}
        </div>
      </div>
      {f.duracion ? <span className="track-dur">{formatDuration(f.duracion)}</span> : null}
      <Quitar f={f} onQuitar={onQuitar} />
    </div>
  );
}

/** Fila gris en la tabla de PC. */
export function FilaFaltantePc({ f, onQuitar }: { f: Faltante; onQuitar: (f: Faltante) => void }) {
  return (
    <div role="row" className="esc-tabla-fila faltante" aria-disabled title="Todavía no está en el servidor: se agrega sola cuando la suban">
      <span className="esc-tabla-num" />
      <span className="esc-tabla-titulo">
        <span className="faltante-portada pc" aria-hidden="true" />
        <span className="track-text">
          <span className="track-title">{f.titulo}</span>
          <span className="track-sub">{f.artistas.join(', ')}</span>
        </span>
      </span>
      <span className="esc-tabla-album faltante-marca">Canción no disponible</span>
      <span className="esc-tabla-anio" />
      <span className="der esc-tabla-dur">
        {f.duracion ? formatDuration(f.duracion) : ''}
        <Quitar f={f} onQuitar={onQuitar} />
      </span>
    </div>
  );
}
