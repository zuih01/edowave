import { db } from './db.js';

/**
 * Insignias del perfil (como las de Discord): se ganan solas con lo que hace cada cuenta. De cada tipo se muestra
 * solo el nivel más alto alcanzado. Se calculan en el momento con la base y se guardan 5 minutos en memoria.
 *
 * nivel: 1 bronce, 2 plata, 3 oro, 4 diamante (la app lo usa para el color).
 */
const miles = (n) => Math.floor(n).toLocaleString('es-CL');
const TIPOS = [
  {
    id: 'horas',
    niveles: [[100, 'Oyente'], [500, 'Melómano'], [1000, 'Leyenda'], [2500, 'Inmortal']],
    detalle: (n) => `${miles(n)} ${Math.floor(n) === 1 ? 'hora escuchada' : 'horas escuchadas'}`,
  },
  {
    id: 'invitados',
    niveles: [[1, 'Embajador'], [5, 'Reclutador'], [10, 'Fundador de comunidad']],
    detalle: (n) => (n === 1 ? 'Invitó a 1 persona' : `Invitó a ${miles(n)} personas`),
  },
  {
    id: 'playlists',
    niveles: [[10, 'Curador'], [50, 'Coleccionista'], [100, 'Archivista']],
    detalle: (n) => `${miles(n)} playlists creadas`,
  },
  {
    id: 'amigos',
    niveles: [[5, 'Sociable'], [15, 'Popular']],
    detalle: (n) => `${miles(n)} amigos`,
  },
  {
    id: 'megusta',
    niveles: [[250, 'Fan'], [1000, 'Superfan']],
    detalle: (n) => `${miles(n)} canciones con me gusta`,
  },
];

/** Cuentas creadas antes de 2027: el primer año de Edowave. */
const FIN_PIONEROS = new Date('2027-01-01T00:00:00-03:00');

const cache = new Map(); // id → { en, insignias }
const VIGENCIA_MS = 5 * 60_000;

function armar(x) {
  const out = [];
  for (const t of TIPOS) {
    const valor = Number(x[t.id]) || 0;
    let k = -1;
    t.niveles.forEach(([umbral], i) => {
      if (valor >= umbral) k = i;
    });
    if (k < 0) continue;
    const nombre = t.niveles[k][1];
    // El último nivel de un tipo con pocos niveles igual se ve "de oro" o más.
    const nivel = t.niveles.length - 1 === k ? Math.max(3, k + 1) : k + 1;
    out.push({ id: t.id, nombre, detalle: t.detalle(valor), nivel: Math.min(4, nivel) });
  }
  if (x.creado && new Date(x.creado) < FIN_PIONEROS) {
    const desde = new Date(x.creado).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' });
    out.push({ id: 'pionero', nombre: 'Pionero', detalle: `En Edowave desde el ${desde}`, nivel: 0 });
  }
  return out;
}

/** Insignias de varias cuentas a la vez: Map(id → [{ id, nombre, detalle, nivel }]). */
export async function insigniasDe(ids) {
  const ahora = Date.now();
  const res = new Map();
  const faltan = [];
  for (const id of new Set(ids.map(Number))) {
    const c = cache.get(id);
    if (c && ahora - c.en < VIGENCIA_MS) res.set(id, c.insignias);
    else faltan.push(id);
  }
  if (faltan.length) {
    const r = await db.query(
      `SELECT u.id, u.creado,
          (SELECT coalesce(sum(e.escuchado), 0)::float / 3600 FROM escuchas e WHERE e.usuario_id = u.id) AS horas,
          (SELECT coalesce(sum(i.usos), 0) FROM invitaciones i WHERE i.creada_por = u.id) AS invitados,
          (SELECT count(*) FROM playlists p WHERE p.usuario_id = u.id AND NOT p.borrada) AS playlists,
          (SELECT count(*) FROM amistades a WHERE (a.de = u.id OR a.para = u.id) AND a.estado = 'aceptada') AS amigos,
          (SELECT count(*) FROM valoraciones v WHERE v.usuario_id = u.id AND v.valor = 1) AS megusta
         FROM usuarios u WHERE u.id = ANY($1::bigint[])`,
      [faltan],
    );
    for (const x of r.rows) {
      const insignias = armar(x);
      cache.set(Number(x.id), { en: ahora, insignias });
      res.set(Number(x.id), insignias);
    }
  }
  return res;
}
