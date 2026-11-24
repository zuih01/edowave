import { Carrusel } from '../components/Carrusel';
import { Cover } from '../components/Cover';
import { Fragment, useEffect, useRef, useState } from 'react';
import { cargarHistorial, cargarValoraciones } from '../server/datosCuenta';
import { BotonDescargar } from '../components/Descargas';
import { BackIcon, MoreIcon, PlayIcon, PlaylistAddIcon, ShuffleIcon } from '../components/Icons';
import { PlaylistCover } from '../components/PlaylistCover';
import { FilaFaltante, useFaltantes } from '../components/FaltantesPlaylist';
import { guardarComoPlaylist, openPlaylistOptions } from '../components/PlaylistSheets';
import { LIKED_ID, usePlaylists } from '../library/playlists';
import { TrackRow } from '../components/TrackRow';
import { arrastrarConAsa } from '../components/ordenar';
import { buscarArtista, VARIOS_ARTISTAS } from '../library/group';
import { ListaSeleccionable } from '../escritorio/seleccion';
import { useLibrary } from '../library/store';
import { goBack, useNav, type Page } from '../nav';
import { usePlayer } from '../player/player';
import { playSongRadio, useReco } from '../reco/store';
import { artistasDe } from '../components/ParaTi';
import { useListaBusqueda } from '../components/ListaBusqueda';
import { Settings } from './Settings';
import { AmigosPage, ComunidadPage, UsuarioPage } from './Social';
import { ResultadosBusqueda } from '../escritorio/ResultadosBusqueda';
import type { Track } from '../types';

function totalTime(sec: number) {
  const min = Math.round(sec / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

function BackBar() {
  return (
    <button className="back-btn" onClick={goBack} aria-label="Atrás">
      <BackIcon />
    </button>
  );
}

/**
 * Reproducir / Aleatorio: suenan SOLO estas canciones (las del álbum, o TODAS las del artista: de cualquier
 * álbum o sencillo), en orden o al azar. Cuando se acaban, la radio sigue con canciones parecidas de otros
 * artistas (eso lo hace el reproductor solo al final de la cola, ver extendWithRadio).
 */
function PlayButtons({ tracks, onPlay, extra, nombre }: { tracks: Track[]; onPlay?: () => void; extra?: React.ReactNode; nombre: string }) {
  const playTracks = (list: Track[], i: number, opts: { shuffle: boolean }) => usePlayer.getState().playTracks(list, i, opts);
  const empty = tracks.length === 0;
  return (
    <div className="play-buttons">
      <button
        className="pill primary"
        disabled={empty}
        onClick={() => {
          playTracks(tracks, 0, { shuffle: false });
          onPlay?.();
        }}
      >
        <PlayIcon size={20} /> Reproducir
      </button>
      <button
        className="pill"
        disabled={empty}
        onClick={() => {
          playTracks(tracks, Math.floor(Math.random() * tracks.length), { shuffle: true });
          onPlay?.();
        }}
      >
        <ShuffleIcon size={20} /> Aleatorio
      </button>
      <BotonDescargar tracks={tracks} nombre={nombre} />
      {extra}
    </div>
  );
}

export function Detail({ page }: { page: Page }) {
  if (page.type === 'playlist') return <PlaylistPage id={page.id} />;
  if (page.type === 'history') return <HistoryPage />;
  if (page.type === 'settings')
    return (
      <div className="detail">
        <BackBar />
        <Settings />
      </div>
    );
  if (page.type === 'amigos') return <AmigosPage />;
  if (page.type === 'usuario') return <UsuarioPage id={page.id} />;
  if (page.type === 'comunidad') return <ComunidadPage id={page.id} />;
  if (page.type === 'resultados') return <ResultadosBusqueda q={page.q} />;
  if (page.type === 'mix') return <MixPage id={page.id} />;
  if (page.type === 'lista') return <ListaBusquedaPage q={page.q} />;
  return page.type === 'album' ? <AlbumPage albumKey={page.key} /> : <ArtistPage name={page.name} />;
}

/**
 * Un mix de "Para ti": se arma en el servidor con lo que escuchas (se renueva cada día). Reproducir/Aleatorio
 * ponen solo sus canciones; cuando se acaban, sigue la radio con canciones parecidas.
 */
function MixPage({ id }: { id: string }) {
  const mix = useReco((s) => s.paraTi.find((x) => x.id === id));
  const tracks = useLibrary((s) => s.tracks);
  const playTracks = usePlayer((s) => s.playTracks);
  if (!mix) return <BackBar />;
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const list = mix.ids.map((i) => byId.get(i)).filter((t): t is Track => !!t);
  return (
    <div className="detail">
      <BackBar />
      <div className="detail-hero">
        <PlaylistCover id={`mix:${mix.id}`} tracks={list} className="hero-cover" />
        <h1>{mix.titulo}</h1>
        <div className="muted small">
          Mix para ti • {list.length} canciones{list.length > 0 && ` • ${totalTime(list.reduce((n, t) => n + t.duration, 0))}`}
        </div>
        {list.length > 0 && <div className="muted small">{artistasDe(list)}</div>}
        <PlayButtons tracks={list} nombre={`"${mix.titulo}"`} />
      </div>
      <ListaSeleccionable tracks={list}>
        {list.map((t, i) => (
          <TrackRow key={t.id} track={t} fila={i} onPlay={() => playTracks(list, i, { shuffle: false })} />
        ))}
      </ListaSeleccionable>
    </div>
  );
}

/** Lista armada por el buscador: se puede tocar, descargar o guardar como playlist propia. */
function ListaBusquedaPage({ q }: { q: string }) {
  const { lista, error, canciones: list } = useListaBusqueda(q);
  const playTracks = usePlayer((s) => s.playTracks);
  if (!lista)
    return (
      <div className="detail">
        <BackBar />
        {error ? (
          <p className="muted pad">No se pudo armar esta lista. Revisa tu conexión.</p>
        ) : (
          <div className="feed-cargando" role="status" aria-label="Cargando">
            <span className="spinner" aria-hidden="true" />
          </div>
        )}
      </div>
    );
  return (
    <div className="detail">
      <BackBar />
      <div className="detail-hero">
        <PlaylistCover id={`lista:${q}`} tracks={list} className="hero-cover" />
        <h1>{lista.titulo}</h1>
        <div className="muted small">
          Lista de tu búsqueda • {list.length} canciones{list.length > 0 && ` • ${totalTime(list.reduce((n, t) => n + t.duration, 0))}`}
        </div>
        {lista.descripcion && <div className="muted small">{lista.descripcion}</div>}
        <PlayButtons
          tracks={list}
          nombre={`"${lista.titulo}"`}
          extra={
            <button
              className="pill icono"
              aria-label="Guardar como playlist"
              title="Guardar como playlist"
              onClick={() => void guardarComoPlaylist(lista.titulo, list.map((t) => t.id), `lista|${q}`)}
            >
              <PlaylistAddIcon size={20} />
            </button>
          }
        />
      </div>
      <ListaSeleccionable tracks={list}>
        {list.map((t, i) => (
          <TrackRow key={t.id} track={t} fila={i} onPlay={() => playTracks(list, i, { shuffle: false })} />
        ))}
      </ListaSeleccionable>
    </div>
  );
}

function AlbumPage({ albumKey }: { albumKey: string }) {
  const album = useLibrary((s) => s.albums.find((a) => a.key === albumKey));
  const push = useNav((s) => s.push);
  const playTracks = usePlayer((s) => s.playTracks);
  if (!album) return <BackBar />;
  const dur = album.tracks.reduce((n, t) => n + t.duration, 0);
  return (
    <div className="detail">
      <BackBar />
      <div className="detail-hero">
        <Cover coverId={album.coverId} seed={album.name + album.artist} className="hero-cover" />
        <h1>{album.name}</h1>
        {album.artist === VARIOS_ARTISTAS ? (
          <span className="muted">{VARIOS_ARTISTAS}</span>
        ) : (
          <button className="link" onClick={() => push({ type: 'artist', name: album.artist })}>
            {album.artist}
          </button>
        )}
        <div className="muted small">
          {album.tracks.length === 1 ? 'Sencillo' : 'Álbum'}
          {album.year ? ` • ${album.year}` : ''} • {album.tracks.length} {album.tracks.length === 1 ? 'canción' : 'canciones'} • {totalTime(dur)}
        </div>
        <PlayButtons
          tracks={album.tracks}
          nombre={`"${album.name}"`}
          extra={
            <button
              className="pill icono"
              aria-label="Guardar como playlist"
              title="Guardar como playlist"
              onClick={() => void guardarComoPlaylist(album.name, album.tracks.map((t) => t.id), `album|${album.key}`)}
            >
              <PlaylistAddIcon size={20} />
            </button>
          }
        />
      </div>
      <ListaSeleccionable tracks={album.tracks}>
        {album.tracks.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            fila={i}
            index={t.trackNo ?? i + 1}
            showAlbum={false}
            onPlay={() => playTracks(album.tracks, i, { shuffle: false })}
          />
        ))}
      </ListaSeleccionable>
    </div>
  );
}

function ArtistPage({ name }: { name: string }) {
  const artist = useLibrary((s) => buscarArtista(s.artists, name));
  const push = useNav((s) => s.push);
  if (!artist) return <BackBar />;
  return (
    <div className="detail">
      <BackBar />
      <div className="detail-hero">
        <Cover coverId={artist.coverId} seed={artist.name} round className="hero-cover" />
        <h1>{artist.name}</h1>
        <div className="muted small">
          {artist.tracks.length} canciones • {totalTime(artist.tracks.reduce((n, t) => n + t.duration, 0))}
        </div>
        <PlayButtons tracks={artist.tracks} nombre={artist.name} />
      </div>
      {/* Álbumes (2 canciones o más) y, debajo, Sencillos (los de una sola canción). */}
      {[
        { titulo: 'Álbumes', lista: artist.albums.filter((a) => a.tracks.length > 1) },
        { titulo: 'Sencillos', lista: artist.albums.filter((a) => a.tracks.length === 1) },
        { titulo: 'Aparece en', lista: artist.aparece ?? [] },
      ].map(
        ({ titulo, lista }) =>
          lista.length > 0 && (
            <section key={titulo}>
              <h3 className="sub-head">{titulo}</h3>
              <Carrusel>
                {lista.map((a) => (
                  <button key={a.key} className="card" onClick={() => push({ type: 'album', key: a.key })}>
                    <Cover coverId={a.coverId} seed={a.name + a.artist} />
                    <div className="card-title">{a.name}</div>
                    <div className="card-sub">
                      {titulo === 'Aparece en' ? a.artist : (a.year ?? (a.tracks.length === 1 ? 'Sencillo' : `${a.tracks.length} canciones`))}
                    </div>
                  </button>
                ))}
              </Carrusel>
            </section>
          ),
      )}
      <section>
        <h3 className="sub-head">Canciones</h3>
        <ListaSeleccionable tracks={artist.tracks} tocar={(i) => playSongRadio(artist.tracks[i].id)}>
          {artist.tracks.map((t, i) => (
            <TrackRow key={t.id} track={t} fila={i} onPlay={() => playSongRadio(t.id)} />
          ))}
        </ListaSeleccionable>
      </section>
    </div>
  );
}

/** Página de una playlist (o de "Música que te gustó"). */
function PlaylistPage({ id }: { id: string }) {
  const liked = id === LIKED_ID;
  const p = usePlaylists((s) => s.list.find((x) => x.id === id));
  const tracks = useLibrary((s) => s.tracks);
  const ratings = usePlayer((s) => s.ratings);
  const playTracks = usePlayer((s) => s.playTracks);
  const falt = useFaltantes(liked ? null : id);
  const listaRef = useRef<HTMLDivElement>(null);
  // Orden de "Música que te gustó": lo último que marcaste, primero.
  const [likedAt, setLikedAt] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (liked) cargarValoraciones().then((rs) => setLikedAt(new Map(rs.map((r) => [r.trackId, r.at]))));
  }, [liked, ratings]);

  if (!liked && !p) return <BackBar />;
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const list = liked
    ? tracks.filter((t) => ratings[t.id] === 1).sort((a, b) => (likedAt.get(b.id) ?? 0) - (likedAt.get(a.id) ?? 0))
    : p!.trackIds.map((i) => byId.get(i)).filter((t): t is Track => !!t);
  const name = liked ? 'Música que te gustó' : p!.name;
  const markPlayed = () => {
    if (!liked) usePlaylists.getState().markPlayed(id);
  };

  return (
    <div className="detail">
      <BackBar />
      <div className="detail-hero">
        <PlaylistCover id={id} tracks={list} className="hero-cover" />
        <h1>{name}</h1>
        <div className="muted small">
          {liked ? 'Playlist autogenerada' : p!.public ? 'Playlist pública' : 'Playlist privada'} • {list.length} {list.length === 1 ? 'canción' : 'canciones'}
          {list.length > 0 && ` • ${totalTime(list.reduce((n, t) => n + t.duration, 0))}`}
          {falt.total > 0 && ` • ${falt.total} no ${falt.total === 1 ? 'disponible' : 'disponibles'}`}
        </div>
        <PlayButtons
          tracks={list}
          nombre={`"${name}"`}
          onPlay={markPlayed}
          extra={
            !liked && (
              <button className="icon-btn" aria-label="Más opciones de la playlist" onClick={() => openPlaylistOptions(id)}>
                <MoreIcon />
              </button>
            )
          }
        />
      </div>
      {list.length === 0 && !falt.total ? (
        <p className="muted pad">
          {liked
            ? 'Aquí aparecen las canciones a las que les das "me gusta".'
            : 'Esta playlist está vacía. En cualquier canción toca ⋮ y luego "Guardar en playlist".'}
        </p>
      ) : (
        <div className="list" ref={listaRef}>
          {falt.inicio.map((f) => (
            <FilaFaltante key={`f${f.id}`} f={f} onQuitar={falt.quitar} />
          ))}
          {list.map((t, i) => (
            <Fragment key={t.id}>
              <TrackRow
                track={t}
                orden={liked ? undefined : i}
                onAsa={
                  liked
                    ? undefined
                    : (e) => arrastrarConAsa(e, listaRef.current, i, (d) => void usePlaylists.getState().moveTracks(id, [t.id], list[d.i].id, d.despues))
                }
                playlist={liked ? undefined : { id, index: p!.trackIds.indexOf(t.id) }}
                onPlay={() => {
                  playTracks(list, i, { shuffle: false });
                  markPlayed();
                }}
              />
              {falt.tras(t.id).map((f) => (
                <FilaFaltante key={`f${f.id}`} f={f} onQuitar={falt.quitar} />
              ))}
            </Fragment>
          ))}
          {falt.final.map((f) => (
            <FilaFaltante key={`f${f.id}`} f={f} onQuitar={falt.quitar} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Día de una escucha, en palabras: "Hoy", "Ayer", "Lunes 3 de noviembre"… */
function nombreDia(t: number) {
  const d = new Date(t);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const dias = Math.round((hoy.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  const txt = d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== hoy.getFullYear() ? { year: 'numeric' } : {}) });
  return txt[0].toUpperCase() + txt.slice(1);
}

/** Historial: lo que escuchaste, lo más reciente primero, agrupado por día (cada canción una vez por día). */
function HistoryPage() {
  const tracks = useLibrary((s) => s.tracks);
  const playTracks = usePlayer((s) => s.playTracks);
  const [grupos, setGrupos] = useState<{ dia: string; tracks: Track[] }[] | null>(null);

  useEffect(() => {
    let vivo = true;
    cargarHistorial().then((plays) => {
      if (!vivo) return;
      const porId = new Map(tracks.map((t) => [t.id, t]));
      const out: { dia: string; tracks: Track[] }[] = [];
      const vistos = new Set<string>();
      let total = 0;
      for (const p of plays.sort((a, b) => b.startedAt - a.startedAt)) {
        if (p.listened < 10 && !p.completed) continue; // pasadas de largo, no cuentan
        const t = porId.get(p.trackId);
        if (!t) continue;
        const dia = nombreDia(p.startedAt);
        let g = out[out.length - 1];
        if (!g || g.dia !== dia) out.push((g = { dia, tracks: [] }));
        const k = `${dia}|${t.id}`;
        if (vistos.has(k)) continue;
        vistos.add(k);
        g.tracks.push(t);
        if (++total >= 500) break;
      }
      setGrupos(out.filter((g) => g.tracks.length));
    });
    return () => {
      vivo = false;
    };
  }, [tracks]);

  return (
    <div className="detail">
      <BackBar />
      <h1 className="page-title">Historial</h1>
      {grupos && grupos.length === 0 && <p className="muted empty-note">Aquí aparecerá lo que escuches.</p>}
      {grupos && grupos.length > 0 && (
        // Una sola selección para todo el historial (Shift + flechas pasa de un día a otro).
        <ListaSeleccionable tracks={grupos.flatMap((g) => g.tracks)} className="">
          {grupos.map((g, gi) => {
            const antes = grupos.slice(0, gi).reduce((n, x) => n + x.tracks.length, 0);
            return (
              <section key={g.dia}>
                <h3 className="sub-head">{g.dia}</h3>
                <div className="list">
                  {g.tracks.map((t, i) => (
                    <TrackRow key={t.id} track={t} fila={antes + i} onPlay={() => playTracks(g.tracks, i, { shuffle: false })} />
                  ))}
                </div>
              </section>
            );
          })}
        </ListaSeleccionable>
      )}
    </div>
  );
}
