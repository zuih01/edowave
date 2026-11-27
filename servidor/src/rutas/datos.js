import { db } from '../db.js';
import { requiereUsuario } from '../auth.js';
import { paisDe } from '../pais.js';
import { aparatoValido, origenValido, registrarBusquedaVacia } from './estadisticas.js';
import { integrantesDeTexto } from '../datos/completar.js';
import { categoriasProbables, idsAnimeNow } from '../categorias.js';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildModel,
  buscarTodo,
  groupLibrary,
  groupScore,
  heardIds,
  interpretarBusqueda,
  listaDeBusqueda,
  marcarExitos,
  matchChart,
  paraTi,
  moodMix,
  MOODS,
  radio,
  radioChain,
  motivoRadio,
  rediscover,
  shortcuts,
  shufflePool,
} from '../reco/motor.js';
import { hoyLocal, listasPersonales, registrarMostradas, resultadosDe, vecinosActuales } from '../reco/aprendizaje.js';
import { asegurarRelaciones, avisarYtmusic, ytmActual } from '../datos/ytmusic.js';

/**
 * Los datos de cada usuario y lo que se calcula con ellos, TODO en el servidor:
 *  - escuchas, "me gusta", búsquedas recientes, ajustes y lo que estaba sonando (la cola);
 *  - el feed (accesos directos, ánimos, Redescubre, tus álbumes y artistas), la radio y el buscador.
 * El algoritmo es el mismo de la app (src/reco → reco/motor.js). La app solo muestra lo que llega de aquí, así
 * que en el teléfono y en la tablet se ve exactamente lo mismo.
 */

const PREFIJO = 's:';
const SIN_ALBUM = 'Álbum desconocido';

/** Billboard Year-End Hot 100, 1985–2025: dato de popularidad histórica (no dice el género de la canción). */
const EXITOS_ANUALES = (() => {
  try {
    return JSON.parse(readFileSync(fileURLToPath(new URL('../../datos-listas/billboard-anual.json', import.meta.url)), 'utf8')).filas;
  } catch {
    return [];
  }
})();

// ---------------- Catálogo (las canciones del servidor, en el formato de la app) ----------------

let catalogo = null; // { firma, tracks, lib, features }
let cargando = null;

/** Mismo formato que `aTrack` en src/server/biblioteca.ts. */
function aTrack(c) {
  return {
    id: PREFIJO + c.id,
    fileName: `${c.artista} - ${c.titulo}.${c.formato ?? 'mp3'}`,
    format: c.formato ?? 'mp3',
    size: Number(c.tamano) || 0,
    title: c.titulo,
    artist: c.artista,
    album: c.album || SIN_ALBUM,
    albumArtist: c.artista_album || c.artista,
    year: c.anio ?? undefined,
    genres: c.generos ?? [],
    trackNo: c.pista ?? undefined,
    duration: c.duracion,
    coverId: c.portada ? `p:${c.portada}` : undefined,
    addedAt: Date.parse(c.subida) || 0,
    server: true,
    members: c.miembros?.length ? c.miembros : undefined,
    vibe: c.feliz !== null && c.feliz !== undefined ? {
      feliz: c.feliz, triste: c.triste, relajada: c.relajada, agresiva: c.agresiva, fiesta: c.fiesta,
      bailable: c.bailable, acustica: c.acustica, electronica: c.electronica, instrumental: c.instrumental,
    } : undefined,
    tags: c.tags?.length ? c.tags : undefined,
    pop: popularidad(c),
    categorias: c.categorias?.length ? c.categorias : undefined,
  };
}

/**
 * Popularidad en el servidor (0–1), con lo que la gente hace con la canción:
 *  - cuántas personas distintas la escuchan;
 *  - su retención: qué parte de las veces la escuchan completa (más de 80 % = muy buena).
 * Con pocas escuchas se asume "normal" (0,5) y se va corrigiendo a medida que hay más datos.
 */
function popularidad(c) {
  const veces = Number(c.veces) || 0;
  if (!veces) return undefined;
  const completas = Number(c.completas) || 0;
  const oyentes = Number(c.oyentes) || 0;
  const retencion = (completas + 0.6 * 5) / (veces + 5); // suavizada: 5 escuchas "imaginarias" al 60 %
  const ret = Math.max(0, Math.min(1, (retencion - 0.4) / 0.45)); // 40 % → 0 · 85 % → 1
  const alcance = Math.min(1, Math.log1p(oyentes) / Math.log(11)); // 10 personas o más → 1
  return Math.round((0.65 * ret + 0.35 * alcance) * 100) / 100;
}

/**
 * El catálogo, recalculado solo cuando cambian las canciones (subidas, datos completados, análisis).
 * Mientras entran canciones nuevas, se sigue usando el que ya está armado y el nuevo se arma en segundo
 * plano, como mucho una vez por minuto: así buscar, el feed y la radio no esperan a que se rehaga todo.
 */
const REARMAR_CADA_MS = 60_000;
let firmaVista = { firma: null, at: 0 };
async function cat() {
  // La firma (una consulta a la base) también se revisa como mucho cada 5 s.
  if (catalogo && Date.now() - firmaVista.at < 5_000 && firmaVista.firma === catalogo.firma) return catalogo;
  const f = await db.query(
    `SELECT count(*)::int AS n, coalesce(max(greatest(subida, datos_revisado)), now())::text AS c,
            (SELECT count(*) FROM analisis WHERE estado = 'listo')::int AS a,
            (SELECT count(*) FROM artistas_info WHERE estado = 'listo')::int AS m,
            -- vibe y etiquetas nuevas también rehacen el catálogo (como mucho una vez por minuto, ver más abajo)
            (SELECT count(*) FROM vibras)::int AS v,
            (SELECT count(*) FROM etiquetas)::int AS e,
            (SELECT count(*) FROM canciones WHERE anio_revisado IS NOT NULL)::int AS y,
            -- sugerencias de categoría nuevas o revisadas: cambian lo que puede sonar en la radio
            (SELECT count(*) || ':' || count(*) FILTER (WHERE estado = 'pendiente') FROM categoria_sugerencias) AS s
       FROM canciones`,
  );
  const firma = JSON.stringify(f.rows[0]);
  firmaVista = { firma, at: Date.now() };
  if (catalogo?.firma === firma) return catalogo;
  if (catalogo) {
    if (!cargando && Date.now() - catalogo.armado >= REARMAR_CADA_MS) void armar(firma).catch(() => {});
    return catalogo;
  }
  return armar(firma);
}

function armar(firma) {
  cargando ??= (async () => {
    try {
      const r = await db.query(
        `SELECT c.id, c.titulo, c.artista, c.album, c.artista_album, c.anio, c.generos, c.pista, c.duracion, c.tamano,
                c.portada, c.formato, c.subida, c.categorias, a.rasgos,
                v.feliz, v.triste, v.relajada, v.agresiva, v.fiesta, v.bailable, v.acustica, v.electronica, v.instrumental,
                e.tags, p.veces, p.completas, p.oyentes
           FROM canciones c
           LEFT JOIN analisis a ON a.cancion_id = c.id
           LEFT JOIN vibras v ON v.cancion_id = c.id AND v.error IS NULL
           LEFT JOIN etiquetas e ON e.cancion_id = c.id
           LEFT JOIN (SELECT cancion, count(*) AS veces, count(*) FILTER (WHERE completa) AS completas,
                             count(DISTINCT usuario_id) AS oyentes
                        FROM escuchas GROUP BY cancion) p ON p.cancion = 's:' || c.id`,
      );
      const info = new Map((await db.query(`SELECT nombre, mb_artista, miembros FROM artistas_info WHERE estado = 'listo'`)).rows.map((x) => [x.nombre, x]));
      for (const c of r.rows) {
        const m = new Set([...integrantesDeTexto(c.artista, info), ...integrantesDeTexto(c.artista_album, info)]);
        if (m.size) c.miembros = [...m];
      }
      const tracks = r.rows.map(aTrack);
      marcarExitos(tracks, EXITOS_ANUALES);
      // Categoría probable (sin confirmar): solo para que memes y OST no se cuelen en radios de música.
      const probables = await categoriasProbables(r.rows).catch(() => new Map());
      for (const t of tracks) {
        const p = probables.get(t.id.slice(PREFIJO.length));
        if (p?.size && !t.categorias) t.contexto = [...p];
      }
      const features = new Map();
      for (const c of r.rows) if (c.rasgos) features.set(PREFIJO + c.id, { trackId: PREFIJO + c.id, ...c.rasgos, analyzedAt: Date.parse(c.subida) || 0 });
      // Mixes de "Para ti". Anime Now: las canciones de su lista que ya están subidas van primero, en su orden.
      const animeNow = idsAnimeNow(tracks);
      const mixes = (await db.query('SELECT * FROM mixes WHERE activo ORDER BY orden, id')).rows.map((x) => ({
        id: x.id,
        titulo: x.titulo,
        tamano: x.tamano,
        anioDesde: x.anio_desde,
        anioHasta: x.anio_hasta,
        generos: x.generos,
        sinGeneros: x.sin_generos,
        categoria: x.categoria,
        fijas: x.fijas,
        externas: x.lista_externa === 'anime-now' ? animeNow : [],
      }));
      catalogo = { firma, tracks, lib: groupLibrary(tracks), features, billboard: null, mixes, armado: Date.now() };
      // Se rehacen con el catálogo nuevo (el buscador usa el viejo mientras tanto). Los que nadie usó en 20 min se
      // sueltan: si no, cada uno guardaría su catálogo viejo en memoria.
      for (const [k, h] of modelos) if (Date.now() - h.usado > 20 * 60_000) modelos.delete(k); else h.at = 0;
      // El índice del buscador se arma ya (~0,5 s), y no en la próxima búsqueda de alguien.
      const nuevo = catalogo;
      setImmediate(() => {
        if (catalogo === nuevo) buscarTodo('a', nuevo.lib, null);
      });
      return catalogo;
    } finally {
      cargando = null;
    }
  })();
  return cargando;
}

// ---------------- Billboard Hot 100 (se baja una vez por día) ----------------

const URL_HOT100 = 'https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main/recent.json';
let chart = null;
let chartBajado = 0;
async function billboard(c) {
  if (Date.now() - chartBajado > 6 * 3600_000) {
    chartBajado = Date.now();
    try {
      const r = await fetch(URL_HOT100, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.data) && j.data.length) {
          chart = { date: j.date, fetchedAt: Date.now(), data: j.data };
          c.billboard = null;
        }
      }
    } catch {
      /* sin internet: se queda con la última */
    }
  }
  if (!chart) return new Map();
  c.billboard ??= new Map([...matchChart(c.tracks, chart)].map(([id, h]) => [id, h.rank]));
  return c.billboard;
}

// ---------------- El modelo de cada usuario ----------------

const modelos = new Map(); // usuario → { model, at (armado; 0 = viejo), bb, usado }
const armando = new Map(); // usuario → el modelo que se está armando (dos pedidos juntos no lo arman dos veces)
// Se marca viejo (no se borra): el buscador puede seguir usándolo mientras se arma el nuevo.
const olvidar = (uid) => {
  const hit = modelos.get(String(uid));
  if (hit) hit.at = 0;
  armando.delete(String(uid));
};

export async function modeloDe(uid) {
  const c = await cat();
  const bb = await billboard(c);
  const hit = modelos.get(String(uid));
  if (hit) hit.usado = Date.now();
  // Se rehace al cambiar sus datos (ver `olvidar`) o cada 20 min (la hora del día cuenta).
  if (hit && Date.now() - hit.at < 20 * 60_000 && hit.bb === bb) return hit.model;
  const k = String(uid);
  if (armando.has(k)) return armando.get(k);
  const p = armarModelo(uid, c, bb).then((model) => {
    // Si sus datos cambiaron mientras se armaba (ver `olvidar`), queda guardado pero marcado viejo.
    modelos.set(k, { model, at: armando.get(k) === p ? Date.now() : 0, bb, usado: Date.now() });
    return model;
  });
  armando.set(k, p);
  try {
    return await p;
  } finally {
    if (armando.get(k) === p) armando.delete(k);
  }
}

/**
 * Para el buscador: el modelo que haya, aunque esté viejo (tus gustos no cambian por una canción más), y si está
 * viejo se rehace por detrás. Así buscar nunca espera a que se arme (antes eso eran los 5 s de algunas búsquedas).
 */
async function modeloParaBuscar(uid) {
  const hit = modelos.get(String(uid));
  if (!hit) return modeloDe(uid);
  void modeloDe(uid).catch(() => {});
  return hit.model;
}

async function armarModelo(uid, c, bb) {
  const [p, v, resultados, b] = await Promise.all([
    db.query(
      `SELECT cancion, extract(epoch FROM empezo) * 1000 AS empezo, escuchado, duracion, completa, saltada, anterior
         FROM escuchas WHERE usuario_id = $1 ORDER BY empezo`,
      [uid],
    ),
    db.query('SELECT cancion, valor FROM valoraciones WHERE usuario_id = $1', [uid]),
    resultadosDe(uid),
    db.query('SELECT busquedas FROM estado_usuario WHERE usuario_id = $1', [uid]).catch(() => ({ rows: [] })),
  ]);
  // Lo que buscaste y tocaste hace poco (las últimas 12): también cuenta como punto de partida para recomendarte.
  const buscadas = (b.rows[0]?.busquedas?.tracks ?? []).filter((x) => typeof x === 'string').slice(0, 12);
  const plays = p.rows.map((x) => ({
    trackId: x.cancion,
    startedAt: Number(x.empezo),
    listened: x.escuchado,
    duration: x.duracion,
    completed: x.completa,
    skipped: x.saltada,
    prevTrackId: x.anterior ?? undefined,
  }));
  const ratings = Object.fromEntries(v.rows.map((x) => [x.cancion, x.valor]));
  const model = buildModel({ tracks: c.tracks, plays, ratings, features: c.features, billboard: bb, now: Date.now(), vecinos: vecinosActuales(), ytm: ytmActual(c.tracks), buscadas, resultados });
  return model;
}

async function idsDePlaylists(uid) {
  const r = await db.query(
    `SELECT DISTINCT pc.cancion FROM playlist_canciones pc JOIN playlists p ON p.id = pc.playlist_id
      WHERE p.usuario_id = $1 AND NOT p.borrada`,
    [uid],
  );
  return r.rows.map((x) => x.cancion);
}

/** Lista pedida con la búsqueda ("80s", "rock clásico"…) o null si es una búsqueda normal. */
function listaPedida(m, q) {
  const consulta = interpretarBusqueda(q);
  if (!consulta) return null;
  const ids = listaDeBusqueda(m, consulta, 50);
  return ids.length ? { q, titulo: consulta.titulo, descripcion: consulta.descripcion, ids } : null;
}

const SHORTCUTS = 26; // 9 + 9 + 8 (el cuadro 27 es "Aleatorio")
const listaIds = (v, max = 500) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(-max) : []);

// Portadas propias de los mixes "Para ti" (los que no tienen, usan el mosaico de carátulas).
const PORTADAS_MIX = { 'anime-now': 'anime-now.jpg', 'essential-90s': 'essential-90s.webp', 'essential-2000s': 'essential-2000s.webp' };
const carpetaPortadasMix = fileURLToPath(new URL('../../datos-listas/portadas/', import.meta.url));

export default async function rutasDatos(app) {
  app.get('/api/mix-portadas/:archivo', async (req, reply) => {
    const archivo = String(req.params.archivo);
    if (!Object.values(PORTADAS_MIX).includes(archivo) || !existsSync(carpetaPortadasMix + archivo)) return reply.code(404).send();
    reply.header('Content-Type', archivo.endsWith('.webp') ? 'image/webp' : 'image/jpeg').header('Cache-Control', 'public, max-age=86400');
    return reply.send(createReadStream(carpetaPortadasMix + archivo));
  });

  // Prepara el catálogo al arrancar (así el primer feed sale rápido).
  void cat().catch(() => {});

  // ---------------- Feed, radio y buscador ----------------

  app.get('/api/feed', { preHandler: requiereUsuario }, async (req) => {
    const m = await modeloDe(req.usuario.id);
    const c = await cat();
    const moods = {};
    for (const x of MOODS) moods[x.id] = moodMix(m, x.id, 50);
    const top = (items, key) =>
      items
        .map((a) => [a, groupScore(m, a.tracks.map((t) => t.id))])
        .sort((x, y) => y[1] - x[1])
        .slice(0, 20)
        .map(([a]) => a[key]);
    const accesos = shortcuts(m, SHORTCUTS);
    // Para medir: las de los accesos directos que todavía no has escuchado (descubrimientos o Billboard).
    const motivoAcceso = heardIds(m).length < 5 ? 'billboard' : 'parecido';
    registrarMostradas(req.usuario.id, 'accesos', accesos.filter((id) => !m.stats.has(id) && m.input.ratings[id] === undefined).map((id) => ({ id, motivo: motivoAcceso })));
    return {
      shortcuts: accesos,
      rediscover: rediscover(m, 15),
      moods,
      heard: heardIds(m).length,
      albums: top(c.lib.albums, 'key'),
      artists: top(c.lib.artists, 'name'),
      shuffle: shufflePool(m, await idsDePlaylists(req.usuario.id)),
      // "Para ti": todo ordenado por lo que más escucha la cuenta (ver `paraTi` en src/reco/engine.ts): mixes del
      // panel solo si escucha eso, tarjetas de sus estilos, Descubrimiento semanal y Mix diario.
      paraTi: paraTi(m, c.mixes, await listasPersonales(req.usuario.id, m), `${req.usuario.id}:${hoyLocal()}`).map(
        ({ portada: _p, tipo: _t, ...x }) => (PORTADAS_MIX[x.id] ? { ...x, portada: `/api/mix-portadas/${PORTADAS_MIX[x.id]}` } : x),
      ),
    };
  });

  /** Siguientes canciones de la radio: parecidas a las últimas que sonaron (`semillas`), sin repetir `excluir`. */
  app.post('/api/radio', { preHandler: requiereUsuario }, async (req) => {
    // La canción con que parte la radio: si YouTube Music todavía no la tiene, se le pregunta ahora (hasta 5 s).
    const ancla = req.body?.desde ? String(req.body.desde) : listaIds(req.body?.semillas, 12)[0];
    const [m] = await Promise.all([modeloDe(req.usuario.id), ancla ? asegurarRelaciones(ancla) : null]);
    const n = Math.max(1, Math.min(30, Number(req.body?.n) || 5));
    const ids = req.body?.desde
      ? radioChain(m, String(req.body.desde), n)
      : radio(m, listaIds(req.body?.semillas, 12), new Set(listaIds(req.body?.excluir, 2000)), n);
    // Se anota de dónde salió cada una (YouTube Music o el algoritmo propio): según lo que termines o saltes, tu
    // cuenta aprende cuánto confiar en YouTube Music (ver `confianzaEnYoutube`).
    registrarMostradas(req.usuario.id, 'radio', ids.map((id) => ({ id, motivo: ancla ? motivoRadio(m, ancla, id) : 'radio' })));
    return { ids };
  });

  app.get('/api/buscar', { preHandler: requiereUsuario }, async (req) => {
    const q = String(req.query?.q ?? '').slice(0, 100);
    const [m, c] = await Promise.all([modeloParaBuscar(req.usuario.id), cat()]);
    const r = buscarTodo(q, c.lib, m);
    // "80s", "reggaetón viejo", "r&b de los 90": además de los resultados, una lista armada con eso.
    const lista = listaPedida(m, q);
    if (lista) r.lista = lista;
    // Lo que se busca y no está: sirve para saber qué canciones subir (solo si dejó de escribir, ver la app).
    if (req.query?.final === '1' && !lista && !r.tracks.length && !r.artists.length && !r.albums.length) void registrarBusquedaVacia(q);
    return r;
  });

  /** La lista de una búsqueda (para abrir su página directo, por ejemplo al volver atrás). */
  app.get('/api/lista-busqueda', { preHandler: requiereUsuario }, async (req, reply) => {
    const q = String(req.query?.q ?? '').slice(0, 100);
    const lista = listaPedida(await modeloDe(req.usuario.id), q);
    if (!lista) return reply.code(404).send({ error: 'Esa búsqueda no arma una lista' });
    return lista;
  });

  // ---------------- Escuchas (historial) ----------------

  /** La app manda cada escucha al terminar (o varias juntas si estuvo sin conexión). No se duplican. */
  app.post('/api/escuchas', { preHandler: requiereUsuario }, async (req) => {
    const lista = Array.isArray(req.body?.escuchas) ? req.body.escuchas.slice(0, 5000) : [];
    const pais = paisDe(req.ip); // solo el país; la IP no se guarda
    let n = 0;
    for (const e of lista) {
      if (!e?.trackId || !e?.clienteId || !(e.startedAt > 0)) continue;
      const r = await db.query(
        `INSERT INTO escuchas (usuario_id, cliente_id, cancion, empezo, escuchado, duracion, completa, saltada, anterior, origen, pais, aparato, version)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT DO NOTHING`,
        [
          req.usuario.id, String(e.clienteId), String(e.trackId), e.startedAt, Number(e.listened) || 0, Number(e.duration) || 0, !!e.completed, !!e.skipped,
          e.prevTrackId ?? null, origenValido(e.origen), pais, aparatoValido(e.aparato), typeof e.version === 'string' ? e.version.slice(0, 40) : null,
        ],
      );
      n += r.rowCount;
    }
    if (n) olvidar(req.usuario.id);
    return { guardadas: n };
  });

  /** Historial (lo más reciente primero). */
  app.get('/api/historial', { preHandler: requiereUsuario }, async (req) => {
    const limite = Math.max(1, Math.min(5000, Number(req.query?.limite) || 1000));
    const r = await db.query(
      `SELECT cancion, extract(epoch FROM empezo) * 1000 AS empezo, escuchado, duracion, completa, saltada
         FROM escuchas WHERE usuario_id = $1 ORDER BY empezo DESC LIMIT $2`,
      [req.usuario.id, limite],
    );
    return r.rows.map((x) => ({
      trackId: x.cancion,
      startedAt: Number(x.empezo),
      listened: x.escuchado,
      duration: x.duracion,
      completed: x.completa,
      skipped: x.saltada,
    }));
  });

  // ---------------- "Me gusta" / "No me gusta" ----------------

  app.get('/api/valoraciones', { preHandler: requiereUsuario }, async (req) => {
    const r = await db.query('SELECT cancion, valor, extract(epoch FROM fecha) * 1000 AS fecha FROM valoraciones WHERE usuario_id = $1', [req.usuario.id]);
    return r.rows.map((x) => ({ trackId: x.cancion, value: x.valor, at: Number(x.fecha) }));
  });

  /** { cancion, valor: 1 | -1 | 0 } (0 = quitar). También acepta varias: { lista: [...] }. */
  app.put('/api/valoraciones', { preHandler: requiereUsuario }, async (req) => {
    const lista = Array.isArray(req.body?.lista) ? req.body.lista : [req.body];
    for (const v of lista.slice(0, 5000)) {
      const cancion = String(v?.cancion ?? v?.trackId ?? '');
      const valor = Number(v?.valor ?? v?.value);
      if (!cancion) continue;
      if (valor === 1 || valor === -1)
        await db.query(
          `INSERT INTO valoraciones (usuario_id, cancion, valor, fecha) VALUES ($1, $2, $3, coalesce(to_timestamp($4 / 1000.0), now()))
           ON CONFLICT (usuario_id, cancion) DO UPDATE SET valor = EXCLUDED.valor, fecha = EXCLUDED.fecha`,
          [req.usuario.id, cancion, valor, Number(v?.at) || null],
        );
      else await db.query('DELETE FROM valoraciones WHERE usuario_id = $1 AND cancion = $2', [req.usuario.id, cancion]);
    }
    olvidar(req.usuario.id);
    avisarYtmusic(); // lo que te gustó se pide pronto a YouTube Music
    return { ok: true };
  });

  // ---------------- Ajustes, cola y búsquedas recientes ----------------

  app.get('/api/estado', { preHandler: requiereUsuario }, async (req) => {
    const r = await db.query('SELECT ajustes, cola, busquedas, migrado, extract(epoch FROM actualizado) * 1000 AS actualizado FROM estado_usuario WHERE usuario_id = $1', [
      req.usuario.id,
    ]);
    const e = r.rows[0];
    return e
      ? { ajustes: e.ajustes, cola: e.cola, busquedas: e.busquedas, migrado: e.migrado, actualizado: Number(e.actualizado) }
      : { ajustes: {}, cola: null, busquedas: { queries: [], tracks: [] }, migrado: false, actualizado: 0 };
  });

  /** Guarda lo que venga: { ajustes? (se mezclan), cola?, busquedas?, migrado? }. */
  app.put('/api/estado', { preHandler: requiereUsuario }, async (req) => {
    const b = req.body ?? {};
    const json = (v) => (v === undefined ? null : JSON.stringify(v));
    if (json(b.ajustes)?.length > 200_000 || json(b.cola)?.length > 200_000 || json(b.busquedas)?.length > 50_000) return { ok: false };
    await db.query(
      `INSERT INTO estado_usuario (usuario_id, ajustes, cola, busquedas, migrado)
       VALUES ($1, coalesce($2::jsonb, '{}'), $3::jsonb, coalesce($4::jsonb, '{"queries": [], "tracks": []}'), coalesce($5, false))
       ON CONFLICT (usuario_id) DO UPDATE SET
         ajustes = CASE WHEN $2::jsonb IS NULL THEN estado_usuario.ajustes ELSE estado_usuario.ajustes || $2::jsonb END,
         cola = CASE WHEN $6 THEN $3::jsonb ELSE estado_usuario.cola END,
         busquedas = coalesce($4::jsonb, estado_usuario.busquedas),
         migrado = estado_usuario.migrado OR coalesce($5, false),
         actualizado = now()`,
      [req.usuario.id, json(b.ajustes), json(b.cola), json(b.busquedas), b.migrado === true ? true : null, b.cola !== undefined],
    );
    return { ok: true };
  });
}
