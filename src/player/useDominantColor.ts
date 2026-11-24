import { useEffect, useState } from 'react';

const cache = new Map<string, string>();

/**
 * Color principal de una portada (como hace YT Music con el fondo del reproductor).
 * Se reduce la imagen a 16x16 y se promedian los píxeles con saturación, oscureciendo el resultado
 * para que el texto blanco siempre se lea.
 */
export function useDominantColor(url: string | undefined, fallback = '#2a2a3a'): string {
  const [color, setColor] = useState(() => (url && cache.get(url)) || fallback);
  useEffect(() => {
    if (!url) {
      setColor(fallback);
      return;
    }
    const hit = cache.get(url);
    if (hit) {
      setColor(hit);
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 16, 16);
      const d = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const max = Math.max(d[i], d[i + 1], d[i + 2]);
        const min = Math.min(d[i], d[i + 1], d[i + 2]);
        const weight = 1 + (max - min) / 32; // los píxeles con color pesan más que los grises
        r += d[i] * weight;
        g += d[i + 1] * weight;
        b += d[i + 2] * weight;
        w += weight;
      }
      const k = 0.55; // oscurecer
      const result = `rgb(${Math.round((r / w) * k)}, ${Math.round((g / w) * k)}, ${Math.round((b / w) * k)})`;
      cache.set(url, result);
      if (alive) setColor(result);
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url, fallback]);
  return color;
}
