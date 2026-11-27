// Recomendaciones de YouTube Music: "qué va con qué" para cada canción (su radio y la pestaña "Relacionado").
// Se usa la API interna de music.youtube.com SIN sesión: es igual para todos y no sabe de nadie. Lo personal lo pone
// el motor de Edowave, que elige desde qué canciones parte cada cuenta (sus "me gusta", lo que escucha y busca).
//
// No es una API oficial: YouTube la puede cambiar sin aviso. Por eso (1) cada canción se pide una sola vez y queda
// guardada en `ytm_relaciones` (se renueva a los 30 días), (2) si falla, el motor sigue igual que antes, y (3) un
// chequeo cada hora queda en `ytm_salud`, que la pestaña Bot del panel muestra con aviso en rojo.
import { db } from '../db.js';
import { artistaPrincipal, limpiarTitulo } from './letras.js';

const BASE = 'https://music.youtube.com/youtubei/v1/';
const CLIENTE = { clientName: 'WEB_REMIX', clientVersion: '1.20241111.01.00', hl: 'es', gl: 'CL' };
const FILTRO_CANCIONES = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';
/**
 * Velocidad: varias canciones a la vez (cada una son 3 consultas), con una pausa entre una y otra en cada fila.
 * 3 a la vez con 2 s ≈ 3 000 canciones por hora. Si YouTube pide esperar (429), se para 15 min y sigue de a una.
 */
const FILAS = 3;
const PAUSA_MS = 2000;
const LOTE = 60;
const RENOVAR_DIAS = 30;
/** Las que fallaron (no por YouTube caído, sino esa canción) se reintentan al día siguiente. */
const REINTENTO_ERROR_DIAS = 1;
/** Si fallan tantas seguidas, YouTube Music está con problemas: se para y se reintenta en 15 min. */
const MAX_FALLAS_SEGUIDAS = 3;
const CHEQUEO_CADA_MS = 3600_000;

let log = console;
let corriendo = false;

// ---------------- La API ----------------

/** Una consulta; si se corta o tarda (pasa a veces), se reintenta una vez antes de darla por fallida. */
async function pedir(ep, body) {
  try {
    return await pedirUnaVez(ep, body);
  } catch (e) {
    if (e.esperar) throw e;
    await new Promise((res) => setTimeout(res, 3000));
    return pedirUnaVez(ep, body);
  }
}

async function pedirUnaVez(ep, body) {
  const r = await fetch(`${BASE}${ep}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', Origin: 'https://music.youtube.com' },
    body: JSON.stringify({ context: { client: CLIENTE }, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 429) throw Object.assign(new Error('YouTube Music: demasiadas consultas (429)'), { esperar: 15 * 60_000 });
  if (!r.ok) throw new Error(`YouTube Music respondió ${r.status} en ${ep}`);
  return r.json();
}

function* buscarClave(o, clave) {
  if (Array.isArray(o)) for (const x of o) yield* buscarClave(x, clave);
  else if (o && typeof o === 'object')
    for (const [k, v] of Object.entries(o)) {
      if (k === clave) yield v;
      yield* buscarClave(v, clave);
    }
}
const texto = (r) => (r?.runs ?? []).map((x) => x.text ?? '').join('');
/** "ADÉLA • 935 K visualizaciones" → "ADÉLA" */
const primeraParte = (s) => String(s ?? '').split(' • ')[0].trim();

/** videoId de la canción en YouTube Music (sección Canciones), o null si no aparece. */
export async function buscarVideo(artista, titulo) {
  const s = await pedir('search', { query: `${artistaPrincipal(artista)} ${limpiarTitulo(titulo) || titulo}`, params: FILTRO_CANCIONES });
  const quiero = clave('', titulo).slice(1);
  for (const it of buscarClave(s, 'musicResponsiveListItemRenderer')) {
    const cols = (it.flexColumns ?? []).map((c) => texto(c.musicResponsiveListItemFlexColumnRenderer?.text));
    const vid = [...buscarClave(it, 'videoId')][0];
    if (!vid) continue;
    // El primer resultado casi siempre es; se exige que el título se parezca para no guardar el mapa de otra canción.
    const t = clave('', cols[0]).slice(1);
    if (t && quiero && (t.includes(quiero) || quiero.includes(t))) return vid;
  }
  return null;
}

/**
 * Álbum y carátula de una canción según YouTube Music (sección Canciones). Sirve para lo que MusicBrainz, iTunes y
 * Deezer no tienen (OST de anime y juegos, phonk, artistas chicos). Se exige que el título y el artista se parezcan
 * y, si se sabe la duración, que no difiera más de 10 s. Un sencillo viene con el álbum igual al título.
 * @returns {Promise<{album:string, artistaAlbum:string, portada:string|null, sencillo:boolean}|null>}
 */
export async function buscarAlbumYtm(artista, titulo, duracion) {
  if (process.env.YTMUSIC === 'no') return null;
  const principal = artistaPrincipal(artista);
  const s = await pedir('search', { query: `${principal} ${limpiarTitulo(titulo) || titulo}`, params: FILTRO_CANCIONES });
  const quiero = clave('', titulo).slice(1);
  const quien = norm(principal);
  for (const it of buscarClave(s, 'musicResponsiveListItemRenderer')) {
    const cols = (it.flexColumns ?? []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []);
    const t = clave('', cols[0]?.map((x) => x.text).join('')).slice(1);
    if (!t || !quiero || !(t.includes(quiero) || quiero.includes(t))) continue;
    const runs = cols[1] ?? [];
    const tipo = (x) => x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    const artistas = runs.filter((x) => tipo(x) === 'MUSIC_PAGE_TYPE_ARTIST').map((x) => x.text);
    const album = runs.find((x) => tipo(x) === 'MUSIC_PAGE_TYPE_ALBUM')?.text;
    if (!album || !artistas.length) continue;
    if (!artistas.some((a) => norm(a) && quien && (norm(a).includes(quien) || quien.includes(norm(a))))) continue;
    const dur = runs.map((x) => x.text).find((x) => /^\d+:\d{2}(:\d{2})?$/.test(x ?? ''));
    if (dur && duracion) {
      const seg = dur.split(':').reduce((a, b) => a * 60 + Number(b), 0);
      if (Math.abs(seg - Number(duracion)) > 10) continue;
    }
    const fotos = [...buscarClave(it.thumbnail, 'thumbnails')][0] ?? [];
    const foto = fotos.at(-1)?.url ?? null;
    return {
      album,
      artistaAlbum: artistas[0],
      // "=w120-h120-l90-rj" → 600 px
      portada: foto ? foto.replace(/=w\d+-h\d+[^/]*$/, '=w600-h600-l90-rj') : null,
      sencillo: norm(album) === norm(limpiarTitulo(titulo) || titulo),
    };
  }
  return null;
}

/** Radio de la canción (lo que YouTube Music pondría después), sin la propia canción. */
export async function radioDe(videoId) {
  const n = await pedir('next', { videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true });
  const lista = [];
  for (const it of buscarClave(n, 'playlistPanelVideoRenderer')) {
    if (it.videoId === videoId) continue;
    const a = primeraParte(texto(it.shortBylineText) || texto(it.longBylineText));
    const t = texto(it.title);
    if (a && t) lista.push({ a, t });
  }
  const pestana = [...buscarClave(n, 'tabRenderer')].find((x) => x.endpoint?.browseEndpoint?.browseId?.startsWith('MPTRt'));
  return { lista, relacionado: pestana?.endpoint.browseEndpoint.browseId ?? null };
}

/** Pestaña "Relacionado": "También te puede interesar" (canciones) y "Artistas similares". */
export async function relacionadoDe(browseId) {
  const r = await pedir('browse', { browseId });
  const similares = [];
  const artistas = [];
  for (const sh of buscarClave(r, 'musicCarouselShelfRenderer')) {
    const contenido = sh.contents ?? [];
    const canciones = contenido.map((c) => c.musicResponsiveListItemRenderer).filter(Boolean);
    // La primera repisa de canciones es "También te puede interesar"; las otras son versiones del mismo tema.
    if (canciones.length && !similares.length) {
      for (const it of canciones) {
        const cols = (it.flexColumns ?? []).map((c) => texto(c.musicResponsiveListItemFlexColumnRenderer?.text));
        const a = primeraParte(cols[1]);
        if (a && cols[0]) similares.push({ a, t: cols[0] });
      }
      continue;
    }
    const tarjetas = contenido.map((c) => c.musicTwoRowItemRenderer).filter(Boolean);
    const esArtista = (x) => x.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC');
    if (!artistas.length && tarjetas.length && tarjetas.every(esArtista)) artistas.push(...tarjetas.map((x) => texto(x.title)).filter(Boolean));
  }
  return { similares, artistas };
}

// ---------------- Guardar y renovar ----------------

async function guardar(id, f) {
  await db.query(
    `INSERT INTO ytm_relaciones (cancion, estado, video_id, radio, similares, artistas, buscada) VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (cancion) DO UPDATE SET estado = $2, video_id = $3, radio = $4, similares = $5, artistas = $6, buscada = now()`,
    [id, f.estado, f.video ?? null, JSON.stringify(f.radio ?? []), JSON.stringify(f.similares ?? []), JSON.stringify(f.artistas ?? [])],
  );
}

/** Pide a YouTube Music lo de una canción del catálogo y lo guarda. Devuelve el estado. */
export async function buscarRelaciones(id) {
  const r = await db.query('SELECT id, titulo, artista FROM canciones WHERE id = $1', [id]);
  const c = r.rows[0];
  if (!c) return null;
  try {
    const video = await buscarVideo(c.artista, c.titulo);
    if (!video) {
      await guardar(id, { estado: 'sin_video' });
      return 'sin_video';
    }
    const { lista, relacionado } = await radioDe(video);
    const rel = relacionado ? await relacionadoDe(relacionado) : { similares: [], artistas: [] };
    if (!lista.length && !rel.similares.length) throw new Error('YouTube Music devolvió la radio vacía');
    await guardar(id, { estado: 'listo', video, radio: lista.slice(0, 50), similares: rel.similares.slice(0, 40), artistas: rel.artistas.slice(0, 20) });
    ponerEnMapa(id, lista.slice(0, 50), rel.similares.slice(0, 40));
    marcarFunciona();
    return 'listo';
  } catch (e) {
    await guardar(id, { estado: 'error' }).catch(() => {});
    throw e;
  }
}

/**
 * Recorre TODO el catálogo, solo, de a una canción. Orden: primero las que la gente escuchó o le gustó más
 * recién (así cada cuenta se ve beneficiada pronto), después las más escuchadas, después las recién subidas y al
 * final el resto. Cuando termina, solo renueva lo que tiene más de 30 días y pide lo nuevo que se suba.
 */
let filasAhora = FILAS;

/** Las próximas canciones por pedir, en orden de prioridad (ver arriba). */
async function proximas(n) {
  const r = await db.query(
    `WITH act AS (
       SELECT cancion, max(empezo) AS u, count(*) AS n FROM escuchas WHERE completa GROUP BY 1
       UNION ALL
       SELECT cancion, fecha, 1 FROM valoraciones WHERE valor = 1)
     SELECT c.id FROM canciones c
       LEFT JOIN (SELECT cancion, max(u) AS u, sum(n) AS n FROM act GROUP BY 1) a ON a.cancion = 's:' || c.id
       LEFT JOIN ytm_relaciones y ON y.cancion = c.id
      WHERE y.cancion IS NULL
         OR (y.estado = 'error' AND y.buscada < now() - make_interval(days => $2))
         OR y.buscada < now() - make_interval(days => $1)
      ORDER BY (y.cancion IS NOT NULL), a.u DESC NULLS LAST, a.n DESC NULLS LAST, c.subida DESC
      LIMIT $3`,
    [RENOVAR_DIAS, REINTENTO_ERROR_DIAS, n],
  );
  return r.rows.map((x) => x.id);
}

async function procesar() {
  if (corriendo) return;
  corriendo = true;
  let seguidas = 0;
  try {
    for (;;) {
      // De a lotes: lo recién gustado o subido entra en el lote siguiente (como mucho ~1 min de espera).
      const fila = await proximas(LOTE);
      if (!fila.length) break;
      let parar = null;
      const trabajar = async () => {
        while (!parar && fila.length) {
          const id = fila.shift();
          try {
            await buscarRelaciones(id);
            seguidas = 0;
          } catch (e) {
            // Una canción rara no detiene el recorrido; varias seguidas o un 429 sí (YouTube Music con problemas).
            if (e.esperar || ++seguidas >= MAX_FALLAS_SEGUIDAS) parar = e;
          }
          await new Promise((res) => setTimeout(res, PAUSA_MS));
        }
      };
      await Promise.all(Array.from({ length: filasAhora }, trabajar));
      if (parar) throw parar;
    }
  } catch (e) {
    log.warn({ err: e.message }, 'YouTube Music: se reintenta más tarde');
    await anotarFalla(e); // falló varias seguidas (o 429): ahí sí es aviso en el panel
    if (e.esperar) {
      filasAhora = 1; // YouTube pidió frenar: desde ahora, de a una
      await new Promise((res) => setTimeout(res, e.esperar));
    }
  } finally {
    corriendo = false;
  }
}

// ---------------- Salud de la API (pestaña Bot) ----------------

let ultimaFalla = 0;
let fallando = false;
/** Solo cuando fallan varias canciones seguidas (o YouTube pide esperar): una canción rara no es aviso. */
async function anotarFalla(e) {
  fallando = true;
  // Queda en el historial como mucho una vez cada 10 minutos.
  if (Date.now() - ultimaFalla < 10 * 60_000) return;
  ultimaFalla = Date.now();
  await db
    .query('INSERT INTO ytm_salud (ok, pruebas) VALUES (false, $1)', [
      JSON.stringify([{ nombre: `Uso normal (${MAX_FALLAS_SEGUIDAS} canciones seguidas)`, ok: false, detalle: String(e.message).slice(0, 200), segundos: 0 }]),
    ])
    .catch(() => {});
}
/** Volvió a responder después de un aviso: se anota, para que el panel vuelva a verde sin esperar al chequeo. */
function marcarFunciona() {
  if (!fallando) return;
  fallando = false;
  void db
    .query('INSERT INTO ytm_salud (ok, pruebas) VALUES (true, $1)', [JSON.stringify([{ nombre: 'Uso normal', ok: true, detalle: 'Volvió a responder', segundos: 0 }])])
    .catch(() => {});
}

const PRUEBA = { artista: 'Daft Punk', titulo: 'One More Time' };

/** Las 3 consultas que usa Edowave, con una canción conocida. */
export async function chequear() {
  const pruebas = [];
  const paso = async (nombre, fn) => {
    const t0 = Date.now();
    try {
      const detalle = await fn();
      pruebas.push({ nombre, ok: true, detalle, segundos: +((Date.now() - t0) / 1000).toFixed(1) });
      return true;
    } catch (e) {
      pruebas.push({ nombre, ok: false, detalle: String(e.message).slice(0, 200), segundos: +((Date.now() - t0) / 1000).toFixed(1) });
      return false;
    }
  };
  let video = null;
  let radio = null;
  await paso('Buscar canción', async () => {
    video = await buscarVideo(PRUEBA.artista, PRUEBA.titulo);
    if (!video) throw new Error(`No encontró "${PRUEBA.titulo}" de ${PRUEBA.artista}`);
    return `${PRUEBA.artista} – ${PRUEBA.titulo}`;
  });
  if (video)
    await paso('Radio', async () => {
      radio = await radioDe(video);
      if (radio.lista.length < 10) throw new Error(`Solo trajo ${radio.lista.length} canciones`);
      return `${radio.lista.length} canciones`;
    });
  if (radio)
    await paso('Relacionado', async () => {
      if (!radio.relacionado) throw new Error('No vino la pestaña Relacionado');
      const r = await relacionadoDe(radio.relacionado);
      if (r.similares.length < 5) throw new Error(`Solo trajo ${r.similares.length} canciones`);
      return `${r.similares.length} canciones, ${r.artistas.length} artistas`;
    });
  const ok = pruebas.length === 3 && pruebas.every((p) => p.ok);
  if (ok) fallando = false;
  await db.query('INSERT INTO ytm_salud (ok, pruebas) VALUES ($1, $2)', [ok, JSON.stringify(pruebas)]);
  await db.query(`DELETE FROM ytm_salud WHERE hora < now() - interval '7 days'`);
  return { ok, pruebas };
}

/** Para la pestaña Bot del panel. */
export async function saludYtm() {
  const [h, c] = await Promise.all([
    db.query(`SELECT hora, ok, pruebas FROM ytm_salud WHERE hora > now() - interval '48 hours' ORDER BY hora`),
    db.query(`SELECT count(*) FILTER (WHERE estado = 'listo')::int AS listas, count(*) FILTER (WHERE estado = 'sin_video')::int AS sin_video,
                     count(*) FILTER (WHERE estado = 'error')::int AS errores,
                     (SELECT count(*)::int FROM canciones) AS total,
                     count(*) FILTER (WHERE buscada > now() - interval '1 hour')::int AS ultima_hora FROM ytm_relaciones`),
  ]);
  const filas = h.rows;
  const ultimo = filas.at(-1) ?? null;
  const ultimoOk = [...filas].reverse().find((x) => x.ok)?.hora ?? null;
  let fallaDesde = null;
  if (ultimo && !ultimo.ok) {
    fallaDesde = ultimo.hora;
    for (let i = filas.length - 1; i >= 0 && !filas[i].ok; i--) fallaDesde = filas[i].hora;
  }
  return {
    ok: !!ultimo?.ok && !fallando,
    hora: ultimo?.hora ?? null,
    pruebas: ultimo?.pruebas ?? [],
    ultimoOk,
    fallaDesde,
    historial: filas.map((x) => ({ hora: x.hora, ok: x.ok })),
    canciones: c.rows[0],
  };
}

// ---------------- Para el motor ----------------

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
function clave(artista, titulo) {
  return `${norm(artistaPrincipal(artista))}|${norm(limpiarTitulo(titulo) || titulo)}`;
}

const PREFIJO = 's:';
/**
 * Un solo mapa que se actualiza en su lugar: así los perfiles ya armados (que guardan este mismo objeto) ven al
 * instante lo que llega de YouTube Music, sin esperar a rehacerse.
 */
const mapa = new Map();
let indice = null; // clave "artista|título" → id del catálogo
let armadoPara = null;
let armadoEn = 0;
let armando = null;
const REARMAR_MS = 10 * 60_000;

/**
 * Canción del catálogo → (canción del catálogo → 0–1): qué tan arriba la pone YouTube Music en su radio o en
 * "Relacionado". Solo entran las que están en el servidor. Si el catálogo cambió o pasaron 10 min, se rehace aparte.
 */
export function ytmActual(tracks) {
  if (!armando && (armadoPara !== tracks || Date.now() - armadoEn > REARMAR_MS)) {
    armadoEn = Date.now();
    armando = armar(tracks)
      .then(() => (armadoPara = tracks))
      .catch((e) => log.warn({ err: e.message }, 'YouTube Music: no se pudo armar el mapa'))
      .finally(() => (armando = null));
  }
  return mapa;
}

/** Las recomendaciones de una canción (sin prefijo) que están en el catálogo. */
function relacionesDe(cancion, radio, similares) {
  const yo = PREFIJO + cancion;
  const m = new Map();
  const poner = (lista, alto, bajo) =>
    lista.forEach((x, i) => {
      const id = indice?.get(clave(x.a, x.t));
      if (!id || id === yo) return;
      const v = alto - ((alto - bajo) * i) / Math.max(1, lista.length - 1);
      if (v > (m.get(id) ?? 0)) m.set(id, v);
    });
  poner(radio ?? [], 1, 0.4);
  poner(similares ?? [], 0.85, 0.35);
  return m;
}

function ponerEnMapa(cancion, radio, similares) {
  if (!indice) return;
  const m = relacionesDe(cancion, radio, similares);
  if (m.size) mapa.set(PREFIJO + cancion, m);
}

async function armar(tracks) {
  const nuevo = new Map();
  for (const t of tracks) {
    const k = clave(t.artist, t.title);
    if (!nuevo.has(k)) nuevo.set(k, t.id);
  }
  indice = nuevo;
  const r = await db.query(`SELECT cancion, radio, similares FROM ytm_relaciones WHERE estado = 'listo'`);
  const vistas = new Set();
  for (const f of r.rows) {
    ponerEnMapa(f.cancion, f.radio, f.similares);
    vistas.add(PREFIJO + f.cancion);
  }
  for (const k of [...mapa.keys()]) if (!vistas.has(k)) mapa.delete(k);
}

/**
 * Antes de una radio: si la canción (con "s:") no tiene datos de YouTube Music, se piden ahora (hasta `ms`).
 * Si YouTube tarda o falla, la radio sale igual con lo que hay.
 */
export async function asegurarRelaciones(idMotor, ms = 5000) {
  if (process.env.YTMUSIC === 'no' || !String(idMotor).startsWith(PREFIJO)) return;
  if (mapa.has(idMotor)) return;
  const id = String(idMotor).slice(PREFIJO.length);
  const ya = await db.query('SELECT 1 FROM ytm_relaciones WHERE cancion = $1', [id]);
  if (ya.rows.length) return;
  await Promise.race([buscarRelaciones(id).catch(() => {}), new Promise((res) => setTimeout(res, ms))]);
}

export function iniciarYtmusic(logger) {
  log = logger;
  if (process.env.YTMUSIC === 'no') return log.info('YouTube Music: desactivado (YTMUSIC=no)');
  const chequeo = () => chequear().catch((e) => log.warn({ err: e.message }, 'YouTube Music: el chequeo falló'));
  setTimeout(chequeo, 30_000);
  setInterval(chequeo, CHEQUEO_CADA_MS).unref();
  setTimeout(() => void procesar(), 90_000);
  setInterval(() => void procesar(), 15 * 60_000).unref();
}

/** Al dar "me gusta" o subir una canción: que se pida pronto. */
export const avisarYtmusic = () => void procesar();
