import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

/** Conexiones a la base de datos (PostgreSQL). */
export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });

/**
 * Aplica las migraciones pendientes (carpeta `migraciones/`, en orden de nombre), cada una en una transacción.
 * Así el esquema queda igual en cualquier servidor nuevo: basta con arrancar el programa.
 */
/** @param {string} dir */
export async function migrate(dir) {
  await db.query(`CREATE TABLE IF NOT EXISTS migraciones (nombre text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query('SELECT nombre FROM migraciones')).rows.map((r) => r.nombre));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(join(dir, f), 'utf8');
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO migraciones (nombre) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log(`migración aplicada: ${f}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw new Error(`falló la migración ${f}: ${e.message}`);
    } finally {
      c.release();
    }
  }
}
