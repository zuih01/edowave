import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cover } from '../components/Cover';
import { BackIcon, CheckIcon, ChevronRightIcon, CloseIcon, EditIcon, HeadphonesIcon, PersonAddIcon, PlusIcon, SearchIcon } from '../components/Icons';
import { PlaylistCover } from '../components/PlaylistCover';
import { showSnack } from '../components/PlaylistSheets';
import { abrirFotoPerfil, AvatarDe } from '../components/ProfileMenu';
import { Carrusel } from '../components/Carrusel';
import { TrackRow } from '../components/TrackRow';
import { usePlaylists } from '../library/playlists';
import { useLibrary } from '../library/store';
import { goBack, useNav } from '../nav';
import { usePlayer } from '../player/player';
import { useReco } from '../reco/store';
import { api, quitarBanner, subirBanner, urlBanner, urlFoto, useCuenta } from '../server/cuenta';
import { useDominantColor } from '../player/useDominantColor';
import {
  aceptarSolicitud,
  cargarAmigos,
  cargarComunidad,
  anularInvitacion,
  cargarInvitaciones,
  crearInvitacion,
  linkInvitacion,
  type Invitacion,
  buscarUsuarios,
  dejarDeEscuchar,
  escucharCon,
  mandarSolicitud,
  quitarAmistad,
  useSocial,
  type Amigo,
  type Escuchando,
  type Insignia,
  type PlaylistComunidad,
} from '../server/social';
import type { Track } from '../types';
import { PlaylistCardView } from './Home';

function BackBar() {
  return (
    <button className="back-btn" onClick={goBack} aria-label="Atrás">
      <BackIcon />
    </button>
  );
}

const errorDe = (e: unknown) => (e as Error)?.message || 'No se pudo. Revisa la conexión.';

/** "Escuchando ahora" / "En pausa" de un amigo, en una línea. */
function lineaEscuchando(e: Escuchando | null | undefined) {
  if (!e?.titulo) return null;
  return { sonando: e.sonando, texto: `${e.titulo} · ${e.artista}`, local: e.local };
}

// ---------------- Amigos ----------------

/**
 * Invitar a alguien a la app con un link (o con el código, que es lo mismo). Sirve una vez y vence en 7 días;
 * cada usuario puede tener hasta 3 sin usar. Quien entra con tu link queda como tu amigo.
 */
function InvitarALaApp() {
  const [lista, setLista] = useState<Invitacion[] | null>(null);
  const [maximo, setMaximo] = useState(3);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(() => {
    cargarInvitaciones().then(
      (r) => {
        setLista(r.invitaciones);
        setMaximo(r.maximo);
      },
      () => setLista([]),
    );
  }, []);
  useEffect(cargar, [cargar]);

  const compartir = async (codigo: string) => {
    const url = linkInvitacion(codigo);
    const texto = `Te invito a mi app de música. Entra aquí para crear tu cuenta: ${url} (o usa el código ${codigo})`;
    try {
      if (navigator.share) return await navigator.share({ title: 'Invitación', text: texto });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // cerró el menú de compartir
    }
    try {
      await navigator.clipboard.writeText(url);
      showSnack('Link copiado');
    } catch {
      showSnack(`Tu código: ${codigo}`);
    }
  };

  const nueva = async () => {
    setCreando(true);
    try {
      const inv = await crearInvitacion();
      setLista((l) => [inv, ...(l ?? [])]);
      await compartir(inv.codigo);
    } catch (e) {
      showSnack(errorDe(e));
    } finally {
      setCreando(false);
    }
  };

  const anular = async (id: number) => {
    try {
      await anularInvitacion(id);
      setLista((l) => (l ?? []).filter((x) => x.id !== id));
    } catch (e) {
      showSnack(errorDe(e));
    }
  };

  const quedan = maximo - (lista?.length ?? 0);
  const dias = (vence: string) => Math.max(1, Math.ceil((Date.parse(vence) - Date.now()) / 86_400_000));
  return (
    <section className="invitar">
      <h3 className="sub-head">Invitar a la app</h3>
      <button className="invitar-btn" onClick={nueva} disabled={creando || lista === null || quedan <= 0}>
        <span className="invitar-icono" aria-hidden="true">
          <PersonAddIcon size={22} />
        </span>
        <span className="track-text">
          <span className="track-title">{creando ? 'Creando link…' : 'Crear link de invitación'}</span>
          <span className="track-sub">
            {quedan > 0 ? 'Sirve una vez y vence en 7 días. Quien entre queda como tu amigo.' : `Ya tienes ${maximo} sin usar: anula una para crear otra.`}
          </span>
        </span>
        <span className="invitar-flecha" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      </button>
      {!!lista?.length && (
        <div className="list">
          {lista.map((i) => (
            <div key={i.id} className="amigo-row invitacion">
              <div className="track-text">
                <div className="track-title invitacion-codigo">{i.codigo}</div>
                <div className="track-sub">Sin usar · vence en {dias(i.vence)} {dias(i.vence) === 1 ? 'día' : 'días'}</div>
              </div>
              <button className="icon-btn" onClick={() => anular(i.id)} aria-label={`Anular la invitación ${i.codigo}`}>
                <CloseIcon />
              </button>
              <button className="pill primary" onClick={() => compartir(i.codigo)}>
                Compartir
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function AmigosPage() {
  const conectado = useCuenta((s) => !!s.token);
  const { amigos, recibidas, enviadas } = useSocial();
  const push = useNav((s) => s.push);
  // Al abrir Amigos se pide la lista al servidor (está guardada en tu cuenta, igual en todos tus aparatos).
  useEffect(() => {
    if (conectado) void cargarAmigos();
  }, [conectado]);
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<{ id: number; nombre: string; foto?: string | null }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const busca = q.trim().replace(/^@+/, '');
    setError('');
    if (!busca) return setResultados([]);
    let vivo = true;
    const t = setTimeout(() => {
      buscarUsuarios(busca).then(
        (r) => vivo && setResultados(r),
        () => vivo && setResultados([]),
      );
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q]);

  if (!conectado) {
    return (
      <div className="detail social">
        <BackBar />
        <h1 className="page-title">Amigos</h1>
        <p className="muted empty-note">Inicia sesión para agregar amigos y escuchar con ellos.</p>
      </div>
    );
  }

  const relacion = (id: number) =>
    amigos.some((a) => a.id === id) ? 'amigo' : enviadas.some((a) => a.id === id) ? 'enviada' : recibidas.some((a) => a.id === id) ? 'recibida' : null;

  const agregar = async (nombre: string) => {
    try {
      await mandarSolicitud(nombre);
      showSnack(`Solicitud enviada a ${nombre}`);
    } catch (e) {
      setError(errorDe(e));
    }
  };
  const accion = (fn: () => Promise<unknown>, ok?: string) => async () => {
    try {
      await fn();
      if (ok) showSnack(ok);
    } catch (e) {
      showSnack(errorDe(e));
    }
  };

  return (
    <div className="detail social amigos">
      <BackBar />
      <h1 className="page-title">Amigos</h1>

      <div className="amigos-buscar">
        <SearchIcon size={20} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre de usuario"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-label="Buscar usuarios"
        />
        {q && (
          <button className="icon-btn" onClick={() => setQ('')} aria-label="Borrar búsqueda">
            <CloseIcon size={20} />
          </button>
        )}
      </div>
      {error && <p className="amigos-error">{error}</p>}
      {q.trim() && (
        <div className="list">
          {resultados.length === 0 && <p className="muted empty-note">Nadie con ese nombre.</p>}
          {resultados.map((u) => {
            const r = relacion(u.id);
            return (
              <div key={u.id} className="amigo-row" role="button" onClick={() => push({ type: 'usuario', id: u.id })}>
                <AvatarDe nombre={u.nombre} foto={u.foto} size={44} />
                <div className="track-text">
                  <div className="track-title">{u.nombre}</div>
                  <div className="track-sub">{r === 'amigo' ? 'Ya son amigos' : r === 'enviada' ? 'Solicitud enviada' : r === 'recibida' ? 'Te mandó una solicitud' : ''}</div>
                </div>
                {r === null && (
                  <button
                    className="pill primary"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void agregar(u.nombre);
                    }}
                  >
                    <PlusIcon size={18} /> Agregar
                  </button>
                )}
                {r === 'recibida' && (
                  <span onClick={(ev) => ev.stopPropagation()}>
                    <button className="pill primary" onClick={accion(() => aceptarSolicitud(recibidas.find((x) => x.id === u.id)!.amistad), `Ahora eres amigo de ${u.nombre}`)}>
                      Aceptar
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!q.trim() && (
        <>
          {recibidas.length > 0 && (
            <section>
              <h3 className="sub-head">Solicitudes</h3>
              <div className="list">
                {recibidas.map((a) => (
                  <div key={a.amistad} className="amigo-row">
                    <AvatarDe nombre={a.nombre} foto={a.foto} size={44} />
                    <div className="track-text">
                      <div className="track-title">{a.nombre}</div>
                      <div className="track-sub">Quiere ser tu amigo</div>
                    </div>
                    <button className="icon-btn" onClick={accion(() => quitarAmistad(a.amistad))} aria-label={`Rechazar a ${a.nombre}`}>
                      <CloseIcon />
                    </button>
                    <button className="pill primary" onClick={accion(() => aceptarSolicitud(a.amistad), `Ahora eres amigo de ${a.nombre}`)}>
                      <CheckIcon size={18} /> Aceptar
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <InvitarALaApp />

          <section>
            <h3 className="sub-head">Tus amigos</h3>
            {amigos.length === 0 && <p className="muted empty-note">Busca a alguien arriba para mandarle una solicitud.</p>}
            <div className="list">
              {amigos.map((a) => (
                <FilaAmigo key={a.id} a={a} onOpen={() => push({ type: 'usuario', id: a.id })} />
              ))}
            </div>
          </section>

          {enviadas.length > 0 && (
            <section>
              <h3 className="sub-head">Enviadas</h3>
              <div className="list">
                {enviadas.map((a) => (
                  <div key={a.amistad} className="amigo-row">
                    <AvatarDe nombre={a.nombre} foto={a.foto} size={44} />
                    <div className="track-text">
                      <div className="track-title">{a.nombre}</div>
                      <div className="track-sub">Esperando que acepte</div>
                    </div>
                    <button className="pill" onClick={accion(() => quitarAmistad(a.amistad), 'Solicitud cancelada')}>
                      Cancelar
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Qué se ve de un amigo: lo que escucha (si lo comparte) o solo "Conectado" / "Sin conexión".
 * Quien no comparte lo que escucha no muestra nada más (ni un aviso de que no comparte).
 */
function estadoAmigo(a: Amigo, l: ReturnType<typeof lineaEscuchando>) {
  if (a.comparte !== false && l && (a.conectado || l.sonando)) return `${l.sonando ? '' : 'En pausa · '}${l.texto}`;
  return a.conectado ? 'Conectado' : 'Sin conexión';
}

/** ¿Eligió color o fondo para su perfil? Entonces su fila lleva placa. */
const tienePlaca = (e?: EstiloPerfil | null): e is EstiloPerfil => !!e && (!!e.color || e.fondo !== 'ninguno');

/**
 * La decoración de una fila de amigo, como las placas de nombre de Discord: el color y el fondo animado de su
 * perfil entran desde la derecha y se desvanecen hacia el nombre.
 */
function PlacaFondo({ fondo }: { fondo: FondoPerfil }) {
  return (
    <div className="placa-fondo" aria-hidden="true">
      <FondoAnimado fondo={fondo} />
    </div>
  );
}

function FilaAmigo({ a, onOpen }: { a: Amigo; onOpen: () => void }) {
  const siguiendo = useSocial((s) => s.siguiendo === a.id);
  const l = lineaEscuchando(a.escuchando);
  const placa = tienePlaca(a.estilo) ? a.estilo : null;
  const colorFoto = useDominantColor(placa && !placa.color ? (urlFoto(a.foto) ?? undefined) : undefined, '#ff4e6a');
  return (
    <div
      className={`amigo-row ${placa ? 'amigo-placa' : ''}`}
      onClick={onOpen}
      style={placa ? ({ '--perfil': placa.color ?? colorFoto } as React.CSSProperties) : undefined}
    >
      {placa && <PlacaFondo fondo={placa.fondo} />}
      <span className="amigo-avatar">
        <AvatarDe nombre={a.nombre} foto={a.foto} size={44} />
        {l?.sonando && <span className="amigo-vivo" aria-hidden="true" />}
      </span>
      <div className="track-text">
        <div className="track-title amigo-nombre">
          <span className="amigo-nombre-txt">{a.nombre}</span>
        </div>
        <div className={`track-sub ${l?.sonando && a.comparte !== false ? 'vivo' : ''}`}>{estadoAmigo(a, l)}</div>
      </div>
      {l?.sonando && a.comparte !== false && (
        <button
          className={`icon-btn juntos-btn ${siguiendo ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (siguiendo) dejarDeEscuchar();
            else escucharCon(a.id);
          }}
          aria-label={siguiendo ? `Dejar de escuchar con ${a.nombre}` : `Escuchar con ${a.nombre}`}
        >
          <HeadphonesIcon />
        </button>
      )}
    </div>
  );
}

// ---------------- Insignias ----------------

/** Dibujo de cada insignia (viewBox 24). */
const DIBUJO_INSIGNIA: Record<string, string> = {
  horas: 'M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z',
  invitados: 'M15 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2zm9 4c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  playlists: 'M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-8v8.2a3 3 0 1 0 2 2.8V8h3V6z',
  amigos: 'M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z',
  megusta: 'M12 21.3l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.5z',
  pionero: 'M12 17.3 18.2 21l-1.6-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.5 14l-1.7 7z',
};
const NIVELES = ['Especial', 'Bronce', 'Plata', 'Oro', 'Diamante'];
const ORDEN_INSIGNIA = ['horas', 'invitados', 'playlists', 'megusta', 'amigos', 'pionero'];
/** Colores de cada insignia (degradado de arriba a abajo), como los íconos de colores de Discord. */
const COLOR_INSIGNIA: Record<string, [string, string]> = {
  horas: ['#ff8fb1', '#e0245e'],
  invitados: ['#7ef29a', '#1fae5b'],
  playlists: ['#c9a2ff', '#7a3cf0'],
  amigos: ['#8ad4ff', '#3a7bf0'],
  megusta: ['#ff9ad5', '#e0359e'],
  pionero: ['#ffe27a', '#f59e0b'],
};

function IconoInsignia({ i, size = 16 }: { i: Insignia; size?: number }) {
  const [a, b] = COLOR_INSIGNIA[i.id] ?? COLOR_INSIGNIA.pionero;
  const id = `ins-${i.id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <path d={DIBUJO_INSIGNIA[i.id] ?? DIBUJO_INSIGNIA.pionero} fill={`url(#${id})`} />
    </svg>
  );
}

const CATEGORIA_INSIGNIA: Record<string, string> = {
  horas: 'Horas escuchadas',
  invitados: 'Invitaciones',
  playlists: 'Playlists',
  amigos: 'Amigos',
  megusta: 'Me gusta',
  pionero: 'Especial',
};

/**
 * Fila de insignias del perfil. Al pasar el mouse (o tocar, en el teléfono) sale una tarjeta como la de Discord:
 * el ícono grande, la categoría, el nombre y la cifra.
 */
function FilaInsignias({ lista }: { lista: Insignia[] }) {
  const [abierta, setAbierta] = useState<{ id: string; x: number } | null>(null);
  const fila = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierta) return;
    const cerrar = (e: PointerEvent) => !fila.current?.contains(e.target as Node) && setAbierta(null);
    document.addEventListener('pointerdown', cerrar);
    return () => document.removeEventListener('pointerdown', cerrar);
  }, [abierta]);
  if (!lista.length) return null;
  const orden = [...lista].sort((a, b) => ORDEN_INSIGNIA.indexOf(a.id) - ORDEN_INSIGNIA.indexOf(b.id));
  const abrir = (i: Insignia, el: HTMLElement) => setAbierta({ id: i.id, x: el.offsetLeft + el.offsetWidth / 2 });
  const actual = abierta && orden.find((i) => i.id === abierta.id);
  return (
    <div className="perfil-insignias" role="list" aria-label="Insignias" ref={fila} onMouseLeave={() => setAbierta(null)}>
      {orden.map((i) => (
        <button
          key={i.id}
          role="listitem"
          className={`insignia nivel-${i.nivel} ${abierta?.id === i.id ? 'activa' : ''}`}
          aria-label={`${i.nombre}: ${i.detalle}`}
          onMouseEnter={(e) => abrir(i, e.currentTarget)}
          onFocus={(e) => abrir(i, e.currentTarget)}
          onClick={(e) => (abierta?.id === i.id ? setAbierta(null) : abrir(i, e.currentTarget))}
        >
          <IconoInsignia i={i} size={20} />
        </button>
      ))}
      {actual && (
        <div className={`insignia-tarjeta nivel-${actual.nivel}`} style={{ left: abierta!.x }} role="tooltip">
          <span className="insignia-tarjeta-icono">
            <IconoInsignia i={actual} size={64} />
          </span>
          <span className="insignia-tarjeta-cat">
            {CATEGORIA_INSIGNIA[actual.id] ?? 'Insignia'}
            {actual.nivel > 0 && ` · ${NIVELES[actual.nivel]}`}
          </span>
          <b className="insignia-tarjeta-nombre">{actual.nombre}</b>
          <span className="insignia-tarjeta-detalle">{actual.detalle}</span>
        </div>
      )}
    </div>
  );
}

// ---------------- Perfil de un amigo ----------------

type FondoPerfil = 'ninguno' | 'particulas' | 'aurora' | 'estrellas' | 'ondas' | 'burbujas';
interface EstiloPerfil {
  color: string | null;
  fondo: FondoPerfil;
}
interface Perfil {
  id: number;
  nombre: string;
  foto: string | null;
  banner?: string | null;
  descripcion: string;
  estilo?: EstiloPerfil;
  insignias?: Insignia[];
  playlists: number;
  amigos: { id: number; nombre: string; foto: string | null }[];
  /** Esa persona ocultó sus amigos (Configuración → Privacidad): no llega la lista ni cuántos son. */
  amigosOcultos?: boolean;
  relacion: 'yo' | 'amigos' | 'enviada' | 'recibida' | null;
  amistad: number | null;
}

const MAX_DESCRIPCION = 300;

/**
 * Lee la imagen elegida para el banner. Un GIF va entero (el servidor lo deja animado); una foto se achica aquí
 * a 2000 px de ancho como JPG, para que la subida pese poco. El servidor la recorta a 3:1 al centro.
 */
async function leerBanner(f: File): Promise<string> {
  const leer = () =>
    new Promise<string>((ok, mal) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => mal(new Error('No se pudo leer la imagen.'));
      r.readAsDataURL(f);
    });
  if (f.type === 'image/gif') {
    if (f.size > 15 * 1024 * 1024) throw new Error('El GIF tiene que pesar menos de 15 MB');
    return leer();
  }
  if (!f.type.startsWith('image/')) throw new Error('Ese archivo no es una imagen');
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('No se pudo abrir la imagen.'));
      i.src = url;
    });
    const k = Math.min(1, 2000 / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** "rgb(12, 34, 56)" o "#123456" → "#123456" (para el selector de color). */
function aHex(c: string) {
  const m = c.match(/\d+/g);
  if (c.startsWith('#') || !m || m.length < 3) return c.slice(0, 7);
  return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}
const COLORES = ['#ff4e6a', '#e0359e', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#eab308', '#f97316', '#ef4444', '#64748b'];
const FONDOS: { id: FondoPerfil; nombre: string }[] = [
  { id: 'ninguno', nombre: 'Liso' },
  { id: 'particulas', nombre: 'Partículas' },
  { id: 'aurora', nombre: 'Aurora' },
  { id: 'estrellas', nombre: 'Estrellas' },
  { id: 'ondas', nombre: 'Ondas' },
  { id: 'burbujas', nombre: 'Burbujas' },
];

/** Puntos del fondo animado: posiciones y tiempos fijos (iguales en cada visita), distintos entre sí. */
const PUNTOS = Array.from({ length: 26 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 97.13 + n * 13.7) + 1) / 2) % 1;
  return { x: r(1) * 100, y: r(2) * 100, t: 0.4 + r(3) * 1.3, d: 9 + r(4) * 16, retraso: -r(5) * 20 };
});

/** El fondo animado del perfil (hecho con CSS: no descarga nada). */
export function FondoAnimado({ fondo }: { fondo: FondoPerfil }) {
  return (
    <div className={`perfil-fondo fondo-${fondo}`} aria-hidden="true">
      {(fondo === 'particulas' || fondo === 'estrellas' || fondo === 'burbujas') &&
        PUNTOS.map((p, i) => (
          <i
            key={i}
            style={
              {
                left: `${p.x}%`,
                top: `${p.y}%`,
                '--t': p.t,
                animationDuration: `${p.d}s`,
                animationDelay: `${p.retraso}s`,
              } as React.CSSProperties
            }
          />
        ))}
    </div>
  );
}

/**
 * Perfil de una persona, con la organización de Spotify: foto grande, "Perfil", nombre enorme y
 * "N playlists públicas • N amigos"; debajo los botones, la descripción, sus playlists públicas y sus amigos.
 * En vez de "Seguir" hay amistad. Cada persona elige el color de su perfil y un fondo animado (como en Steam).
 * `id` 0 = mi propio perfil (ahí se edita).
 */
export function UsuarioPage({ id }: { id: number }) {
  const amigo = useSocial((s) => (id ? s.amigos.find((x) => x.id === id) : undefined));
  const nAmigos = useSocial((s) => s.amigos.length + s.recibidas.length + s.enviadas.length);
  const siguiendo = useSocial((s) => s.siguiendo === id);
  const comunidad = useSocial((s) => s.comunidad);
  const mias = usePlaylists((s) => s.list);
  const miFoto = useCuenta((s) => s.foto);
  const push = useNav((s) => s.push);
  const byId = useByIdMap();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [borrador, setBorrador] = useState<EstiloPerfil>({ color: null, fondo: 'ninguno' });
  const [guardando, setGuardando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [subiendoBanner, setSubiendoBanner] = useState(false);
  const inputBanner = useRef<HTMLInputElement>(null);
  const colorFoto = useDominantColor(urlFoto(perfil?.foto) ?? undefined, '#ff4e6a');

  const cargar = useCallback(() => {
    api<Perfil>(`/api/perfil/${id || 'yo'}`)
      .then((p) => {
        setPerfil(p);
        setError(null);
      })
      .catch((e) => setError(errorDe(e)));
  }, [id]);
  // Se vuelve a pedir si cambian las amistades (aceptó, quitó…) o mi foto.
  useEffect(cargar, [cargar, nAmigos, miFoto]);
  useEffect(() => {
    void cargarComunidad();
  }, []);

  if (!perfil) {
    return (
      <div className="detail social">
        <BackBar />
        {error && <p className="muted empty-note">{error}</p>}
      </div>
    );
  }
  const p = perfil;
  const yo = p.relacion === 'yo';
  // Mientras se edita, se ve cómo quedaría.
  const estilo = editando ? borrador : (p.estilo ?? { color: null, fondo: 'ninguno' as FondoPerfil });
  const color = estilo.color ?? colorFoto;
  const suyas = yo
    ? mias
        .filter((x) => x.public)
        .map((x) => ({ id: x.id, nombre: x.name, tracks: x.trackIds.map((t) => byId.get(t)).filter((t): t is Track => !!t), propia: true }))
    : comunidad.filter((x) => x.duenoId === p.id).map((x) => ({ id: x.id, nombre: x.nombre, tracks: disponibles(x, byId), propia: false }));
  const visibles = suyas.filter((x) => x.tracks.length);
  const nPlaylists = yo ? visibles.length : Math.max(p.playlists, visibles.length);
  const l = amigo ? lineaEscuchando(amigo.escuchando) : null;
  const e = amigo?.escuchando;

  const empezarEdicion = () => {
    setTexto(p.descripcion);
    setBorrador(p.estilo ?? { color: null, fondo: 'ninguno' });
    setEditando(true);
  };
  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await api<{ descripcion: string; estilo: EstiloPerfil }>('/api/perfil', { method: 'PUT', body: { descripcion: texto, estilo: borrador } });
      setPerfil({ ...p, descripcion: r.descripcion, estilo: r.estilo });
      setEditando(false);
      showSnack('Perfil guardado');
    } catch (x) {
      showSnack(errorDe(x));
    } finally {
      setGuardando(false);
    }
  };
  const hacer = (fn: () => Promise<unknown>, ok?: string) => async () => {
    try {
      await fn();
      if (ok) showSnack(ok);
      await cargarAmigos();
      cargar();
    } catch (x) {
      showSnack(errorDe(x));
    }
  };

  const elegirBanner = async (f?: File) => {
    if (!f) return;
    setSubiendoBanner(true);
    try {
      const banner = await subirBanner(await leerBanner(f));
      setPerfil((x) => (x ? { ...x, banner } : x));
      showSnack('Banner actualizado');
    } catch (x) {
      showSnack(errorDe(x));
    } finally {
      setSubiendoBanner(false);
      if (inputBanner.current) inputBanner.current.value = '';
    }
  };
  const sacarBanner = async () => {
    try {
      await quitarBanner();
      setPerfil((x) => (x ? { ...x, banner: null } : x));
      showSnack('Banner quitado');
    } catch (x) {
      showSnack(errorDe(x));
    }
  };

  return (
    <div className="detail social perfil" style={{ '--perfil': color } as React.CSSProperties}>
      <FondoAnimado fondo={estilo.fondo} />
      <div className={`perfil-cabecera ${p.banner ? 'con-banner' : ''}`}>
      {p.banner && (
        <div className="perfil-banner" aria-hidden="true">
          <img src={urlBanner(p.banner)!} alt="" draggable={false} onError={(ev) => (ev.currentTarget.style.visibility = 'hidden')} />
        </div>
      )}
      {yo && (
        <input ref={inputBanner} type="file" accept="image/*" hidden onChange={(ev) => void elegirBanner(ev.target.files?.[0])} />
      )}
      <BackBar />
      <div className="perfil-hero">
        <button
          className="perfil-foto"
          onClick={yo ? abrirFotoPerfil : undefined}
          disabled={!yo}
          aria-label={yo ? 'Cambiar foto de perfil' : undefined}
          title={yo ? 'Cambiar foto de perfil' : undefined}
        >
          <AvatarDe nombre={p.nombre} foto={p.foto} size={168} />
        </button>
        <div className="perfil-datos">
          <span className="perfil-tipo">Perfil</span>
          <h1>{p.nombre}</h1>
          <FilaInsignias lista={p.insignias ?? []} />
          <div className="perfil-cifras">
            {nPlaylists} {nPlaylists === 1 ? 'playlist pública' : 'playlists públicas'}
            {!p.amigosOcultos && <> • {p.amigos.length} {p.amigos.length === 1 ? 'amigo' : 'amigos'}</>}
          </div>
        </div>
      </div>

      </div>

      <div className="perfil-cuerpo">
        <div className="perfil-acciones">
          {yo && !editando && (
            <button className="pill perfil-btn-borde" onClick={empezarEdicion}>
              <EditIcon size={18} /> Editar perfil
            </button>
          )}
          {p.relacion === null && (
            <button className="pill perfil-btn-borde" onClick={hacer(() => mandarSolicitud(p.nombre), 'Solicitud enviada')}>
              <PersonAddIcon size={18} /> Agregar amigo
            </button>
          )}
          {p.relacion === 'enviada' && (
            <button className="pill perfil-btn-borde" onClick={hacer(() => quitarAmistad(p.amistad!), 'Solicitud cancelada')}>
              Solicitud enviada · Cancelar
            </button>
          )}
          {p.relacion === 'recibida' && (
            <>
              <button className="pill primary" onClick={hacer(() => aceptarSolicitud(p.amistad!), `Ahora eres amigo de ${p.nombre}`)}>
                <CheckIcon size={18} /> Aceptar solicitud
              </button>
              <button className="pill perfil-btn-borde" onClick={hacer(() => quitarAmistad(p.amistad!))}>
                Rechazar
              </button>
            </>
          )}
          {p.relacion === 'amigos' && (
            <button className="pill perfil-btn-borde" onClick={() => setConfirmando(true)}>
              <CheckIcon size={18} /> Amigos
            </button>
          )}
          {l?.sonando && amigo?.comparte !== false && (
            <button className={`pill ${siguiendo ? 'perfil-btn-borde' : 'primary'}`} onClick={() => (siguiendo ? dejarDeEscuchar() : escucharCon(p.id))}>
              <HeadphonesIcon size={18} /> {siguiendo ? 'Dejar de escuchar juntos' : 'Escuchar juntos'}
            </button>
          )}
        </div>

        {editando ? (
          <div className="perfil-editar">
            <label className="perfil-editar-titulo" htmlFor="perfil-desc">
              Descripción
            </label>
            <textarea
              id="perfil-desc"
              value={texto}
              maxLength={MAX_DESCRIPCION}
              rows={3}
              placeholder="Cuenta algo de ti: qué música te gusta, qué estás escuchando…"
              onChange={(ev) => setTexto(ev.target.value)}
            />
            <span className="muted small perfil-cuenta">
              {texto.length}/{MAX_DESCRIPCION}
            </span>

            <span className="perfil-editar-titulo">Foto de perfil</span>
            <div className="perfil-banner-op perfil-foto-op">
              <button className="perfil-foto-muestra" onClick={abrirFotoPerfil} aria-label="Cambiar foto de perfil">
                <AvatarDe nombre={p.nombre} foto={p.foto} size={64} />
              </button>
              <div className="perfil-banner-botones">
                <button className="pill" onClick={abrirFotoPerfil}>
                  {p.foto ? 'Cambiar foto' : 'Subir foto'}
                </button>
                <span className="muted small">Foto o GIF. También puedes tocar tu foto de arriba.</span>
              </div>
            </div>

            <span className="perfil-editar-titulo">Banner</span>
            <div className="perfil-banner-op">
              <span className="perfil-banner-muestra" style={{ '--perfil': borrador.color ?? colorFoto } as React.CSSProperties}>
                {p.banner && <img src={urlBanner(p.banner)!} alt="" />}
              </span>
              <div className="perfil-banner-botones">
                <button className="pill" onClick={() => inputBanner.current?.click()} disabled={subiendoBanner}>
                  {subiendoBanner ? 'Subiendo…' : p.banner ? 'Cambiar banner' : 'Subir banner'}
                </button>
                {p.banner && (
                  <button className="pill" onClick={() => void sacarBanner()} disabled={subiendoBanner}>
                    Quitar
                  </button>
                )}
                <span className="muted small">Foto o GIF. Se recorta al centro (3:1). Hasta 5 MB, o 15 MB si es GIF.</span>
              </div>
            </div>

            <span className="perfil-editar-titulo">Color</span>
            <div className="perfil-colores" role="radiogroup" aria-label="Color del perfil">
              <button
                type="button"
                role="radio"
                aria-checked={!borrador.color}
                className="perfil-color auto"
                style={{ background: colorFoto }}
                title="Automático (de tu foto)"
                onClick={() => setBorrador({ ...borrador, color: null })}
              >
                A
              </button>
              {COLORES.map((c) => (
                <button
                  type="button"
                  key={c}
                  role="radio"
                  aria-checked={borrador.color === c}
                  aria-label={c}
                  className="perfil-color"
                  style={{ background: c }}
                  onClick={() => setBorrador({ ...borrador, color: c })}
                />
              ))}
              <label className="perfil-color propio" title="Otro color">
                <input
                  type="color"
                  value={borrador.color ?? aHex(colorFoto)}
                  onChange={(ev) => setBorrador({ ...borrador, color: ev.target.value })}
                  aria-label="Elegir otro color"
                />
                +
              </label>
            </div>

            <span className="perfil-editar-titulo">Fondo</span>
            <div className="perfil-fondos" role="radiogroup" aria-label="Fondo del perfil">
              {FONDOS.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  role="radio"
                  aria-checked={borrador.fondo === f.id}
                  className="perfil-fondo-op"
                  onClick={() => setBorrador({ ...borrador, fondo: f.id })}
                >
                  <span className="perfil-fondo-muestra" style={{ '--perfil': borrador.color ?? colorFoto } as React.CSSProperties}>
                    <FondoAnimado fondo={f.id} />
                  </span>
                  {f.nombre}
                </button>
              ))}
            </div>

            <span className="perfil-editar-titulo">Así te ven tus amigos</span>
            <div className={`amigo-row placa-muestra ${tienePlaca(borrador) ? 'amigo-placa' : ''}`} style={{ '--perfil': borrador.color ?? colorFoto } as React.CSSProperties}>
              {tienePlaca(borrador) && <PlacaFondo fondo={borrador.fondo} />}
              <span className="amigo-avatar">
                <AvatarDe nombre={p.nombre} foto={p.foto} size={44} />
              </span>
              <div className="track-text">
                <div className="track-title amigo-nombre">
                  <span className="amigo-nombre-txt">{p.nombre}</span>
                </div>
                <div className="track-sub">{tienePlaca(borrador) ? 'Tu color y fondo decoran tu nombre' : 'Elige un color o un fondo para decorar tu nombre'}</div>
              </div>
            </div>

            <div className="perfil-editar-pie">
              <button className="pill" onClick={() => setEditando(false)}>
                Cancelar
              </button>
              <button className="pill primary" disabled={guardando} onClick={() => void guardar()}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        ) : (
          p.descripcion && <p className="perfil-descripcion">{p.descripcion}</p>
        )}

        {confirmando && (
          <div className="pad">
            <div className="confirm-box">
              <h3>¿Eliminar a {p.nombre} de tus amigos?</h3>
              <p>Ya no verán lo que escucha cada uno.</p>
              <div className="pl-form-buttons">
                <button className="pill" onClick={() => setConfirmando(false)}>
                  Cancelar
                </button>
                <button
                  className="pill danger"
                  onClick={async () => {
                    setConfirmando(false);
                    await hacer(() => quitarAmistad(p.amistad!), `${p.nombre} ya no es tu amigo`)();
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}

        {amigo && amigo.comparte !== false && e && l && (
          <section>
            <h3 className="sub-head">{l.sonando ? 'Escuchando ahora' : 'Lo último que escuchó'}</h3>
            <div className="ahora-card">
              <Cover coverId={e.portada ?? undefined} seed={e.titulo + e.artista} className="thumb" />
              <div className="track-text">
                <div className="track-title">{e.titulo}</div>
                <div className="track-sub">
                  {e.artista}
                  {e.local ? ' · canción de su teléfono' : ''}
                </div>
              </div>
            </div>
          </section>
        )}

        <section>
          <h3 className="sub-head">Playlists públicas</h3>
          {visibles.length === 0 ? (
            <p className="muted empty-note">{yo ? 'No tienes playlists públicas. Hazlas públicas desde su menú ⋮.' : 'No tiene playlists públicas.'}</p>
          ) : (
            <Carrusel>
              {visibles.map((x) => (
                <button key={x.id} className="card" onClick={() => push(x.propia ? { type: 'playlist', id: x.id } : { type: 'comunidad', id: x.id })}>
                  <PlaylistCover id={x.id} tracks={x.tracks} />
                  <div className="card-title">{x.nombre}</div>
                  <div className="card-sub">Por {p.nombre}</div>
                </button>
              ))}
            </Carrusel>
          )}
        </section>

        {!p.amigosOcultos && (
        <section>
          <h3 className="sub-head">Amigos</h3>
          {p.amigos.length === 0 ? (
            <p className="muted empty-note">{yo ? 'Todavía no tienes amigos agregados.' : 'Todavía no tiene amigos agregados.'}</p>
          ) : (
            <Carrusel>
              {p.amigos.map((f) => (
                <button key={f.id} className="card perfil-amigo" onClick={() => push({ type: 'usuario', id: f.id })}>
                  <AvatarDe nombre={f.nombre} foto={f.foto} size={140} />
                  <div className="card-title">{f.nombre}</div>
                  <div className="card-sub">Perfil</div>
                </button>
              ))}
            </Carrusel>
          )}
        </section>
        )}
      </div>
    </div>
  );
}

// ---------------- Playlists de la comunidad ----------------

function useByIdMap() {
  const tracks = useLibrary((s) => s.tracks);
  return useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
}

/** Las canciones de la playlist que este aparato puede escuchar (las del servidor). */
const disponibles = (p: PlaylistComunidad, byId: Map<string, Track>) => p.canciones.map((id) => byId.get(id)).filter((t): t is Track => !!t);

export function ComunidadPage({ id }: { id: string }) {
  const p = useSocial((s) => s.comunidad.find((x) => x.id === id));
  const byId = useByIdMap();
  const push = useNav((s) => s.push);
  const playTracks = usePlayer((s) => s.playTracks);
  if (!p) {
    return (
      <div className="detail social">
        <BackBar />
        <p className="muted empty-note">Esta playlist ya no es pública.</p>
      </div>
    );
  }
  const tracks = disponibles(p, byId);
  const faltan = p.canciones.length - tracks.length;
  const guardar = async () => {
    await usePlaylists.getState().create(p.nombre, tracks.map((t) => t.id));
    showSnack(`"${p.nombre}" guardada en tu biblioteca`);
  };

  return (
    <div className="detail social">
      <BackBar />
      <div className="detail-hero">
        <PlaylistCover id={p.id} tracks={tracks} className="hero-cover" />
        <h1>{p.nombre}</h1>
        <button className="link" onClick={() => push({ type: 'usuario', id: p.duenoId })}>
          de {p.dueno}
        </button>
        <div className="muted small">
          Playlist pública • {tracks.length} {tracks.length === 1 ? 'canción' : 'canciones'}
        </div>
        <div className="play-buttons">
          <button className="pill primary" disabled={!tracks.length} onClick={() => playTracks(tracks, 0, { shuffle: false })}>
            Reproducir
          </button>
          <button className="pill" disabled={!tracks.length} onClick={guardar}>
            <PlusIcon size={20} /> Guardar
          </button>
        </div>
      </div>
      <div className="list">
        {tracks.map((t, i) => (
          <TrackRow key={t.id} track={t} onPlay={() => playTracks(tracks, i, { shuffle: false })} />
        ))}
      </div>
      {faltan > 0 && (
        <p className="muted pad small">
          {faltan === 1 ? '1 canción está' : `${faltan} canciones están`} solo en el teléfono de {p.dueno}.
        </p>
      )}
    </div>
  );
}

/** Sección de la página principal: playlists públicas de los demás, ordenadas según tus gustos. */
export function DeLaComunidad({ byId, currentId }: { byId: Map<string, Track>; currentId?: string }) {
  const comunidad = useSocial((s) => s.comunidad);
  // Lo tuyo según el servidor (feed, Aleatorio): una playlist que comparte más canciones con eso va primero.
  const tuyas = useReco((s) => s.shuffle);
  const push = useNav((s) => s.push);
  const cards = useMemo(() => {
    const mio = new Set(tuyas);
    return comunidad
      .map((p) => ({ p, tracks: disponibles(p, byId) }))
      .filter((c) => c.tracks.length > 0)
      .map((c) => ({ ...c, score: c.tracks.filter((t) => mio.has(t.id)).length / c.tracks.length + (c.p.deAmigo ? 0.3 : 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [comunidad, byId, tuyas]);
  if (!cards.length) return null;
  return (
    <section>
      <div className="section-head">
        <div className="section-kicker">Playlists públicas</div>
        <h2>De la comunidad</h2>
      </div>
      {/* Con flechas ‹ › en PC (con mouse no se puede deslizar); en el celular se desliza con el dedo. */}
      <Carrusel className="lib-cards">
        {cards.map(({ p, tracks }) => (
          <PlaylistCardView
            key={p.id}
            id={p.id}
            name={p.nombre}
            sub={`de ${p.dueno} · ${tracks.length} ${tracks.length === 1 ? 'canción' : 'canciones'}`}
            tracks={tracks}
            currentId={currentId}
            onOpen={() => push({ type: 'comunidad', id: p.id })}
          />
        ))}
      </Carrusel>
    </section>
  );
}

// ---------------- Aviso "Escuchando con…" ----------------

/** "Ana está escuchando contigo" (para el que comparte la música). */
function textoOyentes(o: { nombre: string }[]) {
  if (o.length === 1) return `${o[0].nombre} está escuchando contigo`;
  if (o.length === 2) return `${o[0].nombre} y ${o[1].nombre} están escuchando contigo`;
  return `${o[0].nombre} y ${o.length - 1} más están escuchando contigo`;
}

export function JuntosBanner() {
  const siguiendo = useSocial((s) => s.siguiendo);
  const oyentes = useSocial((s) => s.oyentes);
  if (siguiendo === null && oyentes.length) {
    return (
      <div className="juntos-banner anfitrion" role="status">
        <HeadphonesIcon size={18} />
        <span className="juntos-texto">{textoOyentes(oyentes)}</span>
      </div>
    );
  }
  return <BannerOyente />;
}

function BannerOyente() {
  const siguiendo = useSocial((s) => s.siguiendo);
  const esperando = useSocial((s) => s.esperando);
  const nombre = useSocial((s) => s.amigos.find((a) => a.id === s.siguiendo)?.nombre);
  if (siguiendo === null) return null;
  return (
    <div className="juntos-banner" role="status">
      <HeadphonesIcon size={18} />
      <span className="juntos-texto">
        {esperando ? `${nombre ?? 'Tu amigo'} está con una canción de su teléfono · esperando la siguiente` : `Escuchando con ${nombre ?? 'tu amigo'}`}
      </span>
      <button onClick={dejarDeEscuchar}>Salir</button>
    </div>
  );
}
