import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useLibrary } from '../library/store';
import { usePlayer } from '../player/player';
import { quitarFotoPlaylist, subirFotoPlaylist, useCuenta } from '../server/cuenta';
import { usePlaylists } from '../library/playlists';
import { completarConPegadas, importarDeSpotify, type Importada } from '../server/playlistsCuenta';
import { closeAllOverlaysThen, closeOverlay, openOverlay, useNav } from '../nav';
import type { Track } from '../types';
import { EditIcon, PlayIcon, PlusIcon, ShuffleIcon, TrashIcon, GlobeIcon, LockIcon, CloseIcon, PinIcon } from './Icons';
import { PlaylistCover } from './PlaylistCover';
import { useExit } from './useExit';
import { menuContextual, Submenu, useAnclaMenu } from './menuContextual';

/**
 * Ventanas inferiores de playlists:
 *  - create: nombre de una playlist nueva (con canciones opcionales)
 *  - pick:   "Guardar en playlist" para una canción
 *  - rename: cambiar el nombre
 *  - spotify: importar una playlist de Spotify con su enlace
 *  - fusionar: elegir la playlist que recibe todas las canciones de esta
 * En PC, "pick", "options" y "fusionar" son menús contextuales junto al clic (ver menuContextual.tsx).
 */
type Sheet =
  | { mode: 'create'; trackIds: string[]; openAfter: boolean }
  | { mode: 'pick'; tracks: Track[] }
  | { mode: 'fusionar'; id: string }
  | { mode: 'rename'; id: string; name: string }
  | { mode: 'options'; id: string }
  | { mode: 'spotify'; completar?: { id: string; nombre: string } };

const useSheet = create<{ sheet: Sheet | null }>(() => ({ sheet: null }));
const open = (sheet: Sheet) => {
  useSheet.setState({ sheet });
  openOverlay(() => useSheet.setState({ sheet: null }));
};

export const openCreatePlaylist = (trackIds: string[] = [], openAfter = true) => open({ mode: 'create', trackIds, openAfter });
export const openSaveToPlaylist = (t: Track | Track[]) => open({ mode: 'pick', tracks: Array.isArray(t) ? t : [t] });
export const openRenamePlaylist = (id: string, name: string) => open({ mode: 'rename', id, name });
export const openPlaylistOptions = (id: string) => open({ mode: 'options', id });
export const openImportarSpotify = () => open({ mode: 'spotify' });
/** Completar una playlist importada pegando las canciones copiadas en Spotify (para las que pasan de 100). */
export const openCompletarSpotify = (id: string, nombre: string) => open({ mode: 'spotify', completar: { id, nombre } });

// ---------------- Avisos cortos ("Guardada en …") ----------------

const useSnack = create<{ text: string | null; n: number }>(() => ({ text: null, n: 0 }));
let snackTimer: ReturnType<typeof setTimeout> | undefined;
export function showSnack(text: string) {
  clearTimeout(snackTimer);
  useSnack.setState((s) => ({ text, n: s.n + 1 }));
  snackTimer = setTimeout(() => useSnack.setState({ text: null }), 2600);
}

export function Snackbar() {
  const { text, n } = useSnack();
  if (!text) return null;
  return (
    <div className="snack" key={n} role="status">
      {text}
    </div>
  );
}

// ---------------- Guardar una cola (radio) o un álbum como playlist ----------------

/** Lo ya guardado en esta sesión (clave → playlist): guardar otra vez la misma radio agrega lo nuevo. */
const guardadas = new Map<string, string>();

/**
 * Crea una playlist con estas canciones (sin repetir, en orden). Si esta misma radio/álbum ya se guardó
 * (misma `clave`) y la playlist sigue existiendo, le agrega solo lo que faltaba.
 */
export async function guardarComoPlaylist(nombre: string, trackIds: string[], clave = nombre) {
  const pl = usePlaylists.getState();
  if (!pl.loaded) await pl.load();
  const ids = [...new Set(trackIds)].slice(0, 2000);
  if (!ids.length) return;
  const ya = guardadas.get(clave);
  if (ya && usePlaylists.getState().list.some((p) => p.id === ya)) {
    const n = await usePlaylists.getState().add(ya, ids);
    showSnack(n ? `Se agregaron ${n} canciones a "${nombre}"` : `Ya está guardada en "${nombre}"`);
    return;
  }
  const id = await usePlaylists.getState().create(nombre, ids);
  guardadas.set(clave, id);
  showSnack(`Guardada en tu biblioteca: "${nombre}"`);
}

// ---------------- Ventanas ----------------

export function PlaylistSheets() {
  const current = useSheet((s) => s.sheet);
  const { shown: sheet, closing } = useExit(current, 180);
  // En PC los menús van junto al clic; los formularios (nombre, Spotify) siguen al centro.
  const ctx = !!sheet && menuContextual() && (sheet.mode === 'pick' || sheet.mode === 'options' || sheet.mode === 'fusionar');
  const ref = useAnclaMenu<HTMLDivElement>(ctx);
  if (!sheet) return null;
  return (
    <div className={`sheet-backdrop ${ctx ? 'ctx' : ''} ${closing ? 'closing' : ''}`} onClick={closing ? undefined : closeOverlay}>
      <div ref={ctx ? ref : undefined} className="sheet pl-sheet" role={ctx ? 'menu' : undefined} onClick={(e) => e.stopPropagation()}>
        {sheet.mode === 'pick' ? (
          <PickSheet tracks={sheet.tracks} />
        ) : sheet.mode === 'fusionar' ? (
          <FusionarSheet id={sheet.id} />
        ) : sheet.mode === 'options' ? (
          <OptionsSheet id={sheet.id} />
        ) : sheet.mode === 'spotify' ? (
          <SpotifySheet completar={sheet.completar} />
        ) : (
          <NameSheet sheet={sheet} />
        )}
      </div>
    </div>
  );
}

function NameSheet({ sheet }: { sheet: Extract<Sheet, { mode: 'create' | 'rename' }> }) {
  const [name, setName] = useState(sheet.mode === 'rename' ? sheet.name : '');
  const creating = sheet.mode === 'create';
  useEffect(() => setName(sheet.mode === 'rename' ? sheet.name : ''), [sheet]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    const pl = usePlaylists.getState();
    if (sheet.mode === 'rename') {
      await pl.rename(sheet.id, clean);
      closeOverlay();
      return;
    }
    const id = await pl.create(clean, sheet.trackIds);
    showSnack(sheet.trackIds.length ? `Guardada en "${clean}"` : `Playlist "${clean}" creada`);
    if (sheet.openAfter) closeAllOverlaysThen(() => useNav.getState().push({ type: 'playlist', id }));
    else closeOverlay();
  };

  return (
    <form className="pl-form" onSubmit={submit}>
      <h3>{creating ? 'Nueva playlist' : 'Cambiar nombre'}</h3>
      <input
        autoFocus
        value={name}
        maxLength={60}
        placeholder="Nombre de la playlist"
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.target.select()}
        aria-label="Nombre de la playlist"
      />
      <div className="pl-form-buttons">
        <button type="button" className="pill" onClick={closeOverlay}>
          Cancelar
        </button>
        <button type="submit" className="pill primary" disabled={!name.trim()}>
          {creating ? 'Crear' : 'Guardar'}
        </button>
      </div>
      {creating && !sheet.trackIds.length && useCuenta.getState().token && (
        <button type="button" className="pl-importar-link" onClick={() => useSheet.setState({ sheet: { mode: 'spotify' } })}>
          ¿La tienes en Spotify? <b>Impórtala con su enlace</b>
        </button>
      )}
    </form>
  );
}

/**
 * Importar una playlist pública de Spotify: se pega el enlace y el servidor arma la playlist con las canciones
 * que ya tiene. Las que faltan quedan esperando y se agregan solas cuando se suben.
 */
function SpotifySheet({ completar }: { completar?: { id: string; nombre: string } }) {
  const [enlace, setEnlace] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<Importada | null>(null);
  // Segundo paso (más de 100): pegar las canciones copiadas en Spotify.
  const [pegar, setPegar] = useState<{ id: string; nombre: string } | null>(completar ?? null);

  const importar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enlace.trim() || cargando) return;
    setCargando(true);
    setError(null);
    try {
      setHecho(await importarDeSpotify(enlace.trim()));
    } catch (x) {
      setError((x as Error).message || 'No se pudo importar. Revisa la conexión.');
    } finally {
      setCargando(false);
    }
  };

  if (pegar) return <PegarSheet id={pegar.id} nombre={pegar.nombre} />;

  if (hecho) {
    const leidas = hecho.encontradas + hecho.faltan;
    return (
      <div className="pl-form">
        <h3>"{hecho.nombre}" importada</h3>
        <p className="pl-importar-resumen">
          {hecho.encontradas === 0
            ? 'Ninguna de sus canciones está todavía en el servidor.'
            : `${hecho.encontradas} de ${leidas} canciones ya estaban en el servidor y quedaron en tu playlist.`}
        </p>
        {hecho.faltan > 0 && (
          <p className="pl-importar-resumen">
            {hecho.faltan === 1 ? 'La que no está aparece en gris' : `Las ${hecho.faltan} que no están aparecen en gris`} como "Canción no disponible" y se agregan solas cuando se suban al servidor.
          </p>
        )}
        {!hecho.completa && (
          <div className="pl-importar-falta">
            <b>Faltan {hecho.total - hecho.leidas} canciones por traer.</b> Con el enlace, Spotify solo deja leer las primeras {hecho.leidas}.
          </div>
        )}
        <div className="pl-form-buttons">
          {hecho.completa ? (
            <button type="button" className="pill" onClick={closeOverlay}>
              Cerrar
            </button>
          ) : (
            <button type="button" className="pill" onClick={() => closeAllOverlaysThen(() => useNav.getState().push({ type: 'playlist', id: hecho.id }))}>
              Abrir playlist
            </button>
          )}
          {hecho.completa ? (
            <button type="button" className="pill primary" onClick={() => closeAllOverlaysThen(() => useNav.getState().push({ type: 'playlist', id: hecho.id }))}>
              Abrir playlist
            </button>
          ) : (
            <button type="button" className="pill primary" onClick={() => setPegar({ id: hecho.id, nombre: hecho.nombre })}>
              Traer el resto
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className="pl-form" onSubmit={importar}>
      <h3>Importar de Spotify</h3>
      <input
        autoFocus
        value={enlace}
        maxLength={300}
        inputMode="url"
        placeholder="https://open.spotify.com/playlist/…"
        onChange={(e) => {
          setEnlace(e.target.value);
          setError(null);
        }}
        aria-label="Enlace de la playlist de Spotify"
        disabled={cargando}
      />
      <p className={`pl-importar-ayuda ${error ? 'error' : ''}`} role={error ? 'alert' : undefined}>
        {error ?? 'En Spotify: ⋯ de la playlist → Compartir → Copiar enlace. Tiene que ser pública.'}
      </p>
      <div className="pl-form-buttons">
        <button type="button" className="pill" onClick={closeOverlay} disabled={cargando}>
          Cancelar
        </button>
        <button type="submit" className="pill primary" disabled={!enlace.trim() || cargando}>
          {cargando ? 'Importando…' : 'Importar'}
        </button>
      </div>
    </form>
  );
}

/**
 * Segundo paso de la importación: pegar las canciones copiadas en Spotify (Ctrl+A, Ctrl+C en la playlist). Se
 * puede pegar la playlist entera: lo que ya estaba no se repite.
 */
function PegarSheet({ id, nombre }: { id: string; nombre: string }) {
  const [texto, setTexto] = useState('');
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ encontradas: number; faltan: number; noLeidas: number } | null>(null);
  const cuantas = texto.split(/[\r\n]+|\s+(?=https:\/\/open\.spotify\.com\/)/).filter((l) => l.trim()).length;

  const completar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cuantas || avance) return;
    setError(null);
    setAvance({ hechas: 0, total: cuantas });
    try {
      setHecho(await completarConPegadas(id, texto, (hechas, total) => setAvance({ hechas, total })));
    } catch (x) {
      setError((x as Error).message || 'No se pudo completar. Revisa la conexión.');
    } finally {
      setAvance(null);
    }
  };

  const abrir = () => closeAllOverlaysThen(() => useNav.getState().push({ type: 'playlist', id }));

  if (hecho) {
    return (
      <div className="pl-form">
        <h3>"{nombre}" completada</h3>
        <p className="pl-importar-resumen">
          {hecho.encontradas + hecho.faltan === 0
            ? 'Esas canciones ya estaban todas en tu playlist.'
            : `Se agregaron ${hecho.encontradas} ${hecho.encontradas === 1 ? 'canción' : 'canciones'}${hecho.faltan ? ` y ${hecho.faltan} quedaron en gris como "Canción no disponible"` : ''}.`}
        </p>
        {hecho.noLeidas > 0 && (
          <p className="pl-importar-resumen muted">Spotify no respondió con {hecho.noLeidas}. Puedes volver a pegar la lista: lo que ya está no se repite.</p>
        )}
        <div className="pl-form-buttons">
          <button type="button" className="pill primary" onClick={abrir}>
            Abrir playlist
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="pl-form" onSubmit={completar}>
      <h3>Traer el resto de "{nombre}"</h3>
      <ol className="pl-importar-pasos">
        <li>Abre la playlist en Spotify en el computador (la app o open.spotify.com).</li>
        <li>
          Haz clic en una canción y aprieta <kbd>Ctrl</kbd> + <kbd>A</kbd> y luego <kbd>Ctrl</kbd> + <kbd>C</kbd>.
        </li>
        <li>
          Pega aquí con <kbd>Ctrl</kbd> + <kbd>V</kbd>. Puedes pegarla entera: lo que ya está no se repite.
        </li>
      </ol>
      <textarea
        autoFocus
        className="pl-importar-pegar"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setError(null);
        }}
        placeholder="https://open.spotify.com/track/…"
        aria-label="Canciones copiadas de Spotify"
        disabled={!!avance}
        rows={5}
      />
      {avance ? (
        <div className="pl-importar-avance" role="status">
          <div className="barra">
            <span style={{ width: `${Math.round((avance.hechas / Math.max(1, avance.total)) * 100)}%` }} />
          </div>
          Leyendo canciones en Spotify… {avance.hechas} de {avance.total}
        </div>
      ) : (
        <p className={`pl-importar-ayuda ${error ? 'error' : ''}`} role={error ? 'alert' : undefined}>
          {error ?? (cuantas ? `${cuantas} ${cuantas === 1 ? 'canción pegada' : 'canciones pegadas'}. Toma unos segundos cada 50.` : 'También sirven líneas "Artista - Canción".')}
        </p>
      )}
      <div className="pl-form-buttons">
        <button type="button" className="pill" onClick={closeOverlay} disabled={!!avance}>
          Cancelar
        </button>
        <button type="submit" className="pill primary" disabled={!cuantas || !!avance}>
          {avance ? 'Agregando…' : 'Agregar'}
        </button>
      </div>
    </form>
  );
}

/** Guarda las canciones en la playlist (sin repetir) y avisa. */
export async function guardarEnPlaylist(pid: string, tracks: Track[]) {
  const p = usePlaylists.getState().list.find((x) => x.id === pid);
  if (!p) return;
  const n = await usePlaylists.getState().add(pid, tracks.map((t) => t.id));
  if (tracks.length === 1) showSnack(n ? `Guardada en "${p.name}"` : `Ya está en "${p.name}"`);
  else showSnack(n ? `Se guardaron ${n} canciones en "${p.name}"` : `Ya estaban todas en "${p.name}"`);
}

/** Fusionar: la playlist `destino` recibe todas las canciones de `origen` (sin repetir). `origen` no cambia. */
export async function fusionarPlaylists(origen: string, destino: string) {
  const pl = usePlaylists.getState();
  const a = pl.list.find((x) => x.id === origen);
  const b = pl.list.find((x) => x.id === destino);
  if (!a || !b) return;
  const n = await pl.add(destino, a.trackIds);
  showSnack(
    n ? `Se agregaron ${n} ${n === 1 ? 'canción' : 'canciones'} de "${a.name}" a "${b.name}"` : `"${b.name}" ya tenía todas las canciones de "${a.name}"`,
  );
}

/**
 * Lista de playlists para elegir una (submenú de PC, como Spotify): buscador, "Nueva playlist" (opcional) y los
 * nombres, de la más reciente a la más antigua.
 */
export function ListaPlaylistsMenu({ excluir, nueva, alElegir }: { excluir?: string; nueva?: () => void; alElegir: (id: string) => void }) {
  const list = usePlaylists((s) => s.list);
  const [q, setQ] = useState('');
  const n = q.trim().toLowerCase();
  const filas = [...list]
    .filter((p) => p.id !== excluir && (!n || p.name.toLowerCase().includes(n)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const hayOtras = list.some((p) => p.id !== excluir);
  return (
    <>
      <label className="ctx-buscar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca una playlist" aria-label="Buscar una playlist" />
      </label>
      {nueva && (
        <button className="ctx-op" onClick={nueva}>
          <PlusIcon /> Nueva playlist
        </button>
      )}
      <div className="ctx-sep" />
      <div className="ctx-lista">
        {filas.map((p) => (
          <button key={p.id} className="ctx-op" onClick={() => alElegir(p.id)}>
            {p.name}
          </button>
        ))}
        {!filas.length && <p className="ctx-vacio">{hayOtras ? 'Ninguna se llama así' : 'No tienes otras playlists'}</p>}
      </div>
    </>
  );
}

/** Teléfono: elegir con qué playlist se fusiona (esa recibe todas las canciones de esta). */
function FusionarSheet({ id }: { id: string }) {
  const p = usePlaylists((s) => s.list.find((x) => x.id === id));
  const list = usePlaylists((s) => s.list);
  const tracks = useLibrary((s) => s.tracks);
  if (!p) return null;
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const otras = list.filter((x) => x.id !== id).sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <>
      <div className="pl-pick-head">Fusionar "{p.name}" con…</div>
      <p className="pl-fusion-nota">La playlist que elijas recibe todas las canciones de "{p.name}". Esta no cambia.</p>
      <div className="pl-pick-list">
        {otras.map((o) => (
          <button
            key={o.id}
            className="pl-pick-row"
            onClick={async () => {
              await fusionarPlaylists(id, o.id);
              closeOverlay();
            }}
          >
            <PlaylistCover id={o.id} tracks={o.trackIds.map((i) => byId.get(i)).filter((t): t is Track => !!t)} className="thumb" />
            <span className="track-text">
              <span className="track-title">{o.name}</span>
              <span className="track-sub">
                {o.trackIds.length} {o.trackIds.length === 1 ? 'canción' : 'canciones'}
              </span>
            </span>
          </button>
        ))}
        {otras.length === 0 && <p className="muted pad small">No tienes otras playlists con cuál fusionarla.</p>}
      </div>
    </>
  );
}

function PickSheet({ tracks: elegidas }: { tracks: Track[] }) {
  const list = usePlaylists((s) => s.list);
  const tracks = useLibrary((s) => s.tracks);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  const ids = elegidas.map((t) => t.id);
  const varias = elegidas.length > 1;

  return (
    <>
      <div className="pl-pick-head">{varias ? `Guardar ${elegidas.length} canciones en playlist` : 'Guardar en playlist'}</div>
      <button
        className="sheet-item"
        onClick={() => {
          // Se reemplaza esta ventana por la de "Nueva playlist", ya con las canciones.
          useSheet.setState({ sheet: { mode: 'create', trackIds: ids, openAfter: false } });
        }}
      >
        <span className="pl-pick-new">
          <PlusIcon />
        </span>
        Nueva playlist
      </button>
      <div className="pl-pick-list">
        {sorted.map((p) => {
          const has = ids.every((i) => p.trackIds.includes(i));
          return (
            <button
              key={p.id}
              className="pl-pick-row"
              onClick={async () => {
                await guardarEnPlaylist(p.id, elegidas);
                closeOverlay();
              }}
            >
              <PlaylistCover id={p.id} tracks={p.trackIds.map((i) => byId.get(i)).filter((t): t is Track => !!t)} className="thumb" />
              <span className="track-text">
                <span className="track-title">{p.name}</span>
                <span className="track-sub">
                  {has ? (varias ? 'Ya están aquí · ' : 'Ya está aquí · ') : ''}
                  {p.trackIds.length} {p.trackIds.length === 1 ? 'canción' : 'canciones'}
                </span>
              </span>
            </button>
          );
        })}
        {sorted.length === 0 && <p className="muted pad small">Todavía no tienes playlists. Crea la primera.</p>}
      </div>
    </>
  );
}

/** Menú ⋮ de una playlist: reproducir, aleatorio, cambiar nombre, eliminar. */
/** Recorta al centro (cuadrada) y achica a 800 px: así la foto sube liviana; el servidor la deja en 600 px. */
async function fotoCuadrada(f: File): Promise<string> {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('No se pudo abrir esa imagen.'));
      i.src = url;
    });
    const lado = Math.min(img.naturalWidth, img.naturalHeight);
    const salida = Math.min(800, lado);
    const c = document.createElement('canvas');
    c.width = salida;
    c.height = salida;
    c.getContext('2d')!.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, salida, salida);
    return c.toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Elegir una foto para la playlist (se sube a la cuenta: la ven tus otros aparatos y, si es pública, la comunidad). */
function elegirFotoPlaylist(id: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/gif';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) return showSnack('Esa imagen es demasiado grande');
    showSnack('Subiendo la foto…');
    try {
      const r = await subirFotoPlaylist(id, await fotoCuadrada(f));
      await usePlaylists.getState().setFoto(id, r.foto, r.actualizada);
      showSnack('Foto de la playlist actualizada');
    } catch (e) {
      showSnack((e as Error).message || 'No se pudo subir la foto. Revisa la conexión.');
    }
  };
  input.click();
}

/** Ícono de "fusionar": dos caminos que se juntan en uno. */
function FusionIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3v4a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" />
      <path d="M12 13v8" />
      <path d="M9 18l3 3 3-3" />
    </svg>
  );
}

/** Ícono de "foto" (marco con montaña y sol). */
function PlaylistAddPhotoIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14v14zm-5.04-6.71-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71z" />
    </svg>
  );
}

function OptionsSheet({ id }: { id: string }) {
  const p = usePlaylists((s) => s.list.find((x) => x.id === id));
  // Confirmación dentro de la misma ventana (no usamos confirm() del navegador: algunos lo bloquean).
  const [confirming, setConfirming] = useState(false);
  const tracks = useLibrary((s) => s.tracks);
  const conectado = useCuenta((s) => !!s.token);
  if (!p) return null;
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const list = p.trackIds.map((i) => byId.get(i)).filter((t): t is Track => !!t);
  const play = (shuffle: boolean) => {
    if (!list.length) return;
    usePlayer.getState().playTracks(list, shuffle ? Math.floor(Math.random() * list.length) : 0, { shuffle });
    usePlaylists.getState().markPlayed(id);
    closeOverlay();
  };
  const doDelete = async () => {
    await usePlaylists.getState().remove(p.id);
    showSnack(`Playlist "${p.name}" eliminada`);
    // Si estabas dentro de esa playlist, vuelves a la Biblioteca.
    const onPage = useNav.getState().stack.some((pg) => pg.type === 'playlist' && pg.id === p.id);
    closeAllOverlaysThen(() => {
      if (onPage) history.back();
    });
  };

  if (confirming) {
    return (
      <div className="confirm-box">
        <h3>¿Eliminar "{p.name}"?</h3>
        <p>Se borra la playlist, pero tus canciones se quedan en tu biblioteca.</p>
        <div className="pl-form-buttons">
          <button className="pill" onClick={() => setConfirming(false)}>
            Cancelar
          </button>
          <button className="pill danger" onClick={doDelete}>
            Eliminar
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="sheet-head">
        <PlaylistCover id={p.id} tracks={list} className="thumb" />
        <div className="track-text">
          <div className="track-title">{p.name}</div>
          <div className="track-sub">
            {p.public ? 'Pública' : 'Privada'} • {list.length} {list.length === 1 ? 'canción' : 'canciones'}
          </div>
        </div>
      </div>
      <button className="sheet-item" disabled={!list.length} onClick={() => play(false)}>
        <PlayIcon /> Reproducir
      </button>
      <button className="sheet-item" disabled={!list.length} onClick={() => play(true)}>
        <ShuffleIcon /> Aleatorio
      </button>
      <button className="sheet-item" onClick={() => useSheet.setState({ sheet: { mode: 'rename', id: p.id, name: p.name } })}>
        <EditIcon /> Cambiar nombre
      </button>
      <button
        className="sheet-item"
        onClick={async () => {
          closeOverlay();
          await usePlaylists.getState().setPinned(p.id, !p.pinnedAt);
          showSnack(p.pinnedAt ? `"${p.name}" ya no está fijada` : `"${p.name}" fijada arriba`);
        }}
      >
        <PinIcon size={24} /> {p.pinnedAt ? 'Dejar de fijar' : 'Fijar playlist'}
      </button>
      {p.origen && conectado && (
        <button className="sheet-item" onClick={() => useSheet.setState({ sheet: { mode: 'spotify', completar: { id: p.id, nombre: p.name } } })}>
          <PlusIcon /> Traer más canciones de Spotify
        </button>
      )}
      <Submenu icono={<FusionIcon />} texto="Fusionar con otra playlist" alTocar={() => useSheet.setState({ sheet: { mode: 'fusionar', id: p.id } })}>
        <div className="ctx-nota">La que elijas recibe todas las canciones de "{p.name}"</div>
        <ListaPlaylistsMenu
          excluir={p.id}
          alElegir={(destino) => {
            closeOverlay();
            void fusionarPlaylists(p.id, destino);
          }}
        />
      </Submenu>
      <button
        className="sheet-item"
        disabled={!conectado}
        onClick={() => {
          closeOverlay();
          elegirFotoPlaylist(p.id);
        }}
      >
        <PlaylistAddPhotoIcon />
        <span className="track-text">
          <span>{p.foto ? 'Cambiar foto' : 'Poner una foto'}</span>
          {!conectado && <span className="sheet-sub">Inicia sesión para ponerle foto</span>}
        </span>
      </button>
      {p.foto && (
        <button
          className="sheet-item"
          onClick={async () => {
            closeOverlay();
            try {
              const r = await quitarFotoPlaylist(p.id);
              await usePlaylists.getState().setFoto(p.id, null, r.actualizada);
              showSnack('Foto quitada');
            } catch (e) {
              showSnack((e as Error).message || 'No se pudo quitar la foto. Revisa la conexión.');
            }
          }}
        >
          <CloseIcon /> Quitar foto
        </button>
      )}
      <button
        className="sheet-item"
        disabled={!conectado}
        onClick={async () => {
          await usePlaylists.getState().setPublic(p.id, !p.public);
          showSnack(p.public ? `"${p.name}" ahora es privada` : `"${p.name}" ahora es pública: la ve la comunidad`);
          closeOverlay();
        }}
      >
        {p.public ? <LockIcon /> : <GlobeIcon />}
        <span className="track-text">
          <span>{p.public ? 'Hacer privada' : 'Hacer pública'}</span>
          <span className="sheet-sub">
            {!conectado ? 'Inicia sesión para compartirla' : p.public ? 'Solo tú la verás' : 'La verán tus amigos y "De la comunidad"'}
          </span>
        </span>
      </button>
      <button className="sheet-item danger" onClick={() => setConfirming(true)}>
        <TrashIcon /> Eliminar playlist
      </button>
    </>
  );
}
