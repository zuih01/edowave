import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { closeOverlay, openOverlay } from '../nav';
import { api } from '../server/cuenta';
import type { Track } from '../types';
import { Cover } from './Cover';
import { showSnack } from './PlaylistSheets';
import { useExit } from './useExit';

/**
 * "Reportar canción": una ventana sencilla con un comentario (se corta, mala calidad, otra versión…).
 * Le llega al administrador en el panel (pestaña Reportes) para que decida si la reemplaza.
 */
const useReporte = create<{ track: Track | null }>(() => ({ track: null }));

export function abrirReporte(track: Track) {
  useReporte.setState({ track });
  openOverlay(() => useReporte.setState({ track: null }));
}

const MAX = 500;
const IDEAS = ['Se corta', 'Mala calidad', 'Otra versión', 'Mal nombre o artista', 'Carátula equivocada'];

export function ReportarCancion() {
  const actual = useReporte((s) => s.track);
  const { shown: track, closing } = useExit(actual, 180);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!actual) return;
    setTexto('');
    setError(null);
    setTimeout(() => campo.current?.focus(), 60);
  }, [actual]);
  if (!track) return null;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return setError('Cuéntanos qué tiene la canción.');
    setEnviando(true);
    try {
      await api('/api/reportes', { method: 'POST', body: { cancion: track.id, comentario: t } });
      closeOverlay();
      showSnack('Gracias, se lo enviamos al administrador');
    } catch (x) {
      setError((x as Error).message || 'No se pudo enviar. Revisa la conexión.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={`sheet-backdrop ${closing ? 'closing' : ''}`} onClick={closing ? undefined : closeOverlay}>
      <div className="sheet reportar" role="dialog" aria-label="Reportar canción" onClick={(e) => e.stopPropagation()}>
        <form className="sugerir" onSubmit={enviar} noValidate>
          <h3>Reportar canción</h3>
          <div className="reportar-cancion">
            <Cover coverId={track.coverId} seed={track.album + track.artist} className="thumb" />
            <div className="track-text">
              <div className="track-title">{track.title}</div>
              <div className="track-sub">{track.artist}</div>
            </div>
          </div>
          <div className="reportar-ideas">
            {IDEAS.map((i) => (
              <button
                type="button"
                key={i}
                className="chip"
                onClick={() => {
                  setTexto((t) => (t.trim() ? `${t.trim()}. ${i}` : i).slice(0, MAX));
                  setError(null);
                  campo.current?.focus();
                }}
              >
                {i}
              </button>
            ))}
          </div>
          <div className={`cuenta-campo ${error ? 'mal' : ''}`}>
            <label className="cuenta-etiqueta" htmlFor="reporte-texto">
              ¿Qué tiene la canción?
            </label>
            <textarea
              ref={campo}
              id="reporte-texto"
              rows={4}
              value={texto}
              maxLength={MAX}
              placeholder="Ej.: se corta al minuto 2, suena con ruido, es la versión en vivo…"
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
          <div className="reportar-pie">
            <button type="button" className="pill" onClick={closeOverlay}>
              Cancelar
            </button>
            <button className="cuenta-btn" disabled={enviando}>
              {enviando ? 'Enviando…' : 'Enviar reporte'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
