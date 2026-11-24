import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { fetchCredits, type Credit, type Credits as CreditsData } from '../library/enrich';
import { OfflineError } from '../library/musicbrainz';
import { useLibrary } from '../library/store';
import { closeOverlay, openOverlay } from '../nav';
import { UNKNOWN_ALBUM, UNKNOWN_ARTIST, type Track } from '../types';
import { Cover } from './Cover';
import { BackIcon } from './Icons';
import { formatDuration } from './TrackRow';
import { useExit } from './useExit';

const useCredits = create<{ trackId: string | null }>(() => ({ trackId: null }));

export function openCredits(track: Track) {
  useCredits.setState({ trackId: track.id });
  openOverlay(() => useCredits.setState({ trackId: null }));
}

type Status = 'loading' | 'ok' | 'notfound' | 'offline' | 'noartist';

function formatSize(bytes: number) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
}

/** Pantalla "Créditos de la canción": quién la hizo y de dónde salió cada dato. */
export function CreditsScreen() {
  const id = useCredits((s) => s.trackId);
  const { shown, closing } = useExit(id, 220);
  const track = useLibrary((s) => s.tracks.find((t) => t.id === shown));
  const [credits, setCredits] = useState<CreditsData | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    if (!id) return;
    const t = useLibrary.getState().tracks.find((x) => x.id === id);
    if (!t) return;
    let alive = true;
    setCredits(null);
    if (t.artist === UNKNOWN_ARTIST) {
      setStatus('noartist');
      return;
    }
    setStatus('loading');
    fetchCredits(t)
      .then((c) => {
        if (!alive) return;
        setCredits(c);
        setStatus(c ? 'ok' : 'notfound');
      })
      .catch((e) => alive && setStatus(e instanceof OfflineError ? 'offline' : 'notfound'));
    return () => {
      alive = false;
    };
  }, [id]);

  if (!shown || !track) return null;
  const fromNet = new Set(track.mbFilled ?? []);
  const net = (field: string) => (fromNet.has(field) ? <span className="net-tag">De internet</span> : null);

  const rows: [string, React.ReactNode, string?][] = [
    ['Álbum', track.album === UNKNOWN_ALBUM ? '—' : track.album, 'album'],
    ['Artista del álbum', track.albumArtist, 'albumArtist'],
    ['Año', track.year ?? '—', 'year'],
    ['Número de pista', track.trackNo ?? '—', 'trackNo'],
    ['Género', track.genres.length ? track.genres.join(', ') : '—', 'genres'],
    ['Portada', track.coverId ? 'Sí' : 'No', 'coverId'],
    ['Duración', formatDuration(track.duration)],
    ['Formato', track.format.toUpperCase()],
    ['Tamaño', formatSize(track.size)],
    ['Archivo', track.fileName],
    ['Agregada', new Date(track.addedAt).toLocaleDateString('es')],
  ];

  return (
    <div className={`credits ${closing ? 'closing' : ''}`}>
      <div className="credits-top">
        <button className="icon-btn" onClick={closeOverlay} aria-label="Atrás">
          <BackIcon />
        </button>
        <span>Créditos de la canción</span>
      </div>

      <div className="credits-body">
        <div className="credits-hero">
          <Cover coverId={track.coverId} seed={track.album + track.artist} className="credits-cover" />
          <div className="track-text">
            <div className="credits-title">{track.title}</div>
            <div className="track-sub">{track.artist}</div>
          </div>
        </div>

        {status === 'loading' && (
          <div className="credits-status">
            <span className="spinner" /> Buscando créditos en internet…
          </div>
        )}
        {status === 'offline' && <div className="credits-status">Sin conexión a internet. Inténtalo más tarde.</div>}
        {status === 'notfound' && <div className="credits-status">No se encontró esta canción en MusicBrainz.</div>}
        {status === 'noartist' && (
          <div className="credits-status">Sin artista no se puede buscar: el resultado podría ser otra canción con el mismo nombre.</div>
        )}

        {credits && (
          <>
            <CreditSection title="Intérpretes" list={credits.performers} />
            <CreditSection title="Composición y letra" list={credits.writers} />
            <CreditSection title="Producción" list={credits.production} />
            {!credits.writers.length && !credits.production.length && (
              <div className="credits-status">MusicBrainz no tiene más créditos para esta canción.</div>
            )}
          </>
        )}

        <h3 className="credits-head">Datos de la canción</h3>
        {rows.map(([label, value, field]) => (
          <div className="credit-row" key={label}>
            <div className="credit-label">{label}</div>
            <div className="credit-value">
              {value} {field && net(field)}
            </div>
          </div>
        ))}

        <div className="credits-source">
          Fuente:{' '}
          {credits ? (
            <a href={`https://musicbrainz.org/recording/${credits.recordingId}`} target="_blank" rel="noreferrer">
              MusicBrainz
            </a>
          ) : (
            'etiquetas del archivo'
          )}
        </div>
      </div>
    </div>
  );
}

function CreditSection({ title, list }: { title: string; list: Credit[] }) {
  if (!list.length) return null;
  return (
    <>
      <h3 className="credits-head">{title}</h3>
      {list.map((c) => (
        <div className="credit-row" key={c.name}>
          <div className="credit-value strong">{c.name}</div>
          <div className="credit-label">{c.roles.join(' · ')}</div>
        </div>
      ))}
    </>
  );
}
