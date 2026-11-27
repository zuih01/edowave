// Busca canciones repetidas en el servidor y (con --borrar) deja solo la más antigua de cada una.
// También endereza las subidas sin etiquetas con el nombre al revés ("Título - Artista.mp3").
//
//   cd ~/reproductor/app && node sistema/duplicados.mjs            → solo muestra la lista (no cambia nada)
//   cd ~/reproductor/app && node sistema/duplicados.mjs --borrar   → borra las repetidas
//   … --enderezar  → además da vuelta los nombres al revés (revisar antes la lista: el 26-11 dio vuelta canciones buenas)
//
// El servidor ya hace esto solo cada 6 horas (src/duplicados.js) y la subida rechaza las repetidas
// (src/rutas/musica.js). Las reglas están en src/repetidas.js.
import '../src/env.js';
import { db } from '../src/db.js';
import { borrarRepetidas, buscarAlReves, buscarRepetidas, enderezarNombres } from '../src/duplicados.js';

const BORRAR = process.argv.includes('--borrar');
const ENDEREZAR = process.argv.includes('--enderezar');
const t0 = Date.now();
const alReves = await buscarAlReves();
console.log(`${alReves.length} canciones que parecen al revés${ENDEREZAR ? ' (se dan vuelta)' : ' (no se tocan; --enderezar para darlas vuelta)'}:`);
for (const c of alReves.slice(0, 40)) console.log(`  ${c.artista} – ${c.titulo}`);
if (alReves.length > 40) console.log(`  … y ${alReves.length - 40} más`);
if (ENDEREZAR) await enderezarNombres(alReves);

const { total, repetidas } = await buscarRepetidas();
const n = repetidas.reduce((s, g) => s + g.length - 1, 0);
const min = (d) => { const s = Math.round(Number(d) || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fila = (c) => `${c.artista} – ${c.titulo}  [${c.album ?? '—'}] ${min(c.duracion)} · ${String(c.subida?.toISOString?.() ?? c.subida).slice(0, 10)} · ${c.escuchas} escuchas`;

console.log(`\n${total} canciones · ${repetidas.length} con repetidas · ${n} se ${BORRAR ? 'borran' : 'borrarían'} · revisado en ${Date.now() - t0} ms\n`);
for (const [queda, ...resto] of repetidas) {
  console.log(`QUEDA  ${fila(queda)}`);
  for (const c of resto) console.log(`BORRA  ${fila(c)}`);
  console.log('');
}

if (!BORRAR) {
  console.log('No se cambió nada. Para aplicar: node sistema/duplicados.mjs --borrar');
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
