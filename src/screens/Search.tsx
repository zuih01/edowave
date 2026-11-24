import { useEffect, useMemo, useRef, useState } from 'react';
import { Cover } from '../components/Cover';
import { CloseIcon, FillQueryIcon, HistoryIcon, MicIcon, SearchIcon } from '../components/Icons';
import { TrackRow } from '../components/TrackRow';
import { normalize } from '../library/fuzzy';
import { useSearchHistory } from '../library/searchHistory';
import { useLibrary } from '../library/store';
import { useNav } from '../nav';
import { playSongRadio } from '../reco/store';
import { api } from '../server/cuenta';
import { mostradas } from '../estadisticas';
import { guardarListaBusqueda, TarjetaListaBusqueda, type ListaBusqueda } from '../components/ListaBusqueda';
import { escuchar, vozDisponible } from '../vozBusqueda';
import type { Track } from '../types';

/** Buscar hablando: el texto aparece en el buscador mientras hablas (ver vozBusqueda.ts). */
function useVoz(setQ: (q: string) => void, alTerminar: (t: string) => void) {
  const [disponible, setDisponible] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [error, setError] = useState('');
  const parar = useRef<(() => void) | null>(null);
  useEffect(() => {
    void vozDisponible().then(setDisponible);
    return () => parar.current?.();
  }, []);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4000);
    return () => clearTimeout(t);
  }, [error]);
  const alternar = async () => {
    if (escuchando) {
      parar.current?.();
      return;
    }
    setError('');
    setEscuchando(true);
    parar.current = await escuchar(
      (t) => setQ(t),
      (t) => {
        setEscuchando(false);
        parar.current = null;
        if (t) {
          setQ(t);
          alTerminar(t);
        }
      },
      (msg) => {
        setEscuchando(false);
        parar.current = null;
        setError(msg);
      },
    );
  };
  return { disponible, escuchando, error, alternar };
}

/** Respuestas recientes del servidor (las últimas 80 búsquedas, por un minuto). */
const recientes = new Map<string, { r: { artists: string[]; albums: string[]; tracks: string[]; lista?: ListaBusqueda }; at: number }>();

/**
 * Buscador. En la versión de PC se usa dentro del menú que se despliega bajo la barra de arriba: ahí el campo de
 * texto es el de la barra (`externo`) y aquí solo se muestran los resultados (misma búsqueda, mismo orden).
 */
export function Search({ externo }: { externo?: { q: string; setQ: (q: string) => void } } = {}) {
  const [qLocal, setQLocal] = useState('');
  const q = externo ? externo.q : qLocal;
  const setQ = externo ? externo.setQ : setQLocal;
  const { tracks, albums, artists } = useLibrary();
  const push = useNav((s) => s.push);
  const history = useSearchHistory();
  const voz = useVoz(setQ, (t) => t && history.addQuery(t));
  // El buscador corre en el SERVIDOR (mismo resultado en todos tus aparatos) y va buscando mientras escribes.
  // Nunca hay más de una búsqueda en camino: si escribes mientras llega una, al volver se pide solo lo último
  // que escribiste (así no se hace fila de búsquedas viejas). Los resultados anteriores quedan hasta que llegan los nuevos.
  const [res, setRes] = useState<{ q: string; artists: string[]; albums: string[]; tracks: string[]; lista?: ListaBusqueda } | null>(null);
  const busq = useRef<{ enCamino: boolean; pendiente: string | null }>({ enCamino: false, pendiente: null });
  const pedir = useRef<(qq: string) => void>(() => {});
  pedir.current = (qq: string) => {
    // Lo ya buscado sale al instante (al borrar una letra, o al volver a escribir lo mismo), como en Google.
    const guardado = recientes.get(qq);
    if (guardado && Date.now() - guardado.at < 60_000) {
      setRes({ q: qq, ...guardado.r });
      if (guardado.r.lista) guardarListaBusqueda(guardado.r.lista);
      return;
    }
    const b = busq.current;
    if (b.enCamino) {
      b.pendiente = qq;
      return;
    }
    b.enCamino = true;
    b.pendiente = null;
    api<{ artists: string[]; albums: string[]; tracks: string[]; lista?: ListaBusqueda }>(`/api/buscar?q=${encodeURIComponent(qq)}`)
      .then(
        (r) => {
          recientes.set(qq, { r, at: Date.now() });
          if (recientes.size > 80) recientes.delete(recientes.keys().next().value!);
          if (qActual.current !== qq) return; // ya escribiste otra cosa
          setRes({ q: qq, ...r });
          if (r.lista) guardarListaBusqueda(r.lista);
          mostradas('busqueda', r.tracks.slice(0, 20)); // estadísticas (CTR)
          // Si no encontró nada y dejaste de escribir, se anota la búsqueda (para saber qué canciones faltan).
          if (!r.lista && !r.tracks.length && !r.artists.length && !r.albums.length)
            setTimeout(() => {
              if (qActual.current === qq) void api(`/api/buscar?q=${encodeURIComponent(qq)}&final=1`).catch(() => {});
            }, 1500);
        },
        () => qActual.current === qq && setRes({ q: qq, artists: [], albums: [], tracks: [] }),
      )
      .finally(() => {
        b.enCamino = false;
        const p = b.pendiente;
        if (p && p === qActual.current) pedir.current(p);
      });
  };
  const qActual = useRef('');
  useEffect(() => {
    const qq = q.trim();
    qActual.current = qq;
    if (!qq) {
      busq.current.pendiente = null;
      return setRes(null);
    }
    const t = setTimeout(() => pedir.current(qq), recientes.has(qq) ? 0 : 60);
    return () => clearTimeout(t);
  }, [q]);
  const r = useMemo(() => {
    if (!q.trim() || !res) return null;
    const ar = new Map(artists.map((a) => [a.name, a]));
    const al = new Map(albums.map((a) => [a.key, a]));
    const tr = new Map(tracks.map((t) => [t.id, t]));
    return {
      lista: res.lista,
      artists: res.artists.map((n) => ar.get(n)).filter((x): x is NonNullable<typeof x> => !!x),
      albums: res.albums.map((k) => al.get(k)).filter((x): x is NonNullable<typeof x> => !!x),
      tracks: res.tracks.map((id) => tr.get(id)).filter((x): x is Track => !!x),
    };
  }, [q, res, tracks, albums, artists]);

  // Mientras escribes: primero tus búsquedas anteriores parecidas, después búsquedas posibles (solo texto).
  const sugerencias = useMemo(() => {
    const qq = normalize(q);
    if (!qq || !r) return { previas: [] as string[], posibles: [] as string[] };
    const previas = history.queries.filter((h) => normalize(h).includes(qq) && normalize(h) !== qq).slice(0, 2);
    const vistos = new Set(previas.map(normalize));
    const posibles: string[] = [];
    const agregar = (texto: string) => {
      const limpio = texto.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const n = normalize(limpio);
      if (!n || n === qq || vistos.has(n) || posibles.length >= 5) return;
      vistos.add(n);
      posibles.push(limpio);
    };
    for (const a of r.artists) agregar(a.name);
    for (const t of r.tracks.slice(0, 8)) agregar(`${t.artist.split(/\s*(?:,|&| y | feat\.? | ft\.? )\s*/i)[0]} ${t.title}`);
    return { previas, posibles };
  }, [q, r, history.queries]);
  /** El texto con lo que ya escribiste en negrita (como en los buscadores de música). */
  const resaltar = (texto: string) => {
    const typed = q.trim().toLowerCase();
    return texto.toLowerCase().startsWith(typed) ? (
      <>
        <b>{texto.slice(0, typed.length)}</b>
        {texto.slice(typed.length)}
      </>
    ) : (
      texto
    );
  };

  /** Tus búsquedas anteriores parecidas primero, después las búsquedas posibles, en una sola lista. */
  const filasSugerencia = [
    ...sugerencias.previas.map((h) => ({ h, previa: true })),
    ...sugerencias.posibles.map((h) => ({ h, previa: false })),
  ];
  const filaSugerencia = ({ h, previa }: { h: string; previa: boolean }) =>
    previa ? (
      <div key={`h-${h}`} className="search-history-row" onClick={() => setQ(h)}>
        <HistoryIcon />
        <span className="search-history-text">{resaltar(h)}</span>
        <button
          className="icon-btn"
          aria-label={`Quitar "${h}" de tus búsquedas`}
          onClick={(e) => {
            e.stopPropagation();
            history.removeQuery(h);
          }}
        >
          <CloseIcon size={20} />
        </button>
      </div>
    ) : (
      <div key={`s-${h}`} className="search-history-row" onClick={() => setQ(h)}>
        <SearchIcon size={22} />
        <span className="search-history-text">{resaltar(h)}</span>
        <span className="icon-btn" aria-hidden="true">
          <FillQueryIcon />
        </span>
      </div>
    );

  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const recentTracks = history.tracks.map((id) => byId.get(id)).filter((t): t is Track => !!t);

  /** Al usar un resultado se guarda lo que escribiste en el historial. */
  const remember = () => history.addQuery(q);
  const playFromSearch = (t: Track) => {
    remember();
    history.addTrack(t.id);
    playSongRadio(t.id); // la canción y después una radio de parecidas
  };

  return (
    <div className={`search ${externo ? 'search-desplegable' : ''}`}>
      {!externo && (
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault();
          remember();
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        <SearchIcon size={22} />
        <input
          autoFocus
          enterKeyHint="search"
          placeholder={voz.escuchando ? 'Escuchando… habla ahora' : 'Busca canciones, álbumes o artistas'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && !voz.escuchando && (
          <button type="button" className="icon-btn search-clear" aria-label="Borrar búsqueda" onClick={() => setQ('')}>
            <CloseIcon />
          </button>
        )}
        {voz.disponible && (
          <button
            type="button"
            className={`icon-btn search-mic ${voz.escuchando ? 'escuchando' : ''}`}
            aria-label={voz.escuchando ? 'Dejar de escuchar' : 'Buscar hablando'}
            aria-pressed={voz.escuchando}
            onClick={voz.alternar}
          >
            <MicIcon />
          </button>
        )}
      </form>
      )}
      {voz.error && <p className="search-voz-error" role="alert">{voz.error}</p>}

      {!r && (recentTracks.length > 0 || history.queries.length > 0) && (
        <section>
          <div className="search-recent-head">
            <h3 className="sub-head">Búsquedas recientes</h3>
            <button className="search-recent-clear" onClick={history.clear}>
              Borrar
            </button>
          </div>
          {recentTracks.length > 0 && (
            <div className="carousel search-recent-tracks">
              {recentTracks.map((t) => (
                <button key={t.id} className="card" onClick={() => playFromSearch(t)}>
                  <Cover coverId={t.coverId} seed={t.album + t.artist} />
                  <div className="card-title">{t.title}</div>
                </button>
              ))}
            </div>
          )}
          {history.queries.map((h) => (
            <div key={h} className="search-history-row" onClick={() => setQ(h)}>
              <HistoryIcon />
              <span className="search-history-text">{h}</span>
              <button
                className="icon-btn"
                aria-label={`Escribir "${h}" en el buscador`}
                onClick={(e) => {
                  e.stopPropagation();
                  setQ(h);
                }}
              >
                <FillQueryIcon />
              </button>
            </div>
          ))}
        </section>
      )}

      {r && !r.lista && r.artists.length + r.albums.length + r.tracks.length === 0 && <p className="muted pad">Sin resultados.</p>}

      {/* "80s", "reggaetón viejo", "r&b de los 90": una lista armada con eso, arriba de todo. */}
      {r?.lista && <TarjetaListaBusqueda lista={r.lista} alUsar={remember} />}

      {/* Como en los buscadores de música. Teléfono: 2 sugerencias, las 3 canciones que más se acercan y el resto de
          sugerencias. PC (menú de la barra de arriba): primero todas las sugerencias de texto y después las canciones. */}
      {r && filasSugerencia.length + r.tracks.length > 0 && (
        <section className="search-sugerencias">
          {(externo ? filasSugerencia : filasSugerencia.slice(0, 2)).map(filaSugerencia)}
          {r.tracks.slice(0, 3).map((t) => (
            <TrackRow key={t.id} track={t} onPlay={() => playFromSearch(t)} />
          ))}
          {!externo && filasSugerencia.slice(2).map(filaSugerencia)}
        </section>
      )}

      {r && r.tracks.length > 3 && (
        <section>
          <h3 className="sub-head">Canciones</h3>
          {r.tracks.slice(3).map((t) => (
            <TrackRow key={t.id} track={t} onPlay={() => playFromSearch(t)} />
          ))}
        </section>
      )}
      {r && r.artists.length > 0 && (
        <section>
          <h3 className="sub-head">Artistas</h3>
          {r.artists.map((a) => (
            <button
              key={a.name}
              className="artist-row"
              onClick={() => {
                remember();
                push({ type: 'artist', name: a.name });
              }}
            >
              <Cover coverId={a.coverId} seed={a.name} round className="thumb" />
              <div className="track-text">
                <div className="track-title">{a.name}</div>
              </div>
            </button>
          ))}
        </section>
      )}
      {r && r.albums.length > 0 && (
        <section>
          <h3 className="sub-head">Álbumes</h3>
          <div className="carousel">
            {r.albums.map((a) => (
              <button
                key={a.key}
                className="card"
                onClick={() => {
                  remember();
                  push({ type: 'album', key: a.key });
                }}
              >
                <Cover coverId={a.coverId} seed={a.name + a.artist} />
                <div className="card-title">{a.name}</div>
                <div className="card-sub">{a.artist}</div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
