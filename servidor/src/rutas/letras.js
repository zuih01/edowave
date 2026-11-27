import { db } from '../db.js';
import { requiereAdmin, requiereUsuario } from '../auth.js';
import { buscarLetra, letraDe, paraApp } from '../datos/letras.js';

/** Letras: las pide la app (con sesión); el panel puede buscarlas de nuevo, pegarlas, ajustar el desfase o quitarlas. */
export default async function letras(app) {
  app.get('/api/letras/:id', { preHandler: requiereUsuario }, async (req, reply) => {
    const l = await letraDe(req.params.id);
    if (!l) return reply.code(404).send({ error: 'No existe esa canción' });
    return l;
  });

  // Varias de una vez (la siguiente de la fila, las descargas): solo lo ya guardado, sin ir a buscar a LRCLIB.
  app.get('/api/letras', { preHandler: requiereUsuario }, async (req) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean).slice(0, 40);
    if (!ids.length) return {};
    const r = await db.query('SELECT * FROM letras WHERE cancion = ANY($1)', [ids]);
    return Object.fromEntries(r.rows.map((f) => [f.cancion, paraApp(f)]));
  });

  // ---- Panel ----
  app.post('/api/admin/letras/:id/buscar', { preHandler: requiereAdmin }, async (req, reply) => {
    const ya = await db.query('SELECT editada_por FROM letras WHERE cancion = $1', [req.params.id]);
    if (ya.rows[0]?.editada_por) await db.query('UPDATE letras SET editada_por = NULL WHERE cancion = $1', [req.params.id]);
    await buscarLetra(req.params.id);
    const l = await letraDe(req.params.id, { buscar: false });
    return l ?? reply.code(404).send({ error: 'No existe esa canción' });
  });

  app.put('/api/admin/letras/:id', { preHandler: requiereAdmin }, async (req, reply) => {
    const { lrc, texto, desfase } = req.body ?? {};
    const existe = await db.query('SELECT 1 FROM canciones WHERE id = $1', [req.params.id]);
    if (!existe.rowCount) return reply.code(404).send({ error: 'No existe esa canción' });
    const sinTiempos = (s) => String(s).replace(/^\[[^\]]*\]\s?/gm, '').trim();
    const l = typeof lrc === 'string' && /\[\d+:\d+(?:[.:]\d+)?\]/.test(lrc) ? lrc.slice(0, 60_000) : null;
    const t = typeof texto === 'string' && texto.trim() ? texto.slice(0, 60_000) : l ? sinTiempos(l) : null;
    const d = Number.isFinite(Number(desfase)) ? Math.max(-10_000, Math.min(10_000, Math.round(Number(desfase)))) : 0;
    if (!l && !t) {
      // Solo se movió el desfase
      await db.query('UPDATE letras SET desfase_ms = $2 WHERE cancion = $1', [req.params.id, d]);
    } else {
      await db.query(
        `INSERT INTO letras (cancion, estado, lrc, texto, desfase_ms, editada_por) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (cancion) DO UPDATE SET estado = $2, lrc = $3, texto = $4, desfase_ms = $5, editada_por = $6, buscada = now()`,
        [req.params.id, l ? 'sincronizada' : 'normal', l, t, d, req.usuario.id],
      );
    }
    return letraDe(req.params.id, { buscar: false });
  });

  app.delete('/api/admin/letras/:id', { preHandler: requiereAdmin }, async (req) => {
    // Queda como "sin_letra" editada a mano: no se vuelve a buscar sola.
    await db.query(
      `INSERT INTO letras (cancion, estado, editada_por) VALUES ($1,'sin_letra',$2)
       ON CONFLICT (cancion) DO UPDATE SET estado = 'sin_letra', lrc = NULL, texto = NULL, desfase_ms = 0, editada_por = $2, buscada = now()`,
      [req.params.id, req.usuario.id],
    );
    return { ok: true };
  });
}
