
/**
 * En la app de Android y en la web del teléfono: deslizar desde el borde IZQUIERDO hacia la derecha = "atrás" (como el botón
 * del teléfono): del reproductor a la pantalla principal, de un álbum o de Amigos a la pantalla anterior.
 *
 * - Solo cuenta si el dedo empieza en el borde (24 px): así no choca con carruseles, el vinilo ni la barra.
 * - Mientras deslizas aparece una flecha que crece; pasada la mitad del recorrido se ilumina ("listo") y al
 *   soltar vuelve atrás. Si sueltas antes, la flecha se esconde con un rebote y no pasa nada.
 * - Usa el mismo historial que el botón "atrás", así que cierra primero lo que esté encima (menús, la cola…).
 */
const BORDE = 24;
const RECORRIDO = 110; // px para que cuente

export function iniciarGestos() {
  if (typeof document === 'undefined') return; // en la app de Android y en la web (con el dedo)

  const flecha = document.createElement('div');
  flecha.className = 'gesto-atras';
  flecha.setAttribute('aria-hidden', 'true');
  flecha.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>';
  document.body.appendChild(flecha);

  let x0 = 0;
  let y0 = 0;
  let activo = false;
  let decidido = false;
  let dx = 0;

  const mostrar = (d: number) => {
    const p = Math.min(1, d / RECORRIDO);
    flecha.style.transition = 'none';
    flecha.style.opacity = String(Math.min(1, p * 1.4));
    flecha.style.transform = `translate3d(${-44 + 44 * p}px, 0, 0) scale(${0.8 + 0.25 * p})`;
    flecha.classList.toggle('listo', p >= 1);
  };
  const esconder = () => {
    flecha.style.transition = '';
    flecha.style.opacity = '';
    flecha.style.transform = '';
    flecha.classList.remove('listo');
  };

  window.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      activo = e.touches.length === 1 && t.clientX <= BORDE;
      decidido = false;
      dx = 0;
      x0 = t.clientX;
      y0 = t.clientY;
    },
    { passive: true, capture: true },
  );

  window.addEventListener(
    'touchmove',
    (e) => {
      if (!activo) return;
      const t = e.touches[0];
      const mx = t.clientX - x0;
      const my = t.clientY - y0;
      if (!decidido) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        // Si el dedo va más hacia arriba/abajo que hacia la derecha, es un scroll: no es el gesto.
        decidido = true;
        if (mx <= 0 || Math.abs(my) > mx) {
          activo = false;
          return;
        }
      }
      dx = Math.max(0, mx);
      if (e.cancelable) e.preventDefault(); // que no se mueva lo de abajo mientras haces el gesto
      mostrar(dx);
    },
    { passive: false, capture: true },
  );

  const terminar = () => {
    if (!activo) return;
    activo = false;
    const vuelve = dx >= RECORRIDO;
    esconder();
    if (vuelve) {
      navigator.vibrate?.(8);
      history.back();
    }
  };
  window.addEventListener('touchend', terminar, { capture: true });
  window.addEventListener('touchcancel', () => {
    activo = false;
    esconder();
  }, { capture: true });
}
