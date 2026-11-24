import { useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { closeOverlay } from '../nav';
import { trackById, usePlayer } from '../player/player';
import { api } from '../server/cuenta';
import { useSocial } from '../server/social';
import {
  abrirVista,
  agregar,
  cambiarControlar,
  compartirLink,
  controlar,
  expulsar,
  invitarAmigo,
  linkParty,
  nombreDe,
  quitarAgregada,
  recomendaciones,
  salirDeParty,
  soyAnfitrion,
  subirAgregada,
  unirse,
  useParty,
  type PartyEstado,
} from '../server/party';
import { Cover } from '../components/Cover';
import { AvatarDe } from '../components/ProfileMenu';
import { showSnack } from '../components/PlaylistSheets';
import { ArrowUpIcon, BackIcon, CheckIcon, CloseIcon, NextIcon, PartyIcon, PauseIcon, PlayIcon, PlusIcon, PrevIcon, SearchIcon, SettingsIcon, ShareIcon } from '../components/Icons';
import type { Track } from '../types';

/**
 * Pantallas de la Party (escuchar en grupo, como la Jam de Spotify):
 *  - aviso de abajo "Party de Ana · 3 personas" (abre la Party);
 *  - la Party: quiénes están, lo que suena, "A continuación" (lo agregado, con quién lo agregó) y lo que sigue en la
 *    cola del anfitrión;
 *  - invitar: compartir el enlace, el código QR (se agranda al tocarlo) y avisar directo a los amigos;
 *  - agregar canciones: recomendaciones del grupo y buscador;
 *  - "¿Quieres unirte a la Party de …?" al abrir el enlace.
 */

const personasTxt = (n: number) => `${n} ${n === 1 ? 'persona' : 'personas'}`;

// ---------------- Aviso de abajo ----------------

export function PartyBanner() {
  const party = useParty((s) => s.party);
  if (!party) return null;
  const anfitrion = soyAnfitrion(party);
  return (
    <button className="juntos-banner party-banner" onClick={() => abrirVista('party')}>
      <PartyIcon size={18} />
      <span className="juntos-texto">
        {anfitrion ? 'Tu Party' : `Party de ${party.anfitrion.nombre}`} · {personasTxt(party.miembros.length)}
      </span>
      <span className="party-banner-ver">Ver</span>
    </button>
  );
}

// ---------------- Código QR ----------------

function Qr({ texto, size }: { texto: string; size: number }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + 2} ${y + 2}h1v1h-1z`;
    return { n: n + 4, d };
  }, [texto]);
  return (
    <svg className="party-qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="Código QR de la Party">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

// ---------------- Filas ----------------

function FilaCancion({
  id,
  por,
  activa,
  children,
}: {
  id: string;
  por?: { nombre: string; foto: string | null } | null;
  activa?: boolean;
  children?: React.ReactNode;
}) {
  const t = trackById(id);
  return (
    <div className={`party-fila ${activa ? 'activa' : ''}`}>
      <Cover coverId={t?.coverId} seed={(t?.album ?? '') + (t?.artist ?? id)} className="thumb" />
      <div className="track-text">
        <div className="track-title">{t?.title ?? 'Canción no disponible'}</div>
        <div className="track-sub">{t?.artist ?? ''}</div>
      </div>
      {por && (
        <span className="party-por" title={`Agregada por ${por.nombre}`}>
          <AvatarDe nombre={por.nombre} foto={por.foto} size={24} />
        </span>
      )}
      {children}
    </div>
  );
}

function Avatares({ party, max = 6 }: { party: Pick<PartyEstado, 'miembros'>; max?: number }) {
  const m = party.miembros;
  return (
    <span className="party-avatares">
      {m.slice(0, max).map((x) => (
        <AvatarDe key={x.id} nombre={x.nombre} foto={x.foto} size={32} />
      ))}
      {m.length > max && <span className="party-mas">+{m.length - max}</span>}
    </span>
  );
}

// ---------------- La Party ----------------

function VistaParty({ party }: { party: PartyEstado }) {
  const anfitrion = soyAnfitrion(party);
  const [ajustes, setAjustes] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const yo = party.yo;
  const s = party.sonando;
  const puedeControlar = anfitrion || party.ajustes.controlar;
  const sonandoAqui = usePlayer((p) => p.playing);
  const sonando = anfitrion ? sonandoAqui : !!s?.sonando;

  useEffect(() => {
    if (!confirmar) return;
    const t = setTimeout(() => setConfirmar(false), 4000);
    return () => clearTimeout(t);
  }, [confirmar]);

  const terminar = () => {
    if (anfitrion && party.miembros.length > 1 && !confirmar) return setConfirmar(true);
    void salirDeParty(); // cierra también estas pantallas
  };

  return (
    <div className="party-hoja" onClick={(e) => e.stopPropagation()}>
      <div className="party-top">
        <button className="icon-btn" onClick={closeOverlay} aria-label="Cerrar">
          <CloseIcon />
        </button>
      </div>
      <div className="party-scroll">
        <h2 className="party-titulo">{anfitrion ? 'Tu Party' : `Party de ${party.anfitrion.nombre}`}</h2>
        <div className="party-quienes">
          <Avatares party={party} />
          <span className="party-modo">{party.miembros.find((m) => m.id === yo)?.modo === 'aparato' ? `En el aparato de ${party.anfitrion.nombre}` : 'Este aparato'}</span>
        </div>
        <div className="party-acciones">
          <button className="party-pill" onClick={() => abrirVista('invitar')}>
            Invitar
          </button>
          <button className={`party-pill ${confirmar ? 'peligro' : ''}`} onClick={terminar}>
            {anfitrion ? (confirmar ? '¿Terminar para todos?' : 'Terminar') : 'Salir'}
          </button>
          {anfitrion && (
            <button className={`icon-btn party-ajustes-btn ${ajustes ? 'on' : ''}`} onClick={() => setAjustes(!ajustes)} aria-label="Ajustes de la Party">
              <SettingsIcon />
            </button>
          )}
        </div>

        {anfitrion && ajustes && (
          <div className="party-ajustes">
            <button className="party-ajuste" role="switch" aria-checked={party.ajustes.controlar} onClick={() => void cambiarControlar(!party.ajustes.controlar)}>
              <span>
                <b>Los invitados controlan la música</b>
                <small>Pueden pausar, seguir y pasar de canción</small>
              </span>
              <span className={`switch ${party.ajustes.controlar ? 'on' : ''}`}>
                <span />
              </span>
            </button>
            {party.miembros
              .filter((m) => m.id !== yo)
              .map((m) => (
                <div key={m.id} className="party-miembro">
                  <AvatarDe nombre={m.nombre} foto={m.foto} size={32} />
                  <span className="party-miembro-nombre">
                    {m.nombre}
                    <small>{m.modo === 'aparato' ? 'Escucha en tu aparato' : 'Escucha en su aparato'}</small>
                  </span>
                  <button className="party-pill chico" onClick={() => void expulsar(m.id)}>
                    Sacar
                  </button>
                </div>
              ))}
          </div>
        )}

        <div className="party-seccion">
          <h3>Estás escuchando</h3>
          <button className="party-agregar" onClick={() => abrirVista('agregar')}>
            <PartyIcon size={18} /> Agregar canciones
          </button>
        </div>
        {s ? (
          <FilaCancion id={s.cancion} activa por={s.por != null ? nombreDe(s.por, party) : null} />
        ) : (
          <p className="party-vacio">Todavía no suena nada. Agrega canciones para empezar.</p>
        )}

        {party.agregadas.length > 0 && (
          <>
            <h3 className="party-h3">A continuación</h3>
            {party.agregadas.map((a, i) => (
              <FilaCancion key={a.uid} id={a.cancion} por={nombreDe(a.por, party)}>
                {anfitrion && i > 0 && (
                  <button className="icon-btn" onClick={() => void subirAgregada(a.uid)} aria-label="Subir">
                    <ArrowUpIcon size={20} />
                  </button>
                )}
                {(anfitrion || a.por === yo) && (
                  <button className="icon-btn" onClick={() => void quitarAgregada(a.uid)} aria-label="Quitar de la fila">
                    <CloseIcon size={20} />
                  </button>
                )}
              </FilaCancion>
            ))}
          </>
        )}

        {party.proximas.length > 0 && (
          <>
            <h3 className="party-h3">{party.contexto ? `Siguiente de: ${party.contexto}` : anfitrion ? 'Siguiente en tu cola' : `Siguiente en la cola de ${party.anfitrion.nombre}`}</h3>
            <div className="party-proximas">
              {party.proximas.slice(0, 10).map((id) => (
                <FilaCancion key={id} id={id} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className={`party-controles ${puedeControlar ? '' : 'apagados'}`}>
        <button className="icon-btn" onClick={() => void controlar('anterior')} aria-label="Anterior" aria-disabled={!puedeControlar}>
          <PrevIcon />
        </button>
        <button className="party-play" onClick={() => void controlar(sonando ? 'pausa' : 'play')} aria-label={sonando ? 'Pausar' : 'Reproducir'} aria-disabled={!puedeControlar}>
          {sonando ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="icon-btn" onClick={() => void controlar('siguiente')} aria-label="Siguiente" aria-disabled={!puedeControlar}>
          <NextIcon />
        </button>
      </div>
    </div>
  );
}

// ---------------- Invitar ----------------

function VistaInvitar({ party }: { party: PartyEstado }) {
  const [grande, setGrande] = useState(false);
  const amigos = useSocial((s) => s.amigos);
  const [invitados, setInvitados] = useState<number[]>([]);
  const url = linkParty(party.codigo);
  const enLaParty = new Set(party.miembros.map((m) => m.id));
  const conectados = amigos.filter((a) => a.conectado && !enLaParty.has(a.id));

  return (
    <div className="party-hoja chica" onClick={(e) => e.stopPropagation()}>
      <div className="party-asa" />
      <div className="party-invitar">
        <p className="party-invitar-txt">{soyAnfitrion(party) ? 'Invita a tus amigos a tu Party' : `Invita a tus amigos a la Party de ${party.anfitrion.nombre}`}</p>
        <button className="party-compartir" onClick={() => void compartirLink()}>
          <ShareIcon size={20} /> Compartir enlace
        </button>

        {conectados.length > 0 && (
          <div className="party-cerca">
            <b>Amigos conectados</b>
            {conectados.map((a) => (
              <div key={a.id} className="party-miembro">
                <AvatarDe nombre={a.nombre} foto={a.foto} size={32} />
                <span className="party-miembro-nombre">{a.nombre}</span>
                <button
                  className="party-pill chico"
                  disabled={invitados.includes(a.id)}
                  onClick={() =>
                    void invitarAmigo(a.id).then(
                      () => {
                        setInvitados((x) => [...x, a.id]);
                        showSnack(`Se invitó a ${a.nombre}`);
                      },
                      (e) => showSnack((e as Error).message),
                    )
                  }
                >
                  {invitados.includes(a.id) ? 'Invitado' : 'Invitar'}
                </button>
              </div>
            ))}
          </div>
        )}

        <button className="party-qr-fila" onClick={() => setGrande(true)}>
          <span>
            <b>Código QR de la Party</b>
            <small>Tócalo para agrandarlo.</small>
          </span>
          <Qr texto={url} size={88} />
        </button>
      </div>
      {grande && (
        <div className="party-qr-grande" onClick={() => setGrande(false)}>
          <div className="party-qr-caja" onClick={(e) => e.stopPropagation()}>
            <b>Escanear código QR</b>
            <Qr texto={url} size={240} />
          </div>
          <button className="party-qr-cerrar" onClick={() => setGrande(false)}>
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- Agregar canciones ----------------

function VistaAgregar({ party }: { party: PartyEstado }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<string[] | null>(null);
  const [recos, setRecos] = useState<{ cancion: string; para: number }[] | null>(null);
  const [agregadas, setAgregadas] = useState<string[]>([]);
  const ultima = party.sonando?.cancion;
  const pedido = useRef(0);

  // Recomendaciones del grupo: se rehacen al cambiar la canción que suena.
  useEffect(() => {
    let vivo = true;
    recomendaciones()
      .then((r) => vivo && setRecos(r.canciones.filter((x) => trackById(x.cancion))))
      .catch(() => vivo && setRecos([]));
    return () => {
      vivo = false;
    };
  }, [ultima]);

  useEffect(() => {
    const qq = q.trim();
    if (!qq) return setResultados(null);
    const n = ++pedido.current;
    const t = setTimeout(() => {
      api<{ tracks: string[] }>(`/api/buscar?q=${encodeURIComponent(qq)}`)
        .then((r) => n === pedido.current && setResultados(r.tracks.filter((id) => trackById(id)).slice(0, 30)))
        .catch(() => n === pedido.current && setResultados([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const enFila = new Set([...party.agregadas.map((a) => a.cancion), ...agregadas]);
  const boton = (id: string) => {
    const ya = enFila.has(id);
    return (
      <button
        className={`icon-btn party-mas-btn ${ya ? 'on' : ''}`}
        aria-label={ya ? 'Ya está en la fila' : 'Agregar a la Party'}
        disabled={ya}
        onClick={() => {
          const t = trackById(id) as Track;
          setAgregadas((x) => [...x, id]);
          void agregar([t]);
        }}
      >
        {ya ? <CheckIcon size={20} /> : <PlusIcon size={22} />}
      </button>
    );
  };

  return (
    <div className="party-hoja" onClick={(e) => e.stopPropagation()}>
      <div className="party-top">
        <button className="icon-btn" onClick={closeOverlay} aria-label="Volver">
          <BackIcon />
        </button>
        <b className="party-top-titulo">Agregar a la Party</b>
      </div>
      <div className="party-scroll">
        <label className="party-buscar">
          <SearchIcon size={20} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" enterKeyHint="search" />
          {q && (
            <button className="icon-btn" onClick={() => setQ('')} aria-label="Borrar">
              <CloseIcon size={18} />
            </button>
          )}
        </label>
        {resultados ? (
          resultados.length ? (
            resultados.map((id) => (
              <FilaCancion key={id} id={id}>
                {boton(id)}
              </FilaCancion>
            ))
          ) : (
            <p className="party-vacio">No hay resultados</p>
          )
        ) : (
          <div className="party-recos">
            <h3 className="party-recos-titulo">
              <PartyIcon size={18} /> Recomendaciones del grupo
            </h3>
            <p className="party-recos-sub">Según los gustos de todos y la música de esta Party</p>
            {!recos ? (
              <div className="feed-cargando">
                <div className="spinner" />
              </div>
            ) : recos.length ? (
              recos.map((r) => (
                <FilaCancion key={r.cancion} id={r.cancion} por={party.miembros.length > 1 ? nombreDe(r.para, party) : null}>
                  {boton(r.cancion)}
                </FilaCancion>
              ))
            ) : (
              <p className="party-vacio">Sin recomendaciones por ahora. Usa el buscador.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Unirse ----------------

function VistaUnirse() {
  const info = useParty((s) => s.unirse);
  const [modo, setModo] = useState<'telefono' | 'aparato' | null>(null);
  const [enviando, setEnviando] = useState(false);
  if (!info) return null;
  const todos = [info.anfitrion, ...info.miembros.filter((m) => m.id !== info.anfitrion.id)];
  const entrar = async () => {
    if (!modo) return;
    setEnviando(true);
    try {
      await unirse(info.codigo, modo);
      closeOverlay();
      setTimeout(() => abrirVista('party'), 60);
    } catch (e) {
      showSnack((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="sheet-backdrop party-fondo" onClick={closeOverlay}>
      <div className="party-hoja chica" onClick={(e) => e.stopPropagation()}>
        <div className="party-asa" />
        <div className="party-unirse">
          <span className="party-avatares grande">
            {todos.slice(0, 5).map((m) => (
              <AvatarDe key={m.id} nombre={m.nombre} foto={m.foto} size={48} />
            ))}
          </span>
          <h2>¿Quieres unirte a la Party de {info.anfitrion.nombre}?</h2>
          {info.llena ? (
            <p className="party-vacio">La Party está llena.</p>
          ) : (
            <>
              <button className={`party-opcion ${modo === 'telefono' ? 'on' : ''}`} onClick={() => setModo('telefono')}>
                <span>
                  <b>Continuar en este aparato</b>
                  <small>Elige esta opción si te unes a distancia</small>
                </span>
                <span className="party-radio" />
              </button>
              <button className={`party-opcion ${modo === 'aparato' ? 'on' : ''}`} onClick={() => setModo('aparato')}>
                <span>
                  <b>Escuchar desde el aparato de {info.anfitrion.nombre}</b>
                  <small>Elige esta opción si estás con {info.anfitrion.nombre}</small>
                </span>
                <span className="party-radio" />
              </button>
              <button className="party-compartir" disabled={!modo || enviando} onClick={() => void entrar()}>
                Unirme
              </button>
            </>
          )}
          <button className="party-ahora-no" onClick={closeOverlay}>
            Ahora no
          </button>
          <p className="party-nota">Quienes estén en esta Party verán tu nombre de usuario, tu foto de perfil y las canciones que agregues.</p>
        </div>
      </div>
    </div>
  );
}

// ---------------- Todo junto ----------------

export function PartyPantallas() {
  const party = useParty((s) => s.party);
  const vistas = useParty((s) => s.vistas);
  return (
    <>
      {party &&
        vistas.map((v) => (
          <div key={v} className={`sheet-backdrop party-fondo ${v === 'invitar' ? '' : 'alto'}`} onClick={closeOverlay}>
            {v === 'party' ? <VistaParty party={party} /> : v === 'invitar' ? <VistaInvitar party={party} /> : <VistaAgregar party={party} />}
          </div>
        ))}
      <VistaUnirse />
    </>
  );
}

/** Para el menú de una canción: ¿estoy en una Party? */
export const useEnParty = () => useParty((s) => !!s.party);
