// Claves para la API de la lista de canciones (GET /api/v1/canciones).
//
//   cd ~/reproductor/app && node sistema/crear-clave-api.mjs "Bot de Discord"   → crea una clave y la muestra UNA vez
//   cd ~/reproductor/app && node sistema/crear-clave-api.mjs --lista             → claves, uso y si están activas
//   cd ~/reproductor/app && node sistema/crear-clave-api.mjs --desactivar 3      → corta el acceso de la clave 3
//   cd ~/reproductor/app && node sistema/crear-clave-api.mjs --activar 3         → se lo devuelve
//
// En la base solo queda la huella de la clave: si se pierde, se crea otra (no se puede recuperar).
import '../src/env.js';
import { randomBytes } from 'node:crypto';
import { db } from '../src/db.js';
import { huellaDe } from '../src/rutas/apiPublica.js';

const [op, arg] = process.argv.slice(2);
try {
  if (!op) {
    console.log('Uso: node sistema/crear-clave-api.mjs "Nombre de la app"  |  --lista  |  --desactivar <id>  |  --activar <id>');
  } else if (op === '--lista') {
    const r = await db.query(`SELECT id, nombre, activa, creada::date, ultimo_uso, usos FROM api_claves ORDER BY id`);
    console.table(r.rows);
  } else if (op === '--desactivar' || op === '--activar') {
    const r = await db.query(`UPDATE api_claves SET activa = $2 WHERE id = $1 RETURNING nombre`, [Number(arg), op === '--activar']);
    console.log(r.rowCount ? `Clave ${arg} (${r.rows[0].nombre}) ${op === '--activar' ? 'activada' : 'desactivada'}.` : `No existe la clave ${arg}.`);
  } else {
    const nombre = op.trim().slice(0, 80);
    const clave = 'edw_' + randomBytes(32).toString('base64url');
    const r = await db.query(`INSERT INTO api_claves (nombre, huella) VALUES ($1, $2) RETURNING id`, [nombre, huellaDe(clave)]);
    console.log(`Clave ${r.rows[0].id} para "${nombre}" (guárdala: no se vuelve a mostrar):\n\n  ${clave}\n`);
    console.log('Uso:  curl -H "X-Api-Key: <clave>" https://musica.empanados.io/api/v1/canciones');
  }
} finally {
  await db.end();
}
