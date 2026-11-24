import { requiereAdmin } from '../auth.js';
import { clave, noTocar, separarColaboracion, sugerenciasArtistas, unificarNombre } from '../artistas.js';

/** Panel: colaboraciones ("A & B" → "A … (con B)") y nombres escritos distinto ("Alvaro Diaz" / "Álvaro Díaz"). */
export default async function rutasArtistas(app) {
  app.addHook('preHandler', requiereAdmin);

  app.get('/api/admin/artistas/sugerencias', async () => sugerenciasArtistas());

  /**
   * { accion: 'separar', clave, principal, invitados[] } · { accion: 'grupo', clave, original }
   * { accion: 'unificar', clave, principal } · { accion: 'distintos', clave, original }
   */
  app.post('/api/admin/artistas', async (req, reply) => {
    const b = req.body ?? {};
    const k = clave(b.clave);
    const texto = (v) => String(v ?? '').trim().slice(0, 200);
    if (!k) return reply.code(400).send({ error: 'Falta el artista' });
    let n = 0;
    if (b.accion === 'separar') {
      const principal = texto(b.principal);
      const invitados = (Array.isArray(b.invitados) ? b.invitados : []).map(texto).filter(Boolean).slice(0, 10);
      if (!principal || !invitados.length) return reply.code(400).send({ error: 'Faltan el artista principal o los invitados' });
      n = await separarColaboracion(k, principal, invitados);
    } else if (b.accion === 'unificar') {
      const principal = texto(b.principal);
      if (!principal || clave(principal) !== k) return reply.code(400).send({ error: 'El nombre elegido no corresponde' });
      n = await unificarNombre(k, principal);
    } else if (b.accion === 'grupo' || b.accion === 'distintos') {
      await noTocar(k, b.accion, texto(b.original) || k);
    } else return reply.code(400).send({ error: 'Acción no válida' });
    req.log.info({ usuario: req.usuario.nombre, accion: b.accion, artista: k, n }, 'artistas: decisión');
    return { ok: true, n };
  });
}
