import { openDB } from 'idb';
import { create } from 'zustand';
import { UNKNOWN_ALBUM, type Track } from '../types';
import { api, useCuenta } from './cuenta';
import { avisarCambioGuardadas, probar, useConexion } from './conexion';

/**
 * Biblioteca del servidor.
 *
 * Las canciones del servidor viven en la biblioteca junto a la música local, con id `s:<id>`. La lista se
 * guarda en el aparato (así se ve aunque no haya conexión) y se actualiza al abrir la app y al volver a ella.
 *
 * El servidor ya hizo el trabajo pesado una vez: datos de MusicBrainz, portada, créditos, ritmo (Automix),
 * volumen (nivelador) y rasgos (algoritmo). La app usa eso y no vuelve a analizar estas canciones.
 *
 * El audio se descarga completo la primera vez que suena (unos 4 MB) y queda guardado en el aparato: la próxima
 * vez suena al instante y también sin conexión. Así funcionan igual el reproductor, el Automix y el vinilo.
 */

export interface CancionServidor {
  id: string;
  titulo: string;
  artista: string;
  album: string | null;
  artista_album: string | null;
  anio: number | null;
  generos: string[];
  pista: number | null;
  duracion: number;
  tamano: string | number;
  portada: string | null;
  subida: string;
  creditos: unknown;
  mb_grabacion: string | null;
  miembros?: string[];
  mb_completado: string[];
  ritmo: Record<string, unknown> | null;
  rasgos: Record<string, unknown> | null;
  lufs: number | null;
  pico: number | null;
  /** Lo que se descarga: mp3, m4a o flac (las canciones viejas no lo traen: mp3). */
  formato?: string;
}

const KEY = 'bibliotecaServidor';
const PREFIJO = 's:';
export const esDelServidor = (id: string | undefined) => !!id && id.startsWith(PREFIJO);
const idServidor = (id: string) => id.slice(PREFIJO.length);

/**
 * La lista se guarda en IndexedDB y no en localStorage: con miles de canciones pesa varios MB y el iPhone solo
 * deja ~5 MB en localStorage (no cabía, y había que bajarla entera cada vez que se abría la app).
 */
const almacen = () => openDB('reproductor-servidor', 1, { upgrade: (db) => db.createObjectStore('kv') });

let lista: CancionServidor[] = [];
let porId = new Map<string, CancionServidor>();
function usar(nueva: CancionServidor[]) {
  lista = nueva;
  porId = new Map(lista.map((c) => [PREFIJO + c.id, c]));
}

/** Carga la lista guardada en el aparato (una vez, al abrir). La biblioteca la espera antes de armarse. */
const listaGuardada: Promise<void> = (async () => {
  try {
    const v = await (await almacen()).get('kv', KEY);
    if (Array.isArray(v)) return usar(v);
  } catch {
    /* sin IndexedDB: se intenta lo de antes */
  }
  try {
    usar(JSON.parse(localStorage.getItem(KEY) ?? '[]')); // aparatos que la tenían guardada a la antigua
  } catch {
    /* nada guardado */
  }
})();
export const esperarListaGuardada = () => listaGuardada;

function guardar(nueva: CancionServidor[]) {
  usar(nueva);
  void (async () => {
    try {
      await (await almacen()).put('kv', nueva, KEY);
      localStorage.removeItem(KEY); // libera el espacio chico (la copia vieja)
    } catch {
      /* sin espacio: queda solo en memoria */
    }
  })();
}

/** Datos del servidor de una canción (`s:<id>`). */
export const datosServidor = (id: string) => porId.get(id);

function aTrack(c: CancionServidor): Track {
  return {
    id: PREFIJO + c.id,
    fileName: `${c.artista} - ${c.titulo}.${c.formato ?? 'mp3'}`,
    format: c.formato ?? 'mp3',
    size: Number(c.tamano) || 0,
    title: c.titulo,
    artist: c.artista,
    album: c.album || UNKNOWN_ALBUM,
    albumArtist: c.artista_album || c.artista,
    year: c.anio ?? undefined,
    genres: c.generos ?? [],
    trackNo: c.pista ?? undefined,
    duration: c.duracion,
    coverId: c.portada ? `p:${c.portada}` : undefined,
    addedAt: Date.parse(c.subida) || 0,
    mbCheckedAt: Date.now(), // los datos ya los completó el servidor
    mbFilled: c.mb_completado?.length ? c.mb_completado : undefined,
    mbRecordingId: c.mb_grabacion ?? undefined,
    server: true,
    members: c.miembros?.length ? c.miembros : undefined,
  };
}

/** Canciones del servidor para la biblioteca (ninguna si no hay sesión). */
export function tracksServidor(): Track[] {
  return useCuenta.getState().token ? lista.map(aTrack) : [];
}

let ultimo = 0;
/**
 * Pide la lista al servidor. Devuelve true si cambió algo (hay que recargar la biblioteca).
 * `forzar` = aunque se haya pedido hace poco.
 */
export async function refrescarServidor(forzar = false): Promise<boolean> {
  if (!useCuenta.getState().token) return false;
  void pedirLlave(); // así la primera canción ya suena sin esperar nada
  if (!forzar && Date.now() - ultimo < 60_000) return false;
  ultimo = Date.now();
  try {
    const nueva = await api<CancionServidor[]>('/api/canciones');
    await listaGuardada;
    if (nueva.length === lista.length && JSON.stringify(nueva) === JSON.stringify(lista)) return false;
    guardar(nueva);
    return true;
  } catch {
    return false; // sin conexión: queda la lista guardada
  }
}

/** Al cerrar sesión, la música del servidor desaparece de este aparato (también lo descargado). */
export async function olvidarServidor() {
  guardar([]);
  guardadas.clear();
  await olvidarDescargas();
  avisarCambioGuardadas();
  llave = null;
  try {
    localStorage.removeItem(LLAVE);
  } catch {
    /* nada */
  }
  try {
    await caches.delete(CACHE);
  } catch {
    /* sin caché */
  }
  try {
    localStorage.removeItem(USO);
  } catch {
    /* nada */
  }
}

// ---------------- Audio y portadas (descargados y guardados en el aparato) ----------------

const CACHE = 'musica-servidor-v1';
const USO = 'musicaServidorUso';
/**
 * La música del servidor vive en el servidor, no en el teléfono: como mucho se guardan 3 canciones (la que
 * suena, la siguiente y la anterior) para que saltar y volver sea instantáneo y para el tocadiscos. Las demás
 * se borran solas (ver podarGuardadas). La música importada en el teléfono no tiene nada que ver con esto.
 */
const MAX_GUARDADAS = 3;

function marcarUso(id: string) {
  try {
    const uso: Record<string, number> = JSON.parse(localStorage.getItem(USO) ?? '{}');
    uso[id] = Date.now();
    const ids = Object.keys(uso);
    if (ids.length > MAX_GUARDADAS) {
      const viejas = ids.sort((a, b) => uso[a] - uso[b]).slice(0, ids.length - MAX_GUARDADAS);
      for (const v of viejas) delete uso[v];
      for (const v of viejas) guardadas.delete(v);
      avisarCambioGuardadas();
      void caches.open(CACHE).then((c) => Promise.all(viejas.map((v) => c.delete(urlAudio(v)))));
    }
    localStorage.setItem(USO, JSON.stringify(uso));
  } catch {
    /* sin almacenamiento */
  }
}

const urlAudio = (id: string) => `${useCuenta.getState().base}/api/canciones/${encodeURIComponent(idServidor(id))}/audio`;

const descargas = new Map<string, Promise<Blob | undefined>>();
const cortes = new Map<string, AbortController>();

/**
 * Corta las descargas en curso (menos la de `salvo`). Se llama al elegir otra canción: así toda la conexión
 * queda para la que el usuario quiere oír AHORA, y no para copias que ya no hacen falta.
 */
export function cancelarDescargas(salvo?: string) {
  for (const [id, c] of cortes) if (id !== salvo) c.abort();
}

/** El MP3 de una canción del servidor: del aparato si ya está, si no se descarga (con la sesión). */
export function audioServidor(id: string): Promise<Blob | undefined> {
  const enCurso = descargas.get(id);
  if (enCurso) return enCurso;
  const p = (async () => {
    const url = urlAudio(id);
    if (descargadas.has(id)) {
      try {
        const hit = await (await caches.open(CACHE_DESC)).match(claveDescarga(id));
        if (hit) return await hit.blob();
      } catch {
        /* se intenta lo de siempre */
      }
    }
    let cache: Cache | null = null;
    try {
      cache = await caches.open(CACHE);
      const hit = await cache.match(url);
      if (hit) {
        marcarUso(id);
        return await hit.blob();
      }
    } catch {
      /* sin Cache API: se descarga igual */
    }
    const { token } = useCuenta.getState();
    if (!token) return undefined;
    const corte = new AbortController();
    cortes.set(id, corte);
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: corte.signal });
      if (r.status === 401) useCuenta.setState({ token: null });
      if (!r.ok) return undefined;
      const blob = await r.blob();
      if (cache) {
        await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } })).then(
          () => {
            guardadas.add(id);
            avisarCambioGuardadas();
          },
          () => {},
        );
        marcarUso(id);
      }
      return blob;
    } catch {
      return undefined; // sin conexión y sin copia guardada
    }
  })().finally(() => {
    descargas.delete(id);
    cortes.delete(id);
  });
  descargas.set(id, p);
  return p;
}

// ---------------- Escuchar al instante (streaming) ----------------

/**
 * Llave de audio: el servidor la da una vez (vale 12 h y para todas las canciones de esta cuenta). Con ella la
 * app arma el enlace de cualquier canción AL TIRO, sin preguntar nada antes de darle play: la canción empieza
 * a sonar mientras llega (streaming).
 */
const LLAVE = 'audioLlave';
let llave: { u: string; v: number; k: string } | null = (() => {
  try {
    return JSON.parse(localStorage.getItem(LLAVE) ?? 'null');
  } catch {
    return null;
  }
})();
let pidiendo: Promise<void> | null = null;

/** Pide (o renueva) la llave si falta o le queda menos de 1 hora. `forzar`: aunque parezca vigente. */
export function pedirLlave(forzar = false): Promise<void> {
  if (!useCuenta.getState().token) return Promise.resolve();
  if (!forzar && llave && llave.v * 1000 - Date.now() > 3600_000) return Promise.resolve();
  pidiendo ??= api<{ u: string; v: number; k: string }>('/api/audio/llave')
    .then((r) => {
      llave = r;
      try {
        localStorage.setItem(LLAVE, JSON.stringify(r));
      } catch {
        /* sin espacio */
      }
    })
    .catch(() => {})
    .finally(() => (pidiendo = null));
  return pidiendo;
}

/** Enlace para escuchar ya (sin esperar nada), o undefined si todavía no hay llave. */
export function urlDirecta(id: string): string | undefined {
  if (!llave || llave.v * 1000 - Date.now() < 60_000) return undefined;
  // r=2: los archivos se aligeraron en el servidor; el número evita mezclar con trozos viejos en caché.
  return `${urlAudio(id)}?u=${llave.u}&v=${llave.v}&k=${llave.k}&r=2`;
}

/** Igual que urlDirecta, pero si falta la llave la pide primero (una sola vez). */
export async function urlParaEscuchar(id: string): Promise<string | undefined> {
  const ya = urlDirecta(id);
  if (ya) return ya;
  await pedirLlave(true);
  return urlDirecta(id);
}

/** Canciones ya guardadas completas en el aparato (se sabe al instante, sin abrir la caché). */
const guardadas = new Set<string>();
void (async () => {
  try {
    for (const r of await (await caches.open(CACHE)).keys()) {
      const m = /\/api\/canciones\/([^/]+)\/audio$/.exec(new URL(r.url).pathname);
      if (m) guardadas.add(PREFIJO + decodeURIComponent(m[1]));
    }
    avisarCambioGuardadas();
  } catch {
    /* sin caché */
  }
})();
/** En el aparato completa: una de las ≤3 temporales o una descargada por el usuario. */
export const estaGuardada = (id: string) => guardadas.has(id) || descargadas.has(id);

// ---------------- Descargas (modo sin conexión) ----------------

/**
 * Canciones que el usuario descargó a propósito. Viven en otra caché que NUNCA se poda sola (a diferencia de
 * las ≤3 temporales): siguen en el aparato hasta que se quitan o se cierra sesión. Suenan sin conexión.
 *
 * La clave no depende de la dirección del servidor (que puede cambiar entre casa y VPS): es fija por canción.
 * Las descargas van de a una, sin cortarse cuando cambias de canción; lo pendiente se recuerda al cerrar la app.
 */
/**
 * La app de PC NO tiene descargas: Windows Defender borra la app si guarda canciones para escuchar sin conexión.
 * Allí no se ofrece descargar, no se baja nada en segundo plano y se borra lo que haya quedado de la beta.73.
 */
export const descargasDisponibles = import.meta.env.VITE_PLATAFORMA !== 'pc';

const CACHE_DESC = 'musica-descargada-v1';
const PENDIENTES = 'descargasPendientes';
const claveDescarga = (id: string) => `https://descargas.edowave/${encodeURIComponent(idServidor(id))}`;
const descargadas = new Set<string>();

interface EstadoDescargas {
  /** Cambia cada vez que se agrega o quita una descarga (para redibujar). */
  v: number;
  /** En espera, en orden. */
  cola: string[];
  /** La que se está bajando ahora. */
  actual?: string;
}
export const useDescargas = create<EstadoDescargas>(() => ({ v: 0, cola: leerPendientes() }));

function leerPendientes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PENDIENTES) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function anotarPendientes() {
  const { cola, actual } = useDescargas.getState();
  try {
    localStorage.setItem(PENDIENTES, JSON.stringify(actual ? [actual, ...cola] : cola));
  } catch {
    /* sin espacio */
  }
}
const cambio = () => {
  useDescargas.setState((s) => ({ v: s.v + 1 }));
  avisarCambioGuardadas();
};

export const estaDescargada = (id: string) => descargadas.has(id);
export const estaEnDescarga = (id: string) => {
  const s = useDescargas.getState();
  return s.actual === id || s.cola.includes(id);
};
export const idsDescargados = () => [...descargadas];
/** Lo que ocupan las descargas (según el tamaño que informa el servidor). */
export const bytesDescargados = () => [...descargadas].reduce((n, id) => n + (Number(porId.get(id)?.tamano) || 0), 0);

const descargasListas: Promise<void> = (async () => {
  if (!descargasDisponibles) {
    try {
      localStorage.removeItem(PENDIENTES);
      useDescargas.setState({ cola: [] });
      await caches.delete(CACHE_DESC);
    } catch {
      /* nada que borrar */
    }
    return;
  }
  try {
    for (const r of await (await caches.open(CACHE_DESC)).keys()) {
      const m = /^\/([^/]+)$/.exec(new URL(r.url).pathname);
      if (m) descargadas.add(PREFIJO + decodeURIComponent(m[1]));
    }
    cambio();
  } catch {
    /* sin caché */
  }
})();

/** Pone canciones en la cola de descarga. Devuelve cuántas se agregaron (las ya descargadas no cuentan). */
export function descargar(ids: string[]): number {
  if (!descargasDisponibles || !useCuenta.getState().token) return 0;
  const { cola, actual } = useDescargas.getState();
  const ya = new Set([...cola, actual]);
  const nuevas = [...new Set(ids)].filter((id) => esDelServidor(id) && !descargadas.has(id) && !ya.has(id));
  if (!nuevas.length) return 0;
  useDescargas.setState({ cola: [...cola, ...nuevas] });
  anotarPendientes();
  // Que el navegador no borre las descargas si le falta espacio.
  void navigator.storage?.persist?.().catch(() => {});
  void procesar();
  return nuevas.length;
}

let procesando = false;
let corteDescarga: AbortController | null = null;
let actualQuitada = false;
const intentos = new Map<string, number>();

async function procesar() {
  if (procesando || !descargasDisponibles) return;
  procesando = true;
  await descargasListas;
  try {
    for (;;) {
      if (!useCuenta.getState().token || !useConexion.getState().servidor) break; // se sigue al volver
      const [id, ...resto] = useDescargas.getState().cola;
      if (!id) break;
      useDescargas.setState({ cola: resto, actual: id });
      actualQuitada = false;
      const ok = await bajarUna(id);
      useDescargas.setState({ actual: undefined });
      if (actualQuitada) {
        // Se quitó mientras bajaba: no queda ni se reintenta.
        if (ok) void caches.open(CACHE_DESC).then((c) => c.delete(claveDescarga(id))).catch(() => {});
      } else if (ok) {
        intentos.delete(id);
        descargadas.add(id);
        cambio();
      } else if (!(await probar())) {
        // Se cortó la conexión: vuelve al principio de la cola y se sigue cuando el servidor conteste.
        useDescargas.setState((s) => ({ cola: [id, ...s.cola] }));
        anotarPendientes();
        break;
      } else {
        const n = (intentos.get(id) ?? 0) + 1;
        intentos.set(id, n);
        if (n < 3) useDescargas.setState((s) => ({ cola: [...s.cola, id] })); // al final, otro intento
      }
      corteDescarga = null;
      anotarPendientes();
    }
  } finally {
    procesando = false;
  }
}

// Al volver la conexión (o al abrir la app con descargas pendientes) se sigue con lo que faltaba.
useConexion.subscribe((s, antes) => {
  if (s.servidor && !antes.servidor) void procesar();
});
if (useDescargas.getState().cola.length) setTimeout(() => void procesar(), 3000);

async function bajarUna(id: string): Promise<boolean> {
  try {
    const url = urlAudio(id);
    // Si ya está entre las 3 temporales, se copia sin volver a bajarla.
    let resp = await (await caches.open(CACHE)).match(url).catch(() => undefined);
    if (!resp) {
      const { token } = useCuenta.getState();
      if (!token) return false;
      corteDescarga = new AbortController();
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: corteDescarga.signal });
      if (r.status === 401) useCuenta.setState({ token: null });
      if (!r.ok) return false;
      resp = r;
    } else corteDescarga = new AbortController();
    const blob = await resp.blob();
    if (corteDescarga.signal.aborted) return false;
    await (await caches.open(CACHE_DESC)).put(claveDescarga(id), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } }));
    // La portada también, para que se vea sin conexión.
    const portada = porId.get(id)?.portada;
    if (portada) void portadaServidor(`p:${portada}`);
    return true;
  } catch {
    return false; // sin conexión o sin espacio
  }
}

/** Quita descargas (y las saca de la cola si estaban esperando). */
export async function quitarDescargas(ids: string[]) {
  const fuera = new Set(ids);
  const { cola, actual } = useDescargas.getState();
  if (actual && fuera.has(actual)) {
    actualQuitada = true;
    corteDescarga?.abort();
  }
  useDescargas.setState({ cola: cola.filter((id) => !fuera.has(id)) });
  for (const id of ids) descargadas.delete(id);
  anotarPendientes();
  cambio();
  try {
    const c = await caches.open(CACHE_DESC);
    await Promise.all(ids.map((id) => c.delete(claveDescarga(id))));
  } catch {
    /* sin caché */
  }
}

async function olvidarDescargas() {
  actualQuitada = true;
  corteDescarga?.abort();
  descargadas.clear();
  useDescargas.setState({ cola: [], actual: undefined });
  anotarPendientes();
  cambio();
  try {
    await caches.delete(CACHE_DESC);
  } catch {
    /* sin caché */
  }
}

/**
 * Borra del teléfono las canciones del servidor que no estén en `mantener` (la que suena, la siguiente y la
 * anterior). Así nunca hay más de 3 guardadas.
 */
export async function podarGuardadas(mantener: (string | undefined)[]) {
  const quedan = new Set(mantener.filter((x): x is string => !!x && esDelServidor(x)));
  const sobran = [...guardadas].filter((id) => !quedan.has(id));
  if (!sobran.length) return;
  for (const id of sobran) guardadas.delete(id);
  avisarCambioGuardadas();
  try {
    const c = await caches.open(CACHE);
    await Promise.all(sobran.map((id) => c.delete(urlAudio(id))));
    const uso: Record<string, number> = JSON.parse(localStorage.getItem(USO) ?? '{}');
    for (const id of sobran) delete uso[id];
    localStorage.setItem(USO, JSON.stringify(uso));
  } catch {
    /* sin caché */
  }
}

/** ¿Ya está guardada en el aparato? (suena al instante y sin conexión) */
export async function audioGuardado(id: string) {
  try {
    return !!(await (await caches.open(CACHE)).match(urlAudio(id)));
  } catch {
    return false;
  }
}

/** Portada del servidor (`p:<archivo>`). No es privada: se guarda en el aparato. */
export async function portadaServidor(coverId: string): Promise<Blob | undefined> {
  const url = `${useCuenta.getState().base}/api/portadas/${encodeURIComponent(coverId.slice(2))}`;
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return await hit.blob();
    const r = await fetch(url);
    if (!r.ok) return undefined;
    await cache.put(url, r.clone());
    return await r.blob();
  } catch {
    return undefined;
  }
}
export const esPortadaServidor = (coverId: string) => coverId.startsWith('p:');

// ---------------- Análisis hechos por el servidor ----------------

/** Rasgos para el algoritmo (mismo formato que los que mide la app). */
export function rasgosServidor() {
  return lista
    .filter((c) => c.rasgos)
    .map((c) => ({ trackId: PREFIJO + c.id, ...(c.rasgos as object), analyzedAt: Date.parse(c.subida) || 0 }));
}

/** Ritmo para el Automix (mismo formato que beats.ts). */
export const ritmoServidor = (id: string) => porId.get(id)?.ritmo ?? undefined;

/** Volumen para el nivelador. */
export function volumenServidor(id: string) {
  const c = porId.get(id);
  return c && c.lufs !== null && c.pico !== null ? { lufs: c.lufs, peak: c.pico } : undefined;
}

/** Créditos (mismo formato que la pantalla "Créditos"). */
export const creditosServidor = (id: string) => porId.get(id)?.creditos ?? null;
