import { createHash, randomBytes } from 'node:crypto';
import { db } from './db.js';
import { bloqueado, hashClave, limpiarFallosDe, registrarFallo, validarClave } from './auth.js';

/**
 * Enlaces para poner una contraseña nueva. zuih genera uno en el panel (Usuarios → Restablecer contraseña) y se
 * lo manda a la persona; ella abre https://musica.empanados.io/clave/#<token> y escribe su propia contraseña.
 *  - Un solo uso y vence en 24 horas. Generar otro anula el anterior.
 *  - El token va después del "#": el navegador no lo manda al pedir la página, así no queda en registros.
 *  - En la base solo queda su huella (sha256).
 */
export const HORAS_ENLACE = 24;
const huella = (t) => createHash('sha256').update(String(t)).digest();
const tokenValido = (t) => typeof t === 'string' && /^[\w-]{40,60}$/.test(t);

/** Crea un enlace para la cuenta (borra los anteriores). Devuelve el token, o null si no existe o es el admin. */
export async function crearEnlaceClave(usuarioId) {
  const u = await db.query('SELECT nombre FROM usuarios WHERE id = $1 AND NOT es_admin', [usuarioId]);
  if (!u.rowCount) return null;
  const token = randomBytes(32).toString('base64url');
  await db.query('DELETE FROM enlaces_clave WHERE usuario_id = $1', [usuarioId]);
  const r = await db.query(
    `INSERT INTO enlaces_clave (token_hash, usuario_id, vence) VALUES ($1, $2, now() + make_interval(hours => $3)) RETURNING vence`,
    [huella(token), usuarioId, HORAS_ENLACE],
  );
  return { token, nombre: u.rows[0].nombre, vence: r.rows[0].vence };
}

// Se borran los vencidos al arrancar y cada 6 horas.
const limpiar = () => db.query('DELETE FROM enlaces_clave WHERE vence < now()').catch(() => {});
setTimeout(limpiar, 60_000).unref();
setInterval(limpiar, 6 * 3600_000).unref();

const buscar = (token) =>
  db.query(
    `SELECT e.usuario_id, u.nombre, u.nombre_clave FROM enlaces_clave e JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.token_hash = $1 AND e.vence > now() AND NOT u.es_admin`,
    [huella(token)],
  );

/** Rutas públicas (sin sesión) que usa la página /clave/. Un token malo cuenta como intento fallido. */
export function rutasEnlaceClave(app) {
  const NO_SIRVE = 'Este enlace ya no sirve: venció o ya se usó. Pide uno nuevo.';

  app.post('/api/clave/enlace', async (req, reply) => {
    const llave = `${req.ip}|#enlace-clave`;
    if (bloqueado(llave)) return reply.code(429).send({ error: 'Demasiados intentos. Espera 5 minutos.' });
    const t = req.body?.token;
    const r = tokenValido(t) ? await buscar(t) : null;
    if (!r?.rowCount) {
      registrarFallo(llave);
      return reply.code(404).send({ error: NO_SIRVE });
    }
    return { nombre: r.rows[0].nombre };
  });

  app.post('/api/clave/nueva', async (req, reply) => {
    const llave = `${req.ip}|#enlace-clave`;
    if (bloqueado(llave)) return reply.code(429).send({ error: 'Demasiados intentos. Espera 5 minutos.' });
    const t = req.body?.token;
    if (!tokenValido(t)) {
      registrarFallo(llave);
      return reply.code(404).send({ error: NO_SIRVE });
    }
    const e = validarClave(req.body?.clave);
    if (e) return reply.code(400).send({ error: e });
    const hash = await hashClave(String(req.body.clave));
    // Se borra el enlace y se cambia la clave en un solo paso: dos pestañas a la vez no pueden usarlo dos veces.
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query(
        `DELETE FROM enlaces_clave e USING usuarios u
          WHERE e.token_hash = $1 AND u.id = e.usuario_id AND e.vence > now() AND NOT u.es_admin
          RETURNING u.id, u.nombre, u.nombre_clave`,
        [huella(t)],
      );
      if (!r.rowCount) {
        await c.query('ROLLBACK');
        registrarFallo(llave);
        return reply.code(404).send({ error: NO_SIRVE });
      }
      const u = r.rows[0];
      await c.query('UPDATE usuarios SET clave_hash = $2 WHERE id = $1', [u.id, hash]);
      const s = await c.query('DELETE FROM sesiones WHERE usuario_id = $1', [u.id]);
      await c.query('COMMIT');
      limpiarFallosDe(u.nombre_clave);
      req.log.info({ usuario: u.nombre, sesionesCerradas: s.rowCount }, 'contraseña nueva puesta con enlace');
      return { ok: true, nombre: u.nombre };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  });
}
