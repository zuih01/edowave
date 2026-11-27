/**
 * Página del notch (app de PC, segunda ventana "notch"; la parte de Rust está en escritorio-pc\app\src-tauri\src\notch.rs).
 * La ventana principal le manda lo que suena (evento notch-estado) y aquí se devuelven los botones (notch-accion).
 * Se abre sola unos segundos al cambiar de canción y mientras el mouse esté encima (evento notch-hover, lo mide Rust).
 */
import './notch.css';

type Estado = {
  id: string | null;
  titulo: string;
  artista: string;
  caratula: string | null;
  color: string;
  sonando: boolean;
  acento: string;
};
type Tauri = {
  core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  event: {
    emit: (nombre: string, datos?: unknown) => Promise<void>;
    listen: <T>(nombre: string, f: (e: { payload: T }) => void) => Promise<() => void>;
  };
};
const tauri = (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

const PLAY = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const PAUSA = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>';
const SIGUIENTE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 6.2v11.6a.8.8 0 0 0 1.24.67L14.8 12.7a.8.8 0 0 0 0-1.34L6.24 5.53A.8.8 0 0 0 5 6.2zM16.5 6h2v12h-2z"/></svg>';

const raiz = document.getElementById('notch')!;
raiz.innerHTML = `
  <div class="contenido">
    <button class="caratula" aria-label="Abrir Edowave" title="Abrir Edowave"></button>
    <div class="texto" title="Abrir Edowave"><div class="titulo"></div><div class="artista"></div></div>
    <button class="boton play" aria-label="Reproducir">${PLAY}</button>
    <button class="boton siguiente" aria-label="Siguiente" title="Siguiente">${SIGUIENTE}</button>
  </div>`;
const el = {
  caratula: raiz.querySelector<HTMLButtonElement>('.caratula')!,
  texto: raiz.querySelector<HTMLDivElement>('.texto')!,
  titulo: raiz.querySelector<HTMLDivElement>('.titulo')!,
  artista: raiz.querySelector<HTMLDivElement>('.artista')!,
  play: raiz.querySelector<HTMLButtonElement>('.play')!,
  siguiente: raiz.querySelector<HTMLButtonElement>('.siguiente')!,
};

let estado: Estado | null = null;
let encima = false;
/** Se muestra solo (al cambiar de canción) hasta esta hora. */
let solaHasta = 0;
let abierto = false;
let cerrarEn: ReturnType<typeof setTimeout> | undefined;
let revisarEn: ReturnType<typeof setTimeout> | undefined;

function dibujar() {
  const e = estado;
  raiz.style.setProperty('--acento', e?.acento || '#ff4e6a');
  raiz.classList.toggle('sonando', !!e?.sonando);
  el.titulo.textContent = e?.id ? e.titulo : 'Nada sonando';
  el.artista.textContent = e?.id ? e.artista : 'Elige una canción en Edowave';
  el.caratula.style.backgroundImage = e?.caratula ? `url("${e.caratula}")` : '';
  el.caratula.style.backgroundColor = e?.color || '#333';
  el.play.innerHTML = e?.sonando ? PAUSA : PLAY;
  el.play.setAttribute('aria-label', e?.sonando ? 'Pausar' : 'Reproducir');
  el.play.title = e?.sonando ? 'Pausar' : 'Reproducir';
  el.play.disabled = !e?.id;
  el.siguiente.disabled = !e?.id;
}

/** Abierto si el mouse está encima o si se mostró solo hace poco. Al salir el mouse, espera un poquito. */
function revisar() {
  clearTimeout(revisarEn);
  const quiere = encima || Date.now() < solaHasta;
  if (quiere) {
    clearTimeout(cerrarEn);
    cerrarEn = undefined;
    poner(true);
  } else if (abierto && !cerrarEn) {
    cerrarEn = setTimeout(() => {
      cerrarEn = undefined;
      if (!encima && Date.now() >= solaHasta) poner(false);
    }, 350);
  }
  if (solaHasta > Date.now()) revisarEn = setTimeout(revisar, solaHasta - Date.now() + 20);
}

function poner(a: boolean) {
  if (a === abierto) return;
  abierto = a;
  raiz.classList.toggle('abierto', a);
  // Abierto recibe clics; escondido los deja pasar a lo que haya debajo.
  void tauri?.core.invoke('notch_abierto', { abierto: a }).catch(() => {});
}

const accion = (a: 'alternar' | 'siguiente' | 'mostrar') => () => void tauri?.event.emit('notch-accion', { accion: a });
el.play.addEventListener('click', accion('alternar'));
el.siguiente.addEventListener('click', accion('siguiente'));
el.caratula.addEventListener('click', accion('mostrar'));
el.texto.addEventListener('click', accion('mostrar'));
// Con el mouse encima de la píldora abierta, también cuenta el "encima" del navegador (más rápido que Rust).
raiz.addEventListener('mouseenter', () => {
  if (!abierto) return;
  encima = true;
  revisar();
});

if (tauri) {
  void tauri.event.listen<Estado>('notch-estado', ({ payload }) => {
    const antes = estado?.id;
    estado = payload;
    dibujar();
    // Canción nueva: se muestra sola unos segundos (no la primera vez, al abrir la app).
    if (antes !== undefined && payload.id && payload.id !== antes) {
      solaHasta = Date.now() + 4000;
      revisar();
    }
  });
  void tauri.event.listen<boolean>('notch-hover', ({ payload }) => {
    encima = payload;
    revisar();
  });
  // Lista: que la ventana principal mande lo que suena.
  void tauri.event.emit('notch-listo');
}
dibujar();
