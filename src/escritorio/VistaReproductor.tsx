import { GuardarColaBoton } from '../components/GuardarCola';
import { useEffect, useState } from 'react';
import { openCredits } from '../components/Credits';
import { Cover, fallbackBackground } from '../components/Cover';
import { ChevronDownIcon, MoreIcon, ThumbDownIcon, ThumbUpIcon } from '../components/Icons';
import { openTrackMenu } from '../components/TrackMenu';
import { formatDuration } from '../components/TrackRow';
import { useCover } from '../library/useCover';
import { closeOverlay, useNav, closeAllOverlaysThen } from '../nav';
import { claveAlbum } from '../library/store';
import { currentTrack, usePlayer } from '../player/player';
import { irAlArtista, QueueList } from '../player/PlayerUI';
import { useDominantColor } from '../player/useDominantColor';
import { useVinyl, Vinyl } from '../player/Vinyl';
import { trackBpm } from '../reco/store';

/**
 * Vista de reproducción de PC (al tocar la carátula o el título abajo). Ocupa el centro y la derecha; el
 * reproductor de abajo sigue siendo el único lugar con los controles (no se repiten). Se cierra con la flecha o Esc.
 * Izquierda: la carátula grande (o el vinilo, si está activo). Derecha: "A continuación" y los datos de la canción.
 */
export function VistaReproductor() {
  const track = usePlayer(currentTrack)!;
  const rating = usePlayer((s) => s.ratings[track.id]);
  const rate = usePlayer((s) => s.rate);
  const colaNombre = usePlayer((s) => s.colaNombre);
  const vinyl = useVinyl((s) => s.on);
  const url = useCover(track.coverId);
  const color = useDominantColor(url, fallbackBackground(track.album + track.artist));
  const [pestana, setPestana] = useState<'cola' | 'info'>('cola');

  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && closeOverlay();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  const album = track.album && track.album !== 'Álbum desconocido' ? track.album : null;
  const irAlAlbum = () => album && closeAllOverlaysThen(() => useNav.getState().push({ type: 'album', key: claveAlbum(track) }));
  const bpm = trackBpm(track.id);

  return (
    <section className="esc-vista" style={{ '--tinte': color } as React.CSSProperties} aria-label="Reproduciendo ahora">
      {url && <div className="esc-vista-fondo" style={{ backgroundImage: `url("${url}")` }} aria-hidden="true" />}
      <header className="esc-vista-cab">
        <button className="esc-vista-cerrar" onClick={closeOverlay} title="Cerrar (Esc)" aria-label="Cerrar vista de reproducción">
          <ChevronDownIcon size={26} />
        </button>
        <button className="icon-btn" onClick={() => openTrackMenu(track, { fromPlayer: true })} title="Más opciones" aria-label="Más opciones">
          <MoreIcon />
        </button>
      </header>

      <div className="esc-vista-cuerpo">
        <div className="esc-vista-arte">
          <div className={`esc-vista-portada ${vinyl ? 'con-vinilo' : ''}`}>
            {vinyl ? <Vinyl key={track.id} track={track} /> : <Cover key={track.id} coverId={track.coverId} seed={track.album + track.artist} className="swap" />}
          </div>
          <div className="esc-vista-info swap" key={track.id}>
            <div className="esc-vista-texto">
              <h1 title={track.title}>{track.title}</h1>
              <div className="esc-vista-sub">
                <button className="esc-link" onClick={() => closeAllOverlaysThen(() => irAlArtista(track.artist))}>
                  {track.artist}
                </button>
                {album && (
                  <>
                    <span aria-hidden="true"> • </span>
                    <button className="esc-link" onClick={irAlAlbum}>
                      {album}
                    </button>
                  </>
                )}
                {track.year ? <span> • {track.year}</span> : null}
              </div>
            </div>
            <button className={`icon-btn round-btn ${rating === -1 ? 'on' : ''}`} onClick={() => rate(track.id, -1)} title="No me gusta" aria-label="No me gusta" aria-pressed={rating === -1}>
              <ThumbDownIcon filled={rating === -1} />
            </button>
            <button className={`icon-btn round-btn ${rating === 1 ? 'on' : ''}`} onClick={() => rate(track.id, 1)} title="Me gusta" aria-label="Me gusta" aria-pressed={rating === 1}>
              <ThumbUpIcon filled={rating === 1} />
            </button>
          </div>
        </div>

        <aside className="esc-vista-lado">
          <div className="esc-vista-pestanas" role="tablist">
            <button role="tab" aria-selected={pestana === 'cola'} className={pestana === 'cola' ? 'on' : ''} onClick={() => setPestana('cola')}>
              A continuación
            </button>
            <button role="tab" aria-selected={pestana === 'info'} className={pestana === 'info' ? 'on' : ''} onClick={() => setPestana('info')}>
              Detalles
            </button>
          </div>
          {pestana === 'cola' ? (
            <div className="esc-vista-cola">
              {colaNombre && (
                <div className="esc-fila-nombre">
                  <span>{colaNombre}</span>
                  <GuardarColaBoton />
                </div>
              )}
              <QueueList />
            </div>
          ) : (
            <dl className="esc-vista-datos">
              <div>
                <dt>Artista</dt>
                <dd>{track.artist}</dd>
              </div>
              {album && (
                <div>
                  <dt>Álbum</dt>
                  <dd>{album}</dd>
                </div>
              )}
              {track.year ? (
                <div>
                  <dt>Año</dt>
                  <dd>{track.year}</dd>
                </div>
              ) : null}
              {track.genres?.length ? (
                <div>
                  <dt>Género</dt>
                  <dd>{track.genres.slice(0, 4).join(', ')}</dd>
                </div>
              ) : null}
              <div>
                <dt>Duración</dt>
                <dd>{formatDuration(track.duration)}</dd>
              </div>
              {bpm ? (
                <div>
                  <dt>Tempo</dt>
                  <dd>{Math.round(bpm)} BPM</dd>
                </div>
              ) : null}
              <button className="pill esc-pill" onClick={() => openCredits(track)}>
                Ver créditos
              </button>
            </dl>
          )}
        </aside>
      </div>
    </section>
  );
}
