import { useSyncExternalStore } from 'react';
import './temas.css';
// Temas claros (Neutro y Algodón): sus reglas van después, para pisar los blancos pensados para fondo oscuro.
import './tema-claro-generado.css';
import './tema-claro.css';

/**
 * Temas de la interfaz, en todas: app de PC, web (PC y teléfono, también iPhone) y app de Android. Sin editor: temas armados que se eligen en Configuración → Tema.
 * El tema "clasico" es el diseño de siempre y no toca nada (sin atributo en <html>); los demás se aplican con
 * <html data-tema="…"> y sus colores están en temas.css. El rack de efectos nunca cambia de color.
 */
export type TemaId = 'clasico' | 'orquidea' | 'medianoche' | 'omnishelf' | 'warmsand' | 'neutro' | 'algodon' | 'aero';

const TODOS: { id: TemaId; nombre: string; detalle: string; muestra: [string, string, string] }[] = [
  { id: 'clasico', nombre: 'Clásico', detalle: 'Negro con acento rosado, el de siempre', muestra: ['#030303', '#1d1d1d', '#ff4e6a'] },
  { id: 'orquidea', nombre: 'Orquídea', detalle: 'Oscuro con tonos morados y rosados', muestra: ['#0b0612', '#a0156c', '#ff4fa3'] },
  { id: 'medianoche', nombre: 'Medianoche', detalle: 'Azul marino con acento azul', muestra: ['#060b15', '#1d4f8f', '#3d9bff'] },
  { id: 'omnishelf', nombre: 'Omnishelf', detalle: 'Negro plano con acento verde lima', muestra: ['#0a0a0a', '#2a2a2a', '#d4f04a'] },
  { id: 'warmsand', nombre: 'Warm Sand', detalle: 'Café oscuro, crema y naranja tostado', muestra: ['#15110e', '#5c3220', '#d0703f'] },
  { id: 'neutro', nombre: 'Neutro', detalle: 'Claro: blanco, rosa pastel y negro', muestra: ['#fbeef4', '#ffe1ee', '#ff6fb5'] },
  { id: 'algodon', nombre: 'Algodón de azúcar', detalle: 'Claro: fondo rosita, rosa pastel y negro', muestra: ['#ffdfeb', '#ffd0e2', '#ff5fa8'] },
  { id: 'aero', nombre: 'Aero', detalle: 'Negro carbón con brillo y play de cristal azul', muestra: ['#07080a', '#272b32', '#3a96ff'] },
];

/** Aero está en pruebas: solo aparece en la web de desarrollo (npm run dev) y en la app de PC de prueba
 *  (compilada con VITE_AERO=1), no en lo que se publica. Neutro es la base para otro tema claro: solo en desarrollo. */
export const TEMAS = TODOS.filter(
  (t) => (t.id !== 'aero' || import.meta.env.DEV || import.meta.env.VITE_AERO === '1') && (t.id !== 'neutro' || import.meta.env.DEV),
);

/** Temas de fondo claro (texto oscuro). */
const CLAROS: TemaId[] = ['neutro', 'algodon'];

const CLAVE = 'temaPc';
const esPc = import.meta.env.VITE_PLATAFORMA === 'pc';
const oyentes = new Set<() => void>();

function leer(): TemaId {
  try {
    const v = localStorage.getItem(CLAVE);
    if (TEMAS.some((t) => t.id === v)) return v as TemaId;
  } catch {
    /* sin almacenamiento */
  }
  return 'clasico';
}

/** ¿Esta interfaz ofrece temas? Todas: app de PC, web (PC y teléfono) y app de Android. */
export const temasDisponibles = () => true;

let actual: TemaId = leer();

function aplicar(id: TemaId) {
  const html = document.documentElement;
  const usar = id !== 'clasico' && temasDisponibles();
  if (usar) html.dataset.tema = id;
  else delete html.dataset.tema;
  // Temas claros: comparten las reglas de tema-claro*.css
  if (usar && CLAROS.includes(id)) html.dataset.claro = '';
  else delete html.dataset.claro;
  // Aero en la app de PC: ventana de vidrio (Acrylic de Windows) que deja ver lo de atrás con desenfoque. En la web no.
  const vidrio = esPc && id === 'aero';
  if (vidrio) html.dataset.vidrio = '';
  else delete html.dataset.vidrio;
  if (esPc) {
    try {
      const t = (window as unknown as { __TAURI__?: { core: { invoke: (c: string, a: object) => Promise<unknown> } } }).__TAURI__;
      void t?.core.invoke('vidrio', { activar: vidrio }).catch(() => delete html.dataset.vidrio);
    } catch {
      delete html.dataset.vidrio;
    }
  }
  // Color de la barra del navegador en el teléfono (el de index.html para el Clásico)
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = usar ? (TEMAS.find((t) => t.id === id)?.muestra[0] ?? '#0f0f0f') : '#0f0f0f';
}

// Se aplica apenas se carga la app (main.tsx lo importa), antes de dibujar, para que no parpadee el tema por defecto.
aplicar(actual);

export function cambiarTema(id: TemaId) {
  actual = id;
  try {
    localStorage.setItem(CLAVE, id);
  } catch {
    /* sin almacenamiento: dura hasta cerrar la app */
  }
  aplicar(id);
  oyentes.forEach((f) => f());
}

export function useTema() {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => actual,
  );
}
