/**
 * Ordenar las canciones de una playlist arrastrándolas (PC y teléfono).
 * Las filas que se pueden ordenar llevan `data-orden={i}` (su posición en la lista que se ve) y van dentro de `raiz`.
 * Mientras se arrastra, la fila de destino muestra una línea arriba o abajo (`orden-antes` / `orden-despues`), y la
 * lista se desplaza sola si el puntero llega al borde de arriba o de abajo.
 */

export interface DestinoOrden {
  i: number;
  despues: boolean;
}

/** El primer contenedor con barra de desplazamiento (o la página). */
export function contenedorScroll(el: HTMLElement | null): HTMLElement {
  for (let x = el?.parentElement ?? null; x; x = x.parentElement) {
    const o = getComputedStyle(x).overflowY;
    if ((o === 'auto' || o === 'scroll') && x.scrollHeight > x.clientHeight) return x;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/** Fila de `raiz` bajo el puntero y si se suelta antes o después de ella. */
export function destinoEn(x: number, y: number, raiz: HTMLElement | null): DestinoOrden | null {
  if (!raiz) return null;
  const bajo = document.elementFromPoint(x, y) as HTMLElement | null;
  const fila = bajo?.closest('[data-orden]') as HTMLElement | null;
  if (!fila || !raiz.contains(fila)) return null;
  const r = fila.getBoundingClientRect();
  return { i: Number(fila.dataset.orden), despues: y > r.top + r.height / 2 };
}

let marcada: HTMLElement | null = null;
/** Dibuja la línea donde caerán las canciones (null = la quita). */
export function marcarDestino(raiz: HTMLElement | null, d: DestinoOrden | null) {
  const fila = d && raiz ? (raiz.querySelector(`[data-orden="${d.i}"]`) as HTMLElement | null) : null;
  if (marcada && marcada !== fila) marcada.classList.remove('orden-antes', 'orden-despues');
  marcada = fila;
  if (fila && d) {
    fila.classList.toggle('orden-antes', !d.despues);
    fila.classList.toggle('orden-despues', d.despues);
  }
}

/** Desplazamiento automático cerca de los bordes mientras se arrastra. */
export function autoDesplazar(cont: HTMLElement) {
  let y = -1;
  let raf = 0;
  const paso = () => {
    const esPagina = cont === document.scrollingElement || cont === document.documentElement;
    const top = esPagina ? 0 : cont.getBoundingClientRect().top;
    const bottom = esPagina ? window.innerHeight : cont.getBoundingClientRect().bottom;
    const borde = 70;
    let v = 0;
    if (y >= 0 && y < top + borde) v = -Math.ceil(((top + borde - y) / borde) * 14);
    else if (y >= 0 && y > bottom - borde) v = Math.ceil(((y - (bottom - borde)) / borde) * 14);
    if (v) cont.scrollTop += v;
    raf = requestAnimationFrame(paso);
  };
  raf = requestAnimationFrame(paso);
  return {
    mover(ny: number) {
      y = ny;
    },
    parar() {
      cancelAnimationFrame(raf);
    },
  };
}

/**
 * Teléfono: arrastrar con el ≡ de la fila. La fila sigue al dedo; al soltar se llama `alSoltar` con el destino.
 */
export function arrastrarConAsa(e: React.PointerEvent, raiz: HTMLElement | null, de: number, alSoltar: (d: DestinoOrden) => void) {
  e.preventDefault();
  e.stopPropagation();
  const fila = (e.currentTarget as HTMLElement).closest('[data-orden]') as HTMLElement | null;
  if (!fila || !raiz) return;
  const cont = contenedorScroll(raiz);
  const auto = autoDesplazar(cont);
  const y0 = e.clientY;
  const s0 = cont.scrollTop;
  let destino: DestinoOrden | null = null;
  fila.classList.add('orden-levantada');
  document.body.classList.add('ordenando');

  const mover = (ev: PointerEvent) => {
    ev.preventDefault();
    fila.style.transform = `translateY(${ev.clientY - y0 + (cont.scrollTop - s0)}px)`;
    auto.mover(ev.clientY);
    // La fila levantada no cuenta como destino: se mira lo que hay debajo de ella.
    fila.style.pointerEvents = 'none';
    const d = destinoEn(ev.clientX, ev.clientY, raiz);
    fila.style.pointerEvents = '';
    destino = d && d.i !== de ? d : null;
    marcarDestino(raiz, destino);
  };
  const fin = (ok: boolean) => {
    window.removeEventListener('pointermove', mover);
    window.removeEventListener('pointerup', soltar);
    window.removeEventListener('pointercancel', cancelar);
    auto.parar();
    marcarDestino(raiz, null);
    fila.classList.remove('orden-levantada');
    fila.style.transform = '';
    document.body.classList.remove('ordenando');
    if (ok && destino) alSoltar(destino);
  };
  const soltar = () => fin(true);
  const cancelar = () => fin(false);
  window.addEventListener('pointermove', mover, { passive: false });
  window.addEventListener('pointerup', soltar);
  window.addEventListener('pointercancel', cancelar);
}
