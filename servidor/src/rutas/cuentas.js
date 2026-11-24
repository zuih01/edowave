import { db } from '../db.js';
import { rutasFoto } from './fotoPerfil.js';
import { rutasEnlaceClave } from '../enlacesClave.js';
import {
  abrirSesion,
  bloqueado,
  cerrarSesion,
  esRedLocal,
  hashClave,
  limpiarFallos,
  registrarFallo,
  requiereUsuario,
  validarClave,
  validarNombre,
  verificarClave,
} from '../auth.js';

/** Inicio de sesión, registro con código de invitación y creación de la cuenta de administrador. */
export default async function cuentas(app) {
  rutasFoto(app);
  rutasEnlaceClave(app);
  // ¿Ya existe la cuenta de administrador? (la página de admin muestra "crear" o "entrar")
  app.get('/api/admin/estado', async () => {
    const r = await db.query('SELECT count(*)::int AS n FROM usuarios WHERE es_admin');
    return { hayAdmin: r.rows[0].n > 0 };
  });

  // Primera vez: crear la cuenta de administrador. Solo si no existe ninguna y desde la red de casa.
  app.post('/api/admin/crear', async (req, reply) => {
    if (!esRedLocal(req.ip)) return reply.code(403).send({ error: 'Solo desde la red de casa' });
    const v = validarNombre(req.body?.nombre);
    if (v.error) return reply.code(400).send({ error: v.error });
    const e = validarClave(req.body?.clave);
    if (e) return reply.code(400).send({ error: e });
    const hash = await hashClave(req.body.clave);
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query('LOCK TABLE usuarios IN EXCLUSIVE MODE'); // dos pestañas a la vez: solo una crea
      const hay = await c.query('SELECT 1 FROM usuarios WHERE es_admin LIMIT 1');
      if (hay.rowCount) {
        await c.query('ROLLBACK');
        return reply.code(409).send({ error: 'La cuenta de administrador ya existe' });
      }
      const u = await c.query('INSERT INTO usuarios (nombre, nombre_clave, clave_hash, es_admin) VALUES ($1, $2, $3, true) RETURNING id', [v.nombre, v.clave, hash]);
      await c.query('COMMIT');
      req.log.info({ usuario: v.nombre }, 'cuenta de administrador creada');
      return { token: await abrirSesion(u.rows[0].id, req.body?.aparato ?? 'Panel de admin'), nombre: v.nombre, esAdmin: true };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  });

  app.post('/api/login', async (req, reply) => {
    const v = validarNombre(req.body?.nombre);
    const clave = String(req.body?.clave ?? '');
    const llave = `${req.ip}|${v.clave ?? ''}`;
    if (bloqueado(llave)) return reply.code(429).send({ error: 'Demasiados intentos. Espera 5 minutos.' });
    // El admin y una cuenta normal pueden llamarse igual: primero se busca la del tipo que se pide.
    const paraAdmin = req.body?.admin === true;
    const r = v.error
      ? null
      : await db.query(
          'SELECT id, nombre, foto, clave_hash, es_admin, puede_admin FROM usuarios WHERE nombre_clave = $1 ORDER BY (es_admin = $2) DESC',
          [v.clave, paraAdmin],
        );
    const u = r?.rows[0];
    if (!u || !(await verificarClave(clave, u.clave_hash))) {
      registrarFallo(llave);
      return reply.code(401).send({ error: 'Usuario o contraseña incorrectos' });
    }
    // El panel de admin solo acepta la cuenta de administrador; la app, solo cuentas normales.
    // (Excepción: una cuenta normal con acceso al panel —puede_admin— entra a los dos con la misma contraseña.)
    if (paraAdmin !== u.es_admin && !(paraAdmin && u.puede_admin)) {
      return reply.code(403).send({ error: paraAdmin ? 'Esta no es la cuenta de administrador' : 'La cuenta de administrador es solo para el panel' });
    }
    limpiarFallos(llave);
    return { token: await abrirSesion(u.id, req.body?.aparato), nombre: u.nombre, foto: u.foto ?? null, esAdmin: u.es_admin || (paraAdmin && u.puede_admin) };
  });

  // Revisar, ANTES de crear la cuenta, que el código sirva y (si se manda) que el usuario esté libre.
  // Solo responde sobre el nombre a quien tiene un código válido: así nadie de afuera puede ir
  // probando qué usuarios existen. Los códigos malos cuentan como intentos fallidos.
  app.post('/api/registro/revisar', async (req, reply) => {
    const llave = `${req.ip}|registro`;
    if (bloqueado(llave)) return reply.code(429).send({ error: 'Demasiados intentos. Espera 5 minutos.' });
    const codigo = String(req.body?.codigo ?? '').trim().toUpperCase();
    const inv = await db.query('SELECT 1 FROM invitaciones WHERE codigo = $1 AND usada IS NULL AND vence > now()', [codigo]);
    if (!inv.rowCount) {
      registrarFallo(llave);
      return reply.code(400).send({ error: 'El código de invitación no es válido o ya se usó', campo: 'codigo' });
    }
    if (req.body?.nombre === undefined) return { ok: true };
    const v = validarNombre(req.body.nombre);
    if (v.error) return reply.code(400).send({ error: v.error, campo: 'nombre' });
    const existe = await db.query('SELECT 1 FROM usuarios WHERE nombre_clave = $1 AND NOT es_admin', [v.clave]);
    if (existe.rowCount) return reply.code(409).send({ error: 'Ese nombre de usuario ya existe', campo: 'nombre' });
    return { ok: true };
  });

  // Crear cuenta con un código de invitación (sirve una sola vez y vence).
  app.post('/api/registro', async (req, reply) => {
    const llave = `${req.ip}|registro`;
    if (bloqueado(llave)) return reply.code(429).send({ error: 'Demasiados intentos. Espera 5 minutos.' });
    const codigo = String(req.body?.codigo ?? '').trim().toUpperCase();
    const v = validarNombre(req.body?.nombre);
    if (v.error) return reply.code(400).send({ error: v.error });
    const e = validarClave(req.body?.clave);
    if (e) return reply.code(400).send({ error: e });
    const hash = await hashClave(req.body.clave);
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const inv = await c.query(
        `SELECT i.id, i.creada_por, i.multiuso, coalesce(u.es_admin, true) AS de_admin
           FROM invitaciones i LEFT JOIN usuarios u ON u.id = i.creada_por
          WHERE i.codigo = $1 AND i.usada IS NULL AND i.vence > now() FOR UPDATE OF i`,
        [codigo],
      );
      if (!inv.rowCount) {
        await c.query('ROLLBACK');
        registrarFallo(llave);
        return reply.code(400).send({ error: 'El código de invitación no es válido o ya se usó' });
      }
      const existe = await c.query('SELECT 1 FROM usuarios WHERE nombre_clave = $1 AND NOT es_admin', [v.clave]);
      if (existe.rowCount) {
        await c.query('ROLLBACK');
        return reply.code(409).send({ error: 'Ese nombre de usuario ya existe' });
      }
      const u = await c.query('INSERT INTO usuarios (nombre, nombre_clave, clave_hash) VALUES ($1, $2, $3) RETURNING id', [v.nombre, v.clave, hash]);
      // Una invitación de varios usos sigue sirviendo: solo se cuenta.
      if (inv.rows[0].multiuso) await c.query('UPDATE invitaciones SET usos = usos + 1 WHERE id = $1', [inv.rows[0].id]);
      else await c.query('UPDATE invitaciones SET usada = now(), usada_por = $1, usos = 1 WHERE id = $2', [u.rows[0].id, inv.rows[0].id]);
      // Invitado por un amigo (no por el admin): quedan como amigos de una vez.
      if (!inv.rows[0].de_admin && !inv.rows[0].multiuso)
        await c.query(`INSERT INTO amistades (de, para, estado, aceptada) VALUES ($1, $2, 'aceptada', now()) ON CONFLICT DO NOTHING`, [
          inv.rows[0].creada_por,
          u.rows[0].id,
        ]);
      await c.query('COMMIT');
      limpiarFallos(llave);
      req.log.info({ usuario: v.nombre }, 'cuenta creada con invitación');
      return { token: await abrirSesion(u.rows[0].id, req.body?.aparato), nombre: v.nombre, esAdmin: false };
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  });

  app.get('/api/yo', { preHandler: requiereUsuario }, async (req) => ({
    nombre: req.usuario.nombre,
    foto: req.usuario.foto ?? null,
    esAdmin: req.usuario.es_admin || req.usuario.puede_admin,
  }));

  app.post('/api/logout', { preHandler: requiereUsuario }, async (req) => {
    await cerrarSesion(req.headers.authorization.slice(7));
    return { ok: true };
  });

  // Cambiar la propia contraseña (cierra las demás sesiones de ese usuario).
  app.post('/api/clave', { preHandler: requiereUsuario }, async (req, reply) => {
    const r = await db.query('SELECT clave_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (!(await verificarClave(String(req.body?.actual ?? ''), r.rows[0].clave_hash))) return reply.code(401).send({ error: 'La contraseña actual no es correcta' });
    const e = validarClave(req.body?.nueva);
    if (e) return reply.code(400).send({ error: e });
    await db.query('UPDATE usuarios SET clave_hash = $1 WHERE id = $2', [await hashClave(req.body.nueva), req.usuario.id]);
    await db.query('DELETE FROM sesiones WHERE usuario_id = $1 AND id <> $2', [req.usuario.id, req.usuario.sesion_id]);
    return { ok: true };
  });
}
