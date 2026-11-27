import { db } from '../db.js';
import { requiereUsuario } from '../auth.js';
import { juntosEmpieza, juntosTermina } from './estadisticas.js';
import { nuevoCodigo } from './admin.js';
import { enlaceSugerenciaValido, pareceEnlace } from '../enlaces.js';
import { idPlaylistSpotify, leerCancionesPegadas, leerPlaylistSpotify } from '../spotify.js';
import { completarImportada, conAvisos, faltantesDe, guardarImportada } from '../importarPlaylist.js';
import { insigniasDe } from '../insignias.js';

/** Cuántas invitaciones sin usar (y vigentes) puede tener cada usuario a la vez. */
const MAX_INVITACIONES = 3;
const DIAS_INVITACION = 7;

/**
 * Lo social: amigos (con solicitud), lo que cada uno está escuchando en vivo, las playlists de cada cuenta
 * (privadas o públicas) y "De la comunidad".
 *
 * En vivo: cada app abre GET /api/eventos y queda escuchando (un flujo de texto que no se cierra). Por ahí le
 * llegan los avisos: qué está escuchando un amigo, una solicitud nueva, una playlist pública nueva…
 * Lo que suena se guarda solo en memoria: si el servidor se reinicia, cada app lo vuelve a contar sola.
 */

// ---------------- Conexiones en vivo ----------------

/** usuario → conexiones abiertas (puede tener la app abierta en el iPhone y en el PC). */
const conexiones = new Map();

export function enviar(usuarioId, evento) {
  const set = conexiones.get(usuarioId);
  if (!set) return;
  const txt = `data: ${JSON.stringify(evento)}\n\n`;
  for (const res of set) res.write(txt);
}
export const enviarATodos = (evento) => {
  for (const id of conexiones.keys()) enviar(id, evento);
};
conAvisos(enviar); // las playlists importadas avisan cuando se les agrega una canción que faltaba

async function amigosDe(usuarioId) {
  const r = await db.query(
    `SELECT CASE WHEN de = $1 THEN para ELSE de END AS id FROM amistades WHERE estado = 'aceptada' AND (de = $1 OR para = $1)`,
    [usuarioId],
  );
  return r.rows.map((x) => Number(x.id));
}

/** Conectado: tiene la app abierta (o la cerró hace menos de 20 s). */
const conectados = new Set();
/** ¿Tiene la app abierta ahora? (lo usa la Party para saber si el anfitrión sigue ahí) */
export const estaConectado = (usuarioId) => conectados.has(Number(usuarioId));
async function avisarPresencia(usuarioId, conectado) {
  if (conectado) conectados.add(usuarioId);
  else conectados.delete(usuarioId);
  for (const amigo of await amigosDe(usuarioId)) enviar(amigo, { tipo: 'presencia', usuario: usuarioId, conectado });
}

// ---------------- Lo que está sonando ----------------

/** usuario → { cancion, titulo, artista, portada, local, posicion, sonando, en } (en = cuándo lo contó, ms). */
const sonando = new Map();
const VIGENTE_MS = 90_000; // sin noticias en 90 s (app cerrada, sin Wi-Fi): se da por pausado

function estadoPublico(usuarioId) {
  const e = sonando.get(usuarioId);
  if (!e) return null;
  const hace = Date.now() - e.en;
  return { ...e, sonando: e.sonando && hace < VIGENTE_MS, hace, en: undefined };
}

async function avisarSonando(usuarioId) {
  const estado = estadoPublico(usuarioId);
  for (const amigo of await amigosDe(usuarioId)) enviar(amigo, { tipo: 'escuchando', usuario: usuarioId, estado });
}

// Cada 30 s: a quien dejó de dar noticias se lo pasa a "en pausa" (y se avisa a sus amigos).
setInterval(() => {
  for (const [id, e] of sonando) {
    if (e.sonando && Date.now() - e.en > VIGENTE_MS) {
      e.sonando = false;
      avisarSonando(id).catch(() => {});
    }
  }
}, 30_000).unref();

// ---------------- Privacidad ----------------

/** usuario → ¿comparte lo que escucha? (se lee de la base una vez y queda en memoria). */
const comparte = new Map();
async function comparteDe(usuarioId) {
  if (!comparte.has(usuarioId)) {
    const r = await db.query('SELECT compartir_escucha FROM usuarios WHERE id = $1', [usuarioId]);
    comparte.set(usuarioId, r.rows[0]?.compartir_escucha ?? true);
  }
  return comparte.get(usuarioId);
}

// ---------------- Quién escucha con quién ----------------

/** anfitrión → Map(oyente → nombre). */
const oyentes = new Map();

function listaOyentes(anfitrion) {
  return [...(oyentes.get(anfitrion) ?? new Map())].map(([id, nombre]) => ({ id, nombre }));
}

/** Avisa al anfitrión quién escucha con él (y, si `nuevo`, quién acaba de llegar). */
function avisarOyentes(anfitrion, nuevo) {
  enviar(anfitrion, { tipo: 'oyentes', lista: listaOyentes(anfitrion), nuevo: nuevo ?? null });
}

/** El oyente deja de escuchar con quien estuviera. */
function soltarOyente(oyente) {
  for (const [anfitrion, mapa] of oyentes) {
    if (mapa.delete(oyente)) {
      if (!mapa.size) oyentes.delete(anfitrion);
      avisarOyentes(anfitrion);
    }
  }
}

/** El anfitrión dejó de compartir: a sus oyentes se les avisa y quedan sueltos. */
function soltarOyentesDe(anfitrion) {
  const mapa = oyentes.get(anfitrion);
  if (!mapa) return;
  oyentes.delete(anfitrion);
  for (const oyente of mapa.keys()) enviar(oyente, { tipo: 'escuchando', usuario: anfitrion, estado: null, privado: true });
  avisarOyentes(anfitrion);
}

// ---------------- Rutas ----------------

const limpiarTexto = (v, max) => (v == null ? null : String(v).slice(0, max));
const N = (x) => Number(x);
/** Fondos animados que se pueden elegir para el perfil (se dibujan en la app, sin archivos). */
const FONDOS_PERFIL = ['ninguno', 'particulas', 'aurora', 'estrellas', 'ondas', 'burbujas'];
/** El estilo del perfil tal como lo ve la app (también decora el nombre en la lista de amigos). */
const estiloDe = (e) => ({ color: e?.color ?? null, fondo: e?.fondo ?? 'ninguno' });

export default async function social(app) {
  /** Flujo de avisos en vivo (Server-Sent Events). */
  app.get('/api/eventos', { preHandler: requiereUsuario }, async (req, reply) => {
    const id = N(req.usuario.id);
    // Las cabeceras ya puestas (CORS para la app de Android, seguridad) se pasan a mano: al tomar la conexión
    // directa (hijack) Fastify ya no las manda solo. Sin esto, la app de Android no recibía los avisos en vivo.
    const previas = reply.getHeaders();
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...previas,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': hola\n\n');
    const recien = !conexiones.has(id);
    if (recien) conexiones.set(id, new Set());
    conexiones.get(id).add(res);
    if (recien) avisarPresencia(id, true).catch(() => {}); // sus amigos ven "Conectado"
    const latido = setInterval(() => res.write(': sigo\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(latido);
      const set = conexiones.get(id);
      set?.delete(res);
      if (set && !set.size) {
        conexiones.delete(id);
        setTimeout(() => {
          if (conexiones.has(id)) return; // volvió a conectarse (un corte corto de Wi-Fi)
          soltarOyente(id);
          avisarPresencia(id, false).catch(() => {}); // sus amigos ven "Sin conexión"
        }, 20_000).unref();
      }
    });
  });

  /** Lo que estoy escuchando ahora (la app lo cuenta al cambiar de canción, pausar, adelantar y cada tanto). */
  app.post('/api/escuchando', { preHandler: requiereUsuario }, async (req) => {
    const b = req.body ?? {};
    const id = N(req.usuario.id);
    if (!(await comparteDe(id))) return { ok: true, compartir: false }; // privado: no se cuenta a nadie
    if (!b.titulo) sonando.delete(id);
    else {
      sonando.set(id, {
        cancion: limpiarTexto(b.cancion, 80), // s:<id> si es del servidor; null si es del teléfono
        titulo: limpiarTexto(b.titulo, 200),
        artista: limpiarTexto(b.artista, 200),
        portada: limpiarTexto(b.portada, 80),
        local: !b.cancion,
        posicion: Math.max(0, Number(b.posicion) || 0),
        duracion: Math.max(0, Number(b.duracion) || 0),
        sonando: !!b.sonando,
        vinilo: !!b.vinilo, // modo vinilo: sus oyentes usan el tocadiscos para oír su scratch
        en: Date.now(),
      });
    }
    await avisarSonando(id);
    return { ok: true };
  });

  /**
   * Scratch del que comparte la música: los movimientos del dedo sobre el disco, en tandas cortas.
   * Se reenvían a sus amigos tal cual; cada oyente los reproduce con un pequeño retraso.
   * g = [[ms desde que apoyó el dedo, 'h' (apoya) | 'n' (mueve) | 'r' (suelta), segundos movidos], …]
   */
  app.post('/api/escuchando/scratch', { preHandler: requiereUsuario }, async (req) => {
    const id = N(req.usuario.id);
    const gesto = String(req.body?.id ?? '').slice(0, 20);
    const g = (Array.isArray(req.body?.g) ? req.body.g : [])
      .slice(0, 300)
      .filter((x) => Array.isArray(x) && ['h', 'n', 'r'].includes(x[1]))
      .map((x) => [Math.max(0, Number(x[0]) || 0), x[1], Math.max(-5, Math.min(5, Number(x[2]) || 0))]);
    if (!gesto || !g.length || !(await comparteDe(id))) return { ok: true };
    for (const amigo of await amigosDe(id)) enviar(amigo, { tipo: 'scratch', usuario: id, id: gesto, g });
    return { ok: true };
  });

  // ---------------- Sugerir una canción ----------------

  /** Pedirle al admin que suba una canción (título y artista). Como mucho 20 por día por cuenta. */
  // ---------------- Invitar amigos a la app (sin depender del admin) ----------------

  /** Mis invitaciones vigentes (sin usar y sin vencer) y cuántas puedo crear todavía. */
  app.get('/api/invitaciones', { preHandler: requiereUsuario }, async (req) => {
    const r = await db.query(
      `SELECT id, codigo, vence FROM invitaciones
        WHERE creada_por = $1 AND usada IS NULL AND vence > now() ORDER BY creada DESC`,
      [req.usuario.id],
    );
    return { invitaciones: r.rows, maximo: MAX_INVITACIONES };
  });

  /** Crea una invitación (sirve una vez, vence en 7 días). Máximo 3 vigentes por usuario. */
  app.post('/api/invitaciones', { preHandler: requiereUsuario }, async (req, reply) => {
    const n = await db.query(`SELECT count(*)::int AS n FROM invitaciones WHERE creada_por = $1 AND usada IS NULL AND vence > now()`, [req.usuario.id]);
    if (n.rows[0].n >= MAX_INVITACIONES)
      return reply.code(409).send({ error: `Ya tienes ${MAX_INVITACIONES} invitaciones sin usar. Anula una o espera a que la usen.` });
    for (;;) {
      try {
        const r = await db.query(
          `INSERT INTO invitaciones (codigo, creada_por, vence) VALUES ($1, $2, now() + make_interval(days => $3))
           RETURNING id, codigo, vence`,
          [nuevoCodigo(), req.usuario.id, DIAS_INVITACION],
        );
        return r.rows[0];
      } catch (e) {
        if (e.code !== '23505') throw e; // código repetido (casi imposible): se genera otro
      }
    }
  });

  /** Anula una invitación mía que nadie ha usado. */
  app.delete('/api/invitaciones/:id', { preHandler: requiereUsuario }, async (req, reply) => {
    const r = await db.query('DELETE FROM invitaciones WHERE id = $1 AND creada_por = $2 AND usada IS NULL', [req.params.id, req.usuario.id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe o ya se usó' });
    return { ok: true };
  });

  /**
   * Sugerir una canción. Formato nuevo: { texto } = "artista", "artista - canción" o un enlace de Spotify/YouTube.
   * El viejo { titulo, artista } sigue aceptándose para las apps que todavía no se actualizaron. La validación que
   * manda es esta (la de la app es solo para avisar al instante).
   */
  app.post('/api/sugerencias', { preHandler: requiereUsuario }, async (req, reply) => {
    const limpio = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
    let titulo = '';
    let artista = '';
    let enlace = null;
    if (typeof req.body?.texto === 'string') {
      const texto = req.body.texto.trim();
      if (!texto) return reply.code(400).send({ error: 'Escribe un artista, una canción o un enlace', campo: 'texto' });
      if (pareceEnlace(texto)) {
        enlace = enlaceSugerenciaValido(texto);
        if (!enlace) return reply.code(400).send({ error: 'Solo enlaces de open.spotify.com, music.youtube.com o www.youtube.com', campo: 'texto' });
      } else {
        const t = limpio(texto, 400);
        const partes = t.split(/ [-–] /); // "artista - canción": lo de antes es el artista, lo de después la canción
        artista = limpio(partes[0], 200);
        titulo = limpio(partes.slice(1).join(' - '), 200);
        if (!artista) return reply.code(400).send({ error: 'Escribe el artista', campo: 'texto' });
      }
    } else {
      titulo = limpio(req.body?.titulo, 200);
      artista = limpio(req.body?.artista, 200);
      if (!titulo) return reply.code(400).send({ error: 'Escribe el título', campo: 'titulo' });
      if (!artista) return reply.code(400).send({ error: 'Escribe el artista', campo: 'artista' });
    }
    const hoy = await db.query("SELECT count(*)::int AS n FROM sugerencias WHERE usuario_id = $1 AND creada > now() - interval '1 day'", [req.usuario.id]);
    if (hoy.rows[0].n >= 20) return reply.code(429).send({ error: 'Ya enviaste muchas hoy. Prueba mañana.' });
    // Duplicado: el mismo enlace, o el mismo artista y canción, ya pendientes de esta persona.
    const ya = enlace
      ? await db.query("SELECT 1 FROM sugerencias WHERE usuario_id = $1 AND estado = 'pendiente' AND enlace = $2", [req.usuario.id, enlace])
      : await db.query(
          "SELECT 1 FROM sugerencias WHERE usuario_id = $1 AND estado = 'pendiente' AND enlace IS NULL AND lower(titulo) = lower($2) AND lower(artista) = lower($3)",
          [req.usuario.id, titulo, artista],
        );
    if (!ya.rowCount) await db.query('INSERT INTO sugerencias (usuario_id, titulo, artista, enlace) VALUES ($1, $2, $3, $4)', [req.usuario.id, titulo, artista, enlace]);
    return { ok: true };
  });

  /** Reportar una canción del servidor (con un comentario). Le llega al administrador en el panel. */
  app.post('/api/reportes', { preHandler: requiereUsuario }, async (req, reply) => {
    const cancion = String(req.body?.cancion ?? '').replace(/^s:/, '');
    const comentario = String(req.body?.comentario ?? '')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 500);
    if (!/^[\w-]{6,40}$/.test(cancion)) return reply.code(400).send({ error: 'Canción inválida' });
    if (!comentario) return reply.code(400).send({ error: 'Cuéntanos qué tiene la canción' });
    const existe = await db.query('SELECT 1 FROM canciones WHERE id = $1', [cancion]);
    if (!existe.rowCount) return reply.code(404).send({ error: 'Esa canción ya no está en el servidor' });
    const hoy = await db.query("SELECT count(*)::int AS n FROM reportes WHERE usuario_id = $1 AND creado > now() - interval '1 day'", [req.usuario.id]);
    if (hoy.rows[0].n >= 30) return reply.code(429).send({ error: 'Ya enviaste muchos reportes hoy. Prueba mañana.' });
    await db.query('INSERT INTO reportes (cancion, usuario_id, comentario) VALUES ($1, $2, $3)', [cancion, req.usuario.id, comentario]);
    return { ok: true };
  });

  // ---------------- Escuchar juntos y privacidad ----------------

  /**
   * Empiezo (con = id del amigo) o dejo (con = null) de escuchar con alguien. Al anfitrión le llega el aviso
   * "X está escuchando contigo".
   */
  app.post('/api/juntos', { preHandler: requiereUsuario }, async (req, reply) => {
    const yo = N(req.usuario.id);
    soltarOyente(yo);
    void juntosTermina(yo); // estadísticas: termina la sesión anterior (si había)
    const con = req.body?.con == null ? null : N(req.body.con);
    if (con === null) return { ok: true };
    if (!(await amigosDe(yo)).includes(con)) return reply.code(403).send({ error: 'Solo puedes escuchar con tus amigos' });
    if (!(await comparteDe(con))) return reply.code(403).send({ error: 'No comparte lo que escucha' });
    if (!oyentes.has(con)) oyentes.set(con, new Map());
    oyentes.get(con).set(yo, req.usuario.nombre);
    avisarOyentes(con, req.usuario.nombre);
    void juntosEmpieza(con, yo);
    return { ok: true };
  });

  /** ¿Comparto lo que escucho? ¿Muestro mis amigos en mi perfil? (Configuración) y quién escucha conmigo ahora. */
  app.get('/api/privacidad', { preHandler: requiereUsuario }, async (req) => {
    const yo = N(req.usuario.id);
    const m = await db.query('SELECT mostrar_amigos FROM usuarios WHERE id = $1', [yo]);
    return { compartir: await comparteDe(yo), mostrarAmigos: m.rows[0]?.mostrar_amigos !== false, oyentes: listaOyentes(yo) };
  });

  /** Cada ajuste es opcional: solo se cambia lo que viene (las apps viejas mandan solo `compartir`). */
  app.put('/api/privacidad', { preHandler: requiereUsuario }, async (req) => {
    const yo = N(req.usuario.id);
    const out = {};
    if (req.body?.mostrarAmigos !== undefined) {
      out.mostrarAmigos = req.body.mostrarAmigos !== false;
      await db.query('UPDATE usuarios SET mostrar_amigos = $2 WHERE id = $1', [yo, out.mostrarAmigos]);
    }
    if (req.body?.compartir === undefined) return out;
    const compartir = req.body.compartir !== false;
    await db.query('UPDATE usuarios SET compartir_escucha = $2 WHERE id = $1', [yo, compartir]);
    comparte.set(yo, compartir);
    if (!compartir) {
      sonando.delete(yo);
      soltarOyentesDe(yo);
    }
    // Sus amigos actualizan la lista (ven "no comparte" o vuelven a ver lo que escucha).
    for (const amigo of await amigosDe(yo)) enviar(amigo, { tipo: 'amigos' });
    return { ...out, compartir };
  });

  // ---------------- Amigos ----------------

  /** Mis amigos (con lo que escuchan), las solicitudes que me llegaron y las que mandé. */
  app.get('/api/amigos', { preHandler: requiereUsuario }, async (req) => {
    const yo = N(req.usuario.id);
    const r = await db.query(
      `SELECT a.id AS amistad, a.estado, a.de, u.id, u.nombre, u.foto, u.compartir_escucha, u.perfil_estilo
         FROM amistades a JOIN usuarios u ON u.id = CASE WHEN a.de = $1 THEN a.para ELSE a.de END
        WHERE a.de = $1 OR a.para = $1
        ORDER BY lower(u.nombre)`,
      [yo],
    );
    const out = { amigos: [], recibidas: [], enviadas: [] };
    for (const x of r.rows) {
      const u = { amistad: N(x.amistad), id: N(x.id), nombre: x.nombre, foto: x.foto ?? null, estilo: estiloDe(x.perfil_estilo) };
      if (x.estado === 'aceptada') {
        comparte.set(N(x.id), x.compartir_escucha);
        out.amigos.push({ ...u, comparte: x.compartir_escucha, conectado: conectados.has(N(x.id)), escuchando: x.compartir_escucha ? estadoPublico(N(x.id)) : null });
      }
      else if (N(x.de) === yo) out.enviadas.push(u);
      else out.recibidas.push(u);
    }
    return out;
  });

  /** Buscar usuarios por nombre (para agregarlos). Nunca muestra la cuenta de administrador. */
  app.get('/api/usuarios', { preHandler: requiereUsuario }, async (req) => {
    const q = String(req.query?.q ?? '').trim().toLowerCase().replace(/^@+/, '');
    if (!q) return [];
    const r = await db.query(
      `SELECT id, nombre, foto FROM usuarios
        WHERE NOT es_admin AND id <> $1 AND nombre_clave LIKE $2 || '%'
        ORDER BY nombre_clave = $2 DESC, length(nombre_clave), nombre_clave LIMIT 8`,
      [req.usuario.id, q.replace(/[%_\\]/g, '')],
    );
    return r.rows.map((u) => ({ id: N(u.id), nombre: u.nombre, foto: u.foto ?? null }));
  });

  /** Mandar una solicitud. Si esa persona ya me había mandado una, quedamos amigos al tiro. */
  app.post('/api/amigos', { preHandler: requiereUsuario }, async (req, reply) => {
    const yo = N(req.usuario.id);
    const nombre = String(req.body?.nombre ?? '').trim().toLowerCase().replace(/^@+/, '');
    const u = await db.query('SELECT id, nombre FROM usuarios WHERE nombre_clave = $1 AND NOT es_admin', [nombre]);
    if (!u.rowCount) return reply.code(404).send({ error: 'No existe ese usuario' });
    const otro = N(u.rows[0].id);
    if (otro === yo) return reply.code(400).send({ error: 'Ese eres tú' });
    const ya = await db.query('SELECT id, de, estado FROM amistades WHERE LEAST(de, para) = LEAST($1::bigint, $2::bigint) AND GREATEST(de, para) = GREATEST($1::bigint, $2::bigint)', [yo, otro]);
    if (ya.rowCount) {
      const a = ya.rows[0];
      if (a.estado === 'aceptada') return reply.code(409).send({ error: `Ya eres amigo de ${u.rows[0].nombre}` });
      if (N(a.de) === yo) return reply.code(409).send({ error: 'Ya le mandaste una solicitud' });
      await db.query("UPDATE amistades SET estado = 'aceptada', aceptada = now() WHERE id = $1", [a.id]);
    } else {
      await db.query('INSERT INTO amistades (de, para) VALUES ($1, $2)', [yo, otro]);
    }
    enviar(otro, { tipo: 'amigos' });
    enviar(yo, { tipo: 'amigos' });
    return { ok: true };
  });

  /** Aceptar una solicitud que me llegó. */
  app.post('/api/amigos/:amistad/aceptar', { preHandler: requiereUsuario }, async (req, reply) => {
    const r = await db.query(
      "UPDATE amistades SET estado = 'aceptada', aceptada = now() WHERE id = $1 AND para = $2 AND estado = 'pendiente' RETURNING de",
      [req.params.amistad, req.usuario.id],
    );
    if (!r.rowCount) return reply.code(404).send({ error: 'La solicitud ya no existe' });
    enviar(N(r.rows[0].de), { tipo: 'amigos' });
    enviar(N(req.usuario.id), { tipo: 'amigos' });
    return { ok: true };
  });

  /** Rechazar una solicitud, cancelar una que mandé o dejar de ser amigos. */
  app.delete('/api/amigos/:amistad', { preHandler: requiereUsuario }, async (req, reply) => {
    const r = await db.query('DELETE FROM amistades WHERE id = $1 AND (de = $2 OR para = $2) RETURNING de, para', [req.params.amistad, req.usuario.id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'Ya no existe' });
    for (const [a, b] of [[N(r.rows[0].de), N(r.rows[0].para)], [N(r.rows[0].para), N(r.rows[0].de)]]) {
      if (oyentes.get(a)?.delete(b)) avisarOyentes(a);
    }
    enviar(N(r.rows[0].de), { tipo: 'amigos' });
    enviar(N(r.rows[0].para), { tipo: 'amigos' });
    return { ok: true };
  });

  // ---------------- Perfil ----------------

  /**
   * Perfil de una persona (o el mío, con `yo`): foto, nombre, descripción, cuántas playlists públicas tiene, sus
   * amigos y qué relación tengo con ella (amigos, solicitud enviada o recibida). Lo ve cualquiera con sesión.
   * La cuenta de administrador no tiene perfil público.
   */
  app.get('/api/perfil/:id', { preHandler: requiereUsuario }, async (req, reply) => {
    const yo = N(req.usuario.id);
    const id = req.params.id === 'yo' ? yo : N(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return reply.code(404).send({ error: 'No existe ese usuario' });
    const u = await db.query('SELECT id, nombre, foto, banner, descripcion, perfil_estilo, es_admin, creado, mostrar_amigos FROM usuarios WHERE id = $1', [id]);
    if (!u.rowCount || (u.rows[0].es_admin && id !== yo)) return reply.code(404).send({ error: 'No existe ese usuario' });
    const [amigos, pls, rel, insignias] = await Promise.all([
      db.query(
        `SELECT u.id, u.nombre, u.foto FROM amistades a JOIN usuarios u ON u.id = CASE WHEN a.de = $1 THEN a.para ELSE a.de END
          WHERE (a.de = $1 OR a.para = $1) AND a.estado = 'aceptada' AND NOT u.es_admin
          ORDER BY lower(u.nombre)`,
        [id],
      ),
      db.query(
        `SELECT count(*)::int AS n FROM playlists p
          WHERE p.usuario_id = $1 AND p.publica AND NOT p.borrada AND EXISTS (SELECT 1 FROM playlist_canciones c WHERE c.playlist_id = p.id)`,
        [id],
      ),
      id === yo
        ? null
        : db.query(
            'SELECT id, de, estado FROM amistades WHERE LEAST(de, para) = LEAST($1::bigint, $2::bigint) AND GREATEST(de, para) = GREATEST($1::bigint, $2::bigint)',
            [yo, id],
          ),
      insigniasDe([id]),
    ]);
    const a = rel?.rows[0];
    const relacion = id === yo ? 'yo' : !a ? null : a.estado === 'aceptada' ? 'amigos' : N(a.de) === yo ? 'enviada' : 'recibida';
    const x = u.rows[0];
    // Privacidad: quien ocultó sus amigos los sigue viendo en su propio perfil; los demás, no (ni cuántos son).
    const amigosOcultos = x.mostrar_amigos === false && id !== yo;
    return {
      id,
      nombre: x.nombre,
      foto: x.foto ?? null,
      banner: x.banner ?? null,
      descripcion: x.descripcion ?? '',
      estilo: estiloDe(x.perfil_estilo),
      // La insignia de amigos dice cuántos tiene: con los amigos ocultos, tampoco se muestra.
      insignias: (insignias.get(id) ?? []).filter((i) => !(amigosOcultos && i.id === 'amigos')),
      desde: x.creado ? new Date(x.creado).getTime() : null,
      playlists: pls.rows[0].n,
      amigos: amigosOcultos ? [] : amigos.rows.map((f) => ({ id: N(f.id), nombre: f.nombre, foto: f.foto ?? null })),
      amigosOcultos,
      relacion,
      amistad: a ? N(a.id) : null,
    };
  });

  /**
   * Editar mi perfil: descripción (hasta 300 caracteres; sin caracteres de control salvo saltos de línea) y/o
   * estilo ({ color: '#rrggbb' | null, fondo: uno de FONDOS_PERFIL }). Lo que no viene no se cambia.
   */
  app.put('/api/perfil', { preHandler: requiereUsuario }, async (req, reply) => {
    const b = req.body ?? {};
    const out = {};
    if (b.descripcion !== undefined) {
      out.descripcion = String(b.descripcion ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 300);
      await db.query('UPDATE usuarios SET descripcion = $1 WHERE id = $2', [out.descripcion, req.usuario.id]);
    }
    if (b.estilo !== undefined) {
      const e = b.estilo ?? {};
      if (e.color != null && !/^#[0-9a-f]{6}$/i.test(String(e.color))) return reply.code(400).send({ error: 'Color inválido' });
      if (e.fondo != null && !FONDOS_PERFIL.includes(String(e.fondo))) return reply.code(400).send({ error: 'Fondo inválido' });
      out.estilo = { color: e.color ? String(e.color).toLowerCase() : null, fondo: e.fondo ? String(e.fondo) : 'ninguno' };
      await db.query('UPDATE usuarios SET perfil_estilo = $1 WHERE id = $2', [out.estilo, req.usuario.id]);
    }
    return out;
  });

  // ---------------- Playlists de la cuenta ----------------

  const filaPlaylist = (p) => ({
    id: p.id,
    nombre: p.nombre,
    canciones: p.canciones ?? [],
    publica: p.publica,
    borrada: p.borrada,
    creada: new Date(p.creada).getTime(),
    actualizada: new Date(p.actualizada).getTime(),
    reproducida: p.reproducida ? new Date(p.reproducida).getTime() : null,
    foto: p.foto ?? null,
    origen: p.origen ?? null,
    faltan: p.faltan ?? 0,
    fijada: p.fijada ? new Date(p.fijada).getTime() : null,
  });
  const CON_CANCIONES = `p.*, (SELECT array_agg(c.cancion ORDER BY c.posicion) FROM playlist_canciones c WHERE c.playlist_id = p.id) AS canciones,
    (SELECT count(*)::int FROM playlist_faltantes f WHERE f.playlist_id = p.id) AS faltan`;

  // ---------------- Importar de Spotify ----------------

  /** Cuándo importó cada cuenta por última vez (para no pedirle a Spotify en ráfaga). */
  const ultimaImportacion = new Map();
  /** Cuentas con una tanda de canciones pegadas en curso. */
  const completando = new Set();

  /**
   * Importar una playlist pública de Spotify: { enlace }. Se crea en la cuenta con las canciones que ya están en
   * el servidor; las que faltan quedan esperando y se agregan solas cuando se suben (ver importarPlaylist.js).
   */
  app.post('/api/playlists/importar', { preHandler: requiereUsuario }, async (req, reply) => {
    const enlace = String(req.body?.enlace ?? '').trim().slice(0, 300);
    const spotify = idPlaylistSpotify(enlace);
    if (!spotify) return reply.code(400).send({ error: 'Pega el enlace de una playlist de Spotify (open.spotify.com/playlist/…)' });
    const yo = N(req.usuario.id);
    if (Date.now() - (ultimaImportacion.get(yo) ?? 0) < 10_000) return reply.code(429).send({ error: 'Espera unos segundos antes de importar otra' });
    ultimaImportacion.set(yo, Date.now());
    let leida;
    try {
      leida = await leerPlaylistSpotify(spotify);
    } catch (e) {
      req.log.warn({ err: e.message }, 'importar: no se pudo leer la playlist de Spotify');
      // Nunca 502/503/504: la app los toma como "servidor caído" y muestra "No hay conexión con el servidor".
      if (e.codigo === 404) return reply.code(404).send({ error: e.message });
      if (e.codigo === 429) return reply.code(429).send({ error: 'Spotify está recibiendo muchas importaciones. Prueba de nuevo en un minuto.' });
      return reply.code(424).send({ error: 'Spotify no respondió. Prueba de nuevo en un rato.' });
    }
    if (!leida.canciones.length) return reply.code(400).send({ error: 'Esa playlist está vacía' });
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const nombre = String(leida.nombre).trim().slice(0, 60) || 'Playlist de Spotify';
    const r = await guardarImportada({ usuarioId: yo, id, nombre, origen: `https://open.spotify.com/playlist/${spotify}`, canciones: leida.canciones });
    req.log.info({ playlist: id, leidas: leida.canciones.length, total: leida.total, ...r }, 'playlist importada de Spotify');
    const p = await db.query(`SELECT ${CON_CANCIONES} FROM playlists p WHERE id = $1`, [id]);
    return { playlist: filaPlaylist(p.rows[0]), ...r, leidas: leida.canciones.length, total: leida.total, completa: leida.completa };
  });

  /**
   * Completar una playlist importada con canciones pegadas: { texto } = los enlaces que copia Spotify (Ctrl+A,
   * Ctrl+C en la playlist) o líneas "Artista - Canción". Sirve para las que pasan de 100: lo que ya estaba no se
   * repite, así que se puede pegar la playlist entera.
   */
  app.post('/api/playlists/:id/completar', { preHandler: requiereUsuario }, async (req, reply) => {
    const mia = await db.query('SELECT 1 FROM playlists WHERE id = $1 AND usuario_id = $2 AND NOT borrada', [req.params.id, req.usuario.id]);
    if (!mia.rowCount) return reply.code(404).send({ error: 'No existe' });
    // La app manda lo pegado en tandas de 50, una tras otra; de a una tanda por cuenta.
    const yo = N(req.usuario.id);
    if (completando.has(yo)) return reply.code(429).send({ error: 'Ya se está completando una playlist' });
    completando.add(yo);
    let leidas;
    try {
      leidas = await leerCancionesPegadas(String(req.body?.texto ?? '').slice(0, 200_000));
    } finally {
      completando.delete(yo);
    }
    if (!leidas.canciones.length) {
      return reply.code(400).send({ error: leidas.lineas ? 'Spotify no respondió. Prueba de nuevo en un rato.' : 'No encontré canciones en lo que pegaste. Pega los enlaces que copia Spotify.' });
    }
    const r = await completarImportada(req.params.id, leidas.canciones);
    if (!r) return reply.code(404).send({ error: 'No existe' });
    req.log.info({ playlist: req.params.id, pegadas: leidas.lineas, noLeidas: leidas.noLeidas, ...r }, 'playlist importada completada');
    const p = await db.query(`SELECT ${CON_CANCIONES} FROM playlists p WHERE id = $1`, [req.params.id]);
    return { playlist: filaPlaylist(p.rows[0]), ...r, pegadas: leidas.lineas, noLeidas: leidas.noLeidas };
  });

  /** Lo que falta de una playlist mía importada (canciones que todavía no están en el servidor). */
  app.get('/api/playlists/:id/faltantes', { preHandler: requiereUsuario }, async (req, reply) => {
    const mia = await db.query('SELECT 1 FROM playlists WHERE id = $1 AND usuario_id = $2', [req.params.id, req.usuario.id]);
    if (!mia.rowCount) return reply.code(404).send({ error: 'No existe' });
    return faltantesDe(req.params.id);
  });

  /** Dejar de esperar una canción que falta (ya no se agregará sola). */
  app.delete('/api/playlists/:id/faltantes/:faltante', { preHandler: requiereUsuario }, async (req) => {
    await db.query(
      `DELETE FROM playlist_faltantes f USING playlists p
        WHERE f.id = $1 AND f.playlist_id = $2 AND p.id = f.playlist_id AND p.usuario_id = $3`,
      [Number(req.params.faltante) || 0, req.params.id, req.usuario.id],
    );
    return { ok: true };
  });

  /** Todas mis playlists (también las borradas, para que los otros aparatos se enteren). */
  app.get('/api/playlists', { preHandler: requiereUsuario }, async (req) => {
    const r = await db.query(`SELECT ${CON_CANCIONES} FROM playlists p WHERE usuario_id = $1`, [req.usuario.id]);
    return r.rows.map(filaPlaylist);
  });

  /** Guardar una playlist (crear o cambiar). Gana la versión más nueva. */
  app.put('/api/playlists/:id', { preHandler: requiereUsuario }, async (req, reply) => {
    const id = String(req.params.id);
    if (!/^[a-z0-9]{4,40}$/i.test(id)) return reply.code(400).send({ error: 'Id inválido' });
    const b = req.body ?? {};
    const nombre = String(b.nombre ?? '').trim().slice(0, 60) || 'Mi playlist';
    const canciones = (Array.isArray(b.canciones) ? b.canciones : []).map((x) => String(x).slice(0, 80)).slice(0, 5000);
    const actualizada = new Date(Number(b.actualizada) || Date.now());
    // Fijada en la barra (cuándo se fijó; null = no). Las apps viejas no la mandan: entonces no se toca.
    const traeFijada = b.fijada !== undefined;
    const fijada = traeFijada && b.fijada ? new Date(Number(b.fijada) || Date.now()) : null;
    const c = await db.connect();
    let publicaAntes = false;
    let cambio = false;
    try {
      await c.query('BEGIN');
      const ya = await c.query('SELECT usuario_id, actualizada, publica FROM playlists WHERE id = $1 FOR UPDATE', [id]);
      if (ya.rowCount && N(ya.rows[0].usuario_id) !== N(req.usuario.id)) {
        await c.query('ROLLBACK');
        return reply.code(409).send({ error: 'Esa playlist es de otra cuenta' });
      }
      publicaAntes = !!ya.rows[0]?.publica;
      const reproducida = b.reproducida ? new Date(Number(b.reproducida)) : null;
      if (!ya.rowCount || new Date(ya.rows[0].actualizada) <= actualizada) {
        cambio = true;
        await c.query(
          `INSERT INTO playlists (id, usuario_id, nombre, creada, actualizada, reproducida, publica, borrada, fijada)
           VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
           ON CONFLICT (id) DO UPDATE SET nombre = $3, actualizada = $5, publica = $7, borrada = false,
             reproducida = GREATEST(playlists.reproducida, $6),
             fijada = CASE WHEN $9 THEN $8 ELSE playlists.fijada END`,
          [id, req.usuario.id, nombre, new Date(Number(b.creada) || Date.now()), actualizada, reproducida, !!b.publica, fijada, traeFijada],
        );
        await c.query('DELETE FROM playlist_canciones WHERE playlist_id = $1', [id]);
        if (canciones.length) {
          await c.query(
            'INSERT INTO playlist_canciones (playlist_id, posicion, cancion) SELECT $1, i - 1, x FROM unnest($2::text[]) WITH ORDINALITY AS t(x, i)',
            [id, canciones],
          );
        }
      } else if (reproducida) {
        await c.query('UPDATE playlists SET reproducida = GREATEST(reproducida, $2) WHERE id = $1', [id, reproducida]);
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    if (cambio && (publicaAntes || b.publica)) enviarATodos({ tipo: 'comunidad' });
    const r = await db.query(`SELECT ${CON_CANCIONES} FROM playlists p WHERE id = $1`, [id]);
    return filaPlaylist(r.rows[0]);
  });

  /** Borrar una playlist (queda marcada como borrada para los otros aparatos). */
  app.delete('/api/playlists/:id', { preHandler: requiereUsuario }, async (req) => {
    const r = await db.query(
      'UPDATE playlists SET borrada = true, actualizada = now() WHERE id = $1 AND usuario_id = $2 RETURNING publica',
      [req.params.id, req.usuario.id],
    );
    await db.query('DELETE FROM playlist_canciones WHERE playlist_id = $1 AND EXISTS (SELECT 1 FROM playlists WHERE id = $1 AND usuario_id = $2)', [req.params.id, req.usuario.id]);
    await db.query('DELETE FROM playlist_faltantes WHERE playlist_id = $1 AND EXISTS (SELECT 1 FROM playlists WHERE id = $1 AND usuario_id = $2)', [req.params.id, req.usuario.id]);
    if (r.rows[0]?.publica) enviarATodos({ tipo: 'comunidad' });
    return { ok: true };
  });

  /** "De la comunidad": las playlists públicas de los demás usuarios (de todos, no solo amigos). */
  app.get('/api/comunidad/playlists', { preHandler: requiereUsuario }, async (req) => {
    const yo = N(req.usuario.id);
    const amigos = new Set(await amigosDe(yo));
    const r = await db.query(
      `SELECT ${CON_CANCIONES}, u.nombre AS dueno
         FROM playlists p JOIN usuarios u ON u.id = p.usuario_id
        WHERE p.publica AND NOT p.borrada AND p.usuario_id <> $1
        ORDER BY p.actualizada DESC LIMIT 200`,
      [yo],
    );
    return r.rows
      .map((p) => ({ ...filaPlaylist(p), dueno: p.dueno, duenoId: N(p.usuario_id), deAmigo: amigos.has(N(p.usuario_id)) }))
      .filter((p) => p.canciones.length);
  });
}
