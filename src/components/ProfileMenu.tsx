import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { closeAllOverlaysThen, closeOverlay, openOverlay, useNav } from '../nav';
import { api, refrescarYo, salir, urlFoto, useCuenta } from '../server/cuenta';
import { FotoPerfil } from './FotoPerfil';
import { showSnack } from './PlaylistSheets';
import { useSocial } from '../server/social';
import { abrirCuenta } from './CuentaScreen';
import { HistoryIcon, NoteIcon, PersonAddIcon, LogoutIcon, PersonIcon, SettingsIcon, EditIcon } from './Icons';
import { useExit } from './useExit';
import { escritorioActivo } from '../escritorio/activo';
import { abrirAyuda } from '../escritorio/atajos';

/**
 * Botón del perfil (arriba a la derecha) y su menú: Historial, Amigos, Configuración y Cerrar sesión.
 * Sin cuenta: el menú ofrece "Iniciar sesión".
 */
const useMenuPerfil = create<{ open: boolean; vista: 'menu' | 'sugerir' | 'foto' }>(() => ({ open: false, vista: 'menu' }));

function abrirMenu() {
  useMenuPerfil.setState({ open: true, vista: 'menu' });
  openOverlay(() => useMenuPerfil.setState({ open: false }));
  void refrescarYo(); // por si cambió la foto en otro aparato
}

/** Abre "Foto de perfil" (desde mi perfil). */
export function abrirFotoPerfil() {
  useMenuPerfil.setState({ open: true, vista: 'foto' });
  openOverlay(() => useMenuPerfil.setState({ open: false }));
}

/** Color fijo por nombre: cada usuario tiene siempre el mismo. */
function colorDe(nombre: string) {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}

/**
 * Avatar de un usuario: su foto de perfil (si subió una) o un círculo con su inicial (o la silueta, si no hay
 * nombre). Si la foto no carga (sin conexión), vuelve a la inicial.
 */
export function AvatarDe({ nombre, foto, size = 32 }: { nombre: string | null | undefined; foto?: string | null; size?: number }) {
  const [rota, setRota] = useState<string | null>(null);
  const url = urlFoto(foto);
  if (url && rota !== url) {
    return <img className="avatar foto" src={url} alt="" width={size} height={size} draggable={false} style={{ width: size, height: size }} onError={() => setRota(url)} />;
  }
  if (!nombre) {
    return (
      <span className="avatar vacio" style={{ width: size, height: size }}>
        <PersonIcon size={Math.round(size * 0.62)} />
      </span>
    );
  }
  return (
    <span className="avatar" style={{ width: size, height: size, background: colorDe(nombre.toLowerCase()), fontSize: size * 0.45 }}>
      {[...nombre][0].toUpperCase()}
    </span>
  );
}

/** Mi avatar (la cuenta con sesión abierta). */
export function Avatar({ size = 32 }: { size?: number }) {
  const nombre = useCuenta((s) => (s.token ? s.nombre : null));
  const foto = useCuenta((s) => (s.token ? s.foto : null));
  return <AvatarDe nombre={nombre} foto={foto} size={size} />;
}

export function ProfileButton() {
  const solicitudes = useSocial((s) => s.recibidas.length);
  return (
    <button className="perfil-btn" onClick={abrirMenu} aria-label={solicitudes ? `Tu perfil · ${solicitudes} solicitudes de amistad` : 'Tu perfil'}>
      <Avatar />
      {solicitudes > 0 && <span className="perfil-punto" aria-hidden="true" />}
    </button>
  );
}

export function ProfileMenu() {
  const { shown, closing } = useExit(useMenuPerfil((s) => s.open) || null, 180);
  const nombre = useCuenta((s) => s.nombre);
  const conectado = useCuenta((s) => !!s.token);
  const solicitudes = useSocial((s) => s.recibidas.length);
  const vista = useMenuPerfil((s) => s.vista);
  if (!shown) return null;
  if (vista === 'sugerir' || vista === 'foto') {
    return (
      <div className={`sheet-backdrop ${closing ? 'closing' : ''}`} onClick={closing ? undefined : closeOverlay}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          {vista === 'foto' ? <FotoPerfil /> : <SugerirCancion />}
        </div>
      </div>
    );
  }

  const run = (fn: () => void) => () => {
    closeOverlay();
    setTimeout(fn, 30);
  };

  // Versión de PC: lista desplegable bajo el botón del perfil (arriba a la derecha).
  if (escritorioActivo()) {
    const ir = (p: Parameters<ReturnType<typeof useNav.getState>['push']>[0]) => () => closeAllOverlaysThen(() => useNav.getState().push(p));
    return (
      <div className={`esc-perfil-velo ${closing ? 'closing' : ''}`} onClick={closing ? undefined : closeOverlay}>
        <div className="esc-perfil-menu" role="menu" onClick={(e) => e.stopPropagation()}>
          <div className="esc-perfil-cab">
            <Avatar size={36} />
            <div className="track-text">
              <div className="track-title">{conectado ? nombre : 'Sin cuenta'}</div>
              <div className="track-sub">{conectado ? 'Conectado al servidor' : 'Solo tu música local'}</div>
            </div>
          </div>
          {conectado && (
            <button role="menuitem" onClick={ir({ type: 'usuario', id: 0 })}>
              <span className="esc-perfil-item"><PersonIcon size={20} /> Perfil</span>
            </button>
          )}
          {conectado && (
            <button role="menuitem" onClick={() => useMenuPerfil.setState({ vista: 'foto' })}>
              <span className="esc-perfil-item"><EditIcon size={20} /> Foto de perfil</span>
            </button>
          )}
          <button role="menuitem" onClick={ir({ type: 'history' })}>
            <span className="esc-perfil-item"><HistoryIcon size={20} /> Historial</span>
          </button>
          <button role="menuitem" onClick={ir({ type: 'amigos' })}>
            <span className="esc-perfil-item"><PersonAddIcon size={20} /> Amigos</span> {solicitudes > 0 && <span className="contador">{solicitudes}</span>}
          </button>
          {conectado && (
            <button role="menuitem" onClick={() => useMenuPerfil.setState({ vista: 'sugerir' })}>
              <span className="esc-perfil-item"><NoteIcon size={20} /> Sugerir una canción</span>
            </button>
          )}
          <button role="menuitem" onClick={ir({ type: 'settings' })}>
            <span className="esc-perfil-item"><SettingsIcon size={20} /> Configuración</span>
          </button>
          <button role="menuitem" onClick={run(abrirAyuda)}>
            <span className="esc-perfil-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <rect x="2.5" y="6" width="19" height="12" rx="2" />
                <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M8 14h8" />
              </svg>{' '}
              Atajos de teclado
            </span>
            <span className="esc-perfil-tecla">Ctrl /</span>
          </button>
          <div className="esc-perfil-sep" />
          {conectado ? (
            <button role="menuitem" onClick={run(() => void salir())}>
              <span className="esc-perfil-item"><LogoutIcon size={20} /> Cerrar sesión</span>
            </button>
          ) : (
            <button role="menuitem" onClick={run(abrirCuenta)}>
              <span className="esc-perfil-item"><PersonIcon size={20} /> Iniciar sesión</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`sheet-backdrop ${closing ? 'closing' : ''}`} onClick={closing ? undefined : closeOverlay}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head perfil-head">
          <Avatar size={44} />
          <div className="track-text">
            <div className="track-title">{conectado ? nombre : 'Sin cuenta'}</div>
            <div className="track-sub">{conectado ? 'Conectado al servidor' : 'Solo tu música local'}</div>
          </div>
        </div>
        {conectado && (
          <button className="sheet-item" onClick={() => closeAllOverlaysThen(() => useNav.getState().push({ type: 'usuario', id: 0 }))}>
            <PersonIcon /> Tu perfil
          </button>
        )}
        {conectado && (
          <button className="sheet-item" onClick={() => useMenuPerfil.setState({ vista: 'foto' })}>
            <EditIcon /> Foto de perfil
          </button>
        )}
        <button className="sheet-item" onClick={() => closeAllOverlaysThen(() => useNav.getState().push({ type: 'history' }))}>
          <HistoryIcon /> Historial
        </button>
        <button className="sheet-item" onClick={() => closeAllOverlaysThen(() => useNav.getState().push({ type: 'amigos' }))}>
          <PersonAddIcon /> Amigos {solicitudes > 0 && <span className="contador">{solicitudes}</span>}
        </button>
        {conectado && (
          <button className="sheet-item" onClick={() => useMenuPerfil.setState({ vista: 'sugerir' })}>
            <NoteIcon /> Sugerir una canción
          </button>
        )}
        <button className="sheet-item" onClick={() => closeAllOverlaysThen(() => useNav.getState().push({ type: 'settings' }))}>
          <SettingsIcon /> Configuración
        </button>
        {conectado ? (
          <button className="sheet-item" onClick={run(() => void salir())}>
            <LogoutIcon /> Cerrar sesión
          </button>
        ) : (
          <button className="sheet-item" onClick={run(abrirCuenta)}>
            <PersonIcon /> Iniciar sesión
          </button>
        )}
      </div>
    </div>
  );
}

/** Solo estos sitios (https). La misma regla está en el servidor (servidor/src/enlaces.js), que es la que manda. */
const DOMINIOS_ENLACE = ['open.spotify.com', 'music.youtube.com', 'www.youtube.com'];
const MENSAJE_ENLACE = 'Solo enlaces de open.spotify.com, music.youtube.com o www.youtube.com';
const pareceEnlace = (t: string) => /^https?:/i.test(t) || t.includes('://') || /(^|[^a-z0-9])www\./i.test(t);
function enlaceValido(t: string): boolean {
  if (t.length > 300) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && DOMINIOS_ENLACE.includes(u.hostname);
  } catch {
    return false;
  }
}

/** "Sugerir una canción": una sola casilla (artista, "artista - canción" o un enlace). Le llega al administrador en su panel. */
function SugerirCancion() {
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const primero = useRef<HTMLInputElement>(null);
  useEffect(() => primero.current?.focus(), []);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return setError('Escribe un artista, una canción o un enlace.');
    // Aviso inmediato; el servidor vuelve a validar (esa es la que manda).
    if (pareceEnlace(t) && !enlaceValido(t)) return setError(MENSAJE_ENLACE);
    setEnviando(true);
    try {
      await api('/api/sugerencias', { method: 'POST', body: { texto: t } });
      closeOverlay();
      showSnack('¡Gracias! Se la enviamos al administrador');
    } catch (x) {
      setError((x as Error).message || 'No se pudo enviar. Revisa la conexión.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="sugerir" onSubmit={enviar} noValidate>
      <h3>Sugerir una canción</h3>
      <div className={`cuenta-campo ${error ? 'mal' : ''}`}>
        <label className="cuenta-etiqueta" htmlFor="sugerir-texto">
          Artista, artista - canción, o un enlace de Spotify o YouTube
        </label>
        <input
          ref={primero}
          id="sugerir-texto"
          value={texto}
          maxLength={300}
          placeholder="Ej.: Soda Stereo - De música ligera"
          enterKeyHint="send"
          aria-invalid={!!error}
          onChange={(e) => {
            setTexto(e.target.value);
            if (error) setError(null);
          }}
        />
        {error && (
          <p className="cuenta-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button className="cuenta-btn" disabled={enviando}>
        {enviando ? 'Enviando…' : 'Enviar'}
      </button>
    </form>
  );
}
