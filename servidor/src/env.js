import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Carga la configuración de `.env` (al lado de esta carpeta): puerto, base de datos, carpeta de música y
 * certificado. Se importa primero, antes que todo lo demás.
 */
export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  /* sin .env: se usan las variables del sistema */
}
