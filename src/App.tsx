import { useEffect, useRef } from 'react';
import { HomeIcon, LibraryIcon, SearchIcon } from './components/Icons';
import { ProfileButton, ProfileMenu } from './components/ProfileMenu';
import { JuntosBanner } from './screens/Social';
import { PartyBanner, PartyPantallas } from './screens/Party';
import { ReportarCancion } from './components/Reportar';
import { iniciarPartyApp } from './server/party';
import { ConexionBanner } from './components/ConexionBanner';
import { EqualizerScreen, useEqScreen } from './components/Equalizer';
import { RackScreen, useRackScreen } from './components/Rack';
import { ImportToast } from './components/ImportControls';
import { sincronizarBiblioteca } from './library/store';
import { sincronizarPlaylists } from './server/playlistsCuenta';
import { iniciarSocial } from './server/social';
import { sincronizarCuenta } from './server/sincronizar';
import { startReco } from './reco/store';
import { iniciarNativo } from './nativo';
import { iniciarGestos } from './gestos';
import { iniciarActualizaciones } from './actualizar';
import { iniciarEstadisticas } from './estadisticas';
import { ActualizacionAviso } from './components/ActualizacionAviso';
import { useLibrary } from './library/store';
import { CreditsScreen } from './components/Credits';
import { TrackMenu } from './components/TrackMenu';
import { PlaylistSheets, Snackbar } from './components/PlaylistSheets';
import { ModeConfirm } from './components/ModeConfirm';
import { ConfirmarQuitarDescarga } from './components/Descargas';
import { CuentaScreen, pedirCuentaAlAbrir } from './components/CuentaScreen';
import { usePlaylists } from './library/playlists';
import { closeAllOverlaysThen, useNav, type Tab } from './nav';
import { usePlayer } from './player/player';
import { FullPlayer, MiniPlayer } from './player/PlayerUI';
import { Detail } from './screens/Detail';
import { Home } from './screens/Home';
import { Library } from './screens/Library';
import { Search } from './screens/Search';
import { Escritorio } from './escritorio/Escritorio';
import { useEscritorio } from './escritorio/activo';

const TABS: { id: Tab; label: string; icon: (active: boolean) => React.ReactNode }[] = [
  { id: 'home', label: 'Principal', icon: (a) => <HomeIcon filled={a} /> },
  { id: 'search', label: 'Buscar', icon: () => <SearchIcon /> },
  { id: 'library', label: 'Biblioteca', icon: (a) => <LibraryIcon filled={a} /> },
];

export default function App() {
  const load = useLibrary((s) => s.load);
  const loaded = useLibrary((s) => s.loaded);
  const { tab, stack, setTab } = useNav();
  const scrollRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const lastY = useRef(0);

  /**
   * Título como en YT Music: al bajar se esconde; al subir un poco vuelve a aparecer (flotando sobre la
   * página, con fondo), sin tener que llegar hasta arriba. Se maneja con clases para no redibujar la app.
   */
  const onScroll = () => {
    const el = scrollRef.current;
    const h = headerRef.current;
    if (!el || !h) return;
    const y = el.scrollTop;
    const dy = y - lastY.current;
    if (y <= h.offsetHeight) h.classList.remove('hidden', 'floating');
    else if (dy > 6) h.classList.add('hidden', 'floating');
    else if (dy < -6) h.classList.remove('hidden');
    else return; // movimientos muy pequeños: no cambia nada (evita parpadeos)
    lastY.current = y;
  };
  const page = stack[stack.length - 1];
  // Ecualizador o rack abiertos: el mini reproductor y la barra de abajo quedan visibles encima.
  const eqScreenOpen = useEqScreen((s) => s.open);
  const rackScreenOpen = useRackScreen((s) => s.open);
  const eqOpen = eqScreenOpen || rackScreenOpen;
  const escritorio = useEscritorio();

  useEffect(() => {
    // Primero la biblioteca, después la sesión del reproductor (necesita saber qué canciones existen).
    usePlaylists.getState().load();
    load().then(async () => {
      // Tus datos están en tu cuenta: primero se traen (ajustes, búsquedas, lo que estaba sonando) y se sube
      // una sola vez lo que este aparato tenía guardado de antes.
      await sincronizarCuenta();
      void usePlayer.getState().restore();
      startReco(); // el feed, calculado por el servidor
      iniciarNativo(); // solo en la app de Android: notificación, pantalla de bloqueo, música de fondo
      iniciarGestos(); // solo en la app de Android: deslizar desde el borde para volver
      iniciarActualizaciones(); // solo en la app de Android: se actualiza sola desde el servidor
      iniciarEstadisticas(); // tiempo de uso (cada minuto), para el panel de estadísticas
      void sincronizarBiblioteca(true); // canciones nuevas del servidor de música
      void sincronizarPlaylists(true); // tus playlists de la cuenta (y las de este aparato, a la cuenta)
      iniciarSocial(); // amigos y lo que escuchan, en vivo
      iniciarPartyApp(); // Party: escuchar en grupo (y abrir el enlace de una invitación)
      pedirCuentaAlAbrir();
    });
  }, [load]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
    lastY.current = 0;
    headerRef.current?.classList.remove('hidden', 'floating');
  }, [tab, page]);

  // Versión de PC (en prueba, solo en este PC): otra distribución, las mismas capas encima.
  if (escritorio)
    return (
      <div className={`app esc-raiz ${eqOpen ? 'eq-open' : ''}`}>
        <Escritorio />
        <ImportToast />
        <ConexionBanner />
        <JuntosBanner />
        <PartyBanner />
        {/* (Sin el reproductor completo del teléfono: en PC está la vista de reproducción dentro de Escritorio) */}
        <CreditsScreen />
        <EqualizerScreen />
        <RackScreen />
        <TrackMenu />
        <PlaylistSheets />
        <ModeConfirm />
        <ConfirmarQuitarDescarga />
        <PartyPantallas />
      <ReportarCancion />
        <CuentaScreen />
        <ProfileMenu />
        <Snackbar />
      </div>
    );

  return (
    <div className={`app ${eqOpen ? 'eq-open' : ''}`}>
      {/* Franja de la barra de estado del iPhone: fija, para que nada pase por debajo de la hora */}
      {!page && <div className="safe-top" />}

      <main ref={scrollRef} className="content" onScroll={onScroll}>
        {/* El título se esconde al bajar y vuelve al subir un poco */}
        {!page && (
          <header ref={headerRef} className="topbar">
            <div className="brand">
              Edowave<span className="marca-beta">Beta</span>
            </div>
            <ProfileButton />
          </header>
        )}
        <div key={page ? `${stack.length}:${JSON.stringify(page)}` : tab} className={page ? 'screen push' : 'screen'}>
        {!loaded ? null : page ? (
          <Detail page={page} />
        ) : tab === 'home' ? (
          <Home />
        ) : tab === 'search' ? (
          <Search />
        ) : (
          <Library />
        )}
        </div>
      </main>

      <ImportToast />
      <ConexionBanner />
      <ActualizacionAviso />
      <JuntosBanner />
      <PartyBanner />
      <MiniPlayer />

      <nav className="bottom-nav">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} className={active ? 'active' : ''} onClick={() => (eqOpen ? closeAllOverlaysThen(() => setTab(t.id)) : setTab(t.id))}>
              {t.icon(active)}
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      <FullPlayer />
      <CreditsScreen />
      <EqualizerScreen />
      <RackScreen />
      <TrackMenu />
      <PlaylistSheets />
      <ModeConfirm />
      <ConfirmarQuitarDescarga />
      <PartyPantallas />
      <ReportarCancion />
      <CuentaScreen />
      <ProfileMenu />
      <Snackbar />
    </div>
  );
}
