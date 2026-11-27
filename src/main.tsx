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

// iPhone con la app instalada (PWA): iOS deja la página más baja que la pantalla y abajo queda una franja donde la
// página no puede dibujar (se probó estirarla: se corta). Cuando pasa, se marca <html data-visor-corto>: la barra de
// pestañas ya no reserva el espacio de la raya de inicio (iOS lo dejó fuera) y la franja se pinta del color de la
// barra, así se ve como una sola barra hasta el borde (styles.css y temas.css).
{
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && instalada) {
    const ajustar = () => {
      const vertical = innerHeight >= innerWidth;
      const alto = vertical ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
      const falta = alto - innerHeight;
      // Solo si falta un trozo chico (con el teclado abierto falta mucho más: no se toca).
      if (falta > 0 && falta <= 80) document.documentElement.dataset.visorCorto = '';
      else delete document.documentElement.dataset.visorCorto;
    };
    ajustar();
    addEventListener('resize', ajustar);
    addEventListener('orientationchange', () => setTimeout(ajustar, 300));
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
