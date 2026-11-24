/**
 * Enlaces que se aceptan en "Sugerir una canción". Solo https y solo estos sitios (nombre exacto): así el
 * administrador nunca recibe un enlace a otro lado en su panel.
 */
export const DOMINIOS_SUGERENCIA = ['open.spotify.com', 'music.youtube.com', 'www.youtube.com'];

/** ¿El texto pretende ser un enlace? (entonces se valida como tal y no se guarda como nombre de artista). */
export const pareceEnlace = (t) => /^https?:/i.test(t) || t.includes('://') || /(^|[^a-z0-9])www\./i.test(t);

/** Devuelve la URL normalizada si es válida y de un sitio permitido; si no, null. */
export function enlaceSugerenciaValido(texto) {
  const t = String(texto ?? '').trim();
  if (!t || t.length > 300) return null;
  let u;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (!DOMINIOS_SUGERENCIA.includes(u.hostname)) return null;
  return u.href.length > 300 ? null : u.href;
}
