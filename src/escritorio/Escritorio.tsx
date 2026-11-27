import { useParty } from '../server/party';
import { PanelParty } from '../screens/Party';
import { GuardarColaBoton } from '../components/GuardarCola';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Cover, fallbackBackground } from '../components/Cover';
import {
  CloseIcon,
  HomeIcon,
  LibraryIcon,
  NextIcon,
  PauseIcon,
  PeopleIcon,
  PinIcon,
  PlayIcon,
  PlaylistAddIcon,
  PlusIcon,
  PrevIcon,
  QueueIcon,
  LetraIcon,
  RepeatIcon,
  SearchIcon,
  ShuffleIcon,
  ThumbDownIcon,
  ThumbUpIcon,
  PartyIcon,
} from '../components/Icons';
import { PlaylistCover } from '../components/PlaylistCover';
import { openCreatePlaylist, openImportarSpotify, openPlaylistOptions, openSaveToPlaylist } from '../components/PlaylistSheets';
import { ProfileButton } from '../components/ProfileMenu';
import { openTrackMenu } from '../components/TrackMenu';
import { formatDuration } from '../components/TrackRow';
import { fijadasPrimero, LIKED_ID, usePlaylists } from '../library/playlists';
import { useLibrary } from '../library/store';
import { useCover } from '../library/useCover';
import { useNav } from '../nav';
import { useVolumen } from '../player/equalizer';
import { currentTrack, radioAjustes, trackById, usePlayer } from '../player/player';
import { irAlArtista, openPlayer, QueueList } from '../player/PlayerUI';
import { useDominantColor } from '../player/useDominantColor';
import { useAutomix } from '../player/automixStore';
import { useSocial } from '../server/social';
import { Detail } from '../screens/Detail';
import { Library } from '../screens/Library';
import { Search } from '../screens/Search';
import type { Track } from '../types';
import { InicioEscritorio } from './InicioEscritorio';
import { PlaylistEscritorio } from './PlaylistEscritorio';
import { empezarArrastre } from './seleccion';
import { VistaReproductor } from './VistaReproductor';
import { VistaLetra } from '../components/Letra';
import { useLetraUi } from '../player/letras';
import { ActualizacionPc } from './ActualizacionPc';
import { useDiscordPc } from './DiscordPc';
import { useBandejaPc } from './BandejaPc';
import { useNotchPc } from './NotchPc';
import { useSearchHistory } from '../library/searchHistory';
import { closeAllOverlaysThen, closeOverlay } from '../nav';
import { arrastrarVentana, BotonesVentana } from './VentanaPc';
import { etiquetaVersion } from '../estadisticas';
import { AyudaAtajos, useAtajos } from './atajos';

/**
 * Ir a otra pantalla desde la barra de arriba o la de la izquierda. Si la vista de reproducción (o un menú) está
 * abierta encima, primero se cierra; así el buscador, una playlist o la biblioteca se ven de inmediato.
 */
const ir = (fn: () => void) => () => {
  useLetraUi.getState().cerrar(); // también si ya estabas en esa pantalla (tocar Inicio estando en Inicio)
  closeAllOverlaysThen(fn);
};

/** Abre el buscador con el cursor ya puesto en el campo, para escribir de inmediato. */
function buscar() {
  document.querySelector<HTMLInputElement>('.esc-buscador input')?.focus();
}

/** Carátula o título de abajo: abre la vista de reproducción, o la cierra si ya está abierta. */
const alternarVista = () => (usePlayer.getState().expanded ? closeOverlay() : openPlayer());
import './escritorio.css';
import './temas'; // tema elegido en Configuración → Tema (se aplica antes de dibujar)

type Panel = 'ahora' | 'fila' | null;

/**
 * Versión de PC: barra de playlists a la izquierda, buscador arriba, pantalla al centro, "sonando ahora" o la fila
 * a la derecha y el reproductor abajo. Misma música, mismo algoritmo y misma estética que la app del teléfono.
 */
export function Escritorio() {
  useDiscordPc(); // la canción que suena, en Discord (solo app de PC)
  useBandejaPc(); // minimizar a la bandeja (si está encendido)
  useNotchPc(); // notch arriba de la pantalla (si está encendido)
  const loaded = useLibrary((s) => s.loaded);
  const { tab, stack } = useNav();
  const page = stack[stack.length - 1];
  const hayCancion = usePlayer((s) => !!currentTrack(s));
  const expandido = usePlayer((s) => s.expanded);
  const letraAbierta = useLetraUi((s) => s.abierta);
  const [panel, setPanel] = useState<Panel>(() => {
    try {
      const v = localStorage.getItem('escPanel');
      return v === 'fila' || v === 'ahora' ? v : v === 'no' ? null : 'ahora';
    } catch {
      return 'ahora';
    }
  });
  const partyEnPanel = useParty((s) => s.panelPc && !!s.party);
  const cambiarPanel = (p: Panel) => {
    useParty.setState({ panelPc: false }); // elegir otro panel cierra el de la Party
    setPanel(p);
    try {
      localStorage.setItem('escPanel', p ?? 'no');
    } catch {
      /* nada */
    }
  };
  const centro = useRef<HTMLElement>(null);
  useEffect(() => {
    centro.current?.scrollTo(0, 0); // (en Chrome nuevo devuelve una promesa: no se retorna)
    // Ir a otra pantalla (inicio, una playlist, un artista…) cierra la letra: si no, quedaba encima tapándola.
    useLetraUi.getState().cerrar();
  }, [tab, page]);
  /** Alt + Shift + Q / R: muestra u oculta la fila o lo que suena (si ya estaba, se cierra). */
  const alternarPanel = useCallback((p: 'ahora' | 'fila') => {
    const enParty = useParty.getState().panelPc;
    // En una Party, la fila ES la Party: el atajo de la fila abre o cierra su panel.
    if (p === 'fila' && useParty.getState().party) return useParty.setState({ panelPc: !enParty });
    useParty.setState({ panelPc: false });
    setPanel((antes) => {
      const nuevo = antes === p && !enParty ? null : p;
      try {
        localStorage.setItem('escPanel', nuevo ?? 'no');
      } catch {
        /* nada */
      }
      return nuevo;
    });
  }, []);
  useAtajos(buscar, alternarPanel);
  // En PC la fila se ve al lado: la radio mantiene unas 10 canciones por delante (en el teléfono, 3).
  useEffect(() => {
    const antes = { ...radioAjustes };
    Object.assign(radioAjustes, { margen: 9, pedir: 10 });
    return () => void Object.assign(radioAjustes, antes);
  }, []);

  const contenido = !loaded ? null : page ? (
    page.type === 'playlist' ? (
      <PlaylistEscritorio id={page.id} />
    ) : (
      <Detail page={page} />
    )
  ) : tab === 'home' ? (
    <InicioEscritorio />
  ) : tab === 'search' ? (
    <Search />
  ) : (
    <Library />
  );

  return (
    <div className={`esc ${(panel && hayCancion) || partyEnPanel ? 'con-panel' : ''}`}>
      <Arriba />
      <Lateral />
      <main ref={centro} className="esc-centro">
        <div key={page ? `${stack.length}:${JSON.stringify(page)}` : tab} className="esc-pantalla">
          {contenido}
        </div>
      </main>
      {partyEnPanel ? (
        <aside className="esc-derecha">
          <PanelParty />
        </aside>
      ) : (
        panel &&
        hayCancion && <aside className="esc-derecha">{panel === 'fila' ? <PanelFila cerrar={() => cambiarPanel(null)} /> : <PanelAhora />}</aside>
      )}
      {expandido && hayCancion && <VistaReproductor />}
      {letraAbierta && !expandido && hayCancion && <VistaLetra />}
      <BarraReproductor panel={panel} cambiarPanel={cambiarPanel} />
      <ActualizacionPc />
      <AyudaAtajos />
    </div>
  );
}

// ---------------------------------------------------------------- Arriba: inicio, buscador y perfil

function Arriba() {
  const { tab, stack, setTab, adelante } = useNav();
  const enInicio = tab === 'home' && !stack.length;
  return (
    <header className="esc-arriba" onMouseDown={arrastrarVentana}>
      <div className="esc-flechas">
        <button
          className="esc-flecha"
          onClick={() => closeAllOverlaysThen(() => history.back())}
          disabled={!stack.length}
          aria-label="Atrás"
          title="Atrás"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <button
          className="esc-flecha"
          onClick={ir(() => useNav.getState().forward())}
          disabled={!adelante.length}
          aria-label="Adelante"
          title="Adelante"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className="esc-arriba-centro">
        <button className={`esc-redondo ${enInicio ? 'on' : ''}`} onClick={ir(() => setTab('home'))} aria-label="Inicio" title="Inicio">
          <HomeIcon filled={enInicio} />
        </button>
        <BuscadorDesplegable />
      </div>
      <div className="esc-arriba-der">
        {/* La versión de la app ("stable-1.0.0"): en la app de PC y en la web de computador (no en el teléfono). */}
        {etiquetaVersion() && (
          <span className="esc-version" title="Versión de la app">
            {etiquetaVersion()}
          </span>
        )}
        <ProfileButton />
        <BotonesVentana />
      </div>
    </header>
  );
}

/**
 * Buscador de arriba: se escribe en la barra y los resultados aparecen en un menú que se despliega debajo
 * (búsquedas recientes, sugerencias, canciones, artistas, álbumes: lo mismo y en el mismo orden que el buscador
 * de siempre). Se cierra con Esc, al hacer clic afuera o al abrir un artista, álbum o playlist.
 */
function BuscadorDesplegable() {
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const addQuery = useSearchHistory((s) => s.addQuery);
  const { tab, stack } = useNav();

  // Al ir a otra pantalla (tocaste un artista, un álbum…) el menú se cierra.
  const pantalla = `${tab}:${stack.length}:${JSON.stringify(stack[stack.length - 1] ?? null)}`;
  const ultima = useRef(pantalla);
  useEffect(() => {
    if (ultima.current !== pantalla) {
      ultima.current = pantalla;
      setAbierto(false);
      input.current?.blur();
    }
  }, [pantalla]);

  // Clic afuera: se cierra.
  useEffect(() => {
    if (!abierto) return;
    const f = (e: PointerEvent) => {
      const t = e.target;
      // Los menús que se abren desde un resultado (⋮, playlists) están fuera de la caja: no cuentan como "afuera".
      if (t instanceof Element && (caja.current?.contains(t) || t.closest('.sheet-backdrop, .esc-perfil-velo'))) return;
      setAbierto(false);
    };
    document.addEventListener('pointerdown', f);
    return () => document.removeEventListener('pointerdown', f);
  }, [abierto]);

  return (
    <div ref={caja} className={`esc-buscador-caja ${abierto ? 'abierto' : ''}`}>
      <div className={`esc-buscador ${abierto ? 'on' : ''}`} onClick={() => input.current?.focus()}>
        <SearchIcon size={22} />
        <input
          ref={input}
          value={q}
          placeholder="¿Qué quieres escuchar?"
          aria-label="Buscar canciones, álbumes o artistas"
          enterKeyHint="search"
          onFocus={() => setAbierto(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setAbierto(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setAbierto(false);
              input.current?.blur();
            } else if (e.key === 'Enter' && q.trim()) {
              // Enter: la página completa de resultados (como Spotify), y el menú se cierra.
              addQuery(q);
              setAbierto(false);
              input.current?.blur();
              const actual = stack[stack.length - 1];
              if (actual?.type === 'resultados')
                useNav.setState({
                  stack: [...stack.slice(0, -1), { type: 'resultados', q: q.trim() }],
                });
              else useNav.getState().push({ type: 'resultados', q: q.trim() });
            }
          }}
        />
        {q ? (
          <button
            className="icon-btn esc-buscador-borrar"
            aria-label="Borrar búsqueda"
            onClick={(e) => {
              e.stopPropagation();
              setQ('');
              input.current?.focus();
            }}
          >
            <CloseIcon size={18} />
          </button>
        ) : (
          <kbd>Ctrl K</kbd>
        )}
      </div>
      {abierto && (
        <div className="esc-desplegable" role="dialog" aria-label="Resultados de la búsqueda">
          <Search externo={{ q, setQ }} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Izquierda: biblioteca y playlists (solo portadas)

function Lateral() {
  const { tab, stack, setTab, push } = useNav();
  const lista = usePlaylists((s) => s.list);
  const tracks = useLibrary((s) => s.tracks);
  const ratings = usePlayer((s) => s.ratings);
  const [menu, setMenu] = useState(false);
  const page = stack[stack.length - 1];
  const abierta = page?.type === 'playlist' ? page.id : null;
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const likedTracks = tracks.filter((t) => ratings[t.id] === 1);
  // Las fijadas arriba (la primera que fijaste, primero); después las que escuchaste o cambiaste hace menos.
  const playlists = fijadasPrimero(
    [...lista].sort((a, b) => Math.max(b.playedAt ?? 0, b.updatedAt) - Math.max(a.playedAt ?? 0, a.updatedAt)),
    (p) => p,
  );

  return (
    <nav className="esc-lateral" aria-label="Tu biblioteca">
      <button
        className={`esc-lat-btn ${tab === 'library' && !stack.length ? 'on' : ''}`}
        onClick={ir(() => setTab('library'))}
        title="Tu biblioteca"
        aria-label="Tu biblioteca"
      >
        <LibraryIcon filled={tab === 'library' && !stack.length} />
      </button>
      <div className="esc-mas-wrap">
        <button
          className={`esc-lat-btn esc-mas ${menu ? 'abierto' : ''}`}
          onClick={() => setMenu(!menu)}
          title="Crear"
          aria-label="Crear"
          aria-expanded={menu}
        >
          {menu ? <CloseIcon size={22} /> : <PlusIcon />}
        </button>
        {menu && (
          <>
            <div className="esc-velo" onClick={() => setMenu(false)} />
            <div className="esc-menu" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  openCreatePlaylist([], true);
                }}
              >
                <span className="esc-menu-ico">
                  <PlusIcon />
                </span>
                <span>
                  <b>Playlist</b>
                  <small>Crea una playlist con tus canciones</small>
                </span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  openImportarSpotify();
                }}
              >
                <span className="esc-menu-ico">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M5 20h14v-2H5v2zm7-18-5.5 5.5 1.41 1.41L11 5.83V16h2V5.83l3.09 3.08 1.41-1.41L12 2z" transform="rotate(180 12 11)" />
                  </svg>
                </span>
                <span>
                  <b>Importar de Spotify</b>
                  <small>Pega el enlace de una playlist pública</small>
                </span>
              </button>
              <button role="menuitem" disabled>
                <span className="esc-menu-ico">
                  <PeopleIcon />
                </span>
                <span>
                  <b>Mezcla con un amigo</b>
                  <small>Pronto: junta tus gustos con los de un amigo</small>
                </span>
              </button>
            </div>
          </>
        )}
      </div>
      <div className="esc-lat-sep" />
      <div className="esc-lat-playlists">
        <button
          className={`esc-lat-pl ${abierta === LIKED_ID ? 'on' : ''}`}
          data-soltar={LIKED_ID}
          onClick={ir(() => push({ type: 'playlist', id: LIKED_ID }))}
          title="Música que te gustó"
          aria-label="Música que te gustó"
        >
          <PlaylistCover id={LIKED_ID} tracks={likedTracks} />
        </button>
        {playlists.map((p) => (
          <button
            key={p.id}
            className={`esc-lat-pl ${abierta === p.id ? 'on' : ''}`}
            data-soltar={p.id}
            onClick={ir(() => push({ type: 'playlist', id: p.id }))}
            onContextMenu={(e) => {
              e.preventDefault();
              openPlaylistOptions(p.id);
            }}
            title={p.pinnedAt ? `${p.name} (fijada)` : p.name}
            aria-label={p.pinnedAt ? `${p.name}, fijada` : p.name}
          >
            <PlaylistCover id={p.id} tracks={p.trackIds.map((i) => byId.get(i)).filter((t): t is Track => !!t)} />
            {p.pinnedAt && (
              <span className="esc-lat-fijada" aria-hidden="true">
                <PinIcon size={12} />
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- Derecha: sonando ahora / fila de reproducción

function PanelAhora() {
  const track = usePlayer(currentTrack)!;
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const rating = usePlayer((s) => s.ratings[track.id]);
  const rate = usePlayer((s) => s.rate);
  const url = useCover(track.coverId);
  const color = useDominantColor(url, fallbackBackground(track.album + track.artist));
  const siguiente = trackById(queue[index + 1]);
  return (
    <div className="esc-ahora" style={{ '--tinte': color } as React.CSSProperties}>
      <div className="esc-panel-cab">
        <span className="esc-panel-titulo">{track.album}</span>
        <button className="icon-btn" onClick={() => openTrackMenu(track, { fromPlayer: true })} aria-label="Más opciones">
          <MoreDots />
        </button>
      </div>
      <button className="esc-ahora-portada" onClick={alternarVista} aria-label="Vista de reproducción">
        <Cover key={track.id} coverId={track.coverId} seed={track.album + track.artist} className="swap" />
      </button>
      <div className="esc-ahora-fila">
        <div className="esc-ahora-texto swap" key={track.id}>
          <div className="esc-ahora-titulo">{track.title}</div>
          <button className="esc-link" onClick={() => irAlArtista(track.artist)}>
            {track.artist}
          </button>
        </div>
        <button className={`icon-btn round-btn ${rating === -1 ? 'on' : ''}`} onClick={() => rate(track.id, -1)} aria-label="No me gusta">
          <ThumbDownIcon filled={rating === -1} />
        </button>
        <button className={`icon-btn round-btn ${rating === 1 ? 'on' : ''}`} onClick={() => rate(track.id, 1)} aria-label="Me gusta">
          <ThumbUpIcon filled={rating === 1} />
        </button>
      </div>
      {siguiente && (
        <div className="esc-ahora-sig">
          <div className="esc-ahora-sig-cab">A continuación</div>
          <button className="esc-ahora-sig-fila" onClick={() => usePlayer.getState().next()}>
            <Cover coverId={siguiente.coverId} seed={siguiente.album + siguiente.artist} className="thumb" />
            <span className="track-text">
              <span className="track-title">{siguiente.title}</span>
              <span className="track-sub">{siguiente.artist}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function PanelFila({ cerrar }: { cerrar: () => void }) {
  const colaNombre = usePlayer((s) => s.colaNombre);
  return (
    <div className="esc-fila">
      <div className="esc-panel-cab">
        <span className="esc-panel-titulo">Fila de reproducción</span>
        <button className="icon-btn" onClick={cerrar} aria-label="Cerrar">
          <CloseIcon />
        </button>
      </div>
      {colaNombre && (
        <div className="esc-fila-nombre">
          <span>{colaNombre}</span>
          <GuardarColaBoton />
        </div>
      )}
      <QueueList />
    </div>
  );
}

// ---------------------------------------------------------------- Abajo: el reproductor

function BarraReproductor({ panel, cambiarPanel }: { panel: Panel; cambiarPanel: (p: Panel) => void }) {
  const track = usePlayer(currentTrack);
  const playing = usePlayer((s) => s.playing);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const rating = usePlayer((s) => (track ? s.ratings[track.id] : undefined));
  const { toggle, next, prev, setRepeat, toggleShuffle, rate } = usePlayer.getState();
  const siguiendo = useSocial((s) => s.siguiendo !== null);
  const enParty = useParty((s) => !!s.party);
  const partyPanel = useParty((s) => s.panelPc && !!s.party);
  const sinModos = enParty || siguiendo;
  const activo = (p: Panel) => panel === p && !partyPanel;
  const letraAbierta = useLetraUi((s) => s.abierta);

  return (
    <footer className="esc-abajo">
      <div className="esc-abajo-izq">
        {track && (
          <>
            <button
              className="esc-abajo-portada"
              onClick={alternarVista}
              onPointerDown={(e) => empezarArrastre(e, () => [track])}
              title="Vista de reproducción (arrástrala a una playlist para guardarla)"
              aria-label="Vista de reproducción"
            >
              <Cover key={track.id} coverId={track.coverId} seed={track.album + track.artist} className="swap" />
            </button>
            <div className="esc-abajo-texto swap" key={track.id} onPointerDown={(e) => empezarArrastre(e, () => [track])}>
              <button className="esc-abajo-titulo" onClick={alternarVista}>
                {track.title}
              </button>
              <button className="esc-link" onClick={() => irAlArtista(track.artist)}>
                {track.artist}
              </button>
            </div>
            <button
              className={`icon-btn esc-chico ${rating === 1 ? 'on' : 'dim'}`}
              onClick={() => rate(track.id, 1)}
              aria-label="Me gusta"
              title="Me gusta"
            >
              <ThumbUpIcon filled={rating === 1} size={20} />
            </button>
            <button
              className="icon-btn esc-chico dim"
              onClick={() => openSaveToPlaylist(track)}
              aria-label="Guardar en playlist"
              title="Guardar en playlist"
            >
              <PlaylistAddIcon size={20} />
            </button>
          </>
        )}
      </div>

      <div className="esc-abajo-centro">
        <div className="esc-controles">
          <button
            className={`icon-btn ${shuffle ? 'on activo' : 'dim'}`}
            onClick={toggleShuffle}
            disabled={sinModos || !track}
            title="Aleatorio"
            aria-label="Aleatorio"
          >
            <ShuffleIcon size={20} />
          </button>
          <button className="icon-btn" onClick={prev} disabled={!track} aria-disabled={siguiendo} title="Anterior" aria-label="Anterior">
            <PrevIcon size={28} />
          </button>
          <button
            className="esc-play"
            onClick={toggle}
            disabled={!track}
            aria-disabled={siguiendo}
            title={playing ? 'Pausar (espacio)' : 'Reproducir (espacio)'}
            aria-label={playing ? 'Pausar' : 'Reproducir'}
          >
            {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
          </button>
          <button className="icon-btn" onClick={next} disabled={!track} aria-disabled={siguiendo} title="Siguiente" aria-label="Siguiente">
            <NextIcon size={28} />
          </button>
          <button
            className={`icon-btn ${repeat !== 'off' ? 'on activo' : 'dim'}`}
            onClick={setRepeat}
            disabled={sinModos || !track}
            title={repeat === 'off' ? 'Repetir' : repeat === 'all' ? 'Repetir todo' : 'Repetir una'}
            aria-label={repeat === 'off' ? 'Repetir: no' : repeat === 'all' ? 'Repetir: todo' : 'Repetir: una'}
          >
            <RepeatIcon one={repeat === 'one'} size={20} />
          </button>
        </div>
        <BarraTiempo />
      </div>

      <div className="esc-abajo-der">
        <button
          className={`icon-btn esc-chico ${letraAbierta ? 'on activo' : 'dim'}`}
          onClick={() => {
            usePlayer.getState().setExpanded(false);
            useLetraUi.getState().alternar();
          }}
          disabled={!track}
          title="Letra (Alt + Shift + L)"
          aria-label="Letra"
        >
          <LetraIcon size={20} />
        </button>
        <button
          className={`icon-btn esc-chico ${activo('ahora') ? 'on activo' : 'dim'}`}
          onClick={() => cambiarPanel(activo('ahora') ? null : 'ahora')}
          disabled={!track}
          title="Sonando ahora"
          aria-label="Sonando ahora"
        >
          <PanelIcon />
        </button>
        {enParty ? (
          <button
            className={`icon-btn esc-chico ${partyPanel ? 'on activo' : 'dim'}`}
            onClick={() => useParty.setState({ panelPc: !partyPanel })}
            title="Party (Alt + Shift + Q)"
            aria-label="Party"
          >
            <PartyIcon size={20} />
          </button>
        ) : (
          <button
            className={`icon-btn esc-chico ${activo('fila') ? 'on activo' : 'dim'}`}
            onClick={() => cambiarPanel(activo('fila') ? null : 'fila')}
            disabled={!track}
            title="Fila de reproducción"
            aria-label="Fila de reproducción"
          >
            <QueueIcon />
          </button>
        )}
        <Volumen />
      </div>
    </footer>
  );
}

/** Barra de tiempo: se puede arrastrar (salvo con Automix o escuchando con un amigo). */
function BarraTiempo() {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const siguiendo = useSocial((s) => s.siguiendo !== null);
  const locked = useAutomix((s) => s.on) || siguiendo;
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? position;
  const pct = duration ? (value / duration) * 100 : 0;
  return (
    <div className={`esc-tiempo ${locked ? 'locked' : ''}`}>
      <span>{formatDuration(value)}</span>
      <input
        type="range"
        className="esc-rango"
        disabled={locked || !duration}
        min={0}
        max={duration || 1}
        step={0.1}
        value={value}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        aria-label="Posición"
      />
      <span>{formatDuration(duration)}</span>
    </div>
  );
}

function Volumen() {
  const v = useVolumen((s) => s.v);
  const set = useVolumen((s) => s.set);
  const antes = useRef(1);
  const pct = Math.round(v * 100);
  return (
    <div className="esc-volumen">
      <button
        className="icon-btn esc-chico dim"
        onClick={() => {
          if (v > 0) {
            antes.current = v;
            set(0);
          } else set(antes.current || 1);
        }}
        title={v > 0 ? 'Silenciar' : 'Activar sonido'}
        aria-label={v > 0 ? 'Silenciar' : 'Activar sonido'}
      >
        <ParlanteIcon nivel={v} />
      </button>
      <input
        type="range"
        className="esc-rango"
        min={0}
        max={100}
        step={1}
        value={pct}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => set(Number(e.target.value) / 100)}
        aria-label="Volumen"
        aria-valuetext={`${pct}%`}
        title={`Volumen ${pct}%`}
      />
    </div>
  );
}

// ---------------------------------------------------------------- Teclado

// ---------------------------------------------------------------- Íconos propios de la versión de PC

function MoreDots() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M14 4v16" />
      <rect x="16" y="8" width="3" height="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ParlanteIcon({ nivel }: { nivel: number }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9z" />
      {nivel === 0 ? (
        <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : nivel < 0.5 ? (
        <path d="M14 8.5a4.5 4.5 0 0 1 0 7z" />
      ) : (
        <path d="M14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6zM14 8.5a4.5 4.5 0 0 1 0 7z" />
      )}
    </svg>
  );
}
