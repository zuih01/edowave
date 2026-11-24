import { useCover } from '../library/useCover';
import { LIKED_ID, usePlaylists } from '../library/playlists';
import { urlFotoPlaylist } from '../server/cuenta';
import { useSocial } from '../server/social';
import { useReco } from '../reco/store';
import { useCuenta } from '../server/cuenta';
import type { Track } from '../types';
import { Cover, fallbackColors } from './Cover';
import { ThumbUpIcon } from './Icons';

function Tile({ track }: { track: Track }) {
  const url = useCover(track.coverId);
  if (url) return <img src={url} alt="" draggable={false} />;
  const [a, b] = fallbackColors(track.album + track.artist);
  return <span style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />;
}

/**
 * Portada de una playlist, como en YT Music: collage 2×2 con las portadas de sus primeros álbumes distintos.
 * Con menos de 4 álbumes, usa la primera portada completa. "Música que te gustó" lleva su ícono de pulgar.
 */
export function PlaylistCover({ id, tracks, className = '' }: { id: string; tracks: Track[]; className?: string }) {
  // Foto propia: de una playlist mía o de una pública de la comunidad.
  const foto = usePlaylists((s) => s.list.find((p) => p.id === id)?.foto) ?? null;
  const fotoComunidad = useSocial((s) => (foto ? null : (s.comunidad.find((p) => p.id === id)?.foto ?? null)));
  // Mix de "Para ti" con portada propia (Anime Now).
  const portadaMix = useReco((s) => (id.startsWith('mix:') ? (s.paraTi.find((m) => `mix:${m.id}` === id)?.portada ?? null) : null));
  const base = useCuenta((s) => s.base);
  const url = portadaMix ? `${base}${portadaMix}` : urlFotoPlaylist(foto ?? fotoComunidad);
  if (url) return <img className={`cover ${className}`} src={url} alt="" loading="lazy" draggable={false} />;
  if (id === LIKED_ID) {
    return (
      <div className={`pl-cover liked ${className}`}>
        <ThumbUpIcon filled size={44} />
      </div>
    );
  }
  const distinct: Track[] = [];
  const seen = new Set<string>();
  for (const t of tracks) {
    const k = t.coverId ?? `${t.album}|${t.artist}`;
    if (seen.has(k)) continue;
    seen.add(k);
    distinct.push(t);
    if (distinct.length === 4) break;
  }
  if (distinct.length === 0) return <Cover seed={id} className={className} />;
  if (distinct.length < 4) {
    const t = distinct[0];
    return <Cover coverId={t.coverId} seed={t.album + t.artist} className={className} />;
  }
  return (
    <div className={`pl-cover grid ${className}`}>
      {distinct.map((t) => (
        <Tile key={t.id} track={t} />
      ))}
    </div>
  );
}
