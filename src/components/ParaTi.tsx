import { useMemo } from 'react';
import { useNav } from '../nav';
import { useReco } from '../reco/store';
import { PlaylistCardView } from '../screens/Home';
import type { Track } from '../types';
import { Carrusel } from './Carrusel';

/** Los artistas que más aparecen en un mix ("Carly Simon, Steve Perry y Andy Gibb"). */
export function artistasDe(tracks: Track[], n = 3) {
  const cuenta = new Map<string, number>();
  for (const t of tracks) cuenta.set(t.artist, (cuenta.get(t.artist) ?? 0) + 1);
  const top = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([a]) => a);
  return top.length > 1 ? `${top.slice(0, -1).join(', ')} y ${top[top.length - 1]}` : (top[0] ?? '');
}

/**
 * "Para ti": mixes que arma el servidor con lo que escuchas (Anime Now, Mix Reggaeton, Essential 90's,
 * Essential 2000's…), ordenados por lo que más escuchas. Va arriba de "De la comunidad" (celular y PC).
 */
export function ParaTi({ byId, currentId }: { byId: Map<string, Track>; currentId?: string }) {
  const mixes = useReco((s) => s.paraTi);
  const push = useNav((s) => s.push);
  const cards = useMemo(
    () =>
      mixes
        .map((m) => ({ m, tracks: m.ids.map((id) => byId.get(id)).filter((t): t is Track => !!t) }))
        .filter((c) => c.tracks.length > 0),
    [mixes, byId],
  );
  if (!cards.length) return null;
  return (
    <section>
      <div className="section-head">
        <h2>Para ti</h2>
      </div>
      <Carrusel className="lib-cards">
        {cards.map(({ m, tracks }) => (
          <PlaylistCardView
            key={m.id}
            id={`mix:${m.id}`}
            name={m.titulo}
            sub={artistasDe(tracks)}
            tracks={tracks}
            currentId={currentId}
            onOpen={() => push({ type: 'mix', id: m.id })}
          />
        ))}
      </Carrusel>
    </section>
  );
}
