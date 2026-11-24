import { create } from 'zustand';
import { sincronizarBiblioteca } from '../library/store';
import { esDelServidor } from './biblioteca';
import { juntosHooks, playIdAt, playerPos, trackById, usePlayer } from '../player/player';
import { deckHold, deckNudge, deckOwns, deckRelease, useMotorJuntos, useVinyl } from '../player/scratch';
import { api, useCuenta } from './cuenta';
import { esCaida, marcarConectado, marcarSinConexion } from './conexion';
import { showSnack } from '../components/PlaylistSheets';
import { sincronizarPlaylists } from './playlistsCuenta';

/**
 * Lo social en la app: amigos, lo que escuchan en vivo, "Escuchar juntos" y las playlists públicas
 * ("De la comunidad").
 *
 * En vivo: la app deja abierta una conexión con el servidor (GET /api/eventos) y por ahí le llegan los avisos.
 * Si se corta (sin Wi-Fi, servidor reiniciado), se vuelve a conectar sola.
 */

export interface Escuchando {
  cancion: string | null; // s:<id> (del servidor) o null (canción del teléfono)
  titulo: string;
  artista: string;
  portada: string | null;
  local: boolean;
  posicion: number;
  duracion: number;
  sonando: boolean;
  /** Tiene el modo vinilo (puede hacer scratch). */
  vinilo?: boolean;
  /** ms desde que lo contó (al llegar) */
  hace: number;
  /** cuándo llegó a este aparato (Date.now()) */
  recibido: number;
}

export interface Amigo {
  amistad: number;
  id: number;
  nombre: string;
  foto?: string | null;
  /** false: decidió no compartir lo que escucha (privacidad). */
  comparte?: boolean;
  /** Tiene la app abierta ahora. */
  conectado?: boolean;
  escuchando?: Escuchando | null;
  /** Color y fondo de su perfil: decoran su fila en la lista de amigos (como las placas de Discord). */
  estilo?: { color: string | null; fondo: 'ninguno' | 'particulas' | 'aurora' | 'estrellas' | 'ondas' | 'burbujas' };
}

/** Insignia del perfil. nivel: 0 especial, 1 bronce, 2 plata, 3 oro, 4 diamante. */
export interface Insignia {
  id: 'horas' | 'invitados' | 'playlists' | 'amigos' | 'megusta' | 'pionero' | string;
  nombre: string;
  detalle: string;
  nivel: number;
}

export interface PlaylistComunidad {
  id: string;
  nombre: string;
  canciones: string[];
  dueno: string;
  duenoId: number;
  deAmigo: boolean;
  actualizada: number;
  foto?: string | null;
}

interface Social {
  amigos: Amigo[];
  recibidas: Amigo[];
  enviadas: Amigo[];
  comunidad: PlaylistComunidad[];
  /** Amigo con el que estoy escuchando juntos (su id), o null. */
  siguiendo: number | null;
  /** Escuchando juntos, pero él puso una canción de su teléfono: aquí se espera la siguiente. */
  esperando: boolean;
  /** Quiénes están escuchando conmigo ahora (soy el anfitrión). */
  oyentes: { id: number; nombre: string }[];
  /** Privacidad: ¿mis amigos ven lo que escucho y pueden escuchar conmigo? (null = todavía no se sabe) */
  compartir: boolean | null;
}

export const useSocial = create<Social>(() => ({
  amigos: [],
  recibidas: [],
  enviadas: [],
  comunidad: [],
  siguiendo: null,
  esperando: false,
  oyentes: [],
  compartir: null,
}));

const conSesion = () => !!useCuenta.getState().token;

/**
 * Otras partes de la app que escuchan los avisos en vivo (la Party): `evento` recibe cada aviso (true = ya lo
 * atendió) y `conectado` se llama al conectarse o reconectarse.
 */
export const eventosHooks: { evento: ((ev: { tipo: string } & Record<string, unknown>) => boolean)[]; conectado: (() => void)[] } = {
  evento: [],
  conectado: [],
};
const conRecibido = (e: Omit<Escuchando, 'recibido'> | null | undefined): Escuchando | null => (e ? { ...e, recibido: Date.now() } : null);

// ---------------- Amigos ----------------

export async function cargarAmigos() {
  if (!conSesion()) return;
  try {
    const r = await api<{ amigos: Amigo[]; recibidas: Amigo[]; enviadas: Amigo[] }>('/api/amigos');
    const amigos = r.amigos.map((a) => ({ ...a, escuchando: conRecibido(a.escuchando) }));
    useSocial.setState({ amigos, recibidas: r.recibidas, enviadas: r.enviadas });
    const s = useSocial.getState().siguiendo;
    const sigo = amigos.find((a) => a.id === s);
    if (s !== null && (!sigo || sigo.comparte === false)) dejarDeEscuchar(); // ya no son amigos o dejó de compartir
  } catch {
    /* sin conexión: queda lo último que se supo */
  }
}

export const buscarUsuarios = (q: string) => api<{ id: number; nombre: string; foto?: string | null }[]>(`/api/usuarios?q=${encodeURIComponent(q)}`);

export async function mandarSolicitud(nombre: string) {
  await api('/api/amigos', { method: 'POST', body: { nombre } });
  await cargarAmigos();
}
export async function aceptarSolicitud(amistad: number) {
  await api(`/api/amigos/${amistad}/aceptar`, { method: 'POST' });
  await cargarAmigos();
}
/** Rechazar una solicitud, cancelar una que mandé o dejar de ser amigos. */
export async function quitarAmistad(amistad: number) {
  await api(`/api/amigos/${amistad}`, { method: 'DELETE' });
  await cargarAmigos();
}

// ---------------- Privacidad ----------------

export async function cargarPrivacidad() {
  if (!conSesion()) return;
  try {
    const r = await api<{ compartir: boolean; oyentes: { id: number; nombre: string }[] }>('/api/privacidad');
    useSocial.setState({ compartir: r.compartir, oyentes: r.oyentes });
  } catch {
    /* sin conexión */
  }
}

/** Compartir (o no) lo que escucho con mis amigos. Al apagarlo, quienes escuchaban conmigo quedan sueltos. */
export async function cambiarPrivacidad(compartir: boolean) {
  const antes = useSocial.getState().compartir;
  useSocial.setState({ compartir, ...(compartir ? {} : { oyentes: [] }) });
  try {
    await api('/api/privacidad', { method: 'PUT', body: { compartir } });
    if (compartir) contarAhora();
  } catch (e) {
    useSocial.setState({ compartir: antes });
    throw e;
  }
}

// ---------------- De la comunidad ----------------

export async function cargarComunidad() {
  if (!conSesion()) return;
  try {
    useSocial.setState({ comunidad: await api<PlaylistComunidad[]>('/api/comunidad/playlists') });
  } catch {
    /* sin conexión */
  }
}

// ---------------- Avisos en vivo ----------------

let conexion: AbortController | null = null;

async function escucharEventos(ctrl: AbortController) {
  let espera = 2000;
  while (!ctrl.signal.aborted && conSesion()) {
    try {
      const { token, base } = useCuenta.getState();
      const r = await fetch(`${base}/api/eventos`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal, cache: 'no-store' });
      if (r.status === 401) {
        useCuenta.setState({ token: null });
        return;
      }
      if (esCaida(r.status)) marcarSinConexion(base);
      if (!r.ok || !r.body) throw new Error(String(r.status));
      marcarConectado();
      espera = 2000;
      // Recién conectado (o reconectado): se pone al día.
      void cargarAmigos();
      void cargarComunidad();
      void cargarPrivacidad();
      contarAhora();
      // Si estaba escuchando con alguien, se le vuelve a avisar al servidor (por si se reinició).
      const sigo = useSocial.getState().siguiendo;
      if (sigo !== null) api('/api/juntos', { method: 'POST', body: { con: sigo } }).catch(() => {});
      for (const fn of eventosHooks.conectado) fn();
      const lector = r.body.getReader();
      const dec = new TextDecoder();
      let resto = '';
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        resto += dec.decode(value, { stream: true });
        const bloques = resto.split('\n\n');
        resto = bloques.pop() ?? '';
        for (const b of bloques) {
          const linea = b.split('\n').find((l) => l.startsWith('data: '));
          if (linea) {
            try {
              const ev = JSON.parse(linea.slice(6));
              if (!eventosHooks.evento.some((fn) => fn(ev))) recibir(ev);
            } catch {
              /* aviso roto: se ignora */
            }
          }
        }
      }
    } catch {
      if (ctrl.signal.aborted) return;
      marcarSinConexion(useCuenta.getState().base);
    }
    await new Promise((ok) => setTimeout(ok, espera));
    espera = Math.min(espera * 2, 30_000);
  }
}

function recibir(ev: {
  tipo: string;
  usuario?: number;
  estado?: Omit<Escuchando, 'recibido'> | null;
  id?: string;
  g?: Gesto[];
  privado?: boolean;
  lista?: { id: number; nombre: string }[];
  nuevo?: string | null;
  conectado?: boolean;
}) {
  if (ev.tipo === 'presencia') {
    useSocial.setState((s) => ({ amigos: s.amigos.map((a) => (a.id === ev.usuario ? { ...a, conectado: !!ev.conectado } : a)) }));
    return;
  }
  if (ev.tipo === 'oyentes') {
    useSocial.setState({ oyentes: ev.lista ?? [] });
    if (ev.nuevo) showSnack(`${ev.nuevo} está escuchando contigo`);
    return;
  }
  if (ev.tipo === 'escuchando' && ev.privado && ev.usuario === useSocial.getState().siguiendo) {
    const nombre = useSocial.getState().amigos.find((a) => a.id === ev.usuario)?.nombre ?? 'Tu amigo';
    dejarDeEscuchar();
    showSnack(`${nombre} dejó de compartir lo que escucha`);
    void cargarAmigos();
    return;
  }
  if (ev.tipo === 'scratch') {
    if (ev.usuario === useSocial.getState().siguiendo && ev.id && ev.g) reproducirScratch(ev.id, ev.g);
    return;
  }
  if (ev.tipo === 'playlists') {
    // Se agregó sola a una playlist importada una canción que faltaba (es nueva: se trae también la biblioteca).
    void sincronizarBiblioteca(true).finally(() => void sincronizarPlaylists(true));
    return;
  }
  if (ev.tipo === 'amigos') void cargarAmigos();
  else if (ev.tipo === 'comunidad') void cargarComunidad();
  else if (ev.tipo === 'escuchando' && ev.usuario !== undefined) {
    const estado = conRecibido(ev.estado);
    useSocial.setState((s) => ({ amigos: s.amigos.map((a) => (a.id === ev.usuario ? { ...a, escuchando: estado } : a)) }));
    if (useSocial.getState().siguiendo === ev.usuario) void seguirA(estado);
  }
}

function conectar() {
  conexion?.abort();
  conexion = null;
  if (!conSesion()) {
    useSocial.setState({ amigos: [], recibidas: [], enviadas: [], comunidad: [], siguiendo: null, esperando: false, oyentes: [], compartir: null });
    return;
  }
  conexion = new AbortController();
  // Los amigos se piden SIEMPRE al servidor al conectar (no solo si llega la conexión en vivo).
  void cargarAmigos();
  void escucharEventos(conexion);
}

// ---------------- Contar lo que estoy escuchando ----------------

let contado = { id: '', sonando: false, pos: 0, en: 0 };

function contarAhora() {
  if (!conSesion() || useSocial.getState().compartir === false) return; // privado: no se cuenta
  const s = usePlayer.getState();
  const id = s.queue[s.index];
  const t = trackById(id);
  const pos = playerPos() || s.position;
  contado = { id: id ?? '', sonando: s.playing, pos, en: Date.now() };
  const cuerpo = t
    ? {
        cancion: esDelServidor(t.id) ? t.id : null,
        titulo: t.title,
        artista: t.artist,
        portada: t.coverId?.startsWith('p:') ? t.coverId : null,
        posicion: pos,
        duracion: t.duration,
        sonando: s.playing,
        vinilo: useVinyl.getState().on,
      }
    : {};
  api('/api/escuchando', { method: 'POST', body: cuerpo }).catch(() => {});
}

let pendiente: ReturnType<typeof setTimeout> | undefined;
const contarPronto = () => {
  clearTimeout(pendiente);
  pendiente = setTimeout(contarAhora, 250);
};

usePlayer.subscribe((s, antes) => {
  const id = s.queue[s.index];
  const cambio = id !== antes.queue[antes.index] || s.playing !== antes.playing;
  if (cambio) {
    if (s.playing !== antes.playing && id === antes.queue[antes.index]) {
      clearTimeout(pendiente);
      contarAhora(); // pausa o play: al instante, para que los oyentes vayan al mismo tiempo
    } else contarPronto();
    vigilarSeguimiento(s, antes);
  } else if (s.position !== antes.position && s.playing && contado.id === id && Date.now() > scratchHasta) {
    // ¿Adelantó o retrocedió? (la posición no es la esperada): se cuenta enseguida.
    const esperada = contado.pos + (Date.now() - contado.en) / 1000;
    if (Math.abs(s.position - esperada) > 3) contarPronto();
  }
});

// ---------------- Escuchar juntos ----------------

/** Cambios que hace la app al seguir al amigo (no son del usuario): no cortan el "escuchar juntos". */
let ignorarHasta = 0;
const aplicando = (ms = 2500) => (ignorarHasta = Date.now() + ms);

/** Lo que hace la app para seguir al amigo (adelantar, pausar) sí puede pasar por los controles bloqueados. */
let interno = false;
function comoApp(fn: () => void) {
  interno = true;
  try {
    fn();
  } finally {
    interno = false;
  }
}

juntosHooks.bloqueado = () => {
  const s = useSocial.getState();
  if (s.siguiendo === null || interno) return false;
  const nombre = s.amigos.find((a) => a.id === s.siguiendo)?.nombre ?? 'tu amigo';
  showSnack(`Estás escuchando con ${nombre}: él elige. Toca "Salir" para elegir tú.`);
  return true;
};

juntosHooks.siguiendo = () => {
  if (useSocial.getState().siguiendo === null) return false;
  aplicando();
  return true;
};

export function escucharCon(amigoId: number) {
  const a = useSocial.getState().amigos.find((x) => x.id === amigoId);
  if (a?.comparte === false) {
    showSnack(`${a.nombre} no comparte lo que escucha`);
    return;
  }
  useSocial.setState({ siguiendo: amigoId, esperando: false });
  // El servidor le avisa a tu amigo: "… está escuchando contigo".
  api('/api/juntos', { method: 'POST', body: { con: amigoId } }).catch((e) => {
    if ((e as { status?: number }).status === 403) {
      dejarDeEscuchar();
      showSnack((e as Error).message);
    }
  });
  void seguirA(a?.escuchando ?? null);
}

export function dejarDeEscuchar() {
  const estaba = useSocial.getState().siguiendo !== null;
  useSocial.setState({ siguiendo: null, esperando: false });
  useMotorJuntos.setState({ on: false });
  if (estaba) api('/api/juntos', { method: 'POST', body: { con: null } }).catch(() => {});
}

/**
 * El que escucha va siempre al mismo tiempo que su amigo: no puede pausar ni cambiar nada (los controles están
 * bloqueados). Si algo lo pausó por fuera (una llamada, otra app), se vuelve a poner al día con su amigo; si
 * algo le cambió la canción, deja de escuchar juntos.
 */
function vigilarSeguimiento(s: ReturnType<typeof usePlayer.getState>, antes: ReturnType<typeof usePlayer.getState>) {
  const social = useSocial.getState();
  if (social.siguiendo === null || Date.now() < ignorarHasta) return;
  if (s.queue[s.index] !== antes.queue[antes.index]) return dejarDeEscuchar();
  if (s.playing !== antes.playing) {
    const a = social.amigos.find((x) => x.id === social.siguiendo);
    setTimeout(() => void seguirA(a?.escuchando ?? null), 300);
  }
}

let reintentoBiblioteca = 0;

async function seguirA(e: Escuchando | null) {
  const p = usePlayer.getState();
  const pausar = () => {
    if (p.playing) {
      aplicando();
      comoApp(() => p.toggle());
    }
  };
  if (!e || !e.titulo) {
    useSocial.setState({ esperando: false });
    return pausar();
  }
  if (e.local || !e.cancion) {
    useSocial.setState({ esperando: true });
    return pausar();
  }
  useSocial.setState({ esperando: false });
  // Su modo vinilo: aquí también se usa el tocadiscos, para oír su scratch.
  if (useMotorJuntos.getState().on !== !!e.vinilo) useMotorJuntos.setState({ on: !!e.vinilo });
  const objetivo = e.posicion + (e.sonando ? (e.hace + (Date.now() - e.recibido)) / 1000 : 0);
  const sonar = e.sonando;
  const actual = p.queue[p.index];
  if (actual !== e.cancion) {
    if (!trackById(e.cancion)) {
      // Canción recién subida que este aparato todavía no conoce: se actualiza la biblioteca y se reintenta.
      if (Date.now() - reintentoBiblioteca > 10_000) {
        reintentoBiblioteca = Date.now();
        await sincronizarBiblioteca(true);
        if (trackById(e.cancion)) return seguirA(e);
      }
      useSocial.setState({ esperando: true });
      return pausar();
    }
    aplicando(4000);
    await playIdAt(e.cancion, objetivo, sonar);
    return;
  }
  if (Math.abs(playerPos() - objetivo) > 2.5 && Date.now() > repitiendoHasta) {
    aplicando();
    comoApp(() => p.seek(objetivo));
  }
  if (p.playing !== sonar) {
    aplicando();
    comoApp(() => p.toggle());
  }
}

// ---------------- Scratch compartido ----------------

type Gesto = [number, 'h' | 'n' | 'r', number];

/** Mientras hace scratch (y un rato después) sus saltos de posición no se cuentan como "adelantó". */
let scratchHasta = 0;
let gestoId = '';
let gestoInicio = 0;
let tanda: Gesto[] = [];
let envio: ReturnType<typeof setTimeout> | undefined;
let alFinal: ReturnType<typeof setTimeout> | undefined;

function enviarTanda() {
  envio = undefined;
  if (!tanda.length || !gestoId) return;
  const g = tanda;
  tanda = [];
  api('/api/escuchando/scratch', { method: 'POST', body: { id: gestoId, g } }).catch(() => {});
}

/**
 * El disco se tocó (lo llama el vinilo): 'h' apoya el dedo, 'n' lo mueve `sec` segundos, 'r' lo suelta.
 * Se manda en tandas de ~0,1 s a los amigos (solo si hay sesión y amigos).
 */
export function grabarGesto(tipo: 'h' | 'n' | 'r', sec = 0) {
  const social = useSocial.getState();
  if (!conSesion() || !social.amigos.length || social.compartir === false) return;
  const ahora = performance.now();
  if (tipo === 'h') {
    gestoId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    gestoInicio = ahora;
  }
  if (!gestoId) return;
  scratchHasta = Date.now() + 2500;
  tanda.push([Math.round(ahora - gestoInicio), tipo, Math.round(sec * 10000) / 10000]);
  if (tipo === 'r') {
    clearTimeout(envio);
    enviarTanda();
    gestoId = '';
    // Al terminar, se cuenta la posición final (por si quedó corrida).
    clearTimeout(alFinal);
    alFinal = setTimeout(contarAhora, 1500);
  } else if (!envio) envio = setTimeout(enviarTanda, 100);
}

/** Retraso con el que el oyente oye el scratch (no es en tiempo real: así llega parejo aunque el Wi-Fi titubee). */
const RETRASO_MS = 700;
let repitiendo = '';
let base = 0;
let repitiendoHasta = 0;

function reproducirScratch(id: string, g: Gesto[]) {
  if (!deckOwns()) return; // el tocadiscos todavía no está listo en este aparato
  if (id !== repitiendo) {
    repitiendo = id;
    base = Date.now() + RETRASO_MS - (g[0]?.[0] ?? 0);
  }
  for (const [t, tipo, sec] of g) {
    const cuando = Math.max(0, base + t - Date.now());
    repitiendoHasta = Math.max(repitiendoHasta, Date.now() + cuando + 3000);
    setTimeout(() => {
      if (useSocial.getState().siguiendo === null || !deckOwns()) return;
      aplicando();
      if (tipo === 'h') deckHold();
      else if (tipo === 'n') deckNudge(sec);
      else deckRelease();
    }, cuando);
  }
}

// ---------------- Arranque ----------------

let iniciado = false;
export function iniciarSocial() {
  if (iniciado) return;
  iniciado = true;
  conectar();
  let tokenAntes = useCuenta.getState().token;
  useCuenta.subscribe((c) => {
    if (c.token !== tokenAntes) {
      tokenAntes = c.token;
      conectar();
    }
  });
  // Mientras suena: se cuenta cada 20 s (así los amigos que escuchan contigo no se desfasan).
  setInterval(() => {
    if (usePlayer.getState().playing) contarAhora();
  }, 20_000);
  // Al cerrar la app o ir a otra: se cuenta la pausa al tiro.
  window.addEventListener('pagehide', () => {
    const { token, base } = useCuenta.getState();
    if (!token) return;
    fetch(`${base}/api/escuchando`, {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ultimoCuerpo(), sonando: false }),
    }).catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      contarAhora();
      void cargarAmigos();
      void cargarComunidad();
    }
  });
}

function ultimoCuerpo() {
  const s = usePlayer.getState();
  const t = trackById(s.queue[s.index]);
  if (!t) return {};
  return {
    cancion: esDelServidor(t.id) ? t.id : null,
    titulo: t.title,
    artista: t.artist,
    portada: t.coverId?.startsWith('p:') ? t.coverId : null,
    posicion: playerPos() || s.position,
    duracion: t.duration,
    vinilo: useVinyl.getState().on,
  };
}


// ---------------- Invitar amigos a la app ----------------

export interface Invitacion {
  id: number;
  codigo: string;
  vence: string;
}

/** Mis invitaciones sin usar y cuántas puedo tener a la vez. */
export const cargarInvitaciones = () => api<{ invitaciones: Invitacion[]; maximo: number }>('/api/invitaciones');
export const crearInvitacion = () => api<Invitacion>('/api/invitaciones', { method: 'POST', body: {} });
export const anularInvitacion = (id: number) => api(`/api/invitaciones/${id}`, { method: 'DELETE' });

/** Link que abre la app directo en "crear cuenta" con el código puesto. */
export function linkInvitacion(codigo: string) {
  const base = useCuenta.getState().base || location.origin;
  return `${base}/?invitar=${encodeURIComponent(codigo)}`;
}
