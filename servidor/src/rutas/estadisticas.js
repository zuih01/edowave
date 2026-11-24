import { db } from '../db.js';
import { requiereAdmin, requiereUsuario } from '../auth.js';
import { paisDe } from '../pais.js';

/**
 * Estadísticas de uso (las ve solo el admin, siempre en números agrupados: nunca qué escuchó cada persona).
 *  - La app manda: qué canciones se MOSTRARON (para el CTR) y, cada minuto, cuánto tiempo estuvo abierta y
 *    cuánto sonó música. Las escuchas ya llegan por /api/escuchas (con origen, aparato y versión).
 *  - El país sale de la IP en el momento (la IP no se guarda).
 */

/** Zona horaria para el mapa de horas (configurable con ZONA_HORARIA en el .env). */
const ZONA = process.env.ZONA_HORARIA || 'America/Santiago';
const ORIGENES = new Set(['accesos', 'busqueda', 'radio', 'playlist', 'album', 'artista', 'amigos', 'comunidad', 'aleatorio', 'animo', 'redescubre', 'historial', 'biblioteca', 'otro']);
const APARATOS = new Set(['android-app', 'android-web', 'iphone', 'pc', 'otro']);
const texto = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : null);

export const origenValido = (o) => (ORIGENES.has(o) ? o : null);
export const aparatoValido = (a) => (APARATOS.has(a) ? a : null);

/** Lo que alguien buscó y no encontró nada. */
export async function registrarBusquedaVacia(q) {
  const t = String(q ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
  if (t.length < 3) return;
  await db
    .query(
      `INSERT INTO busquedas_vacias (texto) VALUES ($1)
       ON CONFLICT (texto) DO UPDATE SET veces = busquedas_vacias.veces + 1, ultima = now()`,
      [t],
    )
    .catch(() => {});
}

/** Escuchar juntos: empieza (devuelve el id de la sesión) y termina. */
export async function juntosEmpieza(anfitrion, oyente) {
  const r = await db.query('INSERT INTO juntos_sesiones (anfitrion, oyente) VALUES ($1, $2) RETURNING id', [anfitrion, oyente]).catch(() => null);
  return r?.rows[0]?.id ?? null;
}
export async function juntosTermina(oyente) {
  await db.query('UPDATE juntos_sesiones SET fin = now() WHERE oyente = $1 AND fin IS NULL', [oyente]).catch(() => {});
}

export default async function rutasEstadisticas(app) {
  // ---------------- Lo que manda la app ----------------

  /** Canciones que se mostraron en pantalla (accesos directos, búsqueda…): { origen, ids: [...] }. */
  app.post('/api/estadisticas/impresiones', { preHandler: requiereUsuario }, async (req) => {
    const origen = origenValido(req.body?.origen);
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.filter((x) => typeof x === 'string' && x.length < 40))].slice(0, 60) : [];
    if (!origen || !ids.length) return { ok: true };
    await db.query(
      `INSERT INTO impresiones (dia, cancion, origen, veces)
       SELECT (now() AT TIME ZONE $3)::date, unnest($1::text[]), $2, 1
       ON CONFLICT (dia, cancion, origen) DO UPDATE SET veces = impresiones.veces + 1`,
      [ids, origen, ZONA],
    );
    return { ok: true };
  });

  /** Cada minuto: { abierta: segundos en pantalla, sonando: segundos con música, aparato, version }. */
  app.post('/api/estadisticas/latido', { preHandler: requiereUsuario }, async (req) => {
    const abierta = Math.max(0, Math.min(120, Math.round(Number(req.body?.abierta) || 0)));
    const sonando = Math.max(0, Math.min(120, Math.round(Number(req.body?.sonando) || 0)));
    if (!abierta && !sonando) return { ok: true };
    const aparato = aparatoValido(req.body?.aparato) ?? 'otro';
    await db.query(
      `INSERT INTO uso_app (usuario_id, dia, aparato, version, pais, abierta_s, sonando_s)
       VALUES ($1, (now() AT TIME ZONE $2)::date, $3, $4, $5, $6, $7)
       ON CONFLICT (usuario_id, dia, aparato) DO UPDATE SET
         abierta_s = uso_app.abierta_s + EXCLUDED.abierta_s,
         sonando_s = uso_app.sonando_s + EXCLUDED.sonando_s,
         version = coalesce(EXCLUDED.version, uso_app.version),
         pais = coalesce(EXCLUDED.pais, uso_app.pais)`,
      [req.usuario.id, ZONA, aparato, texto(req.body?.version), paisDe(req.ip), abierta, sonando],
    );
    return { ok: true };
  });

  // ---------------- Panel de admin ----------------

  /** Todas las estadísticas de un período: ?dias=7 | 30 | 0 (todo). */
  app.get('/api/admin/estadisticas', { preHandler: requiereAdmin }, async (req) => {
    const dias = [7, 30, 90].includes(Number(req.query?.dias)) ? Number(req.query.dias) : 0;
    const desde = dias ? `now() - interval '${dias} days'` : `'-infinity'::timestamptz`; // número fijo de la lista: no hay texto del usuario
    const dDesde = dias ? `(now() AT TIME ZONE '${ZONA}')::date - ${dias}` : `'-infinity'::date`;
    const q = (sql, p = []) => db.query(sql, p).then((r) => r.rows);

    const [resumen] = await q(
      `SELECT count(*)::int AS escuchas,
              count(DISTINCT usuario_id)::int AS oyentes,
              round(100.0 * count(*) FILTER (WHERE completa) / nullif(count(*), 0), 1) AS retencion,
              round(100.0 * count(*) FILTER (WHERE escuchado < 5) / nullif(count(*), 0), 1) AS skip5,
              round(100.0 * count(*) FILTER (WHERE saltada) / nullif(count(*), 0), 1) AS skip30,
              round((sum(escuchado) / 3600.0)::numeric, 1) AS horas_escuchadas
         FROM escuchas WHERE empezo > ${desde}`,
    );
    const [activos] = await q(
      `SELECT count(DISTINCT usuario_id) FILTER (WHERE empezo > now() - interval '1 day')::int AS dia,
              count(DISTINCT usuario_id) FILTER (WHERE empezo > now() - interval '7 days')::int AS semana,
              count(DISTINCT usuario_id) FILTER (WHERE empezo > now() - interval '30 days')::int AS mes,
              (SELECT count(*)::int FROM usuarios WHERE NOT es_admin) AS registrados
         FROM escuchas`,
    );
    // Vuelven: de los que escucharon la semana pasada, cuántos volvieron esta semana.
    const [vuelven] = await q(
      `WITH antes AS (SELECT DISTINCT usuario_id FROM escuchas WHERE empezo BETWEEN now() - interval '14 days' AND now() - interval '7 days'),
            ahora AS (SELECT DISTINCT usuario_id FROM escuchas WHERE empezo > now() - interval '7 days')
       SELECT (SELECT count(*) FROM antes)::int AS antes, (SELECT count(*) FROM antes JOIN ahora USING (usuario_id))::int AS volvieron`,
    );
    const [uso] = await q(
      `SELECT round(sum(abierta_s) / 3600.0, 1) AS horas_abierta,
              round(sum(sonando_s) / 3600.0, 1) AS horas_sonando,
              round(sum(greatest(abierta_s - sonando_s, 0)) / 3600.0, 1) AS horas_sin_musica,
              round(avg(abierta_s) / 60.0, 1) AS min_por_dia_usuario
         FROM uso_app WHERE dia > ${dDesde}`,
    );

    const canciones = await q(
      `WITH e AS (SELECT * FROM escuchas WHERE empezo > ${desde}),
       base AS (
         SELECT cancion,
                count(*)::int AS reproducciones,
                count(DISTINCT usuario_id)::int AS oyentes,
                round(100.0 * count(*) FILTER (WHERE completa) / count(*), 1) AS retencion,
                round((100.0 * avg(least(escuchado / nullif(duracion, 0), 1)))::numeric, 1) AS pct_escuchado,
                round(100.0 * count(*) FILTER (WHERE escuchado < 5) / count(*), 1) AS skip5,
                round(100.0 * count(*) FILTER (WHERE saltada) / count(*), 1) AS skip30,
                round((percentile_cont(0.5) WITHIN GROUP (ORDER BY escuchado) FILTER (WHERE saltada))::numeric, 0) AS salto_en,
                mode() WITHIN GROUP (ORDER BY pais) FILTER (WHERE pais IS NOT NULL) AS pais_top
           FROM e GROUP BY cancion),
       repite AS (
         SELECT cancion, count(*)::int AS repiten FROM (
           SELECT cancion, usuario_id FROM e GROUP BY cancion, usuario_id HAVING count(DISTINCT (empezo AT TIME ZONE '${ZONA}')::date) >= 2) x
         GROUP BY cancion),
       val AS (
         SELECT cancion, count(*) FILTER (WHERE valor = 1)::int AS megusta, count(*) FILTER (WHERE valor = -1)::int AS nomegusta
           FROM valoraciones GROUP BY cancion),
       pl AS (
         SELECT pc.cancion, count(DISTINCT p.id)::int AS playlists, count(DISTINCT p.usuario_id)::int AS guardan
           FROM playlist_canciones pc JOIN playlists p ON p.id = pc.playlist_id AND NOT p.borrada GROUP BY pc.cancion),
       imp AS (SELECT cancion, sum(veces)::int AS impresiones FROM impresiones WHERE dia > ${dDesde} GROUP BY cancion),
       clic AS (SELECT cancion, count(*)::int AS desde_vistas FROM e WHERE origen IN ('accesos', 'busqueda') GROUP BY cancion)
       SELECT 's:' || c.id AS id, c.titulo, c.artista, c.duracion,
              coalesce(b.reproducciones, 0) AS reproducciones, coalesce(b.oyentes, 0) AS oyentes, b.retencion, b.pct_escuchado,
              b.skip5, b.skip30, b.salto_en, b.pais_top, coalesce(r.repiten, 0) AS repiten,
              coalesce(v.megusta, 0) AS megusta, coalesce(v.nomegusta, 0) AS nomegusta,
              round(100.0 * coalesce(v.megusta, 0) / nullif(b.oyentes, 0), 1) AS tasa_megusta,
              round(100.0 * coalesce(v.nomegusta, 0) / nullif(b.oyentes, 0), 1) AS tasa_nomegusta,
              coalesce(pl.playlists, 0) AS playlists, coalesce(pl.guardan, 0) AS guardan,
              coalesce(i.impresiones, 0) AS impresiones,
              round(100.0 * coalesce(k.desde_vistas, 0) / nullif(i.impresiones, 0), 1) AS ctr
         FROM canciones c
         LEFT JOIN base b ON b.cancion = 's:' || c.id
         LEFT JOIN repite r ON r.cancion = 's:' || c.id
         LEFT JOIN val v ON v.cancion = 's:' || c.id
         LEFT JOIN pl ON pl.cancion = 's:' || c.id
         LEFT JOIN imp i ON i.cancion = 's:' || c.id
         LEFT JOIN clic k ON k.cancion = 's:' || c.id
        WHERE b.reproducciones > 0 OR i.impresiones > 0 OR pl.playlists > 0 OR v.megusta > 0 OR v.nomegusta > 0
        ORDER BY reproducciones DESC NULLS LAST
        LIMIT 500`,
    );

    const paises = await q(
      `SELECT pais, count(*)::int AS escuchas, count(DISTINCT usuario_id)::int AS oyentes
         FROM escuchas WHERE empezo > ${desde} AND pais IS NOT NULL GROUP BY pais ORDER BY escuchas DESC LIMIT 20`,
    );
    const origenes = await q(
      `SELECT coalesce(origen, 'sin dato') AS origen, count(*)::int AS escuchas,
              round(100.0 * count(*) FILTER (WHERE completa) / count(*), 1) AS retencion,
              round(100.0 * count(*) FILTER (WHERE saltada) / count(*), 1) AS skip
         FROM escuchas WHERE empezo > ${desde} GROUP BY 1 ORDER BY escuchas DESC`,
    );
    const horas = await q(
      `SELECT extract(isodow FROM empezo AT TIME ZONE '${ZONA}')::int AS dia, extract(hour FROM empezo AT TIME ZONE '${ZONA}')::int AS hora, count(*)::int AS n
         FROM escuchas WHERE empezo > ${desde} GROUP BY 1, 2`,
    );
    const aparatos = await q(
      `SELECT aparato, count(DISTINCT usuario_id)::int AS usuarios, round(sum(abierta_s) / 3600.0, 1) AS horas,
              (array_agg(version ORDER BY dia DESC))[1] AS ultima_version
         FROM uso_app WHERE dia > ${dDesde} GROUP BY aparato ORDER BY usuarios DESC`,
    );
    const vacias = await q(`SELECT texto, veces, ultima FROM busquedas_vacias ORDER BY veces DESC, ultima DESC LIMIT 30`);
    const [nunca] = await q(
      `SELECT count(*)::int AS n FROM canciones c WHERE NOT EXISTS (SELECT 1 FROM escuchas e WHERE e.cancion = 's:' || c.id)`,
    );
    const nuncaLista = await q(
      `SELECT c.titulo, c.artista, c.subida FROM canciones c
        WHERE NOT EXISTS (SELECT 1 FROM escuchas e WHERE e.cancion = 's:' || c.id) ORDER BY c.subida LIMIT 30`,
    );
    const [juntos] = await q(
      `SELECT count(*)::int AS sesiones, round(avg(extract(epoch FROM coalesce(fin, now()) - inicio)) / 60.0, 1) AS minutos_promedio
         FROM juntos_sesiones WHERE inicio > ${desde}`,
    );

    // Si las recomendaciones aciertan: primera reacción dentro de 14 días. Grupos de 2 personas o más, nunca una sola.
    const recomendaciones = await q(
      `WITH m AS (
         SELECT usuario_id, cancion, lista, motivo, min(dia) AS dia FROM reco_mostradas WHERE dia > ${dDesde} GROUP BY 1, 2, 3, 4)
       SELECT m.lista, m.motivo, count(*)::int AS mostradas, count(e.completa)::int AS escuchadas,
              count(*) FILTER (WHERE e.completa)::int AS completas, count(*) FILTER (WHERE e.saltada)::int AS saltadas,
              round(100.0 * count(*) FILTER (WHERE e.completa) / nullif(count(e.completa), 0), 1) AS acierto
         FROM m
         LEFT JOIN LATERAL (
           SELECT x.completa, x.saltada FROM escuchas x
            WHERE x.usuario_id = m.usuario_id AND x.cancion = m.cancion AND x.empezo >= m.dia AND x.empezo < m.dia + 14
            ORDER BY x.empezo LIMIT 1) e ON true
        GROUP BY 1, 2 HAVING count(DISTINCT m.usuario_id) >= 2
        ORDER BY mostradas DESC`,
    );

    return { dias, zona: ZONA, resumen, activos, vuelven, uso, canciones, paises, origenes, horas, aparatos, vacias, nunca: { ...nunca, lista: nuncaLista }, juntos, recomendaciones };
  });
}
