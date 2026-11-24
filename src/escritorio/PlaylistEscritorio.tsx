import { Fragment, useEffect, useState } from 'react';
import { Cover, fallbackBackground } from '../components/Cover';
import { BotonDescargar, MarcaDescarga } from '../components/Descargas';
import { MoreIcon, PauseIcon, PlayIcon, ShuffleIcon } from '../components/Icons';
import { PlaylistCover } from '../components/PlaylistCover';
import { FilaFaltantePc, useFaltantes } from '../components/FaltantesPlaylist';
import { openPlaylistOptions } from '../components/PlaylistSheets';
import { openSeleccionMenu, openTrackMenu } from '../components/TrackMenu';
import { formatDuration, NowPlayingBars } from '../components/TrackRow';
import { LIKED_ID, usePlaylists } from '../library/playlists';
import { claveAlbum, useLibrary } from '../library/store';
import { useCover } from '../library/useCover';
import { useNav } from '../nav';
import { usePlayer } from '../player/player';
import { useDominantColor } from '../player/useDominantColor';
import { cargarValoraciones } from '../server/datosCuenta';
import type { Track } from '../types';
import { clasesFila, empezarArrastre, useSeleccion } from './seleccion';

function tiempoTotal(sec: number) {
  const min = Math.round(sec / 60);
  return min >= 60 ? `cerca de ${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

/** Playlist en PC: encabezado grande del color de su portada y las canciones en una tabla. */
export function PlaylistEscritorio({ id }: { id: string }) {
  const liked = id === LIKED_ID;
  const p = usePlaylists((s) => s.list.find((x) => x.id === id));
  const tracks = useLibrary((s) => s.tracks);
  const ratings = usePlayer((s) => s.ratings);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const push = useNav((s) => s.push);
  const [likedAt, setLikedAt] = useState<Map<string, number>>(new Map());
  const falt = useFaltantes(liked ? null : id);
  useEffect(() => {
    if (liked) cargarValoraciones().then((rs) => setLikedAt(new Map(rs.map((r) => [r.trackId, r.at]))));
  }, [liked, ratings]);

  const byId = new Map(tracks.map((t) => [t.id, t]));
  const list: Track[] = liked
    ? tracks.filter((t) => ratings[t.id] === 1).sort((a, b) => (likedAt.get(b.id) ?? 0) - (likedAt.get(a.id) ?? 0))
    : (p?.trackIds.map((i) => byId.get(i)).filter((t): t is Track => !!t) ?? []);
  const sel = useSeleccion(list.length, (i) => tocar(i), (is) => usePlayer.getState().playTracks(is.map((i) => list[i]), 0, { shuffle: false }), list);
  /** Posición real en la playlist (las canciones que ya no existen no se muestran, pero ocupan lugar). */
  const posicion = (t: Track) => p!.trackIds.indexOf(t.id);
  const menuFila = (i: number) => {
    const elegidas = sel.elegidas.has(i) && sel.elegidas.size > 1 ? [...sel.elegidas].sort((a, b) => a - b) : null;
    if (!elegidas) {
      sel.elegirSolo(i);
      return openTrackMenu(list[i], liked ? undefined : { playlist: { id, index: posicion(list[i]) } });
    }
    const ts = elegidas.map((n) => list[n]);
    openSeleccionMenu({ tracks: ts, playlist: liked ? undefined : { id, indices: ts.map(posicion) } });
  };
  const primera = list[0];
  const url = useCover(primera?.coverId);
  const color = useDominantColor(url, primera ? fallbackBackground(primera.album + primera.artist) : '#3a3a5a');

  if (!liked && !p) return <p className="muted pad">Esta playlist ya no existe.</p>;
  const nombre = liked ? 'Música que te gustó' : p!.name;
  // ¿Está sonando esta playlist? (la cola es exactamente sus canciones)
  const estaSonando = list.length > 0 && queue.length === list.length && queue.every((x, i) => x === list[i].id);
  const marcar = () => {
    if (!liked) usePlaylists.getState().markPlayed(id);
  };
  const tocar = (i: number, shuffle = false) => {
    usePlayer.getState().playTracks(list, i, { shuffle });
    marcar();
  };

  return (
    <div className="esc-pl" style={{ '--tinte': color } as React.CSSProperties}>
      <header className="esc-pl-cab">
        <PlaylistCover id={id} tracks={list} className="esc-pl-portada" />
        <div className="esc-pl-info">
          <div className="esc-pl-tipo">{liked ? 'Playlist automática' : p!.public ? 'Playlist pública' : 'Playlist privada'}</div>
          <h1 className={nombre.length > 18 ? 'largo' : ''}>{nombre}</h1>
          <div className="esc-pl-datos">
            {list.length} {list.length === 1 ? 'canción' : 'canciones'}
            {list.length > 0 && ` • ${tiempoTotal(list.reduce((n, t) => n + t.duration, 0))}`}
            {falt.total > 0 && ` • ${falt.total} no ${falt.total === 1 ? 'disponible' : 'disponibles'}`}
          </div>
        </div>
      </header>

      <div className="esc-pl-acciones">
        <button
          className="esc-pl-play"
          disabled={!list.length}
          onClick={() => (estaSonando ? usePlayer.getState().toggle() : tocar(0))}
          aria-label={estaSonando && playing ? 'Pausar' : 'Reproducir'}
        >
          {estaSonando && playing ? <PauseIcon size={30} /> : <PlayIcon size={30} />}
        </button>
        <button className="icon-btn esc-pl-icono" disabled={!list.length} onClick={() => tocar(Math.floor(Math.random() * list.length), true)} title="Aleatorio" aria-label="Aleatorio">
          <ShuffleIcon size={30} />
        </button>
        <BotonDescargar tracks={list} nombre={`"${nombre}"`} className="icon-btn esc-pl-icono" size={28} />
        {!liked && (
          <button className="icon-btn esc-pl-icono" onClick={() => openPlaylistOptions(id)} title="Más opciones" aria-label="Más opciones de la playlist">
            <MoreIcon size={28} />
          </button>
        )}
      </div>

      {list.length === 0 && !falt.total ? (
        <p className="muted pad">
          {liked ? 'Aquí aparecen las canciones a las que les das "me gusta".' : 'Esta playlist está vacía. En cualquier canción usa ⋮ y luego "Guardar en playlist".'}
        </p>
      ) : (
        <div ref={sel.raiz} className="esc-tabla" role="table" data-seleccion="">
          <div className="esc-tabla-cab" role="row">
            <span>#</span>
            <span>Título</span>
            <span>Álbum</span>
            <span>Año</span>
            <span className="der" title="Duración">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </span>
          </div>
          {falt.inicio.map((f) => (
            <FilaFaltantePc key={`f${f.id}`} f={f} onQuitar={falt.quitar} />
          ))}
          {list.map((t, i) => {
            const actual = estaSonando && index === i;
            return (
              <Fragment key={`${t.id}-${i}`}>
              <div
                role="row"
                data-fila={i}
                aria-selected={sel.elegidas.has(i)}
                className={`esc-tabla-fila ${actual ? 'actual' : ''} ${clasesFila(sel, i)} ${ratings[t.id] === -1 ? 'disliked' : ''}`}
                onClick={(e) => sel.clic(i, e)}
                data-orden={liked ? undefined : i}
                onPointerDown={(e) =>
                  empezarArrastre(
                    e,
                    () => sel.arrastrables(i).map((n) => list[n]),
                    liked
                      ? undefined
                      : {
                          raiz: sel.raiz.current,
                          mover: (ts, d) => {
                            sel.soltar();
                            void usePlaylists.getState().moveTracks(id, ts.map((t) => t.id), list[d.i].id, d.despues);
                          },
                        },
                  )
                }
                onDoubleClick={(e) => {
                  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) tocar(i);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  menuFila(i);
                }}
              >
                <span className="esc-tabla-num">
                  {actual ? <NowPlayingBars paused={!playing} /> : <span className="n">{i + 1}</span>}
                  <button
                    className="esc-tabla-tocar"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (actual) usePlayer.getState().toggle();
                      else tocar(i);
                    }}
                    aria-label={`Reproducir ${t.title}`}
                  >
                    {actual && playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                  </button>
                </span>
                <span className="esc-tabla-titulo">
                  <Cover coverId={t.coverId} seed={t.album + t.artist} className="thumb" />
                  <span className="track-text">
                    <span className="track-title">{t.title}</span>
                    <span className="track-sub">
                      <MarcaDescarga id={t.id} />
                      <button
                        className="esc-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          push({ type: 'artist', name: t.albumArtist || t.artist });
                        }}
                      >
                        {t.artist}
                      </button>
                    </span>
                  </span>
                </span>
                <span className="esc-tabla-album">
                  {t.album && t.album !== 'Álbum desconocido' ? (
                    <button
                      className="esc-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        push({ type: 'album', key: claveAlbum(t) });
                      }}
                    >
                      {t.album}
                    </button>
                  ) : (
                    '—'
                  )}
                </span>
                <span className="esc-tabla-anio">{t.year ?? ''}</span>
                <span className="der esc-tabla-dur">
                  {formatDuration(t.duration)}
                  <button
                    className="icon-btn esc-tabla-mas"
                    onClick={(e) => {
                      e.stopPropagation();
                      menuFila(i);
                    }}
                    aria-label="Más opciones"
                  >
                    <MoreIcon size={20} />
                  </button>
                </span>
              </div>
              {falt.tras(t.id).map((f) => (
                <FilaFaltantePc key={`f${f.id}`} f={f} onQuitar={falt.quitar} />
              ))}
              </Fragment>
            );
          })}
          {falt.final.map((f) => (
            <FilaFaltantePc key={`f${f.id}`} f={f} onQuitar={falt.quitar} />
          ))}
        </div>
      )}
    </div>
  );
}
