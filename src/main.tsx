import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { matchChart, useBillboard } from './library/billboard';
import { useLibrary } from './library/store';
import './player/automix'; // Automix (experimental): se activa en Configuración → Avanzado
import './styles.css';
import './escritorio/temas'; // tema elegido en Configuración → Tema (después de styles.css, para que lo pise)

// iPhone: declarar que esto es un reproductor de música. Sin esto, el interruptor de silencio del iPhone
// calla todo el audio procesado (ecualizador, rack de efectos, vinilo), aunque la música normal sí suene.
// También ayuda a que siga sonando con la pantalla bloqueada.
{
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    /* navegador sin esta opción */
  }
}

// iPhone: sin zoom con dos dedos (la interfaz está hecha a la medida de la pantalla).
document.addEventListener('gesturestart', (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Solo en desarrollo: permite importar archivos desde la consola para pruebas automáticas.
if (import.meta.env.DEV) {
  (window as unknown as { __importFiles: (f: File[]) => Promise<void> }).__importFiles = (files) =>
    useLibrary.getState().importFiles(files);
  // Para revisar el Hot 100 desde la consola: __billboard.getState()
  (window as unknown as { __billboard: unknown }).__billboard = useBillboard;
  (window as unknown as { __matchChart: unknown }).__matchChart = matchChart;
}
