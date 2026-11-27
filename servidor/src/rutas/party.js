import { randomBytes } from 'node:crypto';
import { requiereUsuario } from '../auth.js';
import { radio } from '../reco/motor.js';
import { enviar, estaConectado } from './social.js';
import { modeloDe } from './datos.js';

/**
 * Party: escuchar en grupo con una cola compartida (como la Jam de Spotify).
 *
 *  - El anfitrión la inicia desde el menú de una canción. Lo que suena lo decide SU aparato: él cuenta aquí qué
 *    suena, en qué segundo y qué viene en su cola ("Siguiente de…").
 *  - Los invitados entran con un enlace o un código QR (no hace falta ser amigos). Pueden escuchar en su propio
 *    aparato (van al mismo tiempo que el anfitrión) o "desde el aparato del anfitrión" (en persona: no suena nada
 *    en el suyo, solo ven la cola y agregan canciones).
 *  - Todos agregan canciones a "A continuación"; el aparato del anfitrión las pone a sonar antes que su propia cola.
 *  - Recomendaciones del grupo: la radio de cada integrante a partir de lo que sonó en la Party, combinadas.
 *
 * Todo vive en memoria (como "escuchar juntos"): si el servidor se reinicia, el anfitrión la vuelve a crear con el
 * mismo código al reconectarse y los invitados se vuelven a unir solos.
 */

const MAX_MIEMBROS = 16;
const MAX_AGREGADAS = 100;
/** El anfitrión sin dar noticias ni tener la app abierta por este rato: se termina la Party. */
const ANFITRION_AUSENTE_MS = 5 * 60_000;
/** Un invitado sin la app abierta por este rato sale de la Party. */
const INVITADO_AUSENTE_MS = 10 * 60_000;

/** código → party */
const parties = new Map();
/** Parties terminadas (código → cuándo): no se dejan recrear, así un aparato que estuvo apagado no la revive. */
const terminadas = new Map();
/** usuario → código de la Party en que está */
const dondeEsta = new Map();

const N = (x) => Number(x);
const idCancion = (v) => (typeof v === 'string' && v.length <= 80 && v ? v : null);
const nuevoCodigo = () => {
  // Sin letras que se confunden (0/O, 1/I/L).
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do c = [...randomBytes(6)].map((b) => abc[b % abc.length]).join('');
  while (parties.has(c));
  return c;
};
const nuevoUid = () => randomBytes(6).toString('base64url');

function estadoPublico(p, para) {
  const s = p.sonando;
  return {
    codigo: p.codigo,
    anfitrion: p.anfitrion,
    yo: para,
    miembros: [...p.miembros.values()].map((m) => ({ id: m.id, nombre: m.nombre, foto: m.foto, modo: m.modo })),
    agregadas: p.agregadas,
    sonando: s ? { cancion: s.cancion, por: s.por ?? null, posicion: s.posicion, sonando: s.sonando, hace: Date.now() - s.en } : null,
    proximas: p.proximas,
    contexto: p.contexto,
    ajustes: p.ajustes,
  };
}

function avisar(p) {
  for (const id of p.miembros.keys()) enviar(id, { tipo: 'party', party: estadoPublico(p, id) });
}

function terminar(p, motivo) {
  parties.delete(p.codigo);
  terminadas.set(p.codigo, Date.now());
  for (const id of p.miembros.keys()) {
    if (dondeEsta.get(id) === p.codigo) dondeEsta.delete(id);
    enviar(id, { tipo: 'party-fin', codigo: p.codigo, motivo });
  }
}

/** Saca a alguien de la Party en que esté (si es el anfitrión, la termina). */
function sacar(usuario, motivo = 'salio') {
  const codigo = dondeEsta.get(usuario);
  const p = codigo && parties.get(codigo);
  dondeEsta.delete(usuario);
  if (!p) return;
  if (p.anfitrion.id === usuario) return terminar(p, 'termino');
  p.miembros.delete(usuario);
  if (motivo === 'expulsado') enviar(usuario, { tipo: 'party-fin', codigo: p.codigo, motivo });
  avisar(p);
}

function miembro(u, modo) {
  return { id: N(u.id), nombre: u.nombre, foto: u.foto ?? null, modo, visto: Date.now() };
}

// Cada 30 s: Parties abandonadas e invitados que cerraron la app hace rato.
setInterval(() => {
  const ahora = Date.now();
  for (const [c, en] of terminadas) if (ahora - en > 24 * 3600_000) terminadas.delete(c);
  for (const p of [...parties.values()]) {
    for (const m of p.miembros.values()) if (estaConectado(m.id)) m.visto = ahora;
    const a = p.miembros.get(p.anfitrion.id);
    if (!a || ahora - a.visto > ANFITRION_AUSENTE_MS) {
      for (const id of p.miembros.keys()) dondeEsta.delete(id);
      terminar(p, 'ausente');
      continue;
    }
    let cambio = false;
    for (const m of [...p.miembros.values()]) {
      if (m.id !== p.anfitrion.id && ahora - m.visto > INVITADO_AUSENTE_MS) {
        p.miembros.delete(m.id);
        dondeEsta.delete(m.id);
        cambio = true;
      }
    }
    if (cambio) avisar(p);
  }
}, 30_000).unref();

const miParty = (req) => {
  const yo = N(req.usuario.id);
  const p = parties.get(dondeEsta.get(yo));
  if (p) {
    const m = p.miembros.get(yo);
    if (m) m.visto = Date.now();
  }
  return { yo, p };
};

export default async function party(app) {
  /** Mi Party actual (al abrir la app o reconectarse). */
  app.get('/api/party', { preHandler: requiereUsuario }, async (req) => {
    const { yo, p } = miParty(req);
    return { party: p ? estadoPublico(p, yo) : null };
  });

  /**
   * Iniciar una Party (soy el anfitrión). Si viene `codigo` y ya no existe (el servidor se reinició), se recrea
   * con el mismo código para que el enlace compartido siga sirviendo.
   */
  app.post('/api/party', { preHandler: requiereUsuario }, async (req, reply) => {
    const yo = N(req.usuario.id);
    const b = req.body ?? {};
    const pedido = typeof b.codigo === 'string' && /^[A-Z0-9]{6}$/.test(b.codigo) ? b.codigo : null;
    const actual = parties.get(dondeEsta.get(yo));
    if (actual && actual.anfitrion.id === yo && (!pedido || pedido === actual.codigo)) {
      return { party: estadoPublico(actual, yo) };
    }
    if (pedido && parties.has(pedido)) return reply.code(409).send({ error: 'Esa Party ya existe' });
    if (pedido && terminadas.has(pedido)) return reply.code(410).send({ error: 'Esa Party ya terminó' });
    sacar(yo);
    const p = {
      codigo: pedido ?? nuevoCodigo(),
      anfitrion: { id: yo, nombre: req.usuario.nombre, foto: req.usuario.foto ?? null },
      miembros: new Map([[yo, miembro(req.usuario, 'telefono')]]),
      agregadas: [],
      sonando: null,
      proximas: [],
      contexto: null,
      historial: [],
      ajustes: { controlar: true },
    };
    if (Array.isArray(b.agregadas)) {
      for (const x of b.agregadas.slice(0, MAX_AGREGADAS)) {
        const c = idCancion(x?.cancion);
        if (c) p.agregadas.push({ uid: nuevoUid(), cancion: c, por: N(x.por) || yo });
      }
    }
    parties.set(p.codigo, p);
    dondeEsta.set(yo, p.codigo);
    return { party: estadoPublico(p, yo) };
  });

  /** Lo que ve quien abre el enlace antes de unirse. */
  app.get('/api/party/:codigo/info', { preHandler: requiereUsuario }, async (req, reply) => {
    const p = parties.get(String(req.params.codigo).toUpperCase());
    if (!p) return reply.code(404).send({ error: 'Esta Party ya terminó' });
    return {
      codigo: p.codigo,
      anfitrion: p.anfitrion,
      miembros: [...p.miembros.values()].map((m) => ({ id: m.id, nombre: m.nombre, foto: m.foto })),
      llena: p.miembros.size >= MAX_MIEMBROS,
      ya: p.miembros.has(N(req.usuario.id)),
    };
  });

  /** Unirse. modo: 'telefono' (suena en mi aparato) o 'aparato' (escucho desde el del anfitrión, en persona). */
  app.post('/api/party/:codigo/unirse', { preHandler: requiereUsuario }, async (req, reply) => {
    const yo = N(req.usuario.id);
    const p = parties.get(String(req.params.codigo).toUpperCase());
    if (!p) return reply.code(404).send({ error: 'Esta Party ya terminó' });
    const modo = req.body?.modo === 'aparato' ? 'aparato' : 'telefono';
    if (!p.miembros.has(yo)) {
      if (p.miembros.size >= MAX_MIEMBROS) return reply.code(409).send({ error: 'La Party está llena' });
      sacar(yo);
      p.miembros.set(yo, miembro(req.usuario, modo));
      for (const id of p.miembros.keys()) if (id !== yo) enviar(id, { tipo: 'party-llego', nombre: req.usuario.nombre });
    } else {
      const m = p.miembros.get(yo);
      m.modo = modo;
      m.visto = Date.now();
    }
    dondeEsta.set(yo, p.codigo);
    avisar(p);
    return { party: estadoPublico(p, yo) };
  });

  /** Salir (si soy el anfitrión, termina para todos). */
  app.post('/api/party/salir', { preHandler: requiereUsuario }, async (req) => {
    sacar(N(req.usuario.id));
    return { ok: true };
  });

  /** El aparato del anfitrión cuenta qué suena, su cola y de dónde viene ("Siguiente de: …"). */
  app.post('/api/party/estado', { preHandler: requiereUsuario }, async (req, reply) => {
    const { yo, p } = miParty(req);
    if (!p || p.anfitrion.id !== yo) return reply.code(404).send({ error: 'No tienes una Party' });
    const b = req.body ?? {};
    const cancion = idCancion(b.cancion);
    const antes = p.sonando?.cancion;
    let por = cancion && cancion === antes ? p.sonando.por : null;
    // Empezó a sonar una canción agregada: sale de "A continuación".
    if (typeof b.uid === 'string') {
      const i = p.agregadas.findIndex((a) => a.uid === b.uid);
      if (i >= 0) por = p.agregadas.splice(i, 1)[0].por;
    }
    p.sonando = cancion ? { cancion, por, posicion: Math.max(0, Number(b.posicion) || 0), sonando: !!b.sonando, en: Date.now() } : null;
    if (cancion && cancion !== antes) p.historial = [...p.historial.filter((x) => x !== cancion), cancion].slice(-40);
    p.proximas = (Array.isArray(b.proximas) ? b.proximas : []).map(idCancion).filter(Boolean).slice(0, 20);
    p.contexto = typeof b.contexto === 'string' ? b.contexto.slice(0, 120) : null;
    avisar(p);
    return { ok: true };
  });

  /** Agregar canciones a "A continuación" (cualquiera de la Party). */
  app.post('/api/party/agregar', { preHandler: requiereUsuario }, async (req, reply) => {
    const { yo, p } = miParty(req);
    if (!p) return reply.code(404).send({ error: 'No estás en una Party' });
    const lista = (Array.isArray(req.body?.canciones) ? req.body.canciones : [req.body?.cancion]).map(idCancion).filter(Boolean);
    if (!lista.length) return reply.code(400).send({ error: 'Falta la canción' });
    if (p.agregadas.length + lista.length > MAX_AGREGADAS) return reply.code(409).send({ error: 'La fila de la Party está llena' });
    for (const cancion of lista) p.agregadas.push({ uid: nuevoUid(), cancion, por: yo });
    avisar(p);
    return { ok: true };
  });

  /** Quitar una agregada: el anfitrión (o todos, si deja controlar la música) cualquiera; los demás, solo las suyas. */
  app.delete('/api/party/agregadas/:uid', { preHandler: requiereUsuario }, async (req, reply) => {
    const { yo, p } = miParty(req);
    if (!p) return reply.code(404).send({ error: 'No estás en una Party' });
    const i = p.agregadas.findIndex((a) => a.uid === req.params.uid);
    if (i < 0) return { ok: true };
    if (p.anfitrion.id !== yo && !p.ajustes.controlar && p.agregadas[i].por !== yo) return reply.code(403).send({ error: 'Solo puedes quitar las que agregaste tú' });
    p.agregadas.splice(i, 1);
    avisar(p);
    return { ok: true };
  });

  /** Mover una agregada a otro puesto (el anfitrión, o todos si deja controlar la música). */
  app.post('/api/party/mover', { preHandler: requiereUsuario }, async (req, reply) => {
    const { yo, p } = miParty(req);
    if (!p) return reply.code(404).send({ error: 'No estás en una Party' });
    if (p.anfitrion.id !== yo && !p.ajustes.controlar) return reply.code(403).send({ error: 'El anfitrión no permite ordenar la fila' });
    const i = p.agregadas.findIndex((a) => a.uid === req.body?.uid);
    const a = Math.max(0, Math.min(p.agregadas.length - 1, Number(req.body?.a) || 0));
    if (i >= 0 && i !== a) {
      const [x] = p.agregadas.splice(i, 1);
      p.agregadas.splice(a, 0, x);
      avisar(p);
    }
    return { ok: true };
  });

  /**
   * Quitar o mover una de "Siguiente de: …" (la cola del anfitrión). La cola vive en el dispositivo del anfitrión:
   * se le pasa el pedido y, mientras, se muestra el cambio a todos.
   */
  app.post('/api/party/cola', { preHandler: requiereUsuario }, async (req, reply) => {
    const { yo, p } = miParty(req);
    if (!p) return reply.code(404).send({ error: 'No estás en una Party' });
    if (p.anfitrion.id !== yo && !p.ajustes.controlar) return reply.code(403).send({ error: 'El anfitrión no permite cambiar la música' });
    const b = req.body ?? {};
    const accion = b.accion === 'quitar' ? 'quitar' : b.accion === 'mover' ? 'mover' : null;
    const cancion = idCancion(b.cancion);
    const antesDe = idCancion(b.antesDe);
    if (!accion || !cancion) return reply.code(400).send({ error: 'Pedido incompleto' });
    const i = p.proximas.indexOf(cancion);
    if (i < 0) return { ok: true };
    p.proximas.splice(i, 1);
    if (accion === 'mover') {
      const j = antesDe ? p.proximas.indexOf(antesDe) : -1;
      p.proximas.splice(j < 0 ? p.proximas.length : j, 0, cancion);
    }
    enviar(p.anfitrion.id, { tipo: 'party-cola', accion, cancion, antesDe, nombre: req.usuario.nombre });
    avisar(p);
    return { ok: true };
  });

  /** Sacar a alguien (solo el anfitrión). */
  app.post('/api/party/expulsar', { preHandler: requiereUsuario }, async (req, reply) => {
    const { yo, p } = miParty(req);
    const otro = N(req.body?.usuario);
    if (!p || p.anfitrion.id !== yo) return reply.code(403).send({ error: 'Solo el anfitrión puede sacar a alguien' });
    if (otro === yo || !p.miembros.has(otro)) return { ok: true };
    sacar(otro, 'expulsado');
    return { ok: true };
  });

  /** Ajustes del anfitrión: ¿los invitados pueden pausar y cambiar de canción? */
  app.put('/api/party/ajustes', { preHandler: requiereUsuario }, async (req, reply) => {
    const { yo, p } = miParty(req);
    if (!p || p.anfitrion.id !== yo) return reply.code(403).send({ error: 'Solo el anfitrión' });
    if (typeof req.body?.controlar === 'boolean') p.ajustes.controlar = req.body.controlar;
    avisar(p);
    return { ajustes: p.ajustes };
  });

  /** Un invitado pide pausar, seguir o cambiar de canción: se le pasa al aparato del anfitrión. */
  app.post('/api/party/control', { preHandler: requiereUsuario }, async (req, reply) => {
    const { yo, p } = miParty(req);
    if (!p) return reply.code(404).send({ error: 'No estás en una Party' });
    const accion = ['play', 'pausa', 'siguiente', 'anterior'].includes(req.body?.accion) ? req.body.accion : null;
    if (!accion) return reply.code(400).send({ error: 'Acción desconocida' });
    if (p.anfitrion.id !== yo && !p.ajustes.controlar) return reply.code(403).send({ error: 'El anfitrión no permite cambiar la música' });
    enviar(p.anfitrion.id, { tipo: 'party-control', accion, nombre: req.usuario.nombre });
    return { ok: true };
  });

  /** Invitar directo a un amigo (le llega un aviso en la app). */
  app.post('/api/party/invitar', { preHandler: requiereUsuario }, async (req, reply) => {
    const { p } = miParty(req);
    const otro = N(req.body?.usuario);
    if (!p) return reply.code(404).send({ error: 'No estás en una Party' });
    if (!otro || p.miembros.has(otro)) return { ok: true };
    enviar(otro, { tipo: 'party-invitacion', codigo: p.codigo, nombre: req.usuario.nombre, anfitrion: p.anfitrion.nombre });
    return { ok: true };
  });

  /**
   * Recomendaciones del grupo: la radio de cada integrante (con sus gustos) a partir de lo último que sonó en la
   * Party. Lo que aparece arriba en varias radios va primero; cada una dice para quién se eligió.
   */
  app.get('/api/party/recomendaciones', { preHandler: requiereUsuario }, async (req, reply) => {
    const { p } = miParty(req);
    if (!p) return reply.code(404).send({ error: 'No estás en una Party' });
    const semillas = [...p.historial.slice(-3), ...p.agregadas.slice(-2).map((a) => a.cancion)].slice(-4);
    const excluir = new Set([...p.historial, ...p.agregadas.map((a) => a.cancion), ...p.proximas, p.sonando?.cancion].filter(Boolean));
    const miembros = [...p.miembros.values()].slice(0, 8);
    const N_RADIO = 25;
    const puntos = new Map(); // cancion → { total, mejor, para }
    await Promise.all(
      miembros.map(async (m) => {
        let ids = [];
        try {
          ids = radio(await modeloDe(m.id), semillas, excluir, N_RADIO);
        } catch {
          return;
        }
        ids.forEach((id, i) => {
          const pts = N_RADIO - i;
          const x = puntos.get(id) ?? { total: 0, mejor: 0, para: m.id };
          x.total += pts;
          if (pts > x.mejor) Object.assign(x, { mejor: pts, para: m.id });
          puntos.set(id, x);
        });
      }),
    );
    const lista = [...puntos]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 20)
      .map(([cancion, x]) => ({ cancion, para: x.para }));
    return { canciones: lista };
  });
}
