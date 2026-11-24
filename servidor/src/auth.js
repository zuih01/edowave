import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

/**
 * Cuentas y sesiones.
 *  - Contraseñas: scrypt con sal aleatoria (nunca se guardan en texto).
 *  - Sesión: un token aleatorio que el aparato guarda; en la base solo queda su huella (sha256).
 *    Si alguien leyera la base de datos, no podría usar las sesiones.
 *  - Intentos fallidos: 5 seguidos bloquean ese usuario/aparato 5 minutos.
 */

const scryptAsync = promisify(scrypt);
const N = 32768, R = 8, P = 1, LEN = 64;

/** @param {string} clave */
export async function hashClave(clave) {
  const sal = randomBytes(16);
  const h = /** @type {Buffer} */ (await scryptAsync(clave.normalize('NFC'), sal, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }));
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${h.toString('base64')}`;
}

/** @param {string} clave @param {string} guardado */
export async function verificarClave(clave, guardado) {
  const [tipo, n, r, p, sal, hash] = guardado.split('$');
  if (tipo !== 'scrypt') return false;
  const esperado = Buffer.from(hash, 'base64');
  const h = /** @type {Buffer} */ (
    await scryptAsync(clave.normalize('NFC'), Buffer.from(sal, 'base64'), esperado.length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 })
  );
  return timingSafeEqual(h, esperado);
}

const huella = (/** @type {string} */ token) => createHash('sha256').update(token).digest();

/** Crea una sesión para el usuario y devuelve el token (solo se muestra esta vez). */
export async function abrirSesion(usuarioId, aparato) {
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sesiones (usuario_id, token_hash, aparato) VALUES ($1, $2, $3)', [usuarioId, huella(token), String(aparato ?? '').slice(0, 80) || null]);
  return token;
}

export async function cerrarSesion(token) {
  await db.query('DELETE FROM sesiones WHERE token_hash = $1', [huella(token)]);
}

const tokenDe = (req) => {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

/** Una sesión sin usar durante este tiempo deja de servir (hay que volver a entrar). */
const DIAS_SESION = 90;
// Las sesiones vencidas se borran al arrancar y una vez al día.
const limpiarSesiones = () => db.query('DELETE FROM sesiones WHERE ultimo_uso < now() - make_interval(days => $1)', [DIAS_SESION]).catch(() => {});
setTimeout(limpiarSesiones, 30_000).unref();
setInterval(limpiarSesiones, 24 * 3600_000).unref();

/** Usuario de la petición (o null). Actualiza el "último uso" de la sesión como mucho una vez por minuto. */
export async function usuarioDe(req) {
  const token = tokenDe(req);
  if (!token) return null;
  const q = await db.query(
    `SELECT u.id, u.nombre, u.foto, u.es_admin, u.puede_admin, s.id AS sesion_id, s.ultimo_uso < now() - interval '1 minute' AS viejo
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.ultimo_uso > now() - make_interval(days => $2)`,
    [huella(token), DIAS_SESION],
  );
  const u = q.rows[0];
  if (!u) return null;
  if (u.viejo) await db.query('UPDATE sesiones SET ultimo_uso = now() WHERE id = $1', [u.sesion_id]);
  delete u.viejo;
  return u;
}

/** Para las rutas que necesitan sesión: deja el usuario en `req.usuario` o responde 401. */
export async function requiereUsuario(req, reply) {
  const u = await usuarioDe(req);
  if (!u) return reply.code(401).send({ error: 'Inicia sesión' });
  req.usuario = u;
}

/** Para el panel de admin: además tiene que ser la cuenta de administrador. */
export async function requiereAdmin(req, reply) {
  const u = await usuarioDe(req);
  if (!u) return reply.code(401).send({ error: 'Inicia sesión' });
  // La cuenta de administrador, o una cuenta normal a la que se le dio acceso al panel (puede_admin).
  if (!u.es_admin && !u.puede_admin) return reply.code(403).send({ error: 'Solo la cuenta de administrador' });
  req.usuario = u;
}

// ---------------- Intentos fallidos ----------------

const fallos = new Map(); // clave → { n, hasta }
const MAX_FALLOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;

export function bloqueado(clave) {
  const f = fallos.get(clave);
  return !!f && f.hasta > Date.now();
}
export function registrarFallo(clave) {
  const f = fallos.get(clave) ?? { n: 0, hasta: 0 };
  f.n++;
  if (f.n >= MAX_FALLOS) {
    f.hasta = Date.now() + BLOQUEO_MS;
    f.n = 0;
  }
  fallos.set(clave, f);
}
export const limpiarFallos = (clave) => fallos.delete(clave);

// ---------------- Validaciones ----------------

/** Nombre de usuario: 3–24 letras, números, punto, guion o guion bajo. */
export function validarNombre(nombre) {
  const n = String(nombre ?? '').trim();
  if (!/^[\p{L}\p{N}._-]{3,24}$/u.test(n)) return { error: 'El nombre debe tener de 3 a 24 letras o números (también . _ -)' };
  return { nombre: n, clave: n.toLowerCase() };
}
export function validarClave(clave) {
  const c = String(clave ?? '');
  if (c.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (c.length > 200) return 'La contraseña es demasiado larga';
  return null;
}

/** ¿La petición viene de la red de casa (o del mismo equipo)? */
export function esRedLocal(ip) {
  const v = String(ip ?? '').replace(/^::ffff:/, '');
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v) || v === '::1';
}

/** Borra los intentos fallidos de una cuenta desde cualquier aparato (al restablecer su contraseña). */
export function limpiarFallosDe(nombreClave) {
  for (const k of fallos.keys()) if (k.endsWith(`|${nombreClave}`)) fallos.delete(k);
}
