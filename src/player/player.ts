import { create } from 'zustand';
import { diag } from '../diag';
import { getAudio, type PlayEvent } from '../db';
import { cargarValoraciones, guardarValoracion, mandarPendientes, registrarEscucha } from '../server/datosCuenta';
import type { ColaGuardada } from '../server/datosCuenta';
import { aparato, tomarOrigen, versionApp, type Origen } from '../estadisticas';

/**
 * Lo que estaba sonando se guarda en tu cuenta (server/sincronizar.ts pone estas funciones; así este archivo no
 * depende de aquel y no hay importaciones en círculo).
 */
export const colaHooks: { guardar?: (c: Omit<ColaGuardada, 'at'>) => void; inicial?: () => ColaGuardada | null } = {};
import { useLibrary } from '../library/store';
import { loadCover } from '../library/useCover';
import { audioServidor, cancelarDescargas, esDelServidor, estaGuardada, pedirLlave, podarGuardadas, urlDirecta, urlParaEscuchar } from '../server/biblioteca';
import { probar, useConexion } from '../server/conexion';
import { useAutomix } from './automixStore';
import type { Track } from '../types';

export type Repeat = 'off' | 'all' | 'one';

interface PlayerState {
  queue: string[]; // ids de canciones
  index: number;
  playing: boolean;
  position: number;
  duration: number;
  repeat: Repeat;
  shuffle: boolean;
  /** Orden original antes de activar aleatorio, para poder volver. */
  originalQueue: string[] | null;
  expanded: boolean; // reproductor a pantalla completa abierto
  ratings: Record<string, 1 | -1>;

  playTracks: (tracks: Track[], start?: number, opts?: { shuffle?: boolean }) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  jumpTo: (i: number) => void;
  playNext: (t: Track) => void;
  addToQueue: (t: Track) => void;
  removeAt: (i: number) => void;
  /** Mueve una canción de la cola a otro puesto (arrastrándola). */
  mover: (de: number, a: number) => void;
  /** Nombre de la cola ("Mix de Into You") cuando la armó una radio; null si es un álbum/playlist. */
  colaNombre: string | null;
  setRepeat: () => void;
  toggleShuffle: () => void;
  rate: (trackId: string, value: 1 | -1) => void;
  /** Al acabarse la cola, seguir con canciones parecidas (radio). */
  autoplay: boolean;
  setAutoplay: (v: boolean) => void;
  setExpanded: (v: boolean) => void;
  restore: () => Promise<void>;
  /** Deja lista (en pausa) la cola que venía sonando en otro aparato. */
  retomar: (c: ColaGuardada) => void;
}

// Un único elemento <audio> para toda la app. En la fase del ecualizador se conecta a Web Audio.
export const audio = new Audio();
audio.preload = 'auto';
// App de Android: el audio viene de otro origen (el servidor). Así el ecualizador, el rack y el volumen pueden
// procesarlo (sin esto, el navegador lo dejaría en silencio al pasarlo por el circuito de audio).
if (import.meta.env.VITE_SERVIDOR) audio.crossOrigin = 'anonymous';

/**
 * Diagnóstico (26-11-2026): a veces la canción vuelve al inicio a los ~4 s. Se anota en el registro técnico todo
 * retroceso de más de 1 s: si lo pidió el código (con quién lo pidió) o si lo hizo el navegador solo.
 */
const origenSrc = () => (audio.currentSrc.startsWith('blob:') ? 'blob' : audio.currentSrc.includes('/audio?') ? 'stream' : 'otro');
const quienLlama = () =>
  (new Error().stack ?? '')
    .split('\n')
    .slice(3, 7)
    .map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+/, ''))
    .join(' < ');
let saltoPedido = false;
{
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  if (desc?.get && desc.set) {
    const get = desc.get;
    const setT = desc.set;
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get() {
        return get.call(audio);
      },
      set(v: number) {
        const antes = get.call(audio) as number;
        if (v < antes - 1) {
          saltoPedido = true;
          diag('reproductor: retroceso pedido', { de: antes, a: v, src: origenSrc(), quien: quienLlama() });
        }
        setT.call(audio, v);
      },
    });
  }
}
let ultimoVisto = 0;
audio.addEventListener('timeupdate', () => {
  const t = audio.currentTime;
  if (t < ultimoVisto - 1 && !saltoPedido)
    diag('reproductor: retroceso del navegador', { de: ultimoVisto, a: t, src: origenSrc(), listo: audio.readyState, red: audio.networkState });
  saltoPedido = false;
  ultimoVisto = t;
});
for (const ev of ['loadstart', 'emptied', 'abort', 'stalled', 'error'] as const)
  audio.addEventListener(ev, () => {
    if (ultimoVisto > 1 || ev === 'error') diag(`reproductor: evento ${ev}`, { pos: ultimoVisto, src: origenSrc(), err: audio.error?.code ?? '' });
    if (ev === 'loadstart' || ev === 'emptied') ultimoVisto = 0;
  });

// Solo en desarrollo: si este archivo se recarga en caliente, el reproductor viejo se calla (si no, seguiría
// sonando "huérfano" la canción anterior y el nuevo no podría pararlo). En la app instalada no existe.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  });
}

/** Se ejecutan justo antes de cada play (p. ej., el ecualizador reanuda su circuito de audio). */
export const beforePlay: (() => void)[] = [];
export function startAudio() {
  for (const fn of beforePlay) fn();
  return audio.play();
}

/**
 * Modo vinilo (scratch.ts): cuando está activo, el sonido sale del motor del tocadiscos y no del <audio>.
 * Se conecta así para evitar dependencias circulares.
 */
export const deckHooks: {
  owns?: () => boolean;
  pos?: () => number;
  onLoad?: (id: string, at: number, autoplay: boolean) => void;
  play?: () => void;
  pause?: () => void;
  seek?: (sec: number) => void;
  /** Automix: las dos canciones están sonando a la vez. */
  mixing?: () => boolean;
  cancelMix?: () => void;
} = {};
const deckOwns = () => !!deckHooks.owns?.();
/** Posición real de la canción (del motor del vinilo o del reproductor normal). */
export const playerPos = () => (deckOwns() ? deckHooks.pos!() : audio.currentTime);

/** El ecualizador pone aquí una pausa suave (ver equalizer.ts: evita el saltito al reanudar). */
export const elementHooks: { pause?: () => void } = {};

/** El algoritmo (reco/store.ts) pone aquí la función que elige las siguientes canciones de la radio. */
export const radioProvider: { next?: (queue: string[], index: number, n?: number) => Promise<string[]> } = {};

function readAutoplay() {
  try {
    return localStorage.getItem('autoplay') !== 'off';
  } catch {
    return true;
  }
}

/**
 * Si estás en la última canción de la cola (y la reproducción automática está activa),
 * agrega 5 canciones parecidas al final. Devuelve si agregó algo.
 */
let pidiendoRadio: Promise<boolean> | null = null;
/**
 * Se piden más canciones cuando quedan `margen` o menos por sonar (así siempre hay margen, aunque tarde), de a
 * `pedir`. La versión de PC usa más (se ve la fila completa al lado): ver escritorio/Escritorio.tsx.
 */
export const radioAjustes = { margen: 2, pedir: 5 };
/**
 * La radio la decide el servidor (con tu historial de la cuenta). Es infinita: si una vez no llega nada (sin
 * conexión, o el servidor eligió algo que aún no está en este aparato), se reintenta, y al terminar cada
 * canción se vuelve a pedir.
 */
function extendWithRadio(): Promise<boolean> {
  if (pidiendoRadio) return pidiendoRadio;
  // Ojo: la marca de "pidiendo" se borra cuando la promesa termina, NO dentro de ella. Si se borraba adentro
  // (en un finally) y la función salía de inmediato ("todavía no hace falta"), el borrado pasaba ANTES de
  // guardar la marca: quedaba puesta para siempre y la radio nunca volvía a pedir (se cortaba a las ~20).
  const p = (async () => {
    {
      for (let intento = 0; intento < 3; intento++) {
        const s = usePlayer.getState();
        if (!s.autoplay || s.repeat !== 'off' || !radioProvider.next) return false;
        const quedan = s.queue.length - 1 - s.index;
        if (quedan > radioAjustes.margen) return false;
        const n = Math.max(radioAjustes.pedir, radioAjustes.margen + 1 - quedan);
        const more = (await radioProvider.next(s.queue, s.index, n).catch(() => [] as string[])).filter((id) => trackById(id));
        const now = usePlayer.getState();
        // Mientras tanto cambiaste la cola: se pide de nuevo con la cola nueva (solo si sigue siendo el final).
        if (now.queue !== s.queue) continue;
        const ya = new Set(now.queue);
        const nuevas = more.filter((id) => !ya.has(id));
        if (!nuevas.length) {
          await new Promise((r) => setTimeout(r, 1500 * (intento + 1)));
          continue;
        }
        // La radio SIEMPRE va al final de la cola (después de todo el álbum/playlist, aunque esté barajado), y se
        // agrega igual a originalQueue para que al quitar el aleatorio no se mezcle con lo propio.
        usePlayer.setState({
          queue: (marcarRadio(nuevas), [...now.queue, ...nuevas]),
          originalQueue: now.originalQueue ? [...now.originalQueue, ...nuevas] : null,
        });
        saveSoon();
        return true;
      }
      return false;
    }
  })().catch(() => false);
  pidiendoRadio = p;
  void p.finally(() => {
    if (pidiendoRadio === p) pidiendoRadio = null;
  });
  return p;
}

/** Estadísticas: origen de la cola actual y canciones que agregó la radio. */
let origenCola: Origen = 'otro';
const deRadio = new Set<string>();
export function marcarRadio(ids: string[]) {
  for (const id of ids) deRadio.add(id);
}

let currentUrl: string | null = null;

/** Hasta dónde llegó a cargar el <audio> (segundos), mirando el tramo donde va la reproducción. */
function cargadoHasta() {
  const b = audio.buffered;
  const t = audio.currentTime;
  for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
  return 0;
}

/**
 * Se cumple cuando la canción que suena por streaming ya terminó de llegar (o lleva 90 s de ventaja): recién
 * ahí la conexión queda libre para otra cosa. `false` si mientras tanto se cambió de canción.
 * Con una canción que no viene por streaming (del teléfono o ya guardada) se cumple al tiro.
 */
function streamCargado(token: number): Promise<boolean> {
  return new Promise((listo) => {
    const mirar = () => {
      if (token !== loadToken) return listo(false);
      if (!currentUrl?.includes('/audio?')) return listo(true);
      const d = audio.duration;
      const fin = cargadoHasta();
      if (Number.isFinite(d) && d > 0 && audio.readyState >= 3 && (fin >= d - 2 || fin - audio.currentTime >= 90)) return listo(true);
      setTimeout(mirar, 1000);
    };
    mirar();
  });
}
/** Lo mismo para la canción actual (lo usa el tocadiscos antes de bajar la canción entera). */
export const streamActualCargado = () => streamCargado(loadToken);

/**
 * UNA sola cosa a la vez por la conexión: primero el streaming de lo que suena. Cuando ya llegó entero, se
 * guarda la SIGUIENTE de la cola (así saltar o pasar de canción es instantáneo). La que suena no se vuelve a
 * bajar. Si el usuario elige otra canción, lo que se estuviera guardando se corta (ver `load`).
 */
async function descargarCuandoSuene(token: number) {
  if (!(await streamCargado(token))) return;
  const s = usePlayer.getState();
  const sig = s.queue[s.index + 1];
  // Solo quedan guardadas la que suena, la anterior y la siguiente (máximo 3).
  await podarGuardadas([s.queue[s.index], s.queue[s.index - 1], sig]);
  if (token !== loadToken) return;
  if (sig && esDelServidor(sig) && useConexion.getState().servidor) void audioServidor(sig);
}

/**
 * La canción del servidor no carga (o se quedó esperando datos): si el servidor se cayó, se avisa y se pasa a
 * lo que sí puede sonar; si el servidor está bien (p. ej. venció la llave), se renueva y se reintenta.
 */
let reintentoDirecto = 0;
async function directaFallo(lento = false) {
  if (!currentUrl?.includes('/audio?')) return;
  const { index, playing } = usePlayer.getState();
  // En modo vinilo la posición real es la del plato, no la del <audio> (que va en silencio).
  const at = deckOwns() ? usePlayer.getState().position : audio.currentTime || usePlayer.getState().position;
  if (!(await probar())) {
    // Sin servidor: NO se avisa ni se salta de canción todavía (puede ser un segundo sin señal). Se espera en
    // silencio y, apenas vuelve, la canción sigue donde iba. Solo si pasan 1:30 sin servidor, se salta a lo
    // que esté guardado en el teléfono.
    diag('reproductor: el servidor no contesta, se espera', { pos: at });
    esperarServidor(index, playing, at);
    return;
  }
  // El servidor responde y el <audio> no dio error: la conexión solo va lenta. Recargar tiraría lo ya cargado.
  if (lento && !audio.error) {
    const fin = cargadoHasta();
    const avanza = fin > ultimoCargado + 0.5;
    ultimoCargado = fin;
    esperasSeguidas = avanza ? 0 : esperasSeguidas + 1;
    if (esperasSeguidas < 3) {
      clearTimeout(esperando);
      if (audio.readyState < 3 && !audio.paused) esperando = setTimeout(() => void directaFallo(true), 12_000);
      return;
    }
    esperasSeguidas = 0; // más de medio minuto sin recibir nada: ahí sí se vuelve a pedir
  }
  if (Date.now() - reintentoDirecto < 10_000) return;
  reintentoDirecto = Date.now();
  diag('reproductor: el enlace directo falló, se renueva la llave', { pos: at });
  void pedirLlave(true).then(() => load(index, playing, at));
}
let esperandoServidor: ReturnType<typeof setInterval> | undefined;
function esperarServidor(index: number, sonar: boolean, at: number) {
  clearInterval(esperandoServidor);
  const desde = Date.now();
  const token = loadToken;
  esperandoServidor = setInterval(async () => {
    if (token !== loadToken) return clearInterval(esperandoServidor); // ya cambiaste de canción
    if (await probar()) {
      clearInterval(esperandoServidor);
      diag('reproductor: volvió el servidor, sigue la canción', { pos: at });
      void pedirLlave(true).then(() => load(index, sonar, at));
    } else if (Date.now() - desde > 90_000) {
      clearInterval(esperandoServidor);
      saltarADisponible(index, sonar);
    }
  }, 4000);
}
audio.addEventListener('error', () => void directaFallo());
// Esperando datos más de 12 s: se revisa la conexión (sin recargar si solo va lenta).
let esperando: ReturnType<typeof setTimeout> | undefined;
let esperasSeguidas = 0;
let ultimoCargado = 0;
audio.addEventListener('waiting', () => {
  clearTimeout(esperando);
  esperando = setTimeout(() => void directaFallo(true), 12_000);
});
for (const ev of ['playing', 'pause', 'emptied'] as const)
  audio.addEventListener(ev, () => {
    clearTimeout(esperando);
    esperasSeguidas = 0;
  });

/** ¿Esta canción puede sonar ahora? (Sin conexión, solo la del teléfono y las guardadas.) */
// Solo se da por perdida una canción del servidor si el servidor lleva más de 1:30 sin contestar.
export const puedeSonar = (id: string) => !esDelServidor(id) || estaGuardada(id) || !useConexion.getState().largo;

/** Sin conexión: pasa a la próxima de la cola que sí pueda sonar; si no hay ninguna, queda en pausa. */
function saltarADisponible(desde: number, sonar: boolean) {
  const { queue } = usePlayer.getState();
  for (let j = desde + 1; j < queue.length; j++) {
    if (puedeSonar(queue[j])) {
      void load(j, sonar);
      return;
    }
  }
  if (deckOwns()) deckHooks.pause!();
  else audio.pause();
  usePlayer.setState({ playing: false });
}
let loadToken = 0;

export function trackById(id: string | undefined): Track | undefined {
  if (!id) return undefined;
  return trackMap().get(id);
}
let cachedTracks: Track[] | null = null;
let cachedMap = new Map<string, Track>();
function trackMap() {
  const tracks = useLibrary.getState().tracks;
  if (tracks !== cachedTracks) {
    cachedTracks = tracks;
    cachedMap = new Map(tracks.map((t) => [t.id, t]));
  }
  return cachedMap;
}

export const currentTrack = (s: PlayerState) => trackById(s.queue[s.index]);

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- Registro de escuchas (para el algoritmo) ---------- */

let session: { trackId: string; startedAt: number; listened: number; prevTrackId?: string } | null = null;
let lastTime = 0;
let lastFinishedId: string | undefined;

/** El motor del vinilo suma aquí lo escuchado (el <audio> no avanza de verdad en ese modo). */
export function addListened(sec: number) {
  if (session) session.listened += sec;
}

function startSession(trackId: string) {
  session = { trackId, startedAt: Date.now(), listened: 0, prevTrackId: lastFinishedId };
  lastTime = 0;
}

/**
 * Cierra la escucha actual y la guarda. `ended` = terminó sola.
 * `closing` = la app se está cerrando: IndexedDB no alcanza a escribir, así que se deja en
 * localStorage (que es instantáneo) y se pasa a la base de datos al volver a abrir.
 */
function flushSession(ended: boolean, closing = false) {
  const s = session;
  session = null;
  if (!s || s.listened < 0.5) return;
  const t = trackById(s.trackId);
  const duration = t?.duration || audio.duration || 0;
  const completed = ended || (duration > 0 && s.listened >= duration * 0.9);
  // "Saltada": la cambiaste antes de escuchar la mitad (o 30 s si es muy larga).
  const skipped = !completed && s.listened < Math.min(30, duration * 0.5);
  lastFinishedId = s.trackId;
  const event: PlayEvent = {
    trackId: s.trackId,
    startedAt: s.startedAt,
    listened: Math.round(s.listened),
    duration: Math.round(duration),
    completed,
    skipped,
    prevTrackId: s.prevTrackId,
    origen: deRadio.has(s.trackId) ? 'radio' : origenCola,
    aparato,
    version: versionApp,
  };
  // A tu cuenta (si la app se está cerrando, queda lista para mandarse al volver a abrirla).
  registrarEscucha(event, closing);
}

/** Manda a tu cuenta las escuchas que quedaron pendientes (al cerrar la app o sin conexión). */
async function savePendingPlays() {
  await mandarPendientes();
}

/* ---------- Motor ---------- */

async function load(index: number, autoplay: boolean, startAt = 0) {
  const { queue } = usePlayer.getState();
  const id = queue[index];
  if (!id) return;
  flushSession(false);
  const token = ++loadToken;
  falseEnds = 0;
  cancelarDescargas(id); // toda la conexión para la canción que se eligió
  usePlayer.setState({ index, position: startAt, duration: trackById(id)?.duration ?? 0 });

  // Sin conexión con el servidor y la canción no está en el teléfono: se pasa a la próxima que sí suene.
  if (!puedeSonar(id)) {
    loadToken++;
    saltarADisponible(index, autoplay);
    return;
  }
  // Canción del servidor que todavía no está en el aparato: suena YA por streaming (sin esperar la descarga).
  // Se guarda completa después, cuando ya está sonando (ver descargarCuandoSuene).
  let src: string | undefined;
  if (esDelServidor(id) && !estaGuardada(id)) src = urlDirecta(id) ?? (await urlParaEscuchar(id));
  if (token !== loadToken) return; // el usuario ya cambió de canción
  if (!src) {
    const blob = await getAudio(id);
    if (token !== loadToken) return;
    if (!blob) {
      console.warn('Falta el audio de', id);
      return;
    }
    src = URL.createObjectURL(blob);
  }
  if (currentUrl?.startsWith('blob:')) URL.revokeObjectURL(currentUrl);
  currentUrl = src;
  audio.src = currentUrl;
  if (startAt) {
    audio.addEventListener('loadedmetadata', () => (audio.currentTime = startAt), { once: true });
  }
  deckHooks.onLoad?.(id, startAt, autoplay);
  startSession(id);
  lastTime = startAt;
  // Primero que suene; lo demás (carátula en la pantalla de bloqueo, guardar la sesión, radio) justo después.
  const sonar = autoplay ? startAudio().catch(() => usePlayer.setState({ playing: false })) : Promise.resolve();
  setTimeout(() => {
    if (token !== loadToken) return;
    updateMediaSession(id);
    saveSoon();
    void extendWithRadio();
  }, 60);
  void descargarCuandoSuene(token);
  await sonar;
}

// En modo vinilo, "sonando" lo decide el motor del tocadiscos (solo cambia con el botón de play/pausa).
audio.addEventListener('play', () => !deckOwns() && usePlayer.setState({ playing: true }));
audio.addEventListener('pause', () => !deckOwns() && usePlayer.setState({ playing: false }));
audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration)) usePlayer.setState({ duration: audio.duration });
});
audio.addEventListener('timeupdate', () => {
  if (deckOwns()) return; // en modo vinilo la posición la lleva el motor
  const t = audio.currentTime;
  const d = t - lastTime;
  // Solo suma lo escuchado de verdad (no los saltos al mover la barra).
  if (session && d > 0 && d < 1.5) session.listened += d;
  lastTime = t;
  usePlayer.setState({ position: t });
  if (Math.floor(t) % 5 === 0) saveSoon();
});
audio.addEventListener('seeked', () => (lastTime = audio.currentTime));
audio.addEventListener('ended', () => {
  if (deckOwns()) return; // en modo vinilo el final lo avisa el motor
  const d = audio.duration;
  // Protección: en el iPhone, Safari a veces "corta" la canción en el punto donde se pausó (la duración pasa a
  // ser la posición de la pausa, o 0) y avisa "terminó". Se compara con la duración real guardada en la
  // biblioteca; si falta mucho, se vuelve a cargar el archivo en ese punto en vez de pasar a la siguiente.
  const s0 = usePlayer.getState();
  const known = trackById(s0.queue[s0.index])?.duration ?? 0;
  const real = Math.max(known, Number.isFinite(d) ? d : 0);
  if (falseEnds < 2 && (real < 1 || audio.currentTime < real - 2)) {
    falseEnds++;
    diag('reproductor: "terminó" falso, recarga', { pos: audio.currentTime, dur: d, real });
    void reloadAt(audio.currentTime, true);
    return;
  }
  diag('reproductor: canción terminada', { pos: audio.currentTime, dur: d });
  onTrackEnd();
});

/** La canción llegó al final (la llama el <audio> o el motor del vinilo). */
export function onTrackEnd() {
  flushSession(true);
  const s = usePlayer.getState();
  if (s.repeat === 'one') {
    startSession(s.queue[s.index]);
    if (deckOwns()) deckHooks.seek!(0);
    else {
      audio.currentTime = 0;
      startAudio();
    }
    return;
  }
  advance(true);
}
window.addEventListener('pagehide', () => {
  saveNow();
  flushSession(false, true);
  // La próxima vez que se reproduzca, empieza una escucha nueva (si la página vuelve del caché).
  if (!audio.paused) startSession(usePlayer.getState().queue[usePlayer.getState().index]);
});

/** "Terminó" falsos seguidos en la canción actual (después de 2 se cree, para nunca quedar en un ciclo). */
let falseEnds = 0;

/**
 * Vuelve a cargar el archivo actual y lo deja en `at`. En el iPhone, después de pausar el reproductor
 * mientras suena el vinilo, Safari a veces deja el audio "cortado" en ese punto; recargarlo lo arregla.
 */
export function reloadAt(at: number, play: boolean): Promise<void> {
  if (!currentUrl) return Promise.resolve();
  diag('reproductor: recarga el audio', { pos: at, sonar: play });
  return new Promise((res) => {
    audio.addEventListener(
      'loadedmetadata',
      () => {
        audio.currentTime = at;
        lastTime = at;
        if (play) startAudio().catch(() => {}).finally(res);
        else res();
      },
      { once: true },
    );
    audio.load();
  });
}

/**
 * Automix: terminó la mezcla y la siguiente ya está sonando (en el motor, desde `pos`).
 * La anterior cuenta como escuchada completa.
 */
export function onMixAdvance(id: string, pos: number) {
  const s = usePlayer.getState();
  const i = s.queue[s.index + 1] === id ? s.index + 1 : s.queue.indexOf(id, s.index + 1);
  if (i < 0) return;
  flushSession(true);
  void load(i, true, pos);
}

/** Pasa a la siguiente. `auto` = porque terminó la anterior. */
/** Avances automáticos recientes: si hay muchos seguidos en pocos segundos, algo anda mal y se detiene. */
let autoAdvances: number[] = [];
let autoBlockedUntil = 0;

/** Escuchar con un amigo: mientras se le sigue, al terminar la canción se espera la que ponga él. */
export const juntosHooks: {
  siguiendo?: () => boolean;
  /** Escuchando con un amigo: el que escucha no puede saltar, retroceder ni elegir otra canción (true = bloqueado). */
  bloqueado?: () => boolean;
} = {};
const bloqueado = () => !!juntosHooks.bloqueado?.();

/**
 * Party (server/party.ts pone estas funciones):
 *  - `control`: un invitado tocó un control; la Party decide qué hacer (pasárselo al anfitrión, agregar la
 *    canción a la fila…). true = ya se encargó (el reproductor no hace nada más).
 *  - `siguiente`: soy el anfitrión y hay canciones agregadas: la próxima que debe sonar (antes que mi cola).
 */
export type AccionParty = 'toggle' | 'next' | 'prev' | 'seek' | 'elegir' | 'cola';
export const partyHooks: {
  control?: (accion: AccionParty, tracks?: Track[], inicio?: number) => boolean;
  siguiente?: () => string | null;
  /** En una Party no se usan repetir ni aleatorio (true = bloqueado; la Party avisa por qué). */
  sinModos?: () => boolean;
} = {};
const party = (accion: AccionParty, tracks?: Track[], inicio?: number) => !!partyHooks.control?.(accion, tracks, inicio);

/** ¿Ya se recuperó la cola de la sesión anterior? (al recargar la página) */
export const colaRecuperada = () => restored;

/** Pone a sonar la canción `index` de la cola actual en un punto exacto, sin cambiar la cola (Party: retomar). */
export function playIndexAt(index: number, at: number, play: boolean) {
  return load(index, play, at);
}

/** Pone a sonar una canción en un punto exacto (lo usa "Escuchar juntos"). */
export function playIdAt(id: string, at: number, play: boolean) {
  usePlayer.setState({ queue: [id], originalQueue: null, shuffle: false });
  origenCola = 'amigos'; // escuchando con un amigo
  deRadio.clear();
  return load(0, play, at);
}

function advance(auto: boolean) {
  const s = usePlayer.getState();
  if (auto && juntosHooks.siguiendo?.()) {
    if (deckOwns()) deckHooks.pause!();
    else audio.pause();
    return;
  }
  if (auto) {
    const now = Date.now();
    if (now < autoBlockedUntil) {
      diag('reproductor: avance automático bloqueado (protección activa)');
      audio.pause();
      return;
    }
    autoAdvances = [...autoAdvances.filter((t) => now - t < 4000), now];
    if (autoAdvances.length >= 3) {
      diag('reproductor: varios avances seguidos, se detiene por seguridad', { veces: autoAdvances.length });
      autoAdvances = [];
      autoBlockedUntil = now + 3000;
      audio.pause();
      return;
    }
    diag('reproductor: avanza sola', { de: s.index, cola: s.queue.length });
  }
  // Party (anfitrión): lo que agregó el grupo suena antes que el resto de la cola.
  const dePa = partyHooks.siguiente?.();
  if (dePa && trackById(dePa)) {
    const queue = [...s.queue];
    queue.splice(s.index + 1, 0, dePa);
    usePlayer.setState({ queue, originalQueue: s.originalQueue ? [...s.originalQueue, dePa] : null });
    return load(s.index + 1, true);
  }
  if (s.index + 1 < s.queue.length) return load(s.index + 1, true);
  if (s.repeat === 'all' && s.queue.length) return load(0, true);
  // Fin de la cola: continúa la radio con canciones parecidas (si está activada; la pide al servidor).
  void extendWithRadio().then((ok) => {
    const now = usePlayer.getState();
    if (ok && now.index + 1 < now.queue.length) return load(now.index + 1, true);
    if (auto) quedarAlFinal();
  });
}

/** Se acabó la cola y no hay radio: queda al principio de la última canción, en pausa. */
function quedarAlFinal() {
  if (deckOwns()) {
    deckHooks.pause!();
    deckHooks.seek!(0);
  } else {
    audio.pause();
    audio.currentTime = 0;
  }
}

/* ---------- Estado ---------- */

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  playing: false,
  position: 0,
  duration: 0,
  repeat: 'off',
  shuffle: false,
  originalQueue: null,
  expanded: false,
  ratings: {},
  autoplay: readAutoplay(),

  playTracks(tracks, start = 0, opts) {
    if (!tracks.length || party('elegir', tracks, start) || bloqueado()) return;
    set({ colaNombre: null });
    // Estadísticas: desde dónde se puso esta cola (lo que agregue la radio después cuenta como "radio").
    origenCola = tomarOrigen();
    deRadio.clear();
    let ids = tracks.map((t) => t.id);
    let index = start;
    let originalQueue: string[] | null = null;
    const shuffle = opts?.shuffle ?? get().shuffle;
    if (shuffle) {
      originalQueue = ids;
      const first = opts?.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[start];
      ids = [first, ...shuffled(ids.filter((id) => id !== first))];
      index = 0;
    }
    set({ queue: ids, originalQueue, shuffle });
    load(index, true);
  },

  toggle() {
    if (party('toggle') || !get().queue.length || bloqueado()) return;
    if (!audio.src) {
      load(get().index, true, get().position);
      return;
    }
    if (deckOwns()) {
      // Tocadiscos: el plato arranca o frena (y el <audio> silencioso lo acompaña).
      if (get().playing) deckHooks.pause!();
      else deckHooks.play!();
      return;
    }
    if (audio.paused) startAudio().catch(() => {});
    else if (elementHooks.pause) elementHooks.pause();
    else audio.pause();
  },

  next: () => {
    if (!party('next') && !bloqueado()) advance(false);
  },

  prev() {
    if (party('prev') || bloqueado()) return;
    // Automix: en mitad de una mezcla, "anterior" la cancela y queda sonando sola la que se iba.
    if (deckHooks.mixing?.()) {
      deckHooks.cancelMix!();
      return;
    }
    const s = get();
    const t = playerPos();
    if (t > 3 || s.index === 0) {
      if (s.index === 0 && s.repeat === 'all' && t <= 3 && s.queue.length > 1) {
        load(s.queue.length - 1, true);
        return;
      }
      get().seek(0);
      return;
    }
    load(s.index - 1, true);
  },

  seek(sec) {
    if (party('seek') || bloqueado()) return;
    if (!audio.src) {
      set({ position: sec });
      return;
    }
    if (deckOwns()) deckHooks.seek!(sec);
    else audio.currentTime = sec;
    set({ position: sec });
  },

  jumpTo: (i) => {
    if (!party('elegir') && !bloqueado()) load(i, true);
  },

  playNext(t) {
    if (party('cola', [t])) return;
    const s = get();
    if (!s.queue.length) return get().playTracks([t]);
    const queue = [...s.queue];
    queue.splice(s.index + 1, 0, t.id);
    set({ queue, originalQueue: s.originalQueue ? [...s.originalQueue, t.id] : null });
    saveSoon();
  },

  addToQueue(t) {
    if (party('cola', [t])) return;
    const s = get();
    if (!s.queue.length) return get().playTracks([t]);
    set({ queue: [...s.queue, t.id], originalQueue: s.originalQueue ? [...s.originalQueue, t.id] : null });
    saveSoon();
  },

  colaNombre: null,

  mover(de, a) {
    const s = get();
    if (de === a || de < 0 || a < 0 || de >= s.queue.length || a >= s.queue.length) return;
    const queue = [...s.queue];
    const [x] = queue.splice(de, 1);
    queue.splice(a, 0, x);
    // La que suena sigue siendo la misma (solo cambia de puesto).
    let index = s.index;
    if (de === s.index) index = a;
    else if (de < s.index && a >= s.index) index--;
    else if (de > s.index && a <= s.index) index++;
    set({ queue, index, originalQueue: null, shuffle: false });
    saveSoon();
  },

  removeAt(i) {
    const s = get();
    if (i === s.index) return; // la que suena no se quita
    const queue = s.queue.filter((_, k) => k !== i);
    set({ queue, index: i < s.index ? s.index - 1 : s.index });
    saveSoon();
  },

  setRepeat() {
    if (partyHooks.sinModos?.()) return;
    const order: Repeat[] = ['off', 'all', 'one'];
    set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3] });
    saveSoon();
  },

  toggleShuffle() {
    if (partyHooks.sinModos?.()) return;
    const s = get();
    const cur = s.queue[s.index];
    if (!s.shuffle) {
      // Solo se baraja lo propio de la cola (el álbum, la playlist...). Lo que agregó la radio se queda DETRÁS, en
      // su orden: si se mezclaba con lo demás, al barajar un álbum la radio se colaba entre sus canciones.
      const resto = s.queue.filter((_, k) => k !== s.index);
      const propias = shuffled(resto.filter((id) => !deRadio.has(id)));
      const deLaRadio = resto.filter((id) => deRadio.has(id));
      const rest = [...propias, ...deLaRadio];
      set({ shuffle: true, originalQueue: s.queue, queue: cur ? [cur, ...rest] : rest, index: 0 });
    } else {
      const queue = s.originalQueue ?? s.queue;
      set({ shuffle: false, originalQueue: null, queue, index: Math.max(0, queue.indexOf(cur)) });
    }
    saveSoon();
  },

  rate(trackId, value) {
    const ratings = { ...get().ratings };
    const nextValue = ratings[trackId] === value ? 0 : value; // tocar de nuevo lo quita
    if (nextValue === 0) delete ratings[trackId];
    else ratings[trackId] = nextValue;
    set({ ratings });
    void guardarValoracion(trackId, nextValue);
    // "No me gusta" NO salta la canción (podría ser un toque sin querer): solo hace que se recomiende mucho menos.
  },

  setExpanded: (expanded) => set({ expanded }),

  retomar(c) {
    const known = trackMap();
    const queue = (c.queue ?? []).filter((id) => known.has(id));
    if (!queue.length || get().playing) return;
    const cur = c.queue[c.index];
    if (get().queue[get().index] === cur && get().queue.length === queue.length) return;
    const index = Math.max(0, queue.indexOf(cur));
    set({
      queue,
      index,
      position: c.position ?? 0,
      duration: trackById(queue[index])?.duration ?? 0,
      repeat: c.repeat ?? 'off',
      shuffle: !!c.shuffle,
      originalQueue: c.originalQueue?.filter((id) => known.has(id)) ?? null,
    });
    updateMediaSession(queue[index]);
  },

  setAutoplay(autoplay) {
    set({ autoplay });
    try {
      localStorage.setItem('autoplay', autoplay ? 'on' : 'off');
    } catch {
      /* sin espacio */
    }
    if (autoplay) void extendWithRadio();
  },

  async restore() {
    await savePendingPlays();
    // Tus "me gusta" y lo que estaba sonando vienen de tu cuenta (iguales en todos tus aparatos).
    const ratings = Object.fromEntries((await cargarValoraciones()).map((r) => [r.trackId, r.value]));
    set({ ratings });
    try {
      // Si el usuario ya puso algo a sonar mientras cargaba, eso manda.
      if (get().queue.length) return;
      const saved = colaHooks.inicial?.();
      if (!saved) return;
      const known = trackMap();
      const queue: string[] = (saved.queue ?? []).filter((id: string) => known.has(id));
      if (!queue.length) return;
      const index = Math.max(0, queue.indexOf(saved.queue[saved.index]));
      set({
        queue,
        index,
        position: saved.position ?? 0,
        duration: trackById(queue[index])?.duration ?? 0,
        repeat: saved.repeat ?? 'off',
        shuffle: !!saved.shuffle,
        originalQueue: saved.originalQueue?.filter((id: string) => known.has(id)) ?? null,
      });
      updateMediaSession(queue[index]);
    } catch {
      /* sesión guardada dañada: empezamos de cero */
    } finally {
      restored = true;
      saveSoon();
    }
  },
}));

/* ---------- Guardar la sesión (cola y posición) ---------- */

let saveTimer: number | undefined;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 500);
}
/** Hasta recuperar la sesión anterior no se guarda nada: si no, una cola vacía pisaría la buena. */
let restored = false;
function saveNow() {
  if (!restored) return;
  const s = usePlayer.getState();
  // Lo que está sonando se guarda en tu cuenta (así puedes seguir en otro aparato).
  colaHooks.guardar?.({
    queue: s.queue,
    index: s.index,
    position: playerPos() || s.position,
    repeat: s.repeat,
    shuffle: s.shuffle,
    originalQueue: s.originalQueue,
  });
}

/* ---------- Controles del sistema (notificación / pantalla de bloqueo / teclas multimedia) ---------- */

async function updateMediaSession(id: string) {
  if (!('mediaSession' in navigator)) return;
  const t = trackById(id);
  if (!t) return;
  let artwork: MediaImage[] = [];
  if (t.coverId) {
    const src = await loadCover(t.coverId);
    if (src) artwork = [{ src, sizes: '512x512' }];
  }
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork });
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const p = () => usePlayer.getState();
  ms.setActionHandler('play', () => p().toggle());
  ms.setActionHandler('pause', () => p().toggle());
  ms.setActionHandler('nexttrack', () => p().next());
  ms.setActionHandler('previoustrack', () => p().prev());
  // En Automix la línea de tiempo no se puede mover (tampoco desde la pantalla de bloqueo).
  ms.setActionHandler('seekto', (d) => d.seekTime !== undefined && !useAutomix.getState().on && p().seek(d.seekTime));
  usePlayer.subscribe((s, old) => {
    if (s.playing !== old.playing) ms.playbackState = s.playing ? 'playing' : 'paused';
    if (s.position !== old.position && s.duration && Number.isFinite(s.duration)) {
      try {
        ms.setPositionState({ duration: s.duration, position: Math.min(s.position, s.duration), playbackRate: 1 });
      } catch {
        /* valores fuera de rango mientras carga */
      }
    }
  });
}
