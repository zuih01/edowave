// Genera los íconos PNG de la app a partir de public/icon.svg.
//  - icon-192.png / icon-512.png: el ícono tal cual (con su sombra y fondo transparente).
//  - apple-touch-icon.png (180) y maskable-512.png: versión "a sangre completa": el cuadrado ocupa todo,
//    sin esquinas ni transparencia, porque el iPhone/Android ponen sus propias esquinas redondeadas.
// Uso: node scripts/make-icons.mjs
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('public/icon.svg', 'utf8');

// Versión a sangre completa: sin la sombra del piso, sin esquinas y recortada al cuadrado.
const full = src
  .replace(/<ellipse[^>]*filter="url\(#ground\)"[^>]*\/>/, '')
  .replace(/rx="52"/g, 'rx="0"')
  .replace('viewBox="0 0 256 256"', 'viewBox="26 20 204 204"');

function png(svg, size, file) {
  const out = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(`public/icons/${file}`, out);
  console.log(`public/icons/${file}`, size, 'px');
}

mkdirSync('public/icons', { recursive: true });
png(src, 192, 'icon-192.png');
png(src, 512, 'icon-512.png');
png(full, 180, 'apple-touch-icon.png');
png(full, 512, 'maskable-512.png');
