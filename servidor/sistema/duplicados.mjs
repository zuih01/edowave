// Busca canciones repetidas en el servidor y (con --borrar) deja solo la más antigua de cada una.
//
//   cd ~/reproductor/app && node sistema/duplicados.mjs            → solo muestra la lista (no borra nada)
//   cd ~/reproductor/app && node sistema/duplicados.mjs --borrar   → borra las repetidas
//
// El servidor ya hace esto solo cada 6 horas (src/duplicados.js) y la subida rechaza las repetidas
// (src/rutas/musica.js). Las reglas están en src/repetidas.js.
import '../src/env.js';
import { db } from '../src/db.js';
import { borrarRepetidas, buscarRepetidas } from '../src/duplicados.js';

const BORRAR = process.argv.includes('--borrar');
const { total, repetidas } = await buscarRepetidas();
const n = repetidas.reduce((s, g) => s + g.length - 1, 0);
const min = (d) => `${Math.floor((Number(d) || 0) / 60)}:${String(Math.round(Number(d) || 0) % 60).padStart(2, '0')}`;
const fila = (c) => `${c.artista} – ${c.titulo}  [${c.album ?? '—'}] ${min(c.duracion)} · ${String(c.subida?.toISOString?.() ?? c.subida).slice(0, 10)} · ${c.escuchas} escuchas`;

console.log(`${total} canciones · ${repetidas.length} con repetidas · ${n} se ${BORRAR ? 'borran' : 'borrarían'}\n`);
for (const [queda, ...resto] of repetidas) {
  console.log(`QUEDA  ${fila(queda)}`);
  for (const c of resto) console.log(`BORRA  ${fila(c)}`);
  console.log('');
}

if (!BORRAR) {
  console.log('No se borró nada. Para borrar: node sistema/duplicados.mjs --borrar');
} else {
  try {
    const { borradas, papelera } = await borrarRepetidas(repetidas);
    console.log(`Listo: ${borradas} canciones repetidas borradas${papelera ? ` (los archivos del VPS quedaron en ${papelera})` : ''}.`);
  } catch (e) {
    console.error('No se borró nada (error):', e.message);
    process.exitCode = 1;
  }
}
await db.end();
