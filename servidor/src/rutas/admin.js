import { randomInt } from 'node:crypto';
import { db } from '../db.js';
import { requiereAdmin } from '../auth.js';
import { crearEnlaceClave, HORAS_ENLACE } from '../enlacesClave.js';
import { enlaceSugerenciaValido } from '../enlaces.js';

// Códigos fáciles de dictar: sin 0/O ni 1/I/L.
const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const nuevoCodigo = () =>
  Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + LETRAS[randomInt(LETRAS.length)]).join('');

/**
 * Solo el dueño (la cuenta de administrador "zuih") puede borrar cuentas, cambiar contraseñas y cerrar sesiones.
 * Las cuentas normales con acceso al panel (puede_admin: Criiis, Sandreus, D3nki…) ven a los usuarios pero no
 * pueden tocarlos.
 */
const esDueno = (u) => !!u?.es_admin && String(u.nombre ?? '').trim().toLowerCase() === 'zuih';
function soloDueno(req, reply) {
  if (!esDueno(req.usuario)) {
    req.log.warn({ usuario: req.usuario?.nombre, ruta: req.url }, 'acción solo del dueño, rechazada');
    reply.code(403).send({ error: 'Solo zuih puede hacer esto' });
    return false;
  }
  return true;
}

/** Panel de admin: invitaciones, usuarios y sesiones. */
export default async function admin(app) {
  app.addHook('preHandler', requiereAdmin);

  app.get('/api/admin/invitaciones', async () => {
    const r = await db.query(
      `SELECT i.id, i.codigo, coalesce(i.nota, CASE WHEN NOT c.es_admin THEN 'Invitó ' || c.nombre END) AS nota,
              i.creada, i.vence = 'infinity' AS nunca_vence, CASE WHEN i.vence <> 'infinity' THEN i.vence END AS vence,
              i.usada, u.nombre AS usada_por, i.multiuso, i.usos,
              (i.usada IS NULL AND i.vence > now()) AS vigente
         FROM invitaciones i LEFT JOIN usuarios u ON u.id = i.usada_por LEFT JOIN usuarios c ON c.id = i.creada_por
        ORDER BY i.creada DESC LIMIT 100`,
    );
    return r.rows;
  });

  app.post('/api/admin/invitaciones', async (req) => {
    const dias = Math.max(1, Math.min(30, Number(req.body?.dias) || 7));
    const nota = String(req.body?.nota ?? '').trim().slice(0, 60) || null;
    for (;;) {
      try {
        const r = await db.query(
          `INSERT INTO invitaciones (codigo, nota, creada_por, vence) VALUES ($1, $2, $3, now() + make_interval(days => $4))
           RETURNING id, codigo, nota, creada, vence`,
          [nuevoCodigo(), nota, req.usuario.id, dias],
        );
        return r.rows[0];
      } catch (e) {
        if (e.code !== '23505') throw e; // código repetido (casi imposible): se genera otro
      }
    }
  });

  // Anular una invitación que no se ha usado.
  app.delete('/api/admin/invitaciones/:id', async (req, reply) => {
    const r = await db.query('DELETE FROM invitaciones WHERE id = $1 AND usada IS NULL', [req.params.id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe o ya se usó' });
    return { ok: true };
  });

  app.get('/api/admin/usuarios', async () => {
    const u = await db.query(
      `SELECT u.id, u.nombre, u.es_admin, u.puede_admin, u.creado,
              (SELECT count(*)::int FROM escuchas e WHERE e.usuario_id = u.id) AS escuchas,
              (SELECT count(*)::int FROM valoraciones v WHERE v.usuario_id = u.id AND v.valor = 1) AS me_gusta,
              (SELECT count(*)::int FROM playlists p WHERE p.usuario_id = u.id AND NOT p.borrada) AS playlists
         FROM usuarios u ORDER BY u.es_admin DESC, u.creado`,
    );
    const s = await db.query('SELECT id, usuario_id, aparato, creada, ultimo_uso FROM sesiones ORDER BY ultimo_uso DESC');
    return u.rows.map((x) => ({ ...x, sesiones: s.rows.filter((y) => y.usuario_id === x.id) }));
  });

  // Cerrar la sesión de un aparato (tendrá que volver a entrar).
  app.delete('/api/admin/sesiones/:id', async (req, reply) => {
    if (!soloDueno(req, reply)) return reply;
    const r = await db.query('DELETE FROM sesiones WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe' });
    return { ok: true };
  });

  /**
   * Restablecer la contraseña: genera un enlace de un solo uso (24 h) para que la persona ponga la suya. Sus
   * sesiones siguen abiertas hasta que la cambie; entonces se cierran todas. Generar otro anula el anterior.
   */
  app.post('/api/admin/usuarios/:id/enlace-clave', async (req, reply) => {
    if (!soloDueno(req, reply)) return reply;
    const r = await crearEnlaceClave(req.params.id);
    if (!r) return reply.code(404).send({ error: 'No existe o es la cuenta de administrador' });
    req.log.info({ usuario: r.nombre }, 'enlace para poner contraseña generado por el dueño');
    return { token: r.token, vence: r.vence, horas: HORAS_ENLACE };
  });

  /**
   * Dar o quitar el acceso al panel a una cuenta normal (puede_admin). Solo zuih. Se nota al instante: cada
   * pedido al panel vuelve a leer puede_admin de la base, así que quitarlo deja fuera a esa cuenta enseguida.
   */
  app.patch('/api/admin/usuarios/:id/panel', async (req, reply) => {
    if (!soloDueno(req, reply)) return reply;
    if (typeof req.body?.puede !== 'boolean') return reply.code(400).send({ error: 'Falta indicar sí o no' });
    const r = await db.query('UPDATE usuarios SET puede_admin = $2 WHERE id = $1 AND NOT es_admin RETURNING nombre', [req.params.id, req.body.puede]);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe o es la cuenta de administrador' });
    req.log.info({ usuario: r.rows[0].nombre, puede: req.body.puede }, 'acceso al panel cambiado por el dueño');
    return { ok: true };
  });

  // ---------------- Reportes de canciones ----------------

  app.get('/api/admin/reportes', async () => {
    const r = await db.query(
      `SELECT r.id, r.cancion, r.comentario, r.estado, r.creado, u.nombre AS usuario,
              c.titulo, c.artista, c.album
         FROM reportes r LEFT JOIN usuarios u ON u.id = r.usuario_id LEFT JOIN canciones c ON c.id = r.cancion
        ORDER BY r.estado = 'pendiente' DESC, r.creado DESC LIMIT 300`,
    );
    return r.rows;
  });

  app.patch('/api/admin/reportes/:id', async (req, reply) => {
    const estado = String(req.body?.estado ?? '');
    if (!['pendiente', 'resuelto', 'descartado'].includes(estado)) return reply.code(400).send({ error: 'Estado inválido' });
    const r = await db.query('UPDATE reportes SET estado = $2 WHERE id = $1', [req.params.id, estado]);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe' });
    return { ok: true };
  });

  app.delete('/api/admin/reportes/:id', async (req) => {
    await db.query('DELETE FROM reportes WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // ---------------- Sugerencias de canciones ----------------

  app.get('/api/admin/sugerencias', async () => {
    const r = await db.query(
      `SELECT s.id, s.titulo, s.artista, s.enlace, s.creada, s.estado, u.nombre AS usuario
         FROM sugerencias s LEFT JOIN usuarios u ON u.id = s.usuario_id
        ORDER BY s.estado = 'pendiente' DESC, s.creada DESC LIMIT 300`,
    );
    // No se confía en lo guardado: el enlace solo sale si vuelve a pasar la validación de dominio.
    return r.rows.map((s) => ({ ...s, enlace: s.enlace ? enlaceSugerenciaValido(s.enlace) : null }));
  });

  app.patch('/api/admin/sugerencias/:id', async (req, reply) => {
    const estado = String(req.body?.estado ?? '');
    if (!['pendiente', 'subida', 'descartada'].includes(estado)) return reply.code(400).send({ error: 'Estado inválido' });
    const r = await db.query('UPDATE sugerencias SET estado = $2 WHERE id = $1', [req.params.id, estado]);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe' });
    return { ok: true };
  });

  app.delete('/api/admin/sugerencias/:id', async (req) => {
    await db.query('DELETE FROM sugerencias WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  /**
   * Canciones que esperan las playlists importadas de Spotify: lo que más se pide primero. Al subirlas se
   * agregan solas a esas playlists.
   */
  app.get('/api/admin/faltantes', async () => {
    const r = await db.query(
      `SELECT min(f.titulo) AS titulo, min(array_to_string(f.artistas, ', ')) AS artista,
              count(DISTINCT f.playlist_id)::int AS playlists, array_agg(DISTINCT u.nombre) AS usuarios, max(f.creada) AS creada
         FROM playlist_faltantes f JOIN playlists p ON p.id = f.playlist_id AND NOT p.borrada JOIN usuarios u ON u.id = p.usuario_id
        GROUP BY coalesce(f.spotify_id, lower(f.titulo) || '|' || lower(array_to_string(f.artistas, ',')))
        ORDER BY playlists DESC, creada DESC LIMIT 500`,
    );
    return r.rows;
  });

  // Borrar una cuenta (y todos sus datos). La de administrador no se puede borrar desde aquí.
  app.delete('/api/admin/usuarios/:id', async (req, reply) => {
    if (!soloDueno(req, reply)) return reply;
    const r = await db.query('DELETE FROM usuarios WHERE id = $1 AND NOT es_admin', [req.params.id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe o es la cuenta de administrador' });
    return { ok: true };
  });
}
