import { useSyncExternalStore } from 'react';
import './temas.css';

/**
 * Temas de la interfaz, en todas: app de PC, web (PC y teléfono, también iPhone) y app de Android. Sin editor: temas armados que se eligen en Configuración → Tema.
 * El tema "clasico" es el diseño de siempre y no toca nada (sin atributo en <html>); los demás se aplican con
 * <html data-tema="…"> y sus colores están en temas.css. El rack de efectos nunca cambia de color.
 */
export type TemaId = 'clasico' | 'orquidea' | 'medianoche' | 'omnishelf' | 'warmsand' | 'aero';

const TODOS: { id: TemaId; nombre: string; detalle: string; muestra: [string, string, string] }[] = [
  { id: 'clasico', nombre: 'Clásico', detalle: 'Negro con acento rosado, el de siempre', muestra: ['#030303', '#1d1d1d', '#ff4e6a'] },
  { id: 'orquidea', nombre: 'Orquídea', detalle: 'Oscuro con tonos morados y rosados', muestra: ['#0b0612', '#a0156c', '#ff4fa3'] },
  { id: 'medianoche', nombre: 'Medianoche', detalle: 'Azul marino con acento azul', muestra: ['#060b15', '#1d4f8f', '#3d9bff'] },
  { id: 'omnishelf', nombre: 'Omnishelf', detalle: 'Negro plano con acento verde lima', muestra: ['#0a0a0a', '#2a2a2a', '#d4f04a'] },
  { id: 'warmsand', nombre: 'Warm Sand', detalle: 'Café oscuro, crema y naranja tostado', muestra: ['#15110e', '#5c3220', '#d0703f'] },
  { id: 'aero', nombre: 'Aero', detalle: 'Negro carbón con brillo y play de cristal azul', muestra: ['#07080a', '#272b32', '#3a96ff'] },
];

/** Aero está en pruebas: solo aparece en la web de desarrollo (npm run dev), no en lo que se publica. */
export const TEMAS = TODOS.filter((t) => t.id !== 'aero' || import.meta.env.DEV);

const CLAVE = 'temaPc';
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
