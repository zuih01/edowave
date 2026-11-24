import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

/**
 * Buscar hablando.
 *  - App de Android: el reconocimiento de voz del propio teléfono (el de Google, el mismo del teclado).
 *  - Web (Chrome, Edge, Safari del iPhone): el del navegador.
 * El texto va apareciendo mientras hablas; al terminar, queda escrito en el buscador. La voz la procesa Google
 * o Apple: al servidor de música solo llega el texto.
 */

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
const RecWeb = (): (new () => Rec) | undefined => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const nativo = () => Capacitor.isNativePlatform();
const idioma = () => (navigator.language?.toLowerCase().startsWith('es') ? navigator.language : 'es-CL');

/** ¿Se puede buscar hablando en este aparato? */
export async function vozDisponible(): Promise<boolean> {
  if (nativo()) {
    try {
      return (await SpeechRecognition.available()).available;
    } catch {
      return false;
    }
  }
  return !!RecWeb();
}

/**
 * Empieza a escuchar. `parcial` recibe el texto a medida que hablas; `fin` se llama al terminar (con el texto
 * final, o '' si no se entendió nada) y `error` si no se pudo (sin permiso de micrófono, sin conexión…).
 * Devuelve una función para dejar de escuchar antes.
 */
export async function escuchar(parcial: (t: string) => void, fin: (t: string) => void, error: (msg: string) => void): Promise<() => void> {
  let ultimo = '';
  let terminado = false;
  const terminar = () => {
    if (terminado) return;
    terminado = true;
    fin(ultimo.trim());
  };

  if (nativo()) {
    let permiso = (await SpeechRecognition.checkPermissions()).speechRecognition;
    if (permiso !== 'granted') permiso = (await SpeechRecognition.requestPermissions()).speechRecognition;
    if (permiso !== 'granted') {
      error('Para buscar hablando, permite el micrófono en los ajustes de la app.');
      return () => {};
    }
    await SpeechRecognition.removeAllListeners();
    await SpeechRecognition.addListener('partialResults', (d) => {
      ultimo = d.matches?.[0] ?? ultimo;
      parcial(ultimo);
    });
    await SpeechRecognition.addListener('listeningState', (d) => {
      if (d.status === 'stopped') {
        void SpeechRecognition.removeAllListeners();
        terminar();
      }
    });
    SpeechRecognition.start({ language: idioma(), maxResults: 1, partialResults: true, popup: false }).catch((e: Error) => {
      void SpeechRecognition.removeAllListeners();
      if (!terminado) {
        terminado = true;
        error(String(e?.message ?? '').toLowerCase().includes('no match') ? 'No te entendí. Intenta de nuevo.' : 'No se pudo usar el micrófono.');
      }
    });
    return () => void SpeechRecognition.stop().catch(() => {});
  }

  const R = RecWeb();
  if (!R) {
    error('Este navegador no permite buscar hablando.');
    return () => {};
  }
  const rec = new R();
  rec.lang = idioma();
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    let t = '';
    for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
    ultimo = t;
    parcial(t);
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return; // se resuelve en onend
    terminado = true;
    error(e.error === 'not-allowed' ? 'Permite el micrófono para buscar hablando.' : 'No se pudo usar el micrófono.');
  };
  rec.onend = terminar;
  rec.start();
  return () => rec.stop();
}
