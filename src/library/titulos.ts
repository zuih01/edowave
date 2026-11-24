import { normalize } from './fuzzy';

/** Quita "(Remastered 2011)", "[Live]", " - Radio Edit"… para comparar títulos. */
export function core(s: string) {
  return normalize(s.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, ''));
}

export function sameTitle(a: string, b: string) {
  const x = core(a);
  const y = core(b);
  return !!x && !!y && (x === y || normalize(a) === normalize(b));
}

/** "Queen" coincide con "Queen", y "Bad Bunny" con "Bad Bunny feat. Drake". */
export function sameArtist(ours: string, credit: { name: string }[] | undefined) {
  if (!credit?.length) return false;
  const full = normalize(credit.map((c) => c.name).join(' '));
  const o = normalize(ours);
  return !!o && credit.some((c) => normalize(c.name) === o || full.startsWith(o) || o.startsWith(normalize(c.name)));
}
