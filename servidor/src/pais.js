import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * País de una IP (solo el país, nunca la ubicación exacta), con la base gratuita "IP to Country Lite" de db-ip.com
 * (licencia CC BY 4.0). Se baja una vez al mes y se carga en memoria. La IP no se guarda en ningún lado: se usa
 * en el momento para saber el país y se descarta.
 */
const DIR = join(process.env.MUSIC_DIR ?? '.', '..', 'geo');
const ARCHIVO = join(DIR, 'dbip-country-lite.csv.gz');

let v4 = null; // { ini: Uint32Array, fin: Uint32Array, pais: string[] }
let v6 = null; // { ini: bigint[], fin: bigint[], pais: string[] }

const ip4 = (s) => s.split('.').reduce((n, x) => n * 256 + Number(x), 0);
function ip6(s) {
  let [cabeza, cola] = s.split('::');
  const a = cabeza ? cabeza.split(':') : [];
  const b = cola !== undefined && cola ? cola.split(':') : [];
  const partes = cola !== undefined ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return partes.reduce((n, x) => (n << 16n) + BigInt(parseInt(x || '0', 16)), 0n);
}

async function bajar() {
  await mkdir(DIR, { recursive: true });
  const ahora = new Date();
  const mes = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  // La del mes actual; si todavía no está publicada, la del mes anterior.
  for (const m of [mes(ahora), mes(new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 1, 1)))]) {
    const r = await fetch(`https://download.db-ip.com/free/dbip-country-lite-${m}.csv.gz`, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) continue;
    const tmp = `${ARCHIVO}.tmp`;
    await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
    await rename(tmp, ARCHIVO);
    return true;
  }
  return false;
}

async function cargar() {
  const a4 = { ini: [], fin: [], pais: [] };
  const a6 = { ini: [], fin: [], pais: [] };
  const rl = createInterface({ input: createReadStream(ARCHIVO).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const linea of rl) {
    const [ini, fin, pais] = linea.split(',');
    if (!pais || pais === 'ZZ') continue;
    if (isIPv4(ini)) {
      a4.ini.push(ip4(ini));
      a4.fin.push(ip4(fin));
      a4.pais.push(pais);
    } else if (isIPv6(ini)) {
      a6.ini.push(ip6(ini));
      a6.fin.push(ip6(fin));
      a6.pais.push(pais);
    }
  }
  v4 = { ini: Uint32Array.from(a4.ini), fin: Uint32Array.from(a4.fin), pais: a4.pais };
  v6 = a6;
}

/** Prepara la base (la baja si no está o tiene más de 35 días) y la renueva sola cada mes. */
export async function iniciarPaises(log = console) {
  try {
    const vieja = !existsSync(ARCHIVO) || Date.now() - statSync(ARCHIVO).mtimeMs > 35 * 86_400_000;
    if (vieja && !(await bajar()) && !existsSync(ARCHIVO)) return log.warn('no se pudo bajar la base de países');
    await cargar();
    log.info({ rangos: v4.pais.length + v6.pais.length }, 'base de países lista');
  } catch (e) {
    log.warn({ error: e.message }, 'base de países no disponible');
    await rm(`${ARCHIVO}.tmp`, { force: true }).catch(() => {});
  }
  setTimeout(() => void iniciarPaises(log), 7 * 86_400_000).unref();
}

function buscar(tabla, x) {
  let lo = 0;
  let hi = tabla.ini.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (x < tabla.ini[mid]) hi = mid - 1;
    else if (x > tabla.fin[mid]) lo = mid + 1;
    else return tabla.pais[mid];
  }
  return null;
}

/** Código de país (2 letras) de una IP, o null si no se sabe (IP local, base no cargada…). */
export function paisDe(ip) {
  if (!ip) return null;
  const s = String(ip).replace(/^::ffff:/, '');
  try {
    if (isIPv4(s)) return v4 ? buscar(v4, ip4(s)) : null;
    if (isIPv6(s)) return v6 ? buscar(v6, ip6(s)) : null;
  } catch {
    /* IP rara */
  }
  return null;
}
