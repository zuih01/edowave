import { db } from '../db.js';
import { requiereAdmin } from '../auth.js';
import { CATEGORIAS, avisarCategorias } from '../categorias.js';

/**
 * Panel: categorías especiales (meme, anime, OST de videojuego). Marcar/desmarcar va en el editor de la canción
 * (PATCH /api/admin/canciones/:id con `categorias`); aquí, las sugerencias automáticas para aceptar o rechazar.
 */
export default async function rutasCategorias(app) {
  app.addHook('preHandler', requiereAdmin);

  /** Sugerencias pendientes, agrupables por artista en el panel, con los datos de la canción. */
  app.get('/api/admin/categorias/sugerencias', async () => {
    const r = await db.query(
      `SELECT s.id, s.categoria, s.motivo, s.creada, c.id AS cancion, c.titulo, c.artista, c.album, c.portada, c.categorias
         FROM categoria_sugerencias s JOIN canciones c ON c.id = s.cancion_id
        WHERE s.estado = 'pendiente'
        ORDER BY s.categoria, lower(c.artista), lower(c.album), c.pista NULLS LAST LIMIT 1000`,
    );
    const t = await db.query(`SELECT count(*)::int AS n FROM categoria_sugerencias WHERE estado = 'pendiente'`);
    return { sugerencias: r.rows, total: t.rows[0].n, categorias: CATEGORIAS };
  });

  /**
   * Aceptar o rechazar: { ids: [..], accion: 'aceptar' | 'rechazar' } (de a una o varias: ej. todas las de un
   * artista). Aceptar agrega la categoría a la canción; una rechazada no se vuelve a sugerir.
   */
  app.post('/api/admin/categorias/sugerencias', async (req, reply) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 1000);
    const accion = req.body?.accion;
    if (!ids.length || !['aceptar', 'rechazar'].includes(accion)) return reply.code(400).send({ error: 'Faltan datos' });
    const c = await db.connect();
    let n = 0;
    try {
      await c.query('BEGIN');
      const r = await c.query(
        `UPDATE categoria_sugerencias SET estado = $2 WHERE id = ANY($1) AND estado = 'pendiente' RETURNING cancion_id, categoria`,
        [ids, accion === 'aceptar' ? 'aceptada' : 'rechazada'],
      );
      n = r.rowCount;
      if (accion === 'aceptar') {
        for (const x of r.rows) {
          await c.query(
            `UPDATE canciones SET categorias = array_append(categorias, $2), datos_revisado = now()
              WHERE id = $1 AND NOT ($2 = ANY (categorias))`,
            [x.cancion_id, x.categoria],
          );
        }
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    if (accion === 'aceptar') avisarCategorias(); // puede sugerir el resto del álbum o del artista
    req.log.info({ usuario: req.usuario.nombre, accion, n }, 'categorías: sugerencias revisadas');
    return { ok: true, n };
  });
}
