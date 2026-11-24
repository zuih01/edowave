import { create } from 'zustand';
import { usePlayer } from '../player/player';
import { closeAllOverlaysThen, closeOverlay, openOverlay, useNav } from '../nav';
import { claveAlbum } from '../library/store';
import type { Track } from '../types';
import { Cover } from './Cover';
import { useExit } from './useExit';
import { alternarDescarga, useEstadoDescarga } from './Descargas';
import { descargasDisponibles, esDelServidor } from '../server/biblioteca';
import { openCredits } from './Credits';
import { abrirReporte } from './Reportar';
import { openEqualizer } from './Equalizer';
import { escritorioActivo } from '../escritorio/activo';
import { guardarEnPlaylist, ListaPlaylistsMenu, openCreatePlaylist, openSaveToPlaylist, showSnack } from './PlaylistSheets';
import { usePlaylists } from '../library/playlists';
import { useFijadas } from '../library/fijadas';
import { menuContextual, Submenu, useAnclaMenu } from './menuContextual';
import { useEnParty } from '../screens/Party';
import { agregar as agregarAParty, iniciarParty } from '../server/party';
import { AlbumIcon, PartyIcon, RadioIcon, EqualizerIcon, InfoIcon, PlaylistAddIcon, PlaylistRemoveIcon, PersonIcon, PlayNextIcon, QueueIcon, ThumbDownIcon, ThumbUpIcon, DownloadIcon, DownloadedIcon, PlayIcon } from './Icons';

type PlaylistRef = { id: string; index: number };
/** Varias canciones elegidas (PC: clic, Shift + flechas, Ctrl + clic). `indices`: sus posiciones en la playlist. */
type Seleccion = { tracks: Track[]; playlist?: { id: string; indices: number[] } };
const useMenu = create<{ track: Track | null; fromPlayer: boolean; playlist?: PlaylistRef; seleccion?: Seleccion }>(() => ({ track: null, fromPlayer: false }));

/**
 * `fromPlayer`: abierto desde el reproductor completo (muestra también el ecualizador).
 * `playlist`: la canción está dentro de una playlist (muestra "Quitar de esta playlist").
 */
export function openTrackMenu(track: Track, opts: { fromPlayer?: boolean; playlist?: PlaylistRef } = {}) {
  useMenu.setState({ track, fromPlayer: !!opts.fromPlayer, playlist: opts.playlist, seleccion: undefined });
  openOverlay(() => useMenu.setState({ track: null }));
}

/** Menú de varias canciones a la vez (selección múltiple de PC). Con una sola, es el menú normal. */
export function openSeleccionMenu(sel: Seleccion) {
  if (!sel.tracks.length) return;
  if (sel.tracks.length === 1) {
    const pl = sel.playlist;
    return openTrackMenu(sel.tracks[0], pl ? { playlist: { id: pl.id, index: pl.indices[0] } } : {});
  }
  useMenu.setState({ track: sel.tracks[0], fromPlayer: false, playlist: undefined, seleccion: sel });
  openOverlay(() => useMenu.setState({ track: null, seleccion: undefined }));
}

/** Menú de una canción (los tres puntos): hoja que sube en el teléfono, menú junto al clic en PC. */
export function TrackMenu() {
  const { shown: track, closing } = useExit(useMenu((s) => s.track), 180);
  const rating = usePlayer((s) => (track ? s.ratings[track.id] : undefined));
  const fijada = useFijadas((s) => !!track && s.ids.includes(track.id));
  const fromPlayer = useMenu((s) => s.fromPlayer);
  const inPlaylist = useMenu((s) => s.playlist);
  const seleccion = useMenu((s) => s.seleccion);
  const descarga = useEstadoDescarga(track?.id);
  const enParty = useEnParty();
  const ctx = !!track && menuContextual();
  const ref = useAnclaMenu<HTMLDivElement>(ctx);
  if (!track) return null;
  const p = usePlayer.getState();
  const nav = useNav.getState();
  const albumKey = claveAlbum(track);

  // Cierra el menú y, cuando el historial ya volvió, ejecuta la acción.
  const run = (fn: () => void) => () => {
    closeOverlay();
    setTimeout(fn, 30);
  };

  const guardar = (tracks: Track[]) => (
    <Submenu
      icono={<PlaylistAddIcon />}
      texto="Guardar en playlist"
      alTocar={() => {
        // Esta ventana se reemplaza por la de elegir playlist.
        closeOverlay();
        setTimeout(() => openSaveToPlaylist(tracks), 30);
      }}
    >
      <ListaPlaylistsMenu
        nueva={() => {
          closeOverlay();
          setTimeout(() => openCreatePlaylist(tracks.map((t) => t.id), false), 30);
        }}
        alElegir={(id) => {
          closeOverlay();
          void guardarEnPlaylist(id, tracks);
        }}
      />
    </Submenu>
  );

  const contenido = seleccion ? (
    <>
      <div className="sheet-head">
        <div className="track-text">
          <div className="track-title">{seleccion.tracks.length} canciones elegidas</div>
          <div className="track-sub">
            {seleccion.tracks
              .slice(0, 3)
              .map((t) => t.title)
              .join(', ')}
            {seleccion.tracks.length > 3 ? '…' : ''}
          </div>
        </div>
      </div>
      <button className="sheet-item" onClick={run(() => p.playTracks(seleccion.tracks, 0, { shuffle: false }))}>
        <PlayIcon /> Reproducir
      </button>
      <button
        className="sheet-item"
        onClick={run(() => {
          // Al revés: cada una entra justo después de la que suena, así quedan en su orden.
          if (!usePlayer.getState().queue.length) return p.playTracks(seleccion.tracks, 0, { shuffle: false });
          [...seleccion.tracks].reverse().forEach((t) => usePlayer.getState().playNext(t));
          showSnack(`${seleccion.tracks.length} canciones a continuación`);
        })}
      >
        <PlayNextIcon /> Reproducir a continuación
      </button>
      <button
        className="sheet-item"
        onClick={run(() => {
          seleccion.tracks.forEach((t) => usePlayer.getState().addToQueue(t));
          showSnack(`${seleccion.tracks.length} canciones añadidas a la cola`);
        })}
      >
        <QueueIcon /> Añadir a la cola
      </button>
      {(() => {
        // "Me gusta" a todas (como "Guardar en tus Me gusta" de Spotify); si ya les gustan todas, se puede quitar.
        const ratings = usePlayer.getState().ratings;
        const todas = seleccion.tracks.every((t) => ratings[t.id] === 1);
        return (
          <button
            className="sheet-item"
            onClick={run(() => {
              const r = usePlayer.getState().ratings;
              const cambiar = seleccion.tracks.filter((t) => (todas ? r[t.id] === 1 : r[t.id] !== 1));
              cambiar.forEach((t) => usePlayer.getState().rate(t.id, 1));
              showSnack(todas ? `Se quitó el me gusta a ${cambiar.length} canciones` : `${cambiar.length} canciones en Música que te gustó`);
            })}
          >
            <ThumbUpIcon filled={todas} /> {todas ? 'Quitar de Música que te gustó' : 'Guardar en Música que te gustó'}
          </button>
        );
      })()}
      {enParty && (
        <button className="sheet-item" onClick={run(() => void agregarAParty(seleccion.tracks))}>
          <PartyIcon /> Agregar a la Party
        </button>
      )}
      {guardar(seleccion.tracks)}
      {seleccion.playlist && (
        <button
          className="sheet-item"
          onClick={run(async () => {
            const sp = seleccion.playlist!;
            await usePlaylists.getState().removeIndices(sp.id, sp.indices);
            showSnack(`Se quitaron ${sp.indices.length} canciones de la playlist`);
          })}
        >
          <PlaylistRemoveIcon /> Quitar de esta playlist
        </button>
      )}
    </>
  ) : (
    <>
      <div className="sheet-head">
        <Cover coverId={track.coverId} seed={track.album + track.artist} className="thumb" />
        <div className="track-text">
          <div className="track-title">{track.title}</div>
          <div className="track-sub">{track.artist}</div>
        </div>
        <button className={`icon-btn ${rating === -1 ? 'on' : ''}`} onClick={() => p.rate(track.id, -1)} aria-label="No me gusta">
          <ThumbDownIcon filled={rating === -1} />
        </button>
        <button className={`icon-btn ${rating === 1 ? 'on' : ''}`} onClick={() => p.rate(track.id, 1)} aria-label="Me gusta">
          <ThumbUpIcon filled={rating === 1} />
        </button>
      </div>
      <button className="sheet-item" onClick={run(() => p.playTracks([track], 0, { shuffle: false }))}>
        <RadioIcon /> Iniciar radio
      </button>
      {esDelServidor(track.id) && (
        <button className="sheet-item" onClick={run(() => void (enParty ? agregarAParty([track]) : iniciarParty(track)))}>
          <PartyIcon /> {enParty ? 'Agregar a la Party' : 'Iniciar una Party'}
        </button>
      )}
      <button
        className="sheet-item"
        onClick={run(() => showSnack(useFijadas.getState().alternar(track.id) ? 'Fijada en accesos directos' : 'Ya no está fijada'))}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M16 3v2h-1v6l2 3v2h-4v5l-1 1-1-1v-5H7v-2l2-3V5H8V3z" />
        </svg>{' '}
        {fijada ? 'Quitar de accesos directos' : 'Fijar en accesos directos'}
      </button>
      <button className="sheet-item" onClick={run(() => p.playNext(track))}>
        <PlayNextIcon /> Reproducir a continuación
      </button>
      <button className="sheet-item" onClick={run(() => p.addToQueue(track))}>
        <QueueIcon /> Añadir a la cola
      </button>
      {guardar([track])}
      {descargasDisponibles && esDelServidor(track.id) && (
        <button className="sheet-item" onClick={run(() => alternarDescarga(track))}>
          {descarga === 'lista' ? <DownloadedIcon /> : <DownloadIcon />}{' '}
          {descarga === 'lista' ? 'Quitar descarga' : descarga === 'cola' ? 'Descargando… (tocar para cancelar)' : 'Descargar'}
        </button>
      )}
      {inPlaylist && (
        <button
          className="sheet-item"
          onClick={run(async () => {
            await usePlaylists.getState().removeAt(inPlaylist.id, inPlaylist.index);
            showSnack('Se quitó de la playlist');
          })}
        >
          <PlaylistRemoveIcon /> Quitar de esta playlist
        </button>
      )}
      <button className="sheet-item" onClick={() => closeAllOverlaysThen(() => nav.push({ type: 'album', key: albumKey }))}>
        <AlbumIcon /> Ir al álbum
      </button>
      <button className="sheet-item" onClick={() => closeAllOverlaysThen(() => nav.push({ type: 'artist', name: track.artist }))}>
        <PersonIcon size={22} /> Ir al artista
      </button>
      <button className="sheet-item" onClick={run(() => openCredits(track))}>
        <InfoIcon /> Ver créditos de la canción
      </button>
      {esDelServidor(track.id) && (
        <button className="sheet-item" onClick={run(() => abrirReporte(track))}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M5 3h2v18H5zm3 1h9l-1.5 4L17 12H8z" />
          </svg>{' '}
          Reportar canción
        </button>
      )}
      {/* En PC el ecualizador está en Configuración, no en el reproductor */}
      {fromPlayer && !escritorioActivo() && (
        <button className="sheet-item" onClick={run(openEqualizer)}>
          <EqualizerIcon /> Ecualizador
        </button>
      )}
    </>
  );

  return (
    <div className={`sheet-backdrop ${ctx ? 'ctx' : ''} ${closing ? 'closing' : ''}`} onClick={closing ? undefined : closeOverlay}>
      <div ref={ctx ? ref : undefined} className="sheet" role={ctx ? 'menu' : undefined} onClick={(e) => e.stopPropagation()}>
        {contenido}
      </div>
    </div>
  );
}
