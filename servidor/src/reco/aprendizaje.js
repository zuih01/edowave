import { db } from '../db.js';
import { descubrimientoSemanal, mixesDiarios } from './motor.js';

/**
 * Lo que el servidor aprende con el uso, aparte del historial de cada cuenta:
 *  - qué canciones suelen gustarles a las mismas personas (sin guardar ni mostrar quién);
 *  - qué se recomendó y si resultó (para medir y para que la exploración se ajuste a cada cuenta);
 *  - las listas personales, que se mantienen fijas durante su semana o su día.
 */

const ZONA = process.env.ZONA_HORARIA || 'America/Santiago';
export const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA });
function lunesDe(dia) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const pausa = () => new Promise((r) => setImmediate(r));

// ---------------- Gustos parecidos ----------------

const RECALCULAR_CADA_MS = 6 * 3600_000;
const MAX_POR_PERSONA = 300; // las más recientes de cada cuenta
const MAX_VECINOS = 40;
const MIN_PERSONAS = 2; // una coincidencia de una sola persona no dice nada
const PRUDENCIA = 2; // con pocos datos, el parecido se queda bajo

let vecinos = new Map();
let calculadoEn = 0;
let calculando = null;

/** Parte pura: de "qué le gustó a cada cuenta" a "qué canciones se parecen por quién las escucha". */
export async function calcularVecinos(listas) {
  const personas = new Map();
  for (const l of listas) for (const id of l) personas.set(id, (personas.get(id) ?? 0) + 1);
  const juntas = new Map();
  const sumar = (a, b) => {
    let m = juntas.get(a);
    if (!m) juntas.set(a, (m = new Map()));
    m.set(b, (m.get(b) ?? 0) + 1);
  };
  for (const l of listas) {
    const ids = l.filter((id) => personas.get(id) >= MIN_PERSONAS);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        sumar(ids[i], ids[j]);
        sumar(ids[j], ids[i]);
      }
    }
    await pausa(); // no frenar a quien está usando la app
  }
  const out = new Map();
  for (const [a, m] of juntas) {
    const lista = [];
    for (const [b, n] of m) {
      if (n >= MIN_PERSONAS) lista.push([b, n / (Math.sqrt(personas.get(a) * personas.get(b)) + PRUDENCIA)]);
    }
    if (lista.length) out.set(a, new Map(lista.sort((x, y) => y[1] - x[1]).slice(0, MAX_VECINOS)));
  }
  return out;
}

async function recalcular() {
  const r = await db.query(
    `WITH e AS (
       SELECT usuario_id, cancion, count(*) FILTER (WHERE completa) AS c, count(*) FILTER (WHERE saltada) AS s, max(empezo) AS u
         FROM escuchas GROUP BY 1, 2)
     SELECT coalesce(e.usuario_id, v.usuario_id) AS usuario_id, coalesce(e.cancion, v.cancion) AS cancion
       FROM e FULL JOIN valoraciones v ON v.usuario_id = e.usuario_id AND v.cancion = e.cancion
      WHERE coalesce(v.valor, 0) = 1 OR (v.valor IS NULL AND e.c >= 1 AND e.c >= e.s)
      ORDER BY coalesce(e.u, v.fecha) DESC`,
  );
  const porCuenta = new Map();
  for (const x of r.rows) {
    if (!x.cancion.startsWith('s:')) continue;
    const l = porCuenta.get(x.usuario_id) ?? [];
    if (l.length < MAX_POR_PERSONA) l.push(x.cancion);
    porCuenta.set(x.usuario_id, l);
  }
  vecinos = await calcularVecinos([...porCuenta.values()]);
  await db.query(`DELETE FROM reco_mostradas WHERE dia < current_date - 90`);
}

/** Lo último calculado; si está viejo, se rehace aparte sin hacer esperar a nadie. */
export function vecinosActuales() {
  if (!calculando && Date.now() - calculadoEn > RECALCULAR_CADA_MS) {
    calculadoEn = Date.now();
    calculando = recalcular()
      .catch((e) => console.error('gustos parecidos:', e.message))
      .finally(() => (calculando = null));
  }
  return vecinos;
}

// ---------------- Qué se recomendó y cómo resultó ----------------

const yaAnotadas = new Set();
let diaAnotadas = '';

/** Anota lo recomendado (una vez por día y lista). Si falla, la recomendación sigue igual. */
export function registrarMostradas(uid, lista, items) {
  const dia = hoyLocal();
  if (dia !== diaAnotadas) {
    yaAnotadas.clear();
    diaAnotadas = dia;
  }
  const nuevas = items.filter(({ id }) => {
    const k = `${uid}|${lista}|${id}`;
    if (yaAnotadas.has(k)) return false;
    yaAnotadas.add(k);
    return true;
  });
  if (!nuevas.length) return;
  void db
    .query(
      `INSERT INTO reco_mostradas (usuario_id, cancion, lista, motivo, dia)
       SELECT $1, x.id, $2, x.motivo, $3::date FROM unnest($4::text[], $5::text[]) AS x(id, motivo)
       ON CONFLICT DO NOTHING`,
      [uid, lista, dia, nuevas.map((x) => x.id), nuevas.map((x) => x.motivo)],
    )
    .catch(() => {});
}

/** Primera reacción de la cuenta a cada canción recomendada: la terminó (acierto) o la saltó (error). */
export async function resultadosDe(uid) {
  const r = await db
    .query(
      `SELECT m.cancion, m.motivo, e.completa
         FROM (SELECT cancion, motivo, min(dia) AS dia FROM reco_mostradas
                WHERE usuario_id = $1 AND motivo <> 'conocida' GROUP BY 1, 2) m
         JOIN LATERAL (SELECT completa, saltada FROM escuchas x
                        WHERE x.usuario_id = $1 AND x.cancion = m.cancion AND x.empezo >= m.dia
                        ORDER BY x.empezo LIMIT 1) e ON e.completa OR e.saltada`,
      [uid],
    )
    .catch(() => ({ rows: [] }));
  return r.rows.map((x) => ({ trackId: x.cancion, motivo: x.motivo, exito: x.completa }));
}

// ---------------- Listas personales ----------------

const SEMANAL = 'descubrimiento-semanal';
const MIN_CANCIONES = 12;
const DIARIOS = ['diario-1', 'diario-2', 'diario-3'];
const VERSION_DIARIOS = 'escenas-2'; // al cambiar el criterio, las listas guardadas se rehacen
const VERSION_SEMANAL = 'v2';

async function guardarLista(uid, id, periodo, titulo, ids) {
  await db.query(
    `INSERT INTO reco_listas (usuario_id, id, periodo, titulo, ids) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (usuario_id, id) DO UPDATE SET periodo = EXCLUDED.periodo, titulo = EXCLUDED.titulo, ids = EXCLUDED.ids`,
    [uid, id, periodo, titulo, ids],
  );
}

const enCurso = new Map();

async function armarListas(uid, m) {
  const hoy = hoyLocal();
  const semana = lunesDe(hoy);
  const r = await db.query('SELECT id, periodo, titulo, ids FROM reco_listas WHERE usuario_id = $1', [uid]);
  const listas = new Map(r.rows.map((x) => [x.id, x]));

  // Cada lunes (hora de Chile) se rehace, sin repetir lo de la semana anterior.
  const periodoSemanal = `${semana}:${VERSION_SEMANAL}`;
  if (listas.get(SEMANAL)?.periodo !== periodoSemanal) {
    const items = descubrimientoSemanal(m, 30, `${uid}:${semana}`, new Set(listas.get(SEMANAL)?.ids ?? []));
    if (items) {
      const fila = { id: SEMANAL, periodo: periodoSemanal, titulo: 'Descubrimiento semanal', ids: items.map((x) => x.id) };
      await guardarLista(uid, fila.id, fila.periodo, fila.titulo, fila.ids);
      listas.set(SEMANAL, fila);
      registrarMostradas(uid, 'descubrimiento', items);
    }
  }
  const periodoDiario = `${hoy}:${VERSION_DIARIOS}`;
  if (listas.get(DIARIOS[0])?.periodo !== periodoDiario) {
    // Cada día, sin repetir lo de ayer (si hay de dónde elegir).
    const ayer = new Set(DIARIOS.flatMap((id) => listas.get(id)?.ids ?? []));
    const mixes = mixesDiarios(m, 30, `${uid}:${hoy}`, ayer);
    if (mixes) {
      for (let i = 0; i < DIARIOS.length; i++) {
        const fila = { id: DIARIOS[i], periodo: periodoDiario, titulo: mixes[i]?.titulo ?? 'Mix diario', ids: mixes[i]?.items.map((x) => x.id) ?? [] };
        await guardarLista(uid, fila.id, fila.periodo, fila.titulo, fila.ids);
        listas.set(fila.id, fila);
        if (mixes[i]) registrarMostradas(uid, 'mix-diario', mixes[i].items);
      }
    }
  }
  return [SEMANAL, ...DIARIOS].flatMap((id) => {
    const l = listas.get(id);
    const ids = (l?.ids ?? []).filter((x) => m.byId.has(x) && m.input.ratings[x] !== -1);
    return l && ids.length >= MIN_CANCIONES ? [{ id, titulo: l.titulo, ids, tipo: id === SEMANAL ? 'semanal' : 'diario' }] : [];
  });
}

/** Las listas de la cuenta, en el formato de "Para ti". Si algo falla, simplemente no aparecen. */
export function listasPersonales(uid, m) {
  const k = String(uid);
  let p = enCurso.get(k);
  if (!p) {
    p = armarListas(uid, m)
      .catch((e) => {
        console.error('listas personales:', e.message);
        return [];
      })
      .finally(() => enCurso.delete(k));
    enCurso.set(k, p);
  }
  return p;
}
