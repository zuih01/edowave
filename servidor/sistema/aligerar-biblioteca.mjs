// Una sola vez: deja las canciones YA subidas listas para streaming (ver `aligerar` en src/medios.js).
// No recodifica: el sonido queda idéntico. Uso (en el servidor):  node sistema/aligerar-biblioteca.mjs
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import '../src/env.js';
import { aligerar } from '../src/medios.js';

const dir = process.env.MUSIC_DIR;
let cambiadas = 0, fallidas = 0, antes = 0, despues = 0;
for (const f of await readdir(dir)) {
  const formato = extname(f).slice(1);
  const ruta = join(dir, f);
  const a = (await stat(ruta)).size;
  try {
    if (await aligerar(ruta, formato)) {
      cambiadas++;
      antes += a;
      despues += (await stat(ruta)).size;
    }
  } catch (e) {
    fallidas++;
    console.log('no se pudo:', f, String(e.message).slice(0, 120));
  }
}
console.log(`listas: ${cambiadas} · fallidas: ${fallidas} · se ahorraron ${((antes - despues) / 1048576).toFixed(1)} MB`);
