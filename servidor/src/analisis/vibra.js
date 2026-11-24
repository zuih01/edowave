// Vibe de cada canción (alegre, triste, relajada, agresiva, de fiesta, bailable, acústica, electrónica,
// instrumental), escuchando el audio con Essentia: ver ../../vibra/vibra.py (corre en ~/reproductor/vibra con su
// propio Python, instalado aparte). Se analizan de a una, con prioridad baja, las que todavía no tienen vibe:
// al arrancar se pone al día con toda la biblioteca y después analiza solas las que se suban.
// Si Essentia no está instalado en este servidor, no hace nada (el resto funciona igual).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { db } from '../db.js';
import { rm } from 'node:fs/promises';
import { copiaTemporal } from '../almacen.js';

const CARPETA = process.env.VIBRA_DIR ?? join(process.env.MUSIC_DIR, '..', '..', 'vibra');
const PYTHON = join(CARPETA, '.venv', 'bin', 'python');
// El script viene con el programa del servidor (servidor/vibra/vibra.py); Python y los modelos, en CARPETA.
const SCRIPT = fileURLToPath(new URL('../../vibra/vibra.py', import.meta.url));
const CAMPOS = ['feliz', 'triste', 'relajada', 'agresiva', 'fiesta', 'bailable', 'acustica', 'electronica', 'instrumental'];

let log = console;
let proceso = null;
let lineas = null;
let esperando = null; // resolver de la respuesta en curso
let corriendo = false;

function abrir() {
  return new Promise((listo, falla) => {
    // nice 15: si el servidor necesita la CPU (alguien escuchando, subiendo), el análisis espera.
    proceso = spawn('nice', ['-n', '15', PYTHON, SCRIPT], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, VIBRA_MODELOS: join(CARPETA, 'modelos') },
    });
    lineas = createInterface({ input: proceso.stdout });
    let arrancado = false;
    lineas.on('line', (l) => {
      let r;
      try {
        r = JSON.parse(l);
      } catch {
        return;
      }
      if (!arrancado && r.listo) {
        arrancado = true;
        return listo();
      }
      const e = esperando;
      esperando = null;
      e?.(r);
    });
    proceso.on('exit', () => {
      proceso = null;
      esperando?.({ ok: false, error: 'el analizador se cerró' });
      esperando = null;
      if (!arrancado) falla(new Error('no se pudo abrir el analizador de vibe'));
    });
  });
}

async function analizar(ruta) {
  if (!proceso) await abrir();
  return new Promise((r) => {
    esperando = r;
    proceso.stdin.write(ruta + '\n');
  });
}

async function procesar() {
  if (corriendo) return;
  corriendo = true;
  try {
    for (;;) {
      const r = await db.query(
        `SELECT c.id, c.archivo, c.almacen FROM canciones c LEFT JOIN vibras v ON v.cancion_id = c.id
          WHERE v.cancion_id IS NULL ORDER BY c.subida DESC LIMIT 1`,
      );
      const c = r.rows[0];
      if (!c) break;
      // Si ya se mudó a wifi, se trae una copia temporal solo para analizarla.
      let temporal = null;
      let res;
      try {
        if (c.almacen === 'wifi') temporal = await copiaTemporal(c.archivo);
        res = await analizar(temporal ?? join(process.env.MUSIC_DIR, c.archivo));
      } catch (e) {
        res = { ok: false, error: e.message };
      } finally {
        if (temporal) await rm(temporal, { force: true });
      }
      if (!res.ok && temporal === null && c.almacen === 'wifi') {
        // Wifi apagado: se reintenta en la próxima vuelta (no se marca como error).
        log.warn({ cancion: c.id }, 'vibe: wifi no disponible, se reintenta después');
        break;
      }
      if (res.ok) {
        await db.query(
          `INSERT INTO vibras (cancion_id, ${CAMPOS.join(', ')}) VALUES ($1, ${CAMPOS.map((_, i) => `$${i + 2}`).join(', ')})
           ON CONFLICT (cancion_id) DO NOTHING`,
          [c.id, ...CAMPOS.map((k) => res[k])],
        );
      } else {
        await db.query(`INSERT INTO vibras (cancion_id, error) VALUES ($1, $2) ON CONFLICT (cancion_id) DO NOTHING`, [c.id, String(res.error).slice(0, 200)]);
        log.warn({ cancion: c.id, error: res.error }, 'vibe: no se pudo analizar');
      }
    }
  } catch (e) {
    log.error({ err: e.message }, 'vibe: error');
  } finally {
    corriendo = false;
    // Sin nada que hacer, el analizador se cierra (libera la memoria); se vuelve a abrir con canciones nuevas.
    if (proceso && !esperando) {
      proceso.stdin.end();
      proceso = null;
    }
  }
}

export function iniciarVibra(logger) {
  log = logger;
  if (!existsSync(PYTHON) || !existsSync(SCRIPT)) {
    log.info('vibe: Essentia no está instalado en este servidor (se omite)');
    return;
  }
  setTimeout(() => void procesar(), 20_000); // un rato después de arrancar
  setInterval(() => void procesar(), 5 * 60_000).unref(); // canciones nuevas
}

/** Hay canciones nuevas: analizarlas apenas se pueda. */
export const avisarVibra = () => existsSync(PYTHON) && void procesar();
