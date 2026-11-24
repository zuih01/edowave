// Compara una carpeta de música del PC con lo que ya hay en el servidor y escribe un .txt SOLO con lo que falta,
// una canción por línea:  Artista - Canción
//   node comparar.mjs "C:\ruta\a\mi\musica"
// La lista del servidor se pide por ssh (alias "vps"), solo lectura: no sube ni borra nada.
//
// Rápido: no lee los archivos enteros (antes sacaba una huella de cada uno); solo lee las etiquetas del comienzo
// del archivo, muchas a la vez. Se descarta todo lo repetido: lo que ya está en el servidor (mismo artista y
// canción, o mismo nombre de archivo) y lo que aparece dos veces en la carpeta.
import { readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';

const EXT = /\.(mp3|m4a|aac|mp4|flac|wav|wave|aif|aiff|alac|ogg|oga|opus|wma|ac3|eac3|ape|wv|mka|amr|caf|dsf|mpc|tta|webm)$/i;
const A_LA_VEZ = 24;
const carpeta = process.argv[2];
if (!carpeta) {
  console.error('Falta la carpeta. Uso: node comparar.mjs "C:\\ruta\\de\\la\\musica"');
  process.exit(1);
}

// Paréntesis que NO cambian la canción (misma grabación): se ignoran. Los demás (Remix, En vivo, Acústica…) sí
// cuentan: "Canción (Remix)" no es lo mismo que "Canción".
const MISMA = /\b(remaster(ed)?|\d{4}|single|radio edit|edit|mono|stereo|album version|original( mix| version)?|explicit|clean|version|bonus track|deluxe|hq|hd|audio|official|video|lyrics?|letra|feat|ft|featuring|con|with)\b/i;
const sinTildes = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const limpiar = (s) =>
  sinTildes(s)
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
const normTitulo = (t) =>
  limpiar(
    sinTildes(t)
      .replace(/[([][^)\]]*[)\]]/g, (p) => (MISMA.test(p) ? ' ' : p))
      .replace(/\s-\s.*(remaster|version|edit|mono|stereo).*$/i, ' ')
      .replace(/\s(feat|ft|featuring)\.?\s.*$/, ' '),
  );
const artistaPrincipal = (a) => limpiar(String(a ?? '').split(/,|;|\s&\s|\sx\s|\sy\s|\sand\s|\sfeat\.?\s|\sft\.?\s|\scon\s|\swith\s/i)[0]);
// Sin espacios, para que "ACDC" y "AC/DC" o "Shes" y "She's" cuenten como lo mismo.
const llave = (artista, titulo) => `${artistaPrincipal(artista).replace(/ /g, '')}|${normTitulo(titulo).replace(/ /g, '')}`;

// 1) Lista del servidor (nombre original, artista y título).
console.log('Pidiendo la lista de canciones al servidor…');
const sql = `SELECT coalesce(json_agg(json_build_object('f', nombre_original, 'a', artista, 't', titulo)), '[]') FROM canciones`;
const remoto = `cd ~/reproductor/app && set -a && . ./.env && set +a && psql "$DATABASE_URL" -tA -c "${sql}"`;
let servidor;
try {
  servidor = JSON.parse(execFileSync('ssh', ['vps', remoto], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
} catch (e) {
  console.error('No pude leer la lista del servidor por ssh:', e.message);
  process.exit(1);
}
const nombres = new Set(servidor.map((c) => String(c.f ?? '').toLowerCase()).filter(Boolean));
const enServidor = new Set(servidor.map((c) => llave(c.a, c.t)));
console.log(`El servidor tiene ${servidor.length} canciones.`);

// 2) Archivos de audio de la carpeta (incluye subcarpetas).
async function recorrer(dir, out) {
  let entradas = [];
  try {
    entradas = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // carpeta sin permiso: se salta
  }
  await Promise.all(
    entradas.map((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return recorrer(p, out);
      if (EXT.test(e.name)) out.push(p);
    }),
  );
}
const archivos = [];
await recorrer(carpeta, archivos);
console.log(`En la carpeta hay ${archivos.length} archivos de audio. Revisando…`);

/** Artista y título: de las etiquetas; si no hay, del nombre "Artista - Título.mp3". */
async function datosDe(p) {
  try {
    const { common } = await parseFile(p, { skipCovers: true, duration: false, skipPostHeaders: true });
    if (common.title && (common.artist || common.albumartist)) return { artista: common.artist ?? common.albumartist, titulo: common.title };
  } catch {
    /* archivo sin etiquetas legibles */
  }
  // Quita el número de pista ("01 - ", "07. "), pero no el de un nombre como "4 Non Blondes".
  const n = basename(p, extname(p)).replace(/^(\d{2,3}[\s.\-_]+|\d[.\-_]\s*)/, '').trim();
  const [a, ...t] = n.split(/\s[-–]\s/);
  return t.length ? { artista: a.trim(), titulo: t.join(' - ').trim() } : { artista: '', titulo: n };
}

// Leer todo (muchas a la vez).
const datos = new Array(archivos.length);
let hechas = 0;
let siguiente = 0;
async function trabajador() {
  while (siguiente < archivos.length) {
    const i = siguiente++;
    datos[i] = await datosDe(archivos[i]);
    hechas++;
    if (hechas % 100 === 0 || hechas === archivos.length) process.stdout.write(`  ${hechas} / ${archivos.length}`);
  }
}
const inicio = Date.now();
await Promise.all(Array.from({ length: A_LA_VEZ }, trabajador));
console.log('');

// Texto que alguien agregó al final de todos los nombres ("Crazy ARRE", "Crazy - ARRE", "Crazy (ARRE)"): se
// detecta solo (la misma palabra al final de al menos un 20 % de las canciones) y se quita.
const AL_FINAL = /[\s\-_]*[([]?\s*([^\s()[\]\-_]+)\s*[)\]]?\s*$/;
const cuenta = new Map();
for (const d of datos) {
  const m = d.titulo.match(AL_FINAL);
  if (m && d.titulo.trim() !== m[1]) {
    const w = m[1].toLowerCase();
    cuenta.set(w, (cuenta.get(w) ?? 0) + 1);
  }
}
const agregados = new Set(['arre']);
for (const [w, n] of cuenta) if (n >= 5 && n >= 0.2 * datos.length && !/^\d+$/.test(w)) agregados.add(w);
const quitarAgregado = (t) => {
  const m = t.match(AL_FINAL);
  return m && agregados.has(m[1].toLowerCase()) && t.trim() !== m[1] ? t.slice(0, m.index).trim() : t;
};
const extra = [...agregados].filter((w) => w !== 'arre' || cuenta.has('arre'));
if (extra.length) console.log(`Texto agregado al final de los nombres (se ignora): ${extra.map((w) => `"${w.toUpperCase()}"`).join(', ')}`);

const vistas = new Set();
const faltan = [];
let yaEstan = 0;
let repetidas = 0;
for (let i = 0; i < archivos.length; i++) {
  const p = archivos[i];
  const d = { artista: quitarAgregado(datos[i].artista), titulo: quitarAgregado(datos[i].titulo) };
  const k = llave(d.artista, d.titulo);
  const nombre = basename(p).toLowerCase();
  if (nombres.has(nombre) || enServidor.has(k)) {
    yaEstan++;
    continue;
  }
  if (vistas.has(k)) {
    repetidas++;
    continue;
  }
  vistas.add(k);
  faltan.push(d.artista ? `${d.artista} - ${d.titulo}` : d.titulo);
}

// 3) El .txt queda junto a esta app: solo la lista, ordenada.
const aqui = dirname(fileURLToPath(import.meta.url));
const fechaHora = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-').slice(0, 16);
const salida = join(aqui, `faltan-${fechaHora}.txt`);
faltan.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
await writeFile(salida, '\ufeff' + faltan.join('\r\n') + '\r\n', 'utf8');

console.log(`Ya en el servidor: ${yaEstan} · repetidas en la carpeta: ${repetidas} · FALTAN: ${faltan.length}`);
console.log(`Tardó ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
console.log(`\nListo: ${salida}`);
