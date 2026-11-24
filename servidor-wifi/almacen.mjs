// Almacén de audio del servidor "wifi" (casa). Solo guarda, entrega y borra archivos: el catálogo, las cuentas
// y todo lo demás viven en el VPS. Escucha SOLO en 127.0.0.1: el VPS llega por el túnel SSH (reproductor-tunel).
//
//   GET    /estado              → { libre, total } del disco
//   GET    /a/<nombre>          → el archivo (con Range)
//   PUT    /a/<nombre>          → lo guarda (cabecera X-Sha256 = huella esperada); responde { tamano, sha256 }
//   DELETE /a/<nombre>          → lo borra
//
// Todo pide  Authorization: Bearer <clave>  (la clave está en ~/reproductor/almacen/.clave y en el .env del VPS).
// Sin dependencias: Node 22 puro.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { mkdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BASE = process.env.ALMACEN_DIR ?? join(homedir(), 'reproductor', 'almacen');
const DIR = join(BASE, 'musica');
const TMP = join(BASE, 'tmp');
const PUERTO = Number(process.env.ALMACEN_PUERTO ?? 9107);
const CLAVE = Buffer.from(readFileSync(join(BASE, '.clave'), 'utf8').trim());
if (CLAVE.length < 32) throw new Error('La clave del almacén es muy corta');
const MAX = 2 * 1024 ** 3; // 2 GB por archivo, de sobra

// "abc123.mp3" u "originales/abc123.flac": nada de rutas raras.
const NOMBRE = /^(originales\/)?[A-Za-z0-9_-]{6,40}\.[a-z0-9]{2,5}$/;
const TIPOS = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav' };

await mkdir(join(DIR, 'originales'), { recursive: true });
await mkdir(TMP, { recursive: true });

function autorizado(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) return false;
  const dada = Buffer.from(m[1]);
  return dada.length === CLAVE.length && timingSafeEqual(dada, CLAVE);
}

const json = (res, codigo, cuerpo) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
};

async function entregar(req, res, ruta, nombre) {
  let size;
  try {
    ({ size } = await stat(ruta));
  } catch {
    return json(res, 404, { error: 'No existe' });
  }
  const tipo = TIPOS[nombre.split('.').pop()] ?? 'application/octet-stream';
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let ini = 0;
  let fin = size - 1;
  let codigo = 200;
  if (m && (m[1] || m[2])) {
    ini = m[1] ? Number(m[1]) : size - Number(m[2]);
    fin = m[1] && m[2] ? Number(m[2]) : size - 1;
    ini = Math.max(0, ini);
    fin = Math.min(size - 1, fin);
    if (ini > fin) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    codigo = 206;
  }
  const cab = { 'Content-Type': tipo, 'Content-Length': fin - ini + 1, 'Accept-Ranges': 'bytes' };
  if (codigo === 206) cab['Content-Range'] = `bytes ${ini}-${fin}/${size}`;
  res.writeHead(codigo, cab);
  if (req.method === 'HEAD') return res.end();
  createReadStream(ruta, { start: ini, end: fin }).on('error', () => res.destroy()).pipe(res);
}

async function guardar(req, res, ruta) {
  const esperada = String(req.headers['x-sha256'] ?? '');
  if (!/^[a-f0-9]{64}$/.test(esperada)) return json(res, 400, { error: 'Falta X-Sha256' });
  const tmp = join(TMP, randomBytes(8).toString('hex'));
  const hash = createHash('sha256');
  let tamano = 0;
  const salida = createWriteStream(tmp);
  try {
    await new Promise((listo, falla) => {
      req.on('data', (t) => {
        tamano += t.length;
        if (tamano > MAX) return falla(new Error('muy grande'));
        hash.update(t);
        if (!salida.write(t)) {
          req.pause();
          salida.once('drain', () => req.resume());
        }
      });
      req.on('end', () => salida.end(listo));
      req.on('error', falla);
      req.on('aborted', () => falla(new Error('cortado')));
      salida.on('error', falla);
    });
    const sha256 = hash.digest('hex');
    if (sha256 !== esperada) throw new Error('la huella no coincide');
    await rename(tmp, ruta);
    return json(res, 200, { tamano, sha256 });
  } catch (e) {
    salida.destroy();
    await rm(tmp, { force: true });
    return json(res, 400, { error: e.message });
  }
}

const servidor = createServer(async (req, res) => {
  try {
    if (!autorizado(req)) return json(res, 401, { error: 'No autorizado' });
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/estado' && req.method === 'GET') {
      const d = await statfs(DIR);
      return json(res, 200, { libre: d.bavail * d.bsize, total: d.blocks * d.bsize });
    }
    if (!url.pathname.startsWith('/a/')) return json(res, 404, { error: 'No existe' });
    const nombre = decodeURIComponent(url.pathname.slice(3));
    if (!NOMBRE.test(nombre)) return json(res, 400, { error: 'Nombre no válido' });
    const ruta = join(DIR, nombre);
    if (req.method === 'GET' || req.method === 'HEAD') return await entregar(req, res, ruta, nombre);
    if (req.method === 'PUT') return await guardar(req, res, ruta);
    if (req.method === 'DELETE') {
      await rm(ruta, { force: true });
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'Método no permitido' });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message });
    else res.destroy();
  }
});
servidor.requestTimeout = 0; // subidas largas por el túnel
servidor.listen(PUERTO, '127.0.0.1', () => console.log(`almacén escuchando en 127.0.0.1:${PUERTO} (${DIR})`));
