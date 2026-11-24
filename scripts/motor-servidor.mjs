// Empaqueta el algoritmo de la app (src/reco/servidor.ts) para que lo use el servidor (Node).
// Lo corre scripts/desplegar-servidor.sh antes de subir. Uso: node scripts/motor-servidor.mjs
import { build } from 'rolldown';

await build({
  input: 'src/reco/servidor.ts',
  platform: 'node',
  output: { file: 'servidor/src/reco/motor.js', format: 'esm', banner: '// GENERADO desde src/reco/servidor.ts — no editar a mano.' },
});
console.log('✓ motor del algoritmo listo: servidor/src/reco/motor.js');
