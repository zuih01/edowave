import { useEffect, useMemo, useRef, useState } from 'react';
import { Cover, fallbackColors } from '../components/Cover';
import { ChevronRightIcon, CloudOffIcon, MoreIcon, PlayIcon } from '../components/Icons';
import { PlaylistCover } from '../components/PlaylistCover';
import { openTrackMenu } from '../components/TrackMenu';
import { usePlaylists, type Playlist } from '../library/playlists';
import { useCover } from '../library/useCover';
import { useDominantColor } from '../player/useDominantColor';
import { abrirCuenta } from '../components/CuentaScreen';
import { useCuenta } from '../server/cuenta';
import { useLibrary } from '../library/store';
import { useFijadas } from '../library/fijadas';
import { marcarOrigen, mostradas } from '../estadisticas';
import { useNav } from '../nav';
import { puedeSonar, usePlayer } from '../player/player';
import { probar, useConexion } from '../server/conexion';
import { descargasDisponibles, idsDescargados, useDescargas } from '../server/biblioteca';
import { showSnack } from '../components/PlaylistSheets';
import { abrirDescargas } from './Library';
import { MIN_HEARD, MOODS, type MoodId } from '../reco/engine';
import { playSongRadio, useReco } from '../reco/store';
import { escritorioActivo } from '../escritorio/activo';
import { clasesFila, empezarArrastre, menuDeFila, useSeleccion } from '../escritorio/seleccion';
import type { Track } from '../types';
import { DeLaComunidad } from './Social';
import { ParaTi } from '../components/ParaTi';

const PAGE = 9;
const MAX_PAGES = 3;

/** Accesos directos: páginas de 3×3 que se deslizan hacia la izquierda; al final, un cuadro "Aleatorio". */
/** `radio`: al tocar una canción suena su radio (canciones parecidas); si no, la lista tal cual (mix de ánimo). */
function ShortcutPages({ songs, all, currentId, radio }: { songs: Track[]; all: Track[]; currentId?: string; radio: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const caido = useConexion((s) => s.largo && s.guardadas >= 0);
  const cells: (Track | 'shuffle')[] = [...songs, 'shuffle'];
  const pages: (Track | 'shuffle')[][] = [];
  for (let i = 0; i < cells.length && pages.length < MAX_PAGES; i += PAGE) pages.push(cells.slice(i, i + PAGE));

  // Cada página mide lo mismo: su ancho + el espacio entre páginas (32 px).
  const step = () => ((ref.current?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 1) + 32;
  const onScroll = () => setPage(Math.round((ref.current?.scrollLeft ?? 0) / step()));
  const goTo = (i: number) => ref.current?.scrollTo({ left: i * step(), behavior: 'smooth' });

  const shuffleAll = () => {
    // Tu música (no todo el servidor) en orden aleatorio, empezando por una canción al azar.
    if (!all.length) return;
    marcarOrigen('aleatorio');
    usePlayer.getState().playTracks(all, Math.floor(Math.random() * all.length), { shuffle: true });
  };

  return (
    <>
      <div ref={ref} className={`shortcut-pages ${pages.length > 1 ? 'multi' : ''}`} onScroll={onScroll}>
        {pages.map((cellsOfPage, pi) => (
          <div key={pi} className="shortcut-grid">
            {cellsOfPage.map((c, ci) =>
              c === 'shuffle' ? (
                <button key="shuffle" className="shortcut shortcut-shuffle" onClick={shuffleAll} aria-label="Aleatorio: toda tu música">
                  {/* Tres puntos en diagonal, como la cara de un dado */}
                  <i />
                  <i />
                  <i />
                </button>
              ) : (
                <div
                  key={c.id}
                  className={`shortcut ${c.id === currentId ? 'now-playing' : ''} ${caido && !puedeSonar(c.id) ? 'no-disponible' : ''}`}
                  onClick={() => {
                    if (!radio) marcarOrigen('animo');
                    if (radio) playSongRadio(c.id, songs);
                    else usePlayer.getState().playTracks(songs, pi * PAGE + ci);
                  }}
                >
                  <Cover coverId={c.coverId} seed={c.album + c.artist} />
                  <span>{c.title}</span>
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      {pages.length > 1 && (
        <div className="page-dots">
          {pages.map((_, i) => (
            <button key={i} className={i === page ? 'on' : ''} onClick={() => goTo(i)} aria-label={`Página ${i + 1}`} />
          ))}
        </div>
      )}
    </>
  );
}


/** Una carta de "De tu biblioteca": portada de la playlist, nombre, botón de play y sus 3 primeras canciones. */
function PlaylistCard({ p, tracks, currentId }: { p: Playlist; tracks: Track[]; currentId?: string }) {
  const push = useNav((s) => s.push);
  return (
    <PlaylistCardView
      id={p.id}
      name={p.name}
      sub={`${tracks.length} ${tracks.length === 1 ? 'canción' : 'canciones'}`}
      tracks={tracks}
      currentId={currentId}
      onOpen={() => push({ type: 'playlist', id: p.id })}
      onPlayed={() => usePlaylists.getState().markPlayed(p.id)}
    />
  );
}

/** Tarjeta grande de una playlist (portada, nombre, botón de play y sus 3 primeras canciones). */
export function PlaylistCardView({
  id,
  name,
  sub,
  tracks,
  currentId,
  onOpen,
  onPlayed,
}: {
  id: string;
  name: string;
  sub: string;
  tracks: Track[];
  currentId?: string;
  onOpen: () => void;
  onPlayed?: () => void;
}) {
  const p = { id, name };
  const first = tracks[0];
  const coverUrl = useCover(first?.coverId);
  const color = useDominantColor(coverUrl, first ? fallbackColors(first.album + first.artist)[0] : undefined);
  const play = (i: number) => {
    usePlayer.getState().playTracks(tracks, i, { shuffle: false });
    onPlayed?.();
  };
  const open = onOpen;
  const filas = tracks.slice(0, 3);
  const pc = escritorioActivo();
  // Los mixes de "Para ti" no son playlists tuyas: no se les puede quitar canciones.
  const enPlaylist = usePlaylists.getState().list.some((x) => x.id === id);
  const sel = useSeleccion(filas.length, play, (is) => usePlayer.getState().playTracks(is.map((i) => filas[i]), 0, { shuffle: false }), filas);
  return (
    <div className="lib-card" style={{ background: `color-mix(in srgb, ${color} 55%, #161616)` }}>
      <div className="lib-card-cover" onClick={open}>
        <PlaylistCover id={p.id} tracks={tracks} />
      </div>
      <div className="lib-card-head">
        <div className="lib-card-text" onClick={open}>
          <div className="lib-card-title">{p.name}</div>
          <div className="lib-card-sub">{sub}</div>
        </div>
        <button className="lib-card-play" onClick={() => play(0)} aria-label={`Reproducir ${p.name}`}>
          <PlayIcon size={28} />
        </button>
      </div>
      <div ref={sel.raiz} data-seleccion="">
      {filas.map((t, i) => (
        <div
          key={t.id}
          data-fila={i}
          className={`lib-card-row ${t.id === currentId ? 'current' : ''} ${pc ? clasesFila(sel, i) : ''}`}
          onClick={(e) => {
            // En PC: Ctrl + clic y Shift + clic eligen varias; el clic normal toca, como siempre.
            if (pc && (e.shiftKey || e.ctrlKey || e.metaKey)) return sel.clic(i, e);
            sel.soltar();
            play(i);
          }}
          onContextMenu={
            pc
              ? (e) => {
                  e.preventDefault();
                  menuDeFila(sel, filas, i, enPlaylist ? { id: p.id, index: i } : undefined);
                }
              : undefined
          }
          onPointerDown={pc ? (e) => empezarArrastre(e, () => sel.arrastrables(i).map((n) => filas[n])) : undefined}
        >
          <Cover coverId={t.coverId} seed={t.album + t.artist} className="thumb" />
          <div className="track-text">
            <div className="track-title">{t.title}</div>
            <div className="track-sub">{t.artist}</div>
          </div>
          <button
            className="icon-btn"
            aria-label="Más opciones"
            onClick={(e) => {
              e.stopPropagation();
              if (pc) menuDeFila(sel, filas, i, enPlaylist ? { id: p.id, index: i } : undefined);
              else openTrackMenu(t, { playlist: { id: p.id, index: i } });
            }}
          >
            <MoreIcon />
          </button>
        </div>
      ))}
      </div>
    </div>
  );
}

/**
 * "De tu biblioteca": cartas con las playlists que creaste (las que escuchaste o cambiaste hace menos, primero).
 * Si no tienes ninguna con canciones, la sección no aparece.
 */
function FromYourLibrary({ byId, currentId }: { byId: Map<string, Track>; currentId?: string }) {
  const list = usePlaylists((s) => s.list);
  const setTab = useNav((s) => s.setTab);
  const cards = list
    .map((p) => ({ p, tracks: p.trackIds.map((id) => byId.get(id)).filter((t): t is Track => !!t) }))
    .filter((c) => c.tracks.length > 0)
    .sort((a, b) => Math.max(b.p.playedAt ?? 0, b.p.updatedAt) - Math.max(a.p.playedAt ?? 0, a.p.updatedAt));
  if (!cards.length) return null;
  return (
    <section>
      <button className="section-head section-link" onClick={() => setTab('library')}>
        <h2>De tu biblioteca</h2>
        <ChevronRightIcon size={28} />
      </button>
      <div className="carousel lib-cards">
        {cards.map(({ p, tracks }) => (
          <PlaylistCard key={p.id} p={p} tracks={tracks} currentId={currentId} />
        ))}
      </div>
    </section>
  );
}


/**
 * Inicio sin conexión (teléfono: web, iPhone y Android; la app de PC no tiene descargas).
 * - Sin descargas: un aviso como el de YT Music ("Sin conexión", Ir a Descargas, Reintentar).
 * - Con descargas: accesos directos solo con lo descargado y, abajo, los álbumes que tienen algo descargado.
 */
function InicioSinConexion({ currentId }: { currentId?: string }) {
  const { tracks, albums } = useLibrary();
  const push = useNav((s) => s.push);
  const shortcutIds = useReco((s) => s.shortcuts);
  const fijadas = useFijadas((s) => s.ids);
  const v = useDescargas((s) => s.v);
  const [probando, setProbando] = useState(false);
  const { mias, susAlbumes } = useMemo(() => {
    void v;
    const ids = new Set(idsDescargados());
    // Primero lo que el inicio ya te recomendaba (y lo fijado), después el resto de lo descargado.
    const orden = new Map([...fijadas, ...shortcutIds].map((id, i) => [id, i]));
    const mias = tracks
      .filter((t) => ids.has(t.id))
      .sort((a, b) => (orden.get(a.id) ?? 1e9) - (orden.get(b.id) ?? 1e9) || b.addedAt - a.addedAt);
    const susAlbumes = albums
      .map((a) => ({ a, n: a.tracks.filter((t) => ids.has(t.id)).length }))
      .filter((x) => x.n > 0)
      .sort((x, y) => y.n - x.n)
      .map((x) => x.a);
    return { mias, susAlbumes };
  }, [tracks, albums, shortcutIds, fijadas, v]);

  const reintentar = async () => {
    setProbando(true);
    const ok = await probar();
    setProbando(false);
    if (!ok) showSnack('Sigues sin conexión');
  };

  if (!mias.length) {
    return (
      <div className="sin-conexion" role="status">
        <CloudOffIcon size={64} />
        <h2>Sin conexión</h2>
        <p>Puedes descargar canciones para que nunca te quedes sin música</p>
        <button className="sin-conexion-btn" onClick={abrirDescargas}>
          Ir a Descargas
        </button>
        <button className="sin-conexion-link" onClick={() => void reintentar()} disabled={probando}>
          {probando ? 'Probando…' : 'Reintentar'}
        </button>
      </div>
    );
  }

  return (
    <div className="home">
      <section>
        <div className="section-head">
          <div className="section-kicker">Sin conexión · tus descargas</div>
          <h2>Accesos directos</h2>
        </div>
        <ShortcutPages key="sin-conexion" songs={mias.slice(0, PAGE * MAX_PAGES - 1)} all={mias} currentId={currentId} radio={false} />
      </section>

      {susAlbumes.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Álbumes</h2>
          </div>
          <div className="carousel">
            {susAlbumes.map((a) => (
              <button key={a.key} className="card" onClick={() => push({ type: 'album', key: a.key })}>
                <Cover coverId={a.coverId} seed={a.name + a.artist} />
                <div className="card-title">{a.name}</div>
                <div className="card-sub">{a.artist}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="sin-conexion-pie">
        <CloudOffIcon size={18} /> Sin conexión: solo suena lo descargado.
        <button className="sin-conexion-link" onClick={() => void reintentar()} disabled={probando}>
          {probando ? 'Probando…' : 'Reintentar'}
        </button>
      </div>
    </div>
  );
}

export function Home() {
  const { tracks, artists, albums } = useLibrary();
  const sinConexion = useConexion((s) => s.largo) && descargasDisponibles;
  const push = useNav((s) => s.push);
  const currentId = usePlayer((s) => s.queue[s.index]);
  const shortcutIds = useReco((s) => s.shortcuts);
  const rediscoverIds = useReco((s) => s.rediscover);
  const moods = useReco((s) => s.moods);
  const ready = useReco((s) => s.ready);
  const heard = useReco((s) => s.heard);
  const albumKeys = useReco((s) => s.albums);
  const artistNames = useReco((s) => s.artists);
  const shuffleIds = useReco((s) => s.shuffle);
  const conSesion = useCuenta((s) => !!s.token);
  // (Todos los "use…" van aquí arriba, antes de cualquier return: React exige que sean siempre los mismos.)
  const fijadas = useFijadas((s) => s.ids);
  // Estadísticas (CTR): qué canciones de los accesos directos se mostraron.
  useEffect(() => {
    if (shortcutIds.length) mostradas('accesos', [...fijadas, ...shortcutIds].slice(0, 26));
  }, [shortcutIds, fijadas]);
  const [mood, setMood] = useState<MoodId | null>(null);
  // Tus álbumes y tus artistas: primero lo que escuchas y lo que va con tus gustos (no por orden alfabético).
  // (El orden lo decide el servidor con tus datos; aquí solo se buscan en la biblioteca.)
  const myAlbums = useMemo(() => {
    const m = new Map(albums.map((a) => [a.key, a]));
    return albumKeys.map((k) => m.get(k)).filter((a): a is (typeof albums)[number] => !!a);
  }, [albums, albumKeys]);
  const myArtists = useMemo(() => {
    const m = new Map(artists.map((a) => [a.name, a]));
    return artistNames.map((n) => m.get(n)).filter((a): a is (typeof artists)[number] => !!a);
  }, [artists, artistNames]);

  if (sinConexion && conSesion) return <InicioSinConexion currentId={currentId} />;

  if (tracks.length === 0) {
    // Con sesión: la música está llegando del servidor (un instante). Sin sesión: hay que entrar.
    if (conSesion)
      return (
        <div className="empty cargando-musica" role="status">
          <span className="spinner" aria-hidden="true" />
          <p>Cargando tu música…</p>
        </div>
      );
    return (
      <div className="empty">
        <h2>Tu música, recomendada para ti</h2>
        <p>Inicia sesión para escuchar la música del servidor. Con el tiempo la app aprende qué te gusta.</p>
        <button className="cuenta-btn" onClick={() => abrirCuenta()}>
          Iniciar sesión
        </button>
      </div>
    );
  }

  // Accesos directos: las recomendaciones del algoritmo (o, con un ánimo elegido, su mix).
  // Hasta 3 páginas de 9 (3×3); el último cuadro de la última página es "Aleatorio": 9 + 9 + 8 = 26 canciones.
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const toTracks = (ids: string[]) => ids.map((id) => byId.get(id)).filter((t): t is Track => !!t);
  const recoReady = ready && shortcutIds.length > 0;
  const moodList = mood ? toTracks(moods[mood]) : [];
  // Mientras llega el feed del servidor no se muestra nada "de relleno" (antes salían las últimas subidas).
  // Las canciones que fijaste (3 puntitos → "Fijar en accesos directos") van siempre primero.
  const shortcuts = mood
    ? moodList.slice(0, PAGE * MAX_PAGES - 1)
    : toTracks([...fijadas, ...shortcutIds.filter((id) => !fijadas.includes(id))]).slice(0, PAGE * MAX_PAGES - 1);
  const again = toTracks(rediscoverIds);
  const moodLabel = MOODS.find((m) => m.id === mood)?.label;
  // Aleatorio: tu música (escuchada, "me gusta" y tus playlists); si eres nuevo, el Billboard.
  const aleatorio = mood ? moodList : shuffleIds.length ? toTracks(shuffleIds) : shortcuts;
  // Usuario nuevo: todavía no hay "tus" álbumes ni artistas.
  const conGustos = heard >= MIN_HEARD;

  return (
    <div className="home">
      <div className="chips">
        {/* Tendencia solo aparece si tienes canciones que están en el Hot 100 esta semana */}
        {MOODS.filter((m) => m.id !== 'trending' || moods.trending.length > 0).map((m) => (
          <button
            key={m.id}
            className={`chip ${mood === m.id ? 'active' : ''}`}
            disabled={!recoReady}
            onClick={() => setMood(mood === m.id ? null : m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <section>
        <div className="section-head">
          <div className="section-kicker">{mood ? 'Mix de ánimo' : 'Para ti'}</div>
          <h2>{mood ? moodLabel : 'Accesos directos'}</h2>
        </div>
        {ready || mood ? (
          <ShortcutPages key={mood ?? 'all'} songs={shortcuts} all={aleatorio} currentId={currentId} radio={!mood} />
        ) : (
          <div className="feed-cargando" role="status" aria-label="Cargando tus recomendaciones">
            <span className="spinner" aria-hidden="true" />
          </div>
        )}
      </section>

      {!mood && <FromYourLibrary byId={byId} currentId={currentId} />}

      {!mood && <ParaTi byId={byId} currentId={currentId} />}
      {!mood && <DeLaComunidad byId={byId} currentId={currentId} />}

      {!mood && again.length >= 3 && (
        <section>
          <div className="section-head">
            <div className="section-kicker">Hace tiempo que no suenan</div>
            <h2>Redescubre</h2>
          </div>
          <div className="carousel">
            {again.map((t) => (
              <button
                key={t.id}
                className={`card ${t.id === currentId ? 'now-playing-card' : ''}`}
                onClick={() => {
                  marcarOrigen('redescubre');
                  playSongRadio(t.id, again);
                }}
              >
                <Cover coverId={t.coverId} seed={t.album + t.artist} />
                <div className="card-title">{t.title}</div>
                <div className="card-sub">{t.artist}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {conGustos && (
      <section>
        <div className="section-head">
          <h2>Tus álbumes</h2>
        </div>
        <div className="carousel">
          {myAlbums.map((a) => (
            <button key={a.key} className="card" onClick={() => push({ type: 'album', key: a.key })}>
              <Cover coverId={a.coverId} seed={a.name + a.artist} />
              <div className="card-title">{a.name}</div>
              <div className="card-sub">{a.artist}</div>
            </button>
          ))}
        </div>
      </section>
      )}

      {conGustos && (
      <section>
        <div className="section-head">
          <h2>Tus artistas</h2>
        </div>
        <div className="carousel">
          {myArtists.map((a) => (
            <button key={a.name} className="card artist" onClick={() => push({ type: 'artist', name: a.name })}>
              <Cover coverId={a.coverId} seed={a.name} round />
              <div className="card-title">{a.name}</div>
            </button>
          ))}
        </div>
      </section>
      )}
    </div>
  );
}
