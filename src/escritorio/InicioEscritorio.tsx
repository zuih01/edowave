import { useEffect, useMemo, useRef, useState } from 'react';
import { Cover } from '../components/Cover';
import { PlayIcon, ShuffleIcon } from '../components/Icons';
import { openTrackMenu } from '../components/TrackMenu';
import { NowPlayingBars } from '../components/TrackRow';
import { marcarOrigen, mostradas } from '../estadisticas';
import { useFijadas } from '../library/fijadas';
import { useLibrary } from '../library/store';
import { useNav } from '../nav';
import { puedeSonar, usePlayer } from '../player/player';
import { MIN_HEARD, MOODS, type MoodId } from '../reco/engine';
import { playSongRadio, useReco } from '../reco/store';
import { useConexion } from '../server/conexion';
import { useCuenta } from '../server/cuenta';
import { abrirCuenta } from '../components/CuentaScreen';
import { DeLaComunidad } from '../screens/Social';
import { ParaTi } from '../components/ParaTi';
import type { Track } from '../types';
import { clasesFila, empezarArrastre, menuDeFila, useSeleccion } from './seleccion';

const ACCESOS = 18; // carátulas grandes (se deslizan con las flechas)
const POR_PAGINA = 9; // 3 columnas × 3 filas, como los accesos directos del teléfono
const PAGINAS = 3;

/** Inicio de PC: ánimos arriba, "Selección rápida" (9 por página, con flechas) y tus carruseles. */
export function InicioEscritorio() {
  const { tracks, artists, albums } = useLibrary();
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
  const fijadas = useFijadas((s) => s.ids);
  const [mood, setMood] = useState<MoodId | null>(null);
  useEffect(() => {
    if (shortcutIds.length) mostradas('accesos', [...fijadas, ...shortcutIds].slice(0, 26));
  }, [shortcutIds, fijadas]);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const myAlbums = useMemo(() => {
    const m = new Map(albums.map((a) => [a.key, a]));
    return albumKeys.map((k) => m.get(k)).filter((a): a is (typeof albums)[number] => !!a);
  }, [albums, albumKeys]);
  const myArtists = useMemo(() => {
    const m = new Map(artists.map((a) => [a.name, a]));
    return artistNames.map((n) => m.get(n)).filter((a): a is (typeof artists)[number] => !!a);
  }, [artists, artistNames]);

  if (tracks.length === 0) {
    return conSesion ? (
      <div className="empty cargando-musica" role="status">
        <span className="spinner" aria-hidden="true" />
        <p>Cargando tu música…</p>
      </div>
    ) : (
      <div className="empty">
        <h2>Tu música, recomendada para ti</h2>
        <p>Inicia sesión para escuchar la música del servidor.</p>
        <button className="cuenta-btn" onClick={() => abrirCuenta()}>
          Iniciar sesión
        </button>
      </div>
    );
  }

  const toTracks = (ids: string[]) => ids.map((id) => byId.get(id)).filter((t): t is Track => !!t);
  const moodList = mood ? toTracks(moods[mood]) : [];
  // Accesos directos (carátulas grandes): las recomendaciones del algoritmo, con las fijadas primero.
  const accesos = mood
    ? moodList.slice(0, ACCESOS)
    : toTracks([...fijadas, ...shortcutIds.filter((id) => !fijadas.includes(id))]).slice(0, ACCESOS);
  // Selección rápida (lista de 3×3): más de tu música, sin repetir lo de arriba.
  const enAccesos = new Set(accesos.map((t) => t.id));
  const rapidas = mood
    ? moodList.slice(ACCESOS, ACCESOS + POR_PAGINA * PAGINAS)
    : toTracks([...shortcutIds, ...shuffleIds]).filter((t, i, l) => !enAccesos.has(t.id) && l.findIndex((x) => x.id === t.id) === i).slice(0, POR_PAGINA * PAGINAS);
  const aleatorio = mood ? moodList : shuffleIds.length ? toTracks(shuffleIds) : accesos;
  const again = toTracks(rediscoverIds);
  const conGustos = heard >= MIN_HEARD;
  const recoReady = ready && shortcutIds.length > 0;

  return (
    <div className="esc-inicio">
      <div className="esc-chips">
        {MOODS.filter((m) => m.id !== 'trending' || moods.trending.length > 0).map((m) => (
          <button key={m.id} className={`chip ${mood === m.id ? 'active' : ''}`} disabled={!recoReady} onClick={() => setMood(mood === m.id ? null : m.id)}>
            {m.label}
          </button>
        ))}
      </div>

      {!ready && !mood ? (
        <div className="feed-cargando" role="status" aria-label="Cargando tus recomendaciones">
          <span className="spinner" aria-hidden="true" />
        </div>
      ) : (
        <>
          <Carrusel
            key={`a-${mood ?? 'todo'}`}
            kicker={mood ? 'Mix de ánimo' : 'Para ti'}
            titulo={mood ? (MOODS.find((m) => m.id === mood)?.label ?? '') : 'Accesos directos'}
            accion={
              <button className="pill esc-pill" onClick={() => mezclar(aleatorio)} disabled={!aleatorio.length}>
                <ShuffleIcon size={18} /> Aleatorio
              </button>
            }
          >
            {accesos.map((t, i) => (
              <button
                key={t.id}
                className={`card esc-grande ${t.id === currentId ? 'now-playing-card' : ''}`}
                onClick={() => {
                  if (mood) {
                    marcarOrigen('animo');
                    usePlayer.getState().playTracks(moodList, i);
                  } else playSongRadio(t.id, accesos);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openTrackMenu(t);
                }}
                onPointerDown={(e) => empezarArrastre(e, () => [t])}
              >
                <span className="esc-grande-portada">
                  <Cover coverId={t.coverId} seed={t.album + t.artist} />
                  <span className="esc-grande-play">
                    <PlayIcon size={26} />
                  </span>
                </span>
                <div className="card-title">{t.title}</div>
                <div className="card-sub">{t.artist}</div>
              </button>
            ))}
          </Carrusel>

          {rapidas.length > 0 && (
            <SeleccionRapida
              key={`r-${mood ?? 'todo'}`}
              titulo="Selección rápida"
              canciones={rapidas}
              currentId={currentId}
              radio={!mood}
            />
          )}
        </>
      )}

      {!mood && <ParaTi byId={byId} currentId={currentId} />}
      {!mood && <DeLaComunidad byId={byId} currentId={currentId} />}

      {!mood && again.length >= 3 && (
        <Carrusel kicker="Hace tiempo que no suenan" titulo="Redescubre">
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
        </Carrusel>
      )}

      {!mood && conGustos && myAlbums.length > 0 && (
        <Carrusel titulo="Álbumes para ti">
          {myAlbums.map((a) => (
            <button key={a.key} className="card" onClick={() => push({ type: 'album', key: a.key })}>
              <Cover coverId={a.coverId} seed={a.name + a.artist} />
              <div className="card-title">{a.name}</div>
              <div className="card-sub">{a.artist}</div>
            </button>
          ))}
        </Carrusel>
      )}

      {!mood && conGustos && myArtists.length > 0 && (
        <Carrusel titulo="Tus artistas">
          {myArtists.map((a) => (
            <button key={a.name} className="card artist" onClick={() => push({ type: 'artist', name: a.name })}>
              <Cover coverId={a.coverId} seed={a.name} round />
              <div className="card-title">{a.name}</div>
            </button>
          ))}
        </Carrusel>
      )}
    </div>
  );
}

/** Flechas ‹ › para moverse de a una "pantalla" en una fila que se desliza de lado. */
function Flechas({ caja }: { caja: React.RefObject<HTMLDivElement | null> }) {
  const [bordes, setBordes] = useState({ ini: true, fin: false });
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const f = () => setBordes({ ini: el.scrollLeft <= 4, fin: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    f();
    el.addEventListener('scroll', f, { passive: true });
    window.addEventListener('resize', f);
    return () => {
      el.removeEventListener('scroll', f);
      window.removeEventListener('resize', f);
    };
  }, [caja]);
  const mover = (dir: number) => caja.current?.scrollBy({ left: dir * caja.current.clientWidth, behavior: 'smooth' });
  return (
    <div className="esc-flechas">
      <button onClick={() => mover(-1)} disabled={bordes.ini} aria-label="Anterior">
        ‹
      </button>
      <button onClick={() => mover(1)} disabled={bordes.fin} aria-label="Siguiente">
        ›
      </button>
    </div>
  );
}

/** Tu música en orden aleatorio, empezando por una al azar. */
function mezclar(lista: Track[]) {
  if (!lista.length) return;
  marcarOrigen('aleatorio');
  usePlayer.getState().playTracks(lista, Math.floor(Math.random() * lista.length), { shuffle: true });
}

function Carrusel({ titulo, kicker, accion, children }: { titulo: string; kicker?: string; accion?: React.ReactNode; children: React.ReactNode }) {
  const caja = useRef<HTMLDivElement>(null);
  return (
    <section className="esc-seccion">
      <div className="esc-seccion-cab">
        <div>
          {kicker && <div className="section-kicker">{kicker}</div>}
          <h2>{titulo}</h2>
        </div>
        <div className="esc-seccion-acciones">
          {accion}
          <Flechas caja={caja} />
        </div>
      </div>
      <div ref={caja} className="esc-carrusel">
        {children}
      </div>
    </section>
  );
}

/**
 * Selección rápida (como YouTube Music en PC): filas con portada chica, título y artista, en 3 columnas × 3 filas
 * = 9 canciones por página (las mismas 9 del cuadro del teléfono). Al tocar una suena su radio.
 */
function SeleccionRapida({ titulo, canciones, currentId, radio }: { titulo: string; canciones: Track[]; currentId?: string; radio: boolean }) {
  const caja = useRef<HTMLDivElement>(null);
  const playing = usePlayer((s) => s.playing);
  const caido = useConexion((s) => s.largo && s.guardadas >= 0);
  const paginas: Track[][] = [];
  for (let i = 0; i < canciones.length; i += POR_PAGINA) paginas.push(canciones.slice(i, i + POR_PAGINA));
  const tocar = (t: Track, i: number) => {
    if (radio) playSongRadio(t.id, canciones);
    else {
      marcarOrigen('animo');
      usePlayer.getState().playTracks(canciones, i);
    }
  };
  // Clic toca (como siempre); Ctrl + clic y Shift + clic eligen varias, como en las playlists.
  const sel = useSeleccion(
    canciones.length,
    (i) => tocar(canciones[i], i),
    (is) => usePlayer.getState().playTracks(is.map((i) => canciones[i]), 0, { shuffle: false }),
    canciones,
  );
  return (
    <section className="esc-seccion">
      <div className="esc-seccion-cab">
        <div>
          <h2>{titulo}</h2>
        </div>
        <div className="esc-seccion-acciones">
          <button
            className="pill esc-pill"
            onClick={() => {
              if (!radio) marcarOrigen('animo');
              usePlayer.getState().playTracks(canciones, 0, { shuffle: false });
            }}
          >
            Reproducir todo
          </button>
          <Flechas caja={caja} />
        </div>
      </div>
      {
        <div
          ref={(el) => {
            caja.current = el;
            sel.raiz.current = el;
          }}
          className="esc-rapida"
          data-seleccion=""
        >
          {paginas.map((pag, pi) => (
            <div key={pi} className="esc-rapida-pagina">
              {pag.map((t, ci) => {
                const i = pi * POR_PAGINA + ci;
                const sonando = t.id === currentId;
                return (
                  <div
                    key={t.id}
                    data-fila={i}
                    aria-selected={sel.elegidas.has(i)}
                    className={`esc-rapida-fila ${sonando ? 'sonando' : ''} ${caido && !puedeSonar(t.id) ? 'no-disponible' : ''} ${clasesFila(sel, i)}`}
                    onClick={(e) => {
                      if (e.shiftKey || e.ctrlKey || e.metaKey) sel.clic(i, e);
                      else {
                        sel.soltar();
                        tocar(t, i);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      menuDeFila(sel, canciones, i);
                    }}
                    onPointerDown={(e) => empezarArrastre(e, () => sel.arrastrables(i).map((n) => canciones[n]))}
                  >
                    <div className="esc-rapida-portada">
                      <Cover coverId={t.coverId} seed={t.album + t.artist} />
                      <span className="esc-rapida-play">{sonando ? <NowPlayingBars paused={!playing} /> : <PlayIcon size={22} />}</span>
                    </div>
                    <div className="track-text">
                      <div className="track-title">{t.title}</div>
                      <div className="track-sub">
                        {t.artist}
                        {t.album && t.album !== 'Álbum desconocido' ? ` • ${t.album}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      }
    </section>
  );
}
