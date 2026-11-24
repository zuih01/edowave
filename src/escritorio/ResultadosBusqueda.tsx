import { useEffect, useMemo, useState } from 'react';
import { Cover } from '../components/Cover';
import { MoreIcon, PlayIcon, ShuffleIcon } from '../components/Icons';
import { openTrackMenu } from '../components/TrackMenu';
import { formatDuration, NowPlayingBars, TrackRow } from '../components/TrackRow';
import { useLibrary } from '../library/store';
import { useNav } from '../nav';
import { usePlayer } from '../player/player';
import { playSongRadio } from '../reco/store';
import { api } from '../server/cuenta';
import { mostradas } from '../estadisticas';
import { guardarListaBusqueda, TarjetaListaBusqueda, type ListaBusqueda } from '../components/ListaBusqueda';
import type { Track } from '../types';

/**
 * PC: resultados completos de una búsqueda, al presionar Enter en el buscador de arriba (como Spotify).
 * "Todo": arriba el resultado más destacado (la canción que el buscador del servidor pone primero: la más
 * popular de lo que buscaste) y debajo una lista con más canciones, el artista y sus álbumes. Las pestañas
 * filtran por tipo. Misma búsqueda y mismo orden que el menú desplegable (/api/buscar).
 */
type Filtro = 'todo' | 'canciones' | 'artistas' | 'albumes';
const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'canciones', label: 'Canciones' },
  { id: 'artistas', label: 'Artistas' },
  { id: 'albumes', label: 'Álbumes' },
];

/** Para comparar nombres: sin tildes, mayúsculas ni signos. */
const plano = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** ¿Lo buscado es (casi) el nombre del álbum? "bikini horro" → "BIKINI HORRORS OST V4". */
function coincide(nombre: string, q: string) {
  const n = plano(nombre);
  const b = plano(q);
  return b.length >= 3 && (n.startsWith(b) || (b.length >= n.length * 0.6 && b.includes(n)));
}

export function ResultadosBusqueda({ q }: { q: string }) {
  const { tracks, albums, artists } = useLibrary();
  const push = useNav((s) => s.push);
  const currentId = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const [filtro, setFiltro] = useState<Filtro>('todo');
  const [res, setRes] = useState<{ q: string; artists: string[]; albums: string[]; tracks: string[]; lista?: ListaBusqueda } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vigente = true;
    setError(false);
    setFiltro('todo');
    api<{ artists: string[]; albums: string[]; tracks: string[]; lista?: ListaBusqueda }>(`/api/buscar?q=${encodeURIComponent(q)}&final=1`)
      .then((r) => {
        if (!vigente) return;
        setRes({ q, ...r });
        if (r.lista) guardarListaBusqueda(r.lista);
        mostradas('busqueda', r.tracks.slice(0, 20)); // estadísticas (CTR)
      })
      .catch(() => vigente && setError(true));
    return () => {
      vigente = false;
    };
  }, [q]);

  const r = useMemo(() => {
    if (!res || res.q !== q) return null;
    const ar = new Map(artists.map((a) => [a.name, a]));
    const al = new Map(albums.map((a) => [a.key, a]));
    const tr = new Map(tracks.map((t) => [t.id, t]));
    return {
      lista: res.lista,
      artists: res.artists.map((n) => ar.get(n)).filter((x): x is NonNullable<typeof x> => !!x),
      albums: res.albums.map((k) => al.get(k)).filter((x): x is NonNullable<typeof x> => !!x),
      tracks: res.tracks.map((id) => tr.get(id)).filter((x): x is Track => !!x),
    };
  }, [q, res, tracks, albums, artists]);

  const tocar = (t: Track) => playSongRadio(t.id);

  let cuerpo: React.ReactNode;
  if (error) cuerpo = <p className="muted esc-res-vacio">No se pudo buscar. Revisa tu conexión.</p>;
  else if (!r)
    cuerpo = (
      <div className="feed-cargando" role="status" aria-label="Buscando">
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  else if (!r.lista && !r.tracks.length && !r.artists.length && !r.albums.length)
    cuerpo = <p className="muted esc-res-vacio">No encontramos nada para “{q}”.</p>;
  else if (filtro === 'canciones')
    cuerpo = (
      <div className="list">
        {r.tracks.map((t) => (
          <TrackRow key={t.id} track={t} onPlay={() => tocar(t)} />
        ))}
      </div>
    );
  else if (filtro === 'artistas')
    cuerpo = (
      <div className="esc-res-grilla">
        {r.artists.map((a) => (
          <button key={a.name} className="card" onClick={() => push({ type: 'artist', name: a.name })}>
            <Cover coverId={a.coverId} seed={a.name} round />
            <div className="card-title">{a.name}</div>
            <div className="card-sub">Artista</div>
          </button>
        ))}
      </div>
    );
  else if (filtro === 'albumes')
    cuerpo = (
      <div className="esc-res-grilla">
        {r.albums.map((a) => (
          <button key={a.key} className="card" onClick={() => push({ type: 'album', key: a.key })}>
            <Cover coverId={a.coverId} seed={a.name + a.artist} />
            <div className="card-title">{a.name}</div>
            <div className="card-sub">{[a.year, a.artist].filter(Boolean).join(' • ')}</div>
          </button>
        ))}
      </div>
    );
  else {
    // Todo: el destacado arriba; abajo canciones, el artista y los álbumes, mezclados como en Spotify.
    // Si lo buscado es el nombre de un álbum (de 2 canciones o más), el destacado es el álbum, como en YouTube Music;
    // la canción que se llama igual va primera en la lista de abajo.
    const albumTop = r.albums.find((a) => a.tracks.length > 1 && coincide(a.name, q));
    const [top, ...resto] = albumTop ? [undefined, ...r.tracks] : r.tracks;
    const filas: React.ReactNode[] = [];
    const canciones = resto.filter((t): t is Track => !!t).slice(0, albumTop ? 5 : 4);
    const artistas = r.artists.slice(0, 2);
    const albumes = r.albums.filter((a) => a !== albumTop).slice(0, 4);
    const filaCancion = (t: Track) => {
      const sonando = t.id === currentId;
      return (
        <div
          key={`t-${t.id}`}
          className={`esc-res-fila ${sonando ? 'sonando' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => tocar(t)}
          onKeyDown={(e) => e.key === 'Enter' && tocar(t)}
          onContextMenu={(e) => {
            e.preventDefault();
            openTrackMenu(t);
          }}
        >
          <Cover coverId={t.coverId} seed={t.album + t.artist} className="esc-res-mini" />
          <div className="esc-res-texto">
            <div className="esc-res-titulo">{sonando ? <NowPlayingBars paused={!playing} /> : null}{t.title}</div>
            <div className="esc-res-sub">{t.artist}</div>
          </div>
          <span className="esc-res-tipo">Canción</span>
          <span className="esc-res-dur">{formatDuration(t.duration)}</span>
          <button
            className="icon-btn"
            aria-label="Más opciones"
            onClick={(e) => {
              e.stopPropagation();
              openTrackMenu(t);
            }}
          >
            <MoreIcon size={20} />
          </button>
        </div>
      );
    };
    // Orden: canción, artista, canción, canción, álbumes… (el artista arriba, que es lo que más se busca).
    if (canciones[0]) filas.push(filaCancion(canciones[0]));
    for (const a of artistas)
      filas.push(
        <div key={`a-${a.name}`} className="esc-res-fila" role="button" tabIndex={0} onClick={() => push({ type: 'artist', name: a.name })} onKeyDown={(e) => e.key === 'Enter' && push({ type: 'artist', name: a.name })}>
          <Cover coverId={a.coverId} seed={a.name} round className="esc-res-mini" />
          <div className="esc-res-texto">
            <div className="esc-res-titulo">{a.name}</div>
          </div>
          <span className="esc-res-tipo">Artista</span>
          <span className="esc-res-dur" />
          <span className="esc-res-hueco" />
        </div>,
      );
    for (const t of canciones.slice(1)) filas.push(filaCancion(t));
    for (const a of albumes)
      filas.push(
        <div key={`al-${a.key}`} className="esc-res-fila" role="button" tabIndex={0} onClick={() => push({ type: 'album', key: a.key })} onKeyDown={(e) => e.key === 'Enter' && push({ type: 'album', key: a.key })}>
          <Cover coverId={a.coverId} seed={a.name + a.artist} className="esc-res-mini" />
          <div className="esc-res-texto">
            <div className="esc-res-titulo">{a.name}</div>
            <div className="esc-res-sub">{a.artist}</div>
          </div>
          <span className="esc-res-tipo">{a.tracks.length === 1 ? 'Sencillo' : 'Álbum'}</span>
          <span className="esc-res-dur" />
          <span className="esc-res-hueco" />
        </div>,
      );
    cuerpo = (
      <>
        {r.lista && <TarjetaListaBusqueda lista={r.lista} />}
        {albumTop && (
          <div
            className="esc-res-top esc-res-top-album"
            role="button"
            tabIndex={0}
            onClick={() => push({ type: 'album', key: albumTop.key })}
            onKeyDown={(e) => e.key === 'Enter' && push({ type: 'album', key: albumTop.key })}
          >
            <Cover coverId={albumTop.coverId} seed={albumTop.name + albumTop.artist} className="esc-res-top-portada" />
            <div className="esc-res-texto">
              <div className="esc-res-top-titulo">{albumTop.name}</div>
              <div className="esc-res-sub">{['Álbum', albumTop.artist, albumTop.year].filter(Boolean).join(' • ')}</div>
            </div>
            <div className="esc-res-top-botones">
              <button
                className="pill primary"
                onClick={(e) => {
                  e.stopPropagation();
                  usePlayer.getState().playTracks(albumTop.tracks, 0, { shuffle: false });
                }}
              >
                <PlayIcon size={20} /> Reproducir
              </button>
              <button
                className="pill"
                onClick={(e) => {
                  e.stopPropagation();
                  usePlayer.getState().playTracks(albumTop.tracks, Math.floor(Math.random() * albumTop.tracks.length), { shuffle: true });
                }}
              >
                <ShuffleIcon size={20} /> Aleatorio
              </button>
            </div>
          </div>
        )}
        {top && (
          <div
            className={`esc-res-top ${top.id === currentId ? 'sonando' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => tocar(top)}
            onKeyDown={(e) => e.key === 'Enter' && tocar(top)}
            onContextMenu={(e) => {
              e.preventDefault();
              openTrackMenu(top);
            }}
          >
            <Cover coverId={top.coverId} seed={top.album + top.artist} className="esc-res-top-portada" />
            <div className="esc-res-texto">
              <div className="esc-res-top-titulo">{top.title}</div>
              <div className="esc-res-sub">Canción • {top.artist}</div>
            </div>
            <button
              className="esc-res-play"
              aria-label={`Reproducir ${top.title}`}
              onClick={(e) => {
                e.stopPropagation();
                tocar(top);
              }}
            >
              <PlayIcon size={26} />
            </button>
          </div>
        )}
        <div className="esc-res-lista">{filas}</div>
      </>
    );
  }

  return (
    <div className="detail esc-resultados">
      <div className="esc-res-filtros" role="tablist" aria-label="Filtrar resultados">
        {FILTROS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filtro === f.id} className={`esc-res-chip ${filtro === f.id ? 'on' : ''}`} onClick={() => setFiltro(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {cuerpo}
    </div>
  );
}
