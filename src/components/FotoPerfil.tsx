import { useEffect, useRef, useState } from 'react';
import { quitarFoto, subirFoto, useCuenta } from '../server/cuenta';
import { closeOverlay } from '../nav';
import { showSnack } from './PlaylistSheets';
import { Avatar } from './ProfileMenu';

/** Lado del recuadro donde se acomoda la foto (en pantalla) y de la imagen que se sube. */
const V = 260;
const SALIDA = 512;

/**
 * Cambiar la foto de perfil: elegir una imagen, acomodarla en el círculo (arrastrar para moverla, la barra
 * para acercar) y guardarla. Se sube al servidor, así se ve en todos los aparatos. "Quitar foto" vuelve a la
 * inicial con color. Un GIF se manda entero con el recorte elegido: el servidor lo recorta y queda animado.
 */
export function FotoPerfil() {
  const foto = useCuenta((s) => s.foto);
  const input = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [gif, setGif] = useState<File | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const arrastre = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Escala para que la imagen cubra el recuadro (zoom 1) y medidas en pantalla.
  const base = img ? V / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const w = img ? img.naturalWidth * base * zoom : V;
  const h = img ? img.naturalHeight * base * zoom : V;
  /** La imagen siempre tapa todo el círculo (no quedan bordes vacíos). */
  const acotar = (x: number, y: number, ww = w, hh = h) => ({ x: Math.min(0, Math.max(V - ww, x)), y: Math.min(0, Math.max(V - hh, y)) });

  useEffect(() => () => void (img && URL.revokeObjectURL(img.src)), [img]);

  const elegir = (f: File | undefined) => {
    setError('');
    if (!f) return;
    if (!f.type.startsWith('image/')) return setError('Elige una imagen (JPG, PNG, WebP o GIF).');
    const esGif = f.type === 'image/gif';
    if (esGif && f.size > 8 * 1024 * 1024) return setError('El GIF tiene que pesar menos de 8 MB.');
    if (f.size > 25 * 1024 * 1024) return setError('Esa imagen es demasiado grande.');
    setGif(esGif ? f : null);
    const i = new Image();
    i.onload = () => {
      const b = V / Math.min(i.naturalWidth, i.naturalHeight);
      setImg(i);
      setZoom(1);
      // Centrada.
      setPos({ x: (V - i.naturalWidth * b) / 2, y: (V - i.naturalHeight * b) / 2 });
    };
    i.onerror = () => setError('No se pudo abrir esa imagen.');
    i.src = URL.createObjectURL(f);
  };

  const cambiarZoom = (z: number) => {
    if (!img) return;
    // Acerca hacia el centro del círculo.
    const cx = (V / 2 - pos.x) / zoom;
    const cy = (V / 2 - pos.y) / zoom;
    const nw = img.naturalWidth * base * z;
    const nh = img.naturalHeight * base * z;
    setZoom(z);
    setPos(acotar(V / 2 - cx * z, V / 2 - cy * z, nw, nh));
  };

  const guardar = async () => {
    if (!img) return;
    setGuardando(true);
    setError('');
    try {
      const k = base * zoom;
      if (gif) {
        // GIF: va entero con el recorte (en píxeles de la imagen); el servidor lo recorta y queda animado.
        const datos = await new Promise<string>((ok, mal) => {
          const r = new FileReader();
          r.onload = () => ok(String(r.result));
          r.onerror = () => mal(new Error('No se pudo leer el GIF.'));
          r.readAsDataURL(gif);
        });
        await subirFoto(datos, { x: Math.round(-pos.x / k), y: Math.round(-pos.y / k), lado: Math.round(V / k) });
      } else {
        const c = document.createElement('canvas');
        c.width = SALIDA;
        c.height = SALIDA;
        c.getContext('2d')!.drawImage(img, -pos.x / k, -pos.y / k, V / k, V / k, 0, 0, SALIDA, SALIDA);
        await subirFoto(c.toDataURL('image/jpeg', 0.88));
      }
      closeOverlay();
      showSnack('Foto de perfil actualizada');
    } catch (e) {
      setError((e as Error).message || 'No se pudo guardar. Revisa la conexión.');
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async () => {
    setGuardando(true);
    try {
      await quitarFoto();
      closeOverlay();
      showSnack('Foto de perfil quitada');
    } catch (e) {
      setError((e as Error).message || 'No se pudo quitar. Revisa la conexión.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="foto-perfil">
      <h3>Foto de perfil</h3>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => elegir(e.target.files?.[0])} />
      {img ? (
        <>
          <div
            className="foto-recorte"
            style={{ width: V, height: V }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              arrastre.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
            }}
            onPointerMove={(e) => {
              const a = arrastre.current;
              if (a) setPos(acotar(a.x + e.clientX - a.px, a.y + e.clientY - a.py));
            }}
            onPointerUp={() => (arrastre.current = null)}
            onPointerCancel={() => (arrastre.current = null)}
            onWheel={(e) => cambiarZoom(Math.min(4, Math.max(1, zoom * (e.deltaY < 0 ? 1.1 : 0.9))))}
          >
            <img src={img.src} alt="" draggable={false} style={{ width: w, height: h, transform: `translate(${pos.x}px, ${pos.y}px)` }} />
            <div className="foto-mascara" aria-hidden="true" />
          </div>
          <label className="foto-zoom">
            <span>Acercar</span>
            <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => cambiarZoom(Number(e.target.value))} />
          </label>
          <p className="muted small">Arrastra la foto para acomodarla dentro del círculo.{gif ? ' El GIF se queda animado.' : ''}</p>
          {error && <p className="cuenta-error" role="alert">{error}</p>}
          <div className="foto-botones">
            <button className="pill" onClick={() => input.current?.click()} disabled={guardando}>
              Elegir otra
            </button>
            <button className="pill primary" onClick={() => void guardar()} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </>
      ) : (
        <>
          <Avatar size={120} />
          {error && <p className="cuenta-error" role="alert">{error}</p>}
          <div className="foto-botones">
            {foto && (
              <button className="pill" onClick={() => void quitar()} disabled={guardando}>
                Quitar foto
              </button>
            )}
            <button className="pill primary" onClick={() => input.current?.click()} disabled={guardando}>
              {foto ? 'Cambiar foto' : 'Elegir una foto'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
