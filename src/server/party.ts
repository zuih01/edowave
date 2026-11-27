import { create } from 'zustand';
import { sincronizarBiblioteca } from '../library/store';
import { esDelServidor } from './biblioteca';
import { colaRecuperada, juntosHooks, partyHooks, playIdAt, playIndexAt, playerPos, trackById, usePlayer } from '../player/player';
import { api, useCuenta } from './cuenta';
import { dejarDeEscuchar, eventosHooks, useSocial } from './social';
import { showSnack } from '../components/PlaylistSheets';
import { closeAllOverlaysThen, openOverlay } from '../nav';
import type { Track } from '../types';
import { escritorioActivo } from '../escritorio/activo';

/**
 * Party: escuchar en grupo con una fila compartida (como la Jam de Spotify). Ver servidor/src/rutas/party.js.
 *
 *  - Anfitrión: su aparato manda. Cuenta al servidor qué suena y qué viene en su cola; al pasar de canción, pone
 *    primero lo que agregó el grupo. Los invitados pueden pausar o saltar (si él lo permite): le llega aquí.
 *  - Invitado "en este teléfono": su reproductor va al mismo tiempo que el del anfitrión (como "escuchar juntos").
 *    Si elige una canción o la manda a la cola, se agrega a la Party en vez de sonar.
 *  - Invitado "desde el aparato del anfitrión" (en persona): en su aparato no suena nada; ve la fila y agrega.
 */

export interface MiembroParty {
  id: number;
  nombre: string;
  foto: string | null;
  modo: 'telefono' | 'aparato';
}
export interface Agregada {
  uid: string;
  cancion: string;
  por: number;
}
export interface PartyEstado {
  codigo: string;
  anfitrion: { id: number; nombre: string; foto: string | null };
  yo: number;
  miembros: MiembroParty[];
  agregadas: Agregada[];
  sonando: {
    cancion: string;
    por: number | null;
    posicion: number;
    sonando: boolean;
    hace: number;
  } | null;
  proximas: string[];
  contexto: string | null;
  ajustes: { controlar: boolean };
}
export interface InfoParty {
  codigo: string;
  anfitrion: { id: number; nombre: string; foto: string | null };
  miembros: { id: number; nombre: string; foto: string | null }[];
  llena: boolean;
  ya: boolean;
}

export type VistaParty = 'party' | 'invitar' | 'agregar';

interface Store {
  party: PartyEstado | null;
  /** Cuándo llegó el último estado a este aparato (para calcular en qué segundo va el anfitrión). */
  recibido: number;
  /** Pantallas abiertas, una encima de otra ('party' abajo; 'invitar' o 'agregar' encima). */
  vistas: VistaParty[];
  /** Invitación por abrir: "¿Quieres unirte a la Party de …?" */
  unirse: InfoParty | null;
  /** En PC la Party se ve en el panel de la derecha (como la Jam de Spotify), no en una ventana encima. */
  panelPc: boolean;
}

export const useParty = create<Store>(() => ({
  party: null,
  recibido: 0,
  vistas: [],
  unirse: null,
  panelPc: false,
}));

export const soyAnfitrion = (p = useParty.getState().party) => !!p && p.anfitrion.id === p.yo;
const miModo = (p = useParty.getState().party) => p?.miembros.find((m) => m.id === p.yo)?.modo ?? 'telefono';
/** Invitado que escucha en su propio aparato (sigue al anfitrión). */
const sigoAlAnfitrion = (p = useParty.getState().party) => !!p && !soyAnfitrion(p) && miModo(p) === 'telefono';

export const nombreDe = (id: number | null | undefined, p = useParty.getState().party) => p?.miembros.find((m) => m.id === id) ?? null;

// ---------------- Lo que se recuerda en este aparato (para volver a entrar al reconectarse) ----------------

const KEY = 'party';
interface Guardada {
  codigo: string;
  anfitrion: boolean;
  modo: 'telefono' | 'aparato';
  /** Última vez que este aparato supo de la Party (ms). Pasado ese rato, el servidor ya la terminó. */
  en?: number;
}
/** Igual que en el servidor: sin noticias del anfitrión por 5 min, la Party termina. */
const VIGENTE_MS = 5 * 60_000;
function guardada(): Guardada | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}
function guardar(g: Guardada | null) {
  try {
    if (g) localStorage.setItem(KEY, JSON.stringify(g));
    else localStorage.removeItem(KEY);
  } catch {
    /* sin espacio */
  }
}

/** Al entrar a una Party se apagan repetir y aleatorio: el orden lo pone el grupo. */
function apagarModos() {
  const pl = usePlayer.getState();
  if (pl.repeat !== 'off') usePlayer.setState({ repeat: 'off' });
  if (pl.shuffle) {
    const queue = pl.originalQueue ?? pl.queue;
    const cur = pl.queue[pl.index];
    usePlayer.setState({
      shuffle: false,
      originalQueue: null,
      queue,
      index: Math.max(0, queue.indexOf(cur)),
    });
  }
}
partyHooks.sinModos = () => {
  if (!useParty.getState().party) return false;
  showSnack('En la Party no se usan repetir ni aleatorio');
  return true;
};

function poner(party: PartyEstado | null) {
  const antes = useParty.getState().party;
  if (party && !antes) apagarModos();
  // Terminó: se cierran sus pantallas (pasando por el historial, para que "atrás" no quede con capas fantasma).
  if (!party && useParty.getState().vistas.length) closeAllOverlaysThen(() => {});
  useParty.setState({
    party,
    recibido: Date.now(),
    ...(party ? {} : { vistas: [], panelPc: false }),
  });
  if (party)
    guardar({
      codigo: party.codigo,
      anfitrion: soyAnfitrion(party),
      modo: miModo(party),
      en: Date.now(),
    });
  else guardar(null);
  if (!party) return;
  if (sigoAlAnfitrion(party)) void seguir();
  else if (!soyAnfitrion(party) && (!antes || miModo(antes) !== 'aparato')) pausarAqui(); // en persona: aquí no suena
  if (soyAnfitrion(party)) arrancarSiHaceFalta();
}

// ---------------- Pantallas ----------------

export function abrirVista(v: VistaParty) {
  if (escritorioActivo() && v === 'party') return useParty.setState({ panelPc: true });
  const { vistas } = useParty.getState();
  if (vistas.includes(v)) return;
  useParty.setState({ vistas: [...vistas, v] });
  openOverlay(() => useParty.setState((s) => ({ vistas: s.vistas.filter((x) => x !== v) })));
}

export function linkParty(codigo: string) {
  const base = useCuenta.getState().base || location.origin;
  return `${base}/?party=${encodeURIComponent(codigo)}`;
}

export async function compartirLink() {
  const p = useParty.getState().party;
  if (!p) return;
  const url = linkParty(p.codigo);
  const texto = `Únete a la Party de ${p.anfitrion.nombre} en Edowave`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Party en Edowave', text: texto, url });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return; // cerró el menú de compartir
  }
  try {
    await navigator.clipboard.writeText(url);
    showSnack('Enlace copiado');
  } catch {
    showSnack(url);
  }
}

// ---------------- Anfitrión ----------------

/** "Iniciar una Party" desde el menú de una canción: la pone a sonar (si no suena ya) y abre la Party. */
export async function iniciarParty(track?: Track) {
  if (!useCuenta.getState().token) return showSnack('Inicia sesión para hacer una Party');
  const actual = useParty.getState().party;
  if (actual && !soyAnfitrion(actual)) await salirDeParty();
  if (useSocial.getState().siguiendo !== null) dejarDeEscuchar();
  if (track) {
    if (!esDelServidor(track.id)) return showSnack('Esa canción está solo en este dispositivo: elige una del servidor');
    const p = usePlayer.getState();
    if (p.queue[p.index] !== track.id) p.playTracks([track], 0, { shuffle: false });
    else if (!p.playing) p.toggle();
  }
  try {
    const crear = (body: object) => api<{ party: PartyEstado }>('/api/party', { method: 'POST', body });
    const r = await crear(actual && soyAnfitrion(actual) ? { codigo: actual.codigo } : {}).catch((e) => {
      if ((e as { status?: number }).status !== 410) throw e;
      poner(null); // la anterior ya terminó: se hace una nueva
      return crear({});
    });
    poner(r.party);
    contarAhora();
    abrirVista('party');
  } catch (e) {
    showSnack((e as Error).message || 'No se pudo iniciar la Party');
  }
}

/** Canción agregada que ya se tomó para sonar (se cuenta una vez al servidor para que salga de la fila). */
let uidSonando: string | null = null;
let uidPorContar: string | null = null;

/** Siguiente canción del grupo, si hay (y este aparato ya la conoce). */
function tomarAgregada(): string | null {
  const p = useParty.getState().party;
  if (!p || !soyAnfitrion(p)) return null;
  for (const a of p.agregadas) {
    if (a.uid === uidSonando) continue;
    if (!trackById(a.cancion)) {
      void sincronizarBiblioteca(true); // recién subida: la próxima vez ya estará
      continue;
    }
    uidSonando = a.uid;
    uidPorContar = a.uid;
    // Sale de la fila al tiro (el servidor confirma con el próximo estado).
    useParty.setState({
      party: { ...p, agregadas: p.agregadas.filter((x) => x.uid !== a.uid) },
    });
    return a.cancion;
  }
  return null;
}
partyHooks.siguiente = tomarAgregada;

/** El anfitrión no tiene nada sonando y alguien agregó algo: empieza. */
function arrancarSiHaceFalta() {
  const pl = usePlayer.getState();
  if (pl.queue.length) return;
  const id = tomarAgregada();
  const t = trackById(id ?? undefined);
  if (t) pl.playTracks([t], 0, { shuffle: false });
}

let timerEstado: ReturnType<typeof setTimeout> | undefined;
function contarPronto() {
  clearTimeout(timerEstado);
  timerEstado = setTimeout(contarAhora, 300);
}
function contarAhora() {
  clearTimeout(timerEstado);
  const p = useParty.getState().party;
  if (!p || !soyAnfitrion(p)) return;
  const s = usePlayer.getState();
  const id = s.queue[s.index];
  // Recién recargada la página: mientras se retoma lo que sonaba, no se cuenta "nada" ni "en pausa" (los invitados
  // se pausaban un rato). Se vuelve a contar en cuanto suena esa canción, o al acabarse el plazo.
  if (retomando) {
    const listo = id === retomando.cancion && (s.playing || !retomando.sonando);
    if (listo || Date.now() > retomando.hasta) retomando = null;
    else return;
  }
  const body = {
    cancion: id && esDelServidor(id) ? id : null,
    uid: uidPorContar ?? undefined,
    posicion: playerPos() || s.position,
    sonando: s.playing,
    proximas: s.queue.slice(s.index + 1, s.index + 21).filter(esDelServidor),
    contexto: s.colaNombre,
  };
  uidPorContar = null;
  api('/api/party/estado', { method: 'POST', body })
    .then(() => {
      const g = guardada();
      if (g?.codigo === p.codigo) guardar({ ...g, en: Date.now() });
    })
    .catch((e) => {
      if ((e as { status?: number }).status === 404) void volverAEntrar();
    });
}

/** Anfitrión que recargó la página: lo que el servidor sabía que sonaba (para seguir desde ahí, sin pausar). */
let retomando: { cancion: string; sonando: boolean; hasta: number } | null = null;

/**
 * El anfitrión volvió (recargó la página o se reconectó) y la Party seguía: retoma la canción que sonaba, en el
 * segundo en que iba, sin avisar antes una pausa a los invitados. Espera a que se recupere la cola (hasta 10 s).
 */
async function retomarComoAnfitrion(p: PartyEstado) {
  const e = p.sonando;
  const pl0 = usePlayer.getState();
  if (!e || (pl0.queue[pl0.index] === e.cancion && pl0.playing === e.sonando)) return;
  const desde = Date.now();
  retomando = { cancion: e.cancion, sonando: e.sonando, hasta: desde + 12_000 };
  for (let i = 0; i < 40 && (!colaRecuperada() || !trackById(e.cancion)); i++) await new Promise((ok) => setTimeout(ok, 250));
  if (!retomando || !trackById(e.cancion)) {
    retomando = null;
    return;
  }
  const objetivo = e.posicion + (e.sonando ? (e.hace + (Date.now() - desde)) / 1000 : 0);
  const pl = usePlayer.getState();
  let i = pl.queue[pl.index] === e.cancion ? pl.index : pl.queue.indexOf(e.cancion);
  if (i < 0) {
    // No está en la cola recuperada: se pone justo donde va.
    const queue = [...pl.queue];
    i = Math.min(queue.length, pl.index + (queue.length ? 1 : 0));
    queue.splice(i, 0, e.cancion);
    usePlayer.setState({ queue });
  }
  await playIndexAt(i, objetivo, e.sonando);
}

let ultimoContado = { id: '', pos: 0, en: 0, len: 0 };
usePlayer.subscribe((s, antes) => {
  const p = useParty.getState().party;
  if (!p) return;
  const id = s.queue[s.index];
  if (soyAnfitrion(p)) {
    if (id !== antes.queue[antes.index]) {
      // Si lo que empezó a sonar no es la agregada que se tomó, esa ya no está sonando.
      if (uidSonando && id !== p.sonando?.cancion && !uidPorContar) uidSonando = null;
      contarPronto();
    } else if (s.playing !== antes.playing) contarAhora();
    else if (s.queue !== antes.queue)
      contarPronto(); // agregó, quitó u ordenó su cola
    else if (s.playing && s.position !== antes.position) {
      const esperada = ultimoContado.pos + (Date.now() - ultimoContado.en) / 1000;
      if (ultimoContado.id === id && Math.abs(s.position - esperada) > 3) contarPronto(); // adelantó o retrocedió
    }
    if (id !== ultimoContado.id || s.playing !== antes.playing || s.queue !== antes.queue)
      ultimoContado = {
        id,
        pos: s.position,
        en: Date.now(),
        len: s.queue.length,
      };
    return;
  }
  // Invitado en su aparato: si algo lo pausó por fuera (una llamada), se vuelve a poner al día.
  if (sigoAlAnfitrion(p) && s.playing !== antes.playing && Date.now() > aplicandoHasta) setTimeout(() => void seguir(), 300);
});

function controlDelInvitado(accion: string, nombre: string) {
  const pl = usePlayer.getState();
  if (accion === 'play' && !pl.playing) pl.toggle();
  else if (accion === 'pausa' && pl.playing) pl.toggle();
  else if (accion === 'siguiente') {
    pl.next();
    showSnack(`${nombre} pasó a la siguiente`);
  } else if (accion === 'anterior') pl.prev();
}

// ---------------- Invitado ----------------

let aplicandoHasta = 0;
let interno = false;
function comoApp(fn: () => void) {
  aplicandoHasta = Date.now() + 2500;
  interno = true;
  try {
    fn();
  } finally {
    interno = false;
  }
}
function pausarAqui() {
  if (usePlayer.getState().playing) comoApp(() => usePlayer.getState().toggle());
}

let reintentoBiblioteca = 0;
/** Va al mismo tiempo que el anfitrión (misma canción, mismo segundo, sonando o en pausa). */
async function seguir() {
  const { party: p, recibido } = useParty.getState();
  if (!p || !sigoAlAnfitrion(p)) return;
  const e = p.sonando;
  const pl = usePlayer.getState();
  if (!e) return pausarAqui();
  if (!trackById(e.cancion)) {
    if (Date.now() - reintentoBiblioteca > 10_000) {
      reintentoBiblioteca = Date.now();
      await sincronizarBiblioteca(true);
      if (trackById(e.cancion)) return seguir();
    }
    return pausarAqui();
  }
  const objetivo = e.posicion + (e.sonando ? (e.hace + (Date.now() - recibido)) / 1000 : 0);
  if (pl.queue[pl.index] !== e.cancion) {
    aplicandoHasta = Date.now() + 4000;
    await playIdAt(e.cancion, objetivo, e.sonando);
    return;
  }
  if (Math.abs(playerPos() - objetivo) > 2.5) comoApp(() => usePlayer.getState().seek(objetivo));
  if (usePlayer.getState().playing !== e.sonando) comoApp(() => usePlayer.getState().toggle());
}

/** Al terminar la canción, el invitado espera la que ponga el anfitrión (no sigue con su propia cola). */
const siguiendoAntes = juntosHooks.siguiendo;
juntosHooks.siguiendo = () => {
  if (sigoAlAnfitrion()) {
    aplicandoHasta = Date.now() + 2500;
    return true;
  }
  return !!siguiendoAntes?.();
};

/** Controles del invitado: pasan al anfitrión; elegir una canción la agrega a la Party. */
partyHooks.control = (accion, tracks, inicio) => {
  const p = useParty.getState().party;
  if (!p || soyAnfitrion(p) || interno) return false;
  if (accion === 'elegir' || accion === 'cola') {
    const t = tracks?.[Math.min(tracks.length - 1, Math.max(0, inicio ?? 0))];
    if (t) void agregar([t]);
    else showSnack('En la Party, la música la elige el grupo: agrega canciones a la fila');
    return true;
  }
  if (accion === 'seek') {
    showSnack(`En la Party, ${p.anfitrion.nombre} lleva el ritmo`);
    return true;
  }
  if (!p.ajustes.controlar) {
    showSnack(`${p.anfitrion.nombre} no permite cambiar la música`);
    return true;
  }
  void controlar(accion === 'toggle' ? (p.sonando?.sonando ? 'pausa' : 'play') : accion === 'next' ? 'siguiente' : 'anterior');
  return true;
};

/** Pausar, seguir o cambiar de canción en la Party (si soy el anfitrión, en mi reproductor). */
export async function controlar(accion: 'play' | 'pausa' | 'siguiente' | 'anterior') {
  const p = useParty.getState().party;
  if (!p) return;
  if (soyAnfitrion(p)) return controlDelInvitado(accion, '');
  try {
    await api('/api/party/control', { method: 'POST', body: { accion } });
  } catch (e) {
    showSnack((e as Error).message);
  }
}

// ---------------- Para todos ----------------

export async function agregar(tracks: Track[]) {
  const ids = tracks.filter((t) => esDelServidor(t.id)).map((t) => t.id);
  if (!ids.length) return showSnack('Solo se pueden agregar canciones del servidor');
  try {
    await api('/api/party/agregar', {
      method: 'POST',
      body: { canciones: ids },
    });
    showSnack(ids.length === 1 ? `"${tracks[0].title}" se agregó a la Party` : `${ids.length} canciones se agregaron a la Party`);
  } catch (e) {
    showSnack((e as Error).message);
  }
}

export async function quitarAgregada(uid: string) {
  const p = useParty.getState().party;
  if (p)
    useParty.setState({
      party: { ...p, agregadas: p.agregadas.filter((a) => a.uid !== uid) },
    });
  await api(`/api/party/agregadas/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
  }).catch((e) => showSnack((e as Error).message));
}

/** ¿Puedo ordenar y quitar lo de la fila? El anfitrión, o todos si el anfitrión deja controlar la música. */
export const puedoOrdenar = (p = useParty.getState().party) => !!p && (soyAnfitrion(p) || p.ajustes.controlar);

/** Mueve una agregada al puesto `a` de "A continuación". */
export async function moverAgregada(uid: string, a: number) {
  const p = useParty.getState().party;
  const i = p?.agregadas.findIndex((x) => x.uid === uid) ?? -1;
  if (!p || i < 0 || i === a) return;
  const agregadas = [...p.agregadas];
  const [x] = agregadas.splice(i, 1);
  agregadas.splice(Math.max(0, Math.min(agregadas.length, a)), 0, x);
  useParty.setState({ party: { ...p, agregadas } });
  await api('/api/party/mover', { method: 'POST', body: { uid, a } }).catch((e) => showSnack((e as Error).message));
}

/** En el aparato del anfitrión: quita o mueve una de las que siguen en su cola ("Siguiente de: …"). */
function cambiarColaAqui(accion: 'quitar' | 'mover', cancion: string, antesDe?: string | null) {
  const pl = usePlayer.getState();
  const de = pl.queue.indexOf(cancion, pl.index + 1);
  if (de < 0) return;
  if (accion === 'quitar') pl.removeAt(de);
  else {
    // `antesDe`: la canción que queda justo después (null: al final de lo que se ve).
    let a = antesDe ? pl.queue.indexOf(antesDe, pl.index + 1) : -1;
    if (a < 0) {
      const prox = pl.queue.slice(pl.index + 1, pl.index + 21).filter(esDelServidor);
      const ult = prox.length ? pl.queue.indexOf(prox[prox.length - 1], pl.index + 1) : -1;
      if (ult < 0) return;
      a = ult + 1;
    }
    pl.mover(de, a > de ? a - 1 : a);
  }
  contarPronto();
}

/** Quitar o mover una de "Siguiente de: …" (la cola del anfitrión). */
export async function cambiarProxima(accion: 'quitar' | 'mover', cancion: string, a = 0) {
  const p = useParty.getState().party;
  if (!p) return;
  const proximas = p.proximas.filter((x) => x !== cancion);
  if (accion === 'mover') proximas.splice(Math.max(0, Math.min(proximas.length, a)), 0, cancion);
  const antesDe = accion === 'mover' ? (proximas[proximas.indexOf(cancion) + 1] ?? null) : null;
  useParty.setState({ party: { ...p, proximas } });
  if (soyAnfitrion(p)) return cambiarColaAqui(accion, cancion, antesDe);
  await api('/api/party/cola', {
    method: 'POST',
    body: { accion, cancion, antesDe, a },
  }).catch((e) => showSnack((e as Error).message));
}

export async function expulsar(usuario: number) {
  await api('/api/party/expulsar', { method: 'POST', body: { usuario } }).catch((e) => showSnack((e as Error).message));
}

export async function cambiarControlar(controlar: boolean) {
  const p = useParty.getState().party;
  if (p)
    useParty.setState({
      party: { ...p, ajustes: { ...p.ajustes, controlar } },
    });
  await api('/api/party/ajustes', { method: 'PUT', body: { controlar } }).catch((e) => showSnack((e as Error).message));
}

export async function invitarAmigo(usuario: number) {
  await api('/api/party/invitar', { method: 'POST', body: { usuario } });
}

/** Salir (si soy el anfitrión, la termina para todos). */
export async function salirDeParty() {
  const p = useParty.getState().party;
  poner(null);
  uidSonando = null;
  if (p) await api('/api/party/salir', { method: 'POST', body: {} }).catch(() => {});
}

export const recomendaciones = () => api<{ canciones: { cancion: string; para: number }[] }>('/api/party/recomendaciones');

// ---------------- Unirse ----------------

/** Abre "¿Quieres unirte a la Party de …?" */
export async function verInvitacion(codigo: string) {
  try {
    const info = await api<InfoParty>(`/api/party/${encodeURIComponent(codigo)}/info`);
    const actual = useParty.getState().party;
    if (actual?.codigo === info.codigo) return abrirVista('party');
    useParty.setState({ unirse: info });
    openOverlay(() => useParty.setState({ unirse: null }));
  } catch (e) {
    showSnack((e as Error).message || 'No se encontró la Party');
  }
}

export async function unirse(codigo: string, modo: 'telefono' | 'aparato') {
  const actual = useParty.getState().party;
  if (actual && actual.codigo !== codigo) await salirDeParty();
  if (useSocial.getState().siguiendo !== null) dejarDeEscuchar();
  const r = await api<{ party: PartyEstado }>(`/api/party/${encodeURIComponent(codigo)}/unirse`, { method: 'POST', body: { modo } });
  poner(r.party);
}

/** Al reconectarse (o si el servidor se reinició): vuelve a entrar a la Party en que estaba. */
let volviendo = false;
async function volverAEntrar() {
  const g = guardada();
  if (!g || volviendo || !useCuenta.getState().token) return;
  // Anfitrión con la app cerrada por más de 5 min: el servidor ya la terminó. No se revive.
  if (g.anfitrion && (!g.en || Date.now() - g.en > VIGENTE_MS)) {
    if (useParty.getState().party) showSnack('La Party terminó');
    poner(null);
    return;
  }
  volviendo = true;
  try {
    if (g.anfitrion) {
      const agregadas = useParty.getState().party?.agregadas ?? [];
      try {
        const r = await api<{ party: PartyEstado }>('/api/party', {
          method: 'POST',
          body: { codigo: g.codigo, agregadas },
        });
        const retomar = retomarComoAnfitrion(r.party); // antes de contar: así no se avisa una pausa
        poner(r.party);
        contarAhora();
        await retomar;
      } catch (e) {
        const st = (e as { status?: number }).status;
        if (st && st >= 400 && st < 500) {
          // El servidor dice que ya terminó (o no se puede recrear): se cierra aquí también.
          if (useParty.getState().party) showSnack('La Party terminó');
          poner(null);
          uidSonando = null;
        }
      }
      return;
    }
    for (let intento = 0; intento < 3; intento++) {
      try {
        const r = await api<{ party: PartyEstado }>(`/api/party/${encodeURIComponent(g.codigo)}/unirse`, { method: 'POST', body: { modo: g.modo } });
        poner(r.party);
        return;
      } catch (e) {
        if ((e as { status?: number }).status !== 404) return; // sin conexión: se intenta al reconectar
        await new Promise((ok) => setTimeout(ok, 5000)); // el anfitrión puede estar recreándola
      }
    }
    if (useParty.getState().party) showSnack('La Party terminó');
    poner(null);
  } catch {
    /* sin conexión: se intenta al reconectar */
  } finally {
    volviendo = false;
  }
}

// ---------------- Avisos en vivo ----------------

eventosHooks.conectado.push(() => void volverAEntrar());
eventosHooks.evento.push((ev) => {
  if (ev.tipo === 'party') {
    const nueva = ev.party as PartyEstado;
    const g = useParty.getState().party;
    // Solo se pone al día la Party en que estoy: un aviso que llega tarde (después de salir) no la revive.
    if (!g || g.codigo !== nueva.codigo) return true;
    poner(nueva);
    return true;
  }
  if (ev.tipo === 'party-fin') {
    const p = useParty.getState().party;
    if (!p || p.codigo !== ev.codigo) return true;
    poner(null);
    uidSonando = null;
    if (ev.motivo === 'expulsado') showSnack('Ya no estás en la Party');
    else if (!soyAnfitrion(p)) showSnack(`${p.anfitrion.nombre} terminó la Party`);
    else showSnack('La Party terminó');
    if (!soyAnfitrion(p) && miModo(p) === 'telefono') pausarAqui();
    return true;
  }
  if (ev.tipo === 'party-llego') {
    showSnack(`${String(ev.nombre)} se unió a la Party`);
    return true;
  }
  if (ev.tipo === 'party-cola') {
    if (soyAnfitrion()) cambiarColaAqui(ev.accion === 'quitar' ? 'quitar' : 'mover', String(ev.cancion), ev.antesDe ? String(ev.antesDe) : null);
    return true;
  }
  if (ev.tipo === 'party-control') {
    if (soyAnfitrion()) controlDelInvitado(String(ev.accion), String(ev.nombre));
    return true;
  }
  if (ev.tipo === 'party-invitacion') {
    void verInvitacion(String(ev.codigo));
    return true;
  }
  return false;
});

// ---------------- Arranque ----------------

/** Link de una Party: musica.empanados.io/?party=ABC234. Se lee una vez y se quita de la barra de direcciones. */
const codigoDelLink = (() => {
  try {
    const u = new URL(location.href);
    const c = u.searchParams.get('party');
    if (!c) return null;
    u.searchParams.delete('party');
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    return c.toUpperCase();
  } catch {
    return null;
  }
})();

let iniciada = false;
export function iniciarPartyApp() {
  if (iniciada) return;
  iniciada = true;
  // Mientras suena: el anfitrión cuenta cada 15 s (así los invitados no se desfasan).
  setInterval(() => {
    if (soyAnfitrion() && usePlayer.getState().playing) contarAhora();
    // Con la app abierta, la Party sigue vigente aunque se corte la conexión un rato.
    const g = guardada();
    if (g && useParty.getState().party?.codigo === g.codigo) guardar({ ...g, en: Date.now() });
  }, 15_000);
  if (!codigoDelLink) return;
  if (useCuenta.getState().token) void verInvitacion(codigoDelLink);
  else {
    // Primero inicia sesión (la app se lo pide sola); después se abre la invitación.
    const fin = useCuenta.subscribe((c) => {
      if (c.token) {
        fin();
        void verInvitacion(codigoDelLink);
      }
    });
  }
}
