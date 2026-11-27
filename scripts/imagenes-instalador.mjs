// Imagen de cabecera del instalador de Windows (NSIS, 150×57).
// Se arman con el logo (public/icon.svg) y se guardan como BMP de 24 bits, que es lo que acepta NSIS.
// Uso: node scripts/imagenes-instalador.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const logo = readFileSync('public/icon.svg', 'utf8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const destino = 'escritorio-pc/app/src-tauri/instalador';

function bmp(svg, ancho, alto, archivo) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: ancho }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render();
  const px = png.pixels; // RGBA
  const fila = Math.ceil((ancho * 3) / 4) * 4;
  const datos = Buffer.alloc(fila * alto);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 4;
      const a = px[i + 3] / 255;
      const o = (alto - 1 - y) * fila + x * 3; // BMP: de abajo hacia arriba, BGR
      datos[o] = Math.round(px[i + 2] * a + 255 * (1 - a));
      datos[o + 1] = Math.round(px[i + 1] * a + 255 * (1 - a));
      datos[o + 2] = Math.round(px[i] * a + 255 * (1 - a));
    }
  }
  const cab = Buffer.alloc(54);
  cab.write('BM', 0);
  cab.writeUInt32LE(54 + datos.length, 2);
  cab.writeUInt32LE(54, 10);
  cab.writeUInt32LE(40, 14);
  cab.writeInt32LE(ancho, 18);
  cab.writeInt32LE(alto, 22);
  cab.writeUInt16LE(1, 26);
  cab.writeUInt16LE(24, 28);
  cab.writeUInt32LE(datos.length, 34);
  cab.writeInt32LE(2835, 38);
  cab.writeInt32LE(2835, 42);
  writeFileSync(`${destino}/${archivo}`, Buffer.concat([cab, datos]));
}

// Panel lateral (lateral.bmp, 164×314): es una ilustración elegida a mano, recortada al centro sin estirar
// (ver scripts/aviso-instalador.py para el texto del acuerdo). Este script ya no la genera.

// Cabecera: fondo blanco (el de las páginas del instalador) con el logo a la derecha.
bmp(
  `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
    <rect width="150" height="57" fill="#ffffff"/>
    <svg x="100" y="8" width="41" height="41" viewBox="0 0 128 128">${logo}</svg>
  </svg>`,
  150,
  57,
  'cabecera.bmp',
);
console.log('lista: cabecera.bmp');
