import { hashString } from '../library/importer';
import { useCover } from '../library/useCover';
import { PersonIcon } from './Icons';

/** Colores del degradado por defecto: uno vivo arriba a la izquierda que se oscurece en diagonal. Estable según el nombre. */
const hueOf = (seed: string) => parseInt(hashString(seed).slice(-4), 36) % 360;

export function fallbackColors(seed: string): [string, string] {
  const hue = hueOf(seed);
  return [`hsl(${hue} 85% 62%)`, `hsl(${(hue + 60) % 360} 65% 18%)`];
}

/** Versión oscura del mismo color, para el fondo del reproductor completo. */
export function fallbackBackground(seed: string): string {
  return `hsl(${hueOf(seed)} 60% 30%)`;
}

/** Portada; si no hay imagen, el degradado por defecto. */
export function Cover({
  coverId,
  seed,
  round,
  className = '',
}: {
  coverId?: string;
  seed: string;
  round?: boolean;
  className?: string;
}) {
  const url = useCover(coverId);
  const cls = `cover ${round ? 'round' : ''} ${className}`;
  if (url) return <img className={cls} src={url} alt="" loading="lazy" draggable={false} />;
  const [from, to] = fallbackColors(seed);
  return (
    <div className={`${cls} cover-empty`} style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
      {round && <PersonIcon size={40} />}
    </div>
  );
}
