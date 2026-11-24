import { useEffect, useMemo, useRef, useState } from 'react';
import { cargarHistorial } from '../server/datosCuenta';
import { Cover } from '../components/Cover';
import { ChevronDownIcon, DownloadedIcon, GridIcon, ListIcon, MoreIcon, PinIcon, PlusIcon } from '../components/Icons';
import { PlaylistCover } from '../components/PlaylistCover';
import { openCreatePlaylist, openPlaylistOptions } from '../components/PlaylistSheets';
import { TrackRow } from '../components/TrackRow';
import { pedirQuitar } from '../components/Descargas';
import { bytesDescargados, descargasDisponibles, idsDescargados, useDescargas } from '../server/biblioteca';
import { fijadasPrimero, LIKED_ID, usePlaylists, type Playlist } from '../library/playlists';
import { useLibrary } from '../library/store';
import { useNav } from '../nav';
import { puedeSonar, usePlayer } from '../player/player';
import { useConexion } from '../server/conexion';
import type { Album, Artist, Track } from '../types';

type Chip = 'playlists' | 'songs' | 'albums' | 'artists' | 'downloads';
const CHIPS: { id: Chip; label: string }[] = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'songs', label: 'Canciones' },
  { id: 'albums', label: 'Álbumes' },
  { id: 'artists', label: 'Artistas' },
  // La app de PC no tiene descargas (Windows Defender la borraba).
  ...(descargasDisponibles ? [{ id: 'downloads' as const, label: 'Descargas' }] : []),
];

type Sort = 'recent' | 'added' | 'az';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'recent', label: 'Actividad reciente' },
  { id: 'added', label: 'Agregados recientemente' },
  { id: 'az', label: 'A–Z' },
];

type Item =
  | { kind: 'liked'; key: string; name: string; tracks: Track[] }
  | { kind: 'playlist'; key: string; name: string; tracks: Track[]; p: Playlist }
  | { kind: 'album'; key: string; name: string; a: Album }
  | { kind: 'artist'; key: string; name: string; a: Artist };

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const formatoTamano = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.round(b / 1e6)} MB`);
const count = (n: number) => `${n} ${n === 1 ? 'canción' : 'canciones'}`;

/** Preferencias de la pantalla (orden y lista/cuadrícula), recordadas entre sesiones. */
function usePref<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T) || initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, nv);
      } catch {
        /* sin espacio */
      }
    },
  ];
}

/** Abre la Biblioteca directo en "Descargas" (lo usa el inicio sin conexión). */
let chipPedido: Chip | null = null;
export function abrirDescargas() {
  chipPedido = 'downloads';
  useNav.getState().setTab('library');
  window.dispatchEvent(new Event('abrir-descargas'));
}

export function Library() {
  const [chip, setChip] = useState<Chip | null>(() => {
    const c = chipPedido;
    chipPedido = null;
    return c;
  });
  useEffect(() => {
    const ir = () => {
      chipPedido = null;
      setChip('downloads');
    };
    window.addEventListener('abrir-descargas', ir);
    return () => window.removeEventListener('abrir-descargas', ir);
  }, []);
  const [sort, setSort] = usePref<Sort>('library.sort', 'recent');
  const [layout, setLayout] = usePref<'list' | 'grid'>('library.layout', 'list');
  const [sortOpen, setSortOpen] = useState(false);
  const { tracks, albums, artists } = useLibrary();
  const playlists = usePlaylists((s) => s.list);
  const ratings = usePlayer((s) => s.ratings);
  const push = useNav((s) => s.push);
  const playTracks = usePlayer((s) => s.playTracks);
  const sonando = usePlayer((s) => s.queue[s.index]);

  // Última vez que sonó cada canción (para "Actividad reciente" y para saber qué escuchaste).
  const [lastPlayed, setLastPlayed] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    cargarHistorial().then((plays) => {
      const m = new Map<string, number>();
      for (const p of plays) m.set(p.trackId, Math.max(m.get(p.trackId) ?? 0, p.startedAt));
      setLastPlayed(m);
    });
  }, [sonando]);

  /**
   * Canciones, Álbumes y Artistas son un filtro de lo que GUARDASTE: las canciones de tus playlists y las que
   * te gustaron ("Música que te gustó"). Lo que solo escuchaste no aparece aquí (eso está en el Historial).
   * Una playlist con una sola canción = una sola canción.
   */
  const mias = useMemo(() => {
    const guardadas = new Set([...playlists.flatMap((p) => p.trackIds), ...Object.keys(ratings).filter((id) => ratings[id] === 1)]);
    return tracks.filter((t) => guardadas.has(t.id));
  }, [tracks, playlists, ratings]);

  const items = useMemo(() => {
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const liked: Item = { kind: 'liked', key: LIKED_ID, name: 'Música que te gustó', tracks: tracks.filter((t) => ratings[t.id] === 1) };
    const pls: Item[] = playlists.map((p) => ({
      kind: 'playlist',
      key: p.id,
      name: p.name,
      p,
      tracks: p.trackIds.map((i) => byId.get(i)).filter((t): t is Track => !!t),
    }));
    // Álbumes y artistas: solo los que tienen alguna canción tuya (y se cuentan solo esas).
    const mio = new Set(mias.map((t) => t.id));
    const albs: Item[] = albums
      .map((a) => ({ ...a, tracks: a.tracks.filter((t) => mio.has(t.id)) }))
      .filter((a) => a.tracks.length)
      .map((a) => ({ kind: 'album', key: a.key, name: a.name, a }));
    const arts: Item[] = artists
      .map((a) => ({ ...a, tracks: a.tracks.filter((t) => mio.has(t.id)) }))
      .filter((a) => a.tracks.length)
      .map((a) => ({ kind: 'artist', key: a.name, name: a.name, a }));

    const played = (ts: Track[]) => ts.reduce((m, t) => Math.max(m, lastPlayed.get(t.id) ?? 0), 0);
    const added = (ts: Track[]) => ts.reduce((m, t) => Math.max(m, t.addedAt), 0);
    const recentOf = (it: Item) =>
      it.kind === 'playlist'
        ? Math.max(it.p.updatedAt, it.p.playedAt ?? 0, played(it.tracks))
        : it.kind === 'liked'
          ? played(it.tracks)
          : played(it.a.tracks);
    const addedOf = (it: Item) =>
      it.kind === 'playlist' ? it.p.createdAt : it.kind === 'liked' ? added(it.tracks) : added(it.a.tracks);
    const cmp = (x: Item, y: Item) =>
      sort === 'az'
        ? collator.compare(x.name, y.name)
        : sort === 'added'
          ? addedOf(y) - addedOf(x)
          : recentOf(y) - recentOf(x) || addedOf(y) - addedOf(x);

    const plDe = (it: Item) => (it.kind === 'playlist' ? it.p : undefined);
    let list: Item[];
    if (chip === 'playlists') list = fijadasPrimero([...pls].sort(cmp), plDe);
    else if (chip === 'albums') list = [...albs].sort(cmp);
    else if (chip === 'artists') list = [...arts].sort(cmp);
    else list = fijadasPrimero([...pls, ...albs, ...arts].sort(cmp), plDe);
    // "Música que te gustó" siempre arriba (fijada), como en YT Music.
    return chip === null || chip === 'playlists' ? [liked, ...list] : list;
  }, [chip, sort, tracks, mias, albums, artists, playlists, ratings, lastPlayed]);

  // Canciones: las tuyas, en el orden elegido.
  const misCanciones = useMemo(() => {
    const list = [...mias];
    if (sort === 'az') list.sort((a, b) => collator.compare(a.title, b.title));
    else if (sort === 'added') list.sort((a, b) => b.addedAt - a.addedAt);
    else list.sort((a, b) => (lastPlayed.get(b.id) ?? 0) - (lastPlayed.get(a.id) ?? 0) || b.addedAt - a.addedAt);
    return list;
  }, [mias, sort, lastPlayed]);

  // Descargas: lo guardado en este aparato para escuchar sin conexión (lo último descargado no tiene orden propio: A–Z).
  const versionDescargas = useDescargas((s) => s.v);
  const bajando = useDescargas((s) => s.cola.length + (s.actual ? 1 : 0));
  const descargadas = useMemo(() => {
    void versionDescargas;
    const ids = new Set(idsDescargados());
    const list = tracks.filter((t) => ids.has(t.id));
    if (sort === 'added') list.sort((a, b) => b.addedAt - a.addedAt);
    else list.sort((a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.title, b.title));
    return list;
  }, [tracks, versionDescargas, sort]);

  const vacio =
    chip === 'downloads' && !descargadas.length && !bajando
      ? 'Aquí aparecerán las canciones que descargues para escuchar sin conexión. En una canción toca ⋮ y luego "Descargar", o usa el botón de descarga de un álbum o playlist.'
      : chip === 'songs' && !misCanciones.length
      ? 'Aquí aparecerán las canciones de tus playlists y las que te gusten.'
      : chip === 'albums' && !items.length
        ? 'Aquí aparecerán los álbumes de las canciones que guardes.'
        : chip === 'artists' && !items.length
          ? 'Aquí aparecerán los artistas de las canciones que guardes.'
          : null;

  const openItem = (it: Item) => {
    if (it.kind === 'album') push({ type: 'album', key: it.a.key });
    else if (it.kind === 'artist') push({ type: 'artist', name: it.a.name });
    else push({ type: 'playlist', id: it.key });
  };

  return (
    <div className="library">
      <div className="chips">
        {CHIPS.map((c) => (
          <button key={c.id} className={`chip ${chip === c.id ? 'active' : ''}`} onClick={() => setChip(chip === c.id ? null : c.id)}>
            {c.label}
          </button>
        ))}
      </div>


      {tracks.length === 0 && <p className="muted pad">Todavía no hay música. Importa tu carpeta para empezar.</p>}

      {chip === 'downloads' && !vacio ? (
        <div className="list">
          <div className="descargas-cab">
            <span>
              {count(descargadas.length)} • {formatoTamano(bytesDescargados())}
              {bajando > 0 && ` • bajando ${bajando}`}
            </span>
            {descargadas.length > 0 && (
              <button className="pill" onClick={() => pedirQuitar(descargadas.map((t) => t.id), 'tus descargas')}>
                Quitar todas
              </button>
            )}
          </div>
          {descargadas.map((t, i) => (
            <TrackRow key={t.id} track={t} onPlay={() => playTracks(descargadas, i)} />
          ))}
        </div>
      ) : chip === 'songs' ? (
        <div className="list">
          {vacio ? (
            <p className="muted pad">{vacio}</p>
          ) : (
            <>
              <div className="list-count">{count(misCanciones.length)}</div>
              {misCanciones.map((t, i) => (
                <TrackRow key={t.id} track={t} onPlay={() => playTracks(misCanciones, i)} />
              ))}
            </>
          )}
        </div>
      ) : vacio ? (
        <p className="muted pad">{vacio}</p>
      ) : (
        <>
          <div className="lib-bar">
            <SortMenu sort={sort} open={sortOpen} setOpen={setSortOpen} onPick={setSort} />
            <button
              className="icon-btn"
              aria-label={layout === 'list' ? 'Ver en cuadrícula' : 'Ver en lista'}
              onClick={() => setLayout(layout === 'list' ? 'grid' : 'list')}
            >
              {layout === 'list' ? <GridIcon /> : <ListIcon />}
            </button>
          </div>

          <div className={layout === 'grid' ? 'lib-grid' : 'list'}>
            {items.map((it) => (
              <LibItem key={it.kind + it.key} it={it} grid={layout === 'grid'} onOpen={() => openItem(it)} />
            ))}
          </div>
        </>
      )}

      {/* Botón flotante "+ Nueva", como en YT Music */}
      <div className="fab-wrap">
        <button className="fab" onClick={() => openCreatePlaylist()}>
          <PlusIcon size={26} /> Nueva
        </button>
      </div>
    </div>
  );
}

function SortMenu({ sort, open, setOpen, onPick }: { sort: Sort; open: boolean; setOpen: (v: boolean) => void; onPick: (s: Sort) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, setOpen]);
  return (
    <div className="sort" ref={ref}>
      <button className="sort-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        {SORTS.find((s) => s.id === sort)?.label}
        <ChevronDownIcon size={24} />
      </button>
      {open && (
        <div className="sort-menu" role="menu">
          {SORTS.map((s) => (
            <button
              key={s.id}
              role="menuitemradio"
              aria-checked={s.id === sort}
              className={s.id === sort ? 'on' : ''}
              onClick={() => {
                onPick(s.id);
                setOpen(false);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LibItem({ it, grid, onOpen }: { it: Item; grid: boolean; onOpen: () => void }) {
  // Sin conexión: una playlist o álbum sin nada que pueda sonar se ve en gris; uno que suena entero, con su marca.
  const sinConexion = useConexion((s) => s.largo && s.guardadas >= 0);
  useDescargas((s) => s.v);
  const lista = it.kind === 'album' || it.kind === 'artist' ? it.a.tracks : it.tracks;
  const suenan = sinConexion ? lista.filter((t) => puedeSonar(t.id)).length : 0;
  const gris = sinConexion && lista.length > 0 && suenan === 0;
  const entera = sinConexion && lista.length > 0 && suenan === lista.length;
  const cover =
    it.kind === 'liked' || it.kind === 'playlist' ? (
      <PlaylistCover id={it.key} tracks={it.tracks} className={grid ? '' : 'thumb lib-thumb'} />
    ) : it.kind === 'album' ? (
      <Cover coverId={it.a.coverId} seed={it.a.name + it.a.artist} className={grid ? '' : 'thumb lib-thumb'} />
    ) : (
      <Cover coverId={it.a.coverId} seed={it.a.name} round className={grid ? '' : 'thumb lib-thumb'} />
    );
  const sub =
    it.kind === 'liked' ? (
      <>
        <PinIcon /> Playlist autogenerada
      </>
    ) : it.kind === 'playlist' ? (
      <>
        {it.p.pinnedAt && <PinIcon />}
        {`Playlist${it.p.public ? ' pública' : ''} • ${count(it.tracks.length)}`}
      </>
    ) : it.kind === 'album' ? (
      `Álbum • ${it.a.artist}`
    ) : (
      `Artista • ${count(it.a.tracks.length)}`
    );
  const subFinal = entera ? (
    <>
      <span className="lib-descargada" aria-label="Descargada">
        <DownloadedIcon size={14} />
      </span>
      {sub}
    </>
  ) : sinConexion && suenan > 0 ? (
    <>
      {sub}
      {` • ${suenan} sin conexión`}
    </>
  ) : (
    sub
  );
  const more =
    it.kind === 'playlist' ? (
      <button
        className="icon-btn more"
        aria-label="Más opciones"
        onClick={(e) => {
          e.stopPropagation();
          openPlaylistOptions(it.p.id);
        }}
      >
        <MoreIcon />
      </button>
    ) : null;

  if (grid) {
    return (
      <div className={`card lib-card ${it.kind === 'artist' ? 'artist' : ''} ${gris ? 'no-disponible' : ''}`} onClick={onOpen}>
        {cover}
        <div className="card-title">{it.name}</div>
        <div className="card-sub lib-sub">{subFinal}</div>
      </div>
    );
  }
  return (
    <div className={`lib-row ${gris ? 'no-disponible' : ''}`} onClick={onOpen}>
      {cover}
      <div className="track-text">
        <div className="lib-title">{it.name}</div>
        <div className="track-sub lib-sub">{subFinal}</div>
      </div>
      {more}
    </div>
  );
}
