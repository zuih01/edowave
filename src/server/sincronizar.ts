import { getAllPlays, getAllRatings, getAllTracks, getDB } from '../db';
import { useFijadas } from '../library/fijadas';
import { useSearchHistory } from '../library/searchHistory';
import { recargarEq, useEq, useVolumen } from '../player/equalizer';
import { useLeveler } from '../player/loudness';
import { colaHooks, usePlayer } from '../player/player';
import { recargarRack, useRack } from '../player/rack';
import { useVinyl } from '../player/scratch';
import { useCuenta } from './cuenta';
import { cargarEstado, despuesDe, guardarEstado, mandarPendientes, type Busquedas, type ColaGuardada } from './datosCuenta';

/**
 * Sincroniza con tu cuenta lo que antes vivía solo en este aparato:
 *  - ajustes (ecualizador, rack, volumen, nivelador, reproducción automática, modo vinilo);
 *  - búsquedas recientes;
 *  - lo que estaba sonando (la cola) — eso lo lleva player.ts con `colaDelServidor` y `guardarCola`.
 * Al volver a la app (o cada minuto con la app abierta) se trae lo último, así un cambio hecho en la tablet
 * aparece en el teléfono.
 */

// ---------------- Ajustes ----------------

interface Ajuste {
  /** Clave con que se guarda (la misma que usa cada módulo). */
  clave: string;
  leer: () => string | null;
  aplicar: (v: string) => void;
  escuchar: (fn: () => void) => () => void;
}
const ls = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const escribir = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin espacio */
  }
};

const AJUSTES: Ajuste[] = [
  {
    clave: 'eq',
    leer: () => ls('eq'),
    aplicar: (v) => {
      escribir('eq', v);
      recargarEq();
    },
    escuchar: (fn) => useEq.subscribe(fn),
  },
  {
    clave: 'rack',
    leer: () => ls('rack'),
    aplicar: (v) => {
      escribir('rack', v);
      recargarRack();
    },
    escuchar: (fn) => useRack.subscribe(fn),
  },
  {
    clave: 'volumen',
    leer: () => String(useVolumen.getState().v),
    aplicar: (v) => Number.isFinite(Number(v)) && useVolumen.getState().set(Number(v)),
    escuchar: (fn) => useVolumen.subscribe(fn),
  },
  {
    clave: 'leveler',
    leer: () => (useLeveler.getState().on ? 'on' : 'off'),
    aplicar: (v) => useLeveler.getState().set(v === 'on'),
    escuchar: (fn) => useLeveler.subscribe((s, p) => s.on !== p.on && fn()),
  },
  {
    clave: 'autoplay',
    leer: () => (usePlayer.getState().autoplay ? 'on' : 'off'),
    aplicar: (v) => usePlayer.getState().autoplay !== (v === 'on') && usePlayer.getState().setAutoplay(v === 'on'),
    escuchar: (fn) => usePlayer.subscribe((s, p) => s.autoplay !== p.autoplay && fn()),
  },
  {
    clave: 'vinyl',
    leer: () => (useVinyl.getState().on ? 'on' : 'off'),
    aplicar: (v) => useVinyl.getState().set(v === 'on'),
    escuchar: (fn) => useVinyl.subscribe(fn),
  },
  {
    // Canciones fijadas en los accesos directos.
    clave: 'fijadas',
    leer: () => JSON.stringify(useFijadas.getState().ids),
    aplicar: (v) => {
      try {
        const ids = JSON.parse(v);
        if (Array.isArray(ids)) useFijadas.setState({ ids: ids.filter((x) => typeof x === 'string') });
      } catch {
        /* dato dañado: se ignora */
      }
    },
    escuchar: (fn) => useFijadas.subscribe(fn),
  },
];

/** Lo último que se sabe que está en el servidor (para no mandar lo mismo de vuelta). */
const enServidor: Record<string, string> = {};
let aplicando = false;

const mandarAjustes = despuesDe<Record<string, string>>(800, (cambios) => {
  void guardarEstado({ ajustes: cambios });
  pendientes = {};
});
let pendientes: Record<string, string> = {};

function vigilarAjustes() {
  for (const a of AJUSTES) {
    a.escuchar(() => {
      if (aplicando) return;
      // Cada módulo guarda su valor al cambiar: se lee justo después.
      setTimeout(() => {
        const v = a.leer();
        if (v === null || enServidor[a.clave] === v) return;
        enServidor[a.clave] = v;
        pendientes = { ...pendientes, [a.clave]: v };
        mandarAjustes(pendientes);
      });
    });
  }
}

function aplicarAjustes(ajustes: Record<string, string>) {
  aplicando = true;
  try {
    for (const a of AJUSTES) {
      const v = ajustes[a.clave];
      if (typeof v !== 'string') continue;
      enServidor[a.clave] = v;
      if (a.leer() !== v) a.aplicar(v);
    }
  } finally {
    // Los módulos avisan de su cambio un instante después: se ignora ese aviso.
    setTimeout(() => (aplicando = false), 50);
  }
}

// ---------------- Búsquedas recientes ----------------

let busquedasDelServidor = '';
const mandarBusquedas = despuesDe<Busquedas>(1500, (b) => void guardarEstado({ busquedas: b }));
function vigilarBusquedas() {
  useSearchHistory.subscribe((s) => {
    const b = { queries: s.queries, tracks: s.tracks };
    const j = JSON.stringify(b);
    if (j === busquedasDelServidor) return;
    busquedasDelServidor = j;
    mandarBusquedas(b);
  });
}
function aplicarBusquedas(b: Busquedas | undefined) {
  if (!b) return;
  busquedasDelServidor = JSON.stringify({ queries: b.queries ?? [], tracks: b.tracks ?? [] });
  useSearchHistory.setState({ queries: b.queries ?? [], tracks: b.tracks ?? [] });
}

// ---------------- Lo que estaba sonando ----------------

let colaGuardadaAt = 0;
const mandarCola = despuesDe<ColaGuardada>(3000, (c) => void guardarEstado({ cola: c }));
/** player.ts la llama al cambiar la cola, la canción o al pausar. */
export function guardarCola(c: Omit<ColaGuardada, 'at'>, ya = false) {
  if (!useCuenta.getState().token) return;
  colaGuardadaAt = Date.now();
  mandarCola({ ...c, at: colaGuardadaAt });
  if (ya) mandarCola.ahora();
}

let colaInicial: ColaGuardada | null = null;
/** La cola guardada en tu cuenta (la usa player.ts al abrir la app). */
export const colaDelServidor = () => colaInicial;
colaHooks.inicial = colaDelServidor;
colaHooks.guardar = (c) => guardarCola(c);

// ---------------- Pasar al servidor lo que había en este aparato (una sola vez) ----------------

const YA_SUBIDO = 'datosSubidosACuenta';

async function subirLoDeEsteAparato(estado: { ajustes: Record<string, string>; busquedas: Busquedas }) {
  if (ls(YA_SUBIDO) === useCuenta.getState().nombre) return;
  const { api } = await import('./cuenta');
  // Escuchas (con un id fijo por escucha: si se corta a la mitad y se repite, no se duplican).
  const plays = (await getAllPlays()).filter((p) => p.trackId.startsWith('s:'));
  let viejas: typeof plays = [];
  try {
    viejas = JSON.parse(ls('pendingPlays') ?? '[]');
  } catch {
    /* nada */
  }
  const todas = [...plays, ...viejas.filter((p) => p.trackId?.startsWith('s:'))].map((p) => ({ ...p, clienteId: `aparato-${p.trackId}-${p.startedAt}` }));
  for (let i = 0; i < todas.length; i += 1000) await api('/api/escuchas', { method: 'POST', body: { escuchas: todas.slice(i, i + 1000) } });
  // "Me gusta"
  const ratings = (await getAllRatings()).filter((r) => r.trackId.startsWith('s:'));
  if (ratings.length) await api('/api/valoraciones', { method: 'PUT', body: { lista: ratings.map((r) => ({ cancion: r.trackId, valor: r.value, at: r.at })) } });
  // Búsquedas recientes: se juntan con las de la cuenta.
  const local = useSearchHistory.getState();
  const b: Busquedas = {
    queries: [...new Set([...(estado.busquedas.queries ?? []), ...local.queries])].slice(0, 12),
    tracks: [...new Set([...(estado.busquedas.tracks ?? []), ...local.tracks])].slice(0, 12),
  };
  // Ajustes: solo si la cuenta todavía no tiene (si ya los tiene, mandan los de la cuenta).
  const ajustes: Record<string, string> = {};
  if (!Object.keys(estado.ajustes).length) for (const a of AJUSTES) {
    const v = a.leer();
    if (v !== null) ajustes[a.clave] = v;
  }
  await guardarEstado({ busquedas: b, ajustes, migrado: true });
  estado.busquedas = b;
  Object.assign(estado.ajustes, ajustes);
  // Ya está en tu cuenta: se borra de este aparato (historial, "me gusta" y la música importada).
  await borrarDeEsteAparato();
  escribir(YA_SUBIDO, useCuenta.getState().nombre ?? '');
}

/** Este aparato deja de guardar tus datos: todo está en el servidor. */
async function borrarDeEsteAparato() {
  try {
    const db = await getDB();
    const locales = (await getAllTracks()).filter((t) => !t.server).map((t) => t.id);
    const tx = db.transaction(['plays', 'ratings', 'tracks', 'files', 'covers', 'features'], 'readwrite');
    await Promise.all([
      tx.objectStore('plays').clear(),
      tx.objectStore('ratings').clear(),
      ...locales.flatMap((id) => [tx.objectStore('tracks').delete(id), tx.objectStore('files').delete(id), tx.objectStore('features').delete(id)]),
      tx.done,
    ]);
  } catch {
    /* nada que borrar */
  }
  for (const k of ['pendingPlays', 'searchHistory', 'player']) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* nada */
    }
  }
}

// ---------------- Arranque ----------------

let iniciado = false;
let ultimaVuelta = 0;

/** Trae de tu cuenta ajustes, búsquedas y lo que estaba sonando. Se llama al abrir la app y al entrar. */
export async function sincronizarCuenta() {
  if (!useCuenta.getState().token) return;
  const estado = await cargarEstado();
  if (!estado) return;
  try {
    await subirLoDeEsteAparato(estado);
  } catch {
    /* sin conexión a la mitad: se reintenta la próxima vez */
  }
  colaInicial = estado.cola;
  aplicarAjustes(estado.ajustes ?? {});
  aplicarBusquedas(estado.busquedas);
  void mandarPendientes();
  ultimaVuelta = Date.now();
  if (!iniciado) {
    iniciado = true;
    vigilarAjustes();
    vigilarBusquedas();
    // Al volver a la app: lo último de tu cuenta (por si cambiaste algo en otro aparato).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - ultimaVuelta > 5000) void refrescar();
      if (document.visibilityState === 'hidden') mandarCola.ahora();
    });
    setInterval(() => document.visibilityState === 'visible' && void refrescar(), 60_000);
  }
}

async function refrescar() {
  ultimaVuelta = Date.now();
  const e = await cargarEstado();
  if (!e) return;
  aplicarAjustes(e.ajustes ?? {});
  aplicarBusquedas(e.busquedas);
  void mandarPendientes();
  // Lo que estaba sonando en OTRO aparato: si aquí no suena nada, se deja listo (en pausa) para seguir.
  const p = usePlayer.getState();
  if (e.cola && e.cola.at > colaGuardadaAt && !p.playing) usePlayer.getState().retomar(e.cola);
}

// ---------------- Entrar y salir de la cuenta ----------------

useCuenta.subscribe((c, antes) => {
  if (c.token === antes.token) return;
  if (!c.token) {
    // Saliste: en este aparato no queda nada tuyo.
    colaInicial = null;
    usePlayer.setState({ ratings: {} });
    useSearchHistory.setState({ queries: [], tracks: [] });
    return;
  }
  // Entraste: tus ajustes, búsquedas, "me gusta" y lo que estaba sonando, en cuanto llegue tu música.
  void (async () => {
    await sincronizarCuenta();
    const { useLibrary } = await import('../library/store');
    const listo = () => useLibrary.getState().tracks.some((t) => t.server);
    if (!listo())
      await new Promise<void>((r) => {
        const fin = useLibrary.subscribe(() => listo() && (fin(), r()));
        setTimeout(() => (fin(), r()), 20_000);
      });
    await usePlayer.getState().restore();
  })();
});
