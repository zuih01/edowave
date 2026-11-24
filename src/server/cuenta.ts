import { create } from 'zustand';
import { esCaida, marcarConectado, marcarSinConexion } from './conexion';

/**
 * Cuenta del usuario en el servidor de música.
 *
 * La sesión queda abierta hasta cerrar sesión (o hasta que el admin la cierre). El token se guarda en este
 * aparato; el servidor solo guarda su huella.
 *
 * `base` = dirección del servidor. Vacía: la app le habla por /api en su mismo origen (Vite lo reenvía al
 * servidor de casa). Si algún día la app se sirve desde otro lado, aquí va https://IP:8443.
 */
/**
 * En la app de Android la interfaz va DENTRO del .apk (no se abre ninguna página): ahí la dirección del servidor
 * viene fija al compilar (VITE_SERVIDOR). En la web queda vacía (mismo origen).
 */
export const SERVIDOR_FIJO: string = import.meta.env.VITE_SERVIDOR ?? '';
export const esAppNativa = !!SERVIDOR_FIJO;

interface Cuenta {
  token: string | null;
  nombre: string | null;
  /** Foto de perfil (archivo en el servidor) o null = se muestra la inicial. */
  foto: string | null;
  base: string;
  /** El usuario eligió seguir sin cuenta (solo música local): no se le vuelve a pedir al abrir la app. */
  omitida: boolean;
}

const KEY = 'cuenta';
function leer(): Cuenta {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (c) return { token: c.token ?? null, nombre: c.nombre ?? null, foto: c.foto ?? null, base: SERVIDOR_FIJO || (c.base ?? ''), omitida: !!c.omitida };
  } catch {
    /* nada guardado */
  }
  return { token: null, nombre: null, foto: null, base: SERVIDOR_FIJO, omitida: false };
}

export const useCuenta = create<Cuenta>(() => leer());
useCuenta.subscribe((c) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* sin espacio */
  }
});

export const conSesion = () => !!useCuenta.getState().token;

export class ErrorServidor extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Petición al servidor con la sesión. Si la sesión ya no vale (401), se cierra en este aparato. */
export async function api<T>(ruta: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { token, base } = useCuenta.getState();
  let r: Response;
  try {
    r = await fetch(`${base}${ruta}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    marcarSinConexion(base);
    throw new ErrorServidor('No hay conexión con el servidor', 0);
  }
  if (esCaida(r.status)) {
    marcarSinConexion(base);
    throw new ErrorServidor('No hay conexión con el servidor', 0);
  }
  marcarConectado();
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && token && ruta !== '/api/login') useCuenta.setState({ token: null });
  if (!r.ok) throw new ErrorServidor(datos.error ?? `Error ${r.status}`, r.status);
  return datos as T;
}

/** Nombre de este aparato para la lista de sesiones del panel ("iPhone", "PC con Windows"…). */
export function nombreAparato() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'PC con Windows';
  if (/Mac OS X/.test(ua)) return 'Mac';
  return 'Navegador';
}

interface Respuesta {
  token: string;
  nombre: string;
  foto?: string | null;
}

export async function entrar(nombre: string, clave: string) {
  const r = await api<Respuesta>('/api/login', { method: 'POST', body: { nombre, clave, aparato: nombreAparato() } });
  useCuenta.setState({ token: r.token, nombre: r.nombre, foto: r.foto ?? null, omitida: false });
}

export async function crearCuenta(codigo: string, nombre: string, clave: string) {
  const r = await api<Respuesta>('/api/registro', { method: 'POST', body: { codigo, nombre, clave, aparato: nombreAparato() } });
  useCuenta.setState({ token: r.token, nombre: r.nombre, foto: null, omitida: false });
}

/** Antes de crear la cuenta: ¿sirve el código? y, si se manda el nombre, ¿está libre? (lanza error si no) */
export async function revisarRegistro(codigo: string, nombre?: string) {
  await api('/api/registro/revisar', { method: 'POST', body: nombre === undefined ? { codigo } : { codigo, nombre } });
}

export async function salir() {
  // Primero se suben los cambios de playlists que falten (después, sin sesión, ya no se puede).
  await import('./playlistsCuenta').then((m) => m.subirAntesDeSalir()).catch(() => {});
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* sin conexión: igual se cierra en este aparato */
  }
  useCuenta.setState({ token: null, nombre: null, foto: null });
}

// ---------------- Foto de perfil (se guarda en el servidor: se ve igual en todos los aparatos) ----------------

/** Dirección de una foto de perfil (de cualquier usuario). */
export const urlFoto = (foto: string | null | undefined) => (foto ? `${useCuenta.getState().base}/api/fotos/${encodeURIComponent(foto)}` : null);

/**
 * Sube la foto y la deja como la mía: un JPG ya recortado (base64), o un GIF entero con el recorte elegido
 * (en píxeles de la imagen original; el servidor lo recorta y lo deja animado).
 */
export async function subirFoto(imagen: string, recorte?: { x: number; y: number; lado: number }) {
  const r = await api<{ foto: string }>('/api/foto', { method: 'POST', body: { imagen, recorte } });
  useCuenta.setState({ foto: r.foto });
}

/** Dirección del banner de un perfil (foto o GIF). */
export const urlBanner = (banner: string | null | undefined) =>
  banner ? `${useCuenta.getState().base}/api/banners/${encodeURIComponent(banner)}` : null;

/** Sube mi banner (una foto ya achicada como JPG, o un GIF entero: el servidor lo recorta y lo deja animado). */
export async function subirBanner(imagen: string) {
  return (await api<{ banner: string }>('/api/banner', { method: 'POST', body: { imagen } })).banner;
}

export async function quitarBanner() {
  await api('/api/banner', { method: 'DELETE' });
}

/** Dirección de la foto propia de una playlist. */
export const urlFotoPlaylist = (foto: string | null | undefined) =>
  foto ? `${useCuenta.getState().base}/api/playlist-fotos/${encodeURIComponent(foto)}` : null;

/** Pone (o cambia) la foto de una playlist mía; el servidor la deja cuadrada (600 px). */
export async function subirFotoPlaylist(id: string, imagen: string) {
  return api<{ foto: string; actualizada: number }>(`/api/playlists/${encodeURIComponent(id)}/foto`, { method: 'POST', body: { imagen } });
}

export async function quitarFotoPlaylist(id: string) {
  return api<{ foto: null; actualizada: number }>(`/api/playlists/${encodeURIComponent(id)}/foto`, { method: 'DELETE' });
}

export async function quitarFoto() {
  await api('/api/foto', { method: 'DELETE' });
  useCuenta.setState({ foto: null });
}

/** Al abrir la app: trae la foto (y el nombre) actuales, por si se cambiaron en otro aparato. */
export async function refrescarYo() {
  if (!useCuenta.getState().token) return;
  try {
    const r = await api<{ nombre: string; foto: string | null }>('/api/yo');
    useCuenta.setState({ nombre: r.nombre, foto: r.foto ?? null });
  } catch {
    /* sin conexión: queda lo guardado */
  }
}
setTimeout(() => void refrescarYo(), 1500);
