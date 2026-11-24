// Crea el certificado HTTPS del servidor de música (el Ubuntu de casa), firmado con la misma autoridad local
// que ya está instalada en el iPhone: así la app se conecta sin avisos de seguridad.
//
//   node scripts/certificado-servidor.mjs 192.168.1.5
//
// Deja certs/servidor-musica/servidor.key + servidor.crt. Esos dos SÍ van al servidor (son suyos).
// La clave de la autoridad (certs/ca.key) nunca sale de esta computadora.
// Si cambias de servidor o de IP: vuelve a correrlo con la IP nueva (no hay que reinstalar nada en el iPhone).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const ips = process.argv.slice(2);
if (!ips.length || ips.some((ip) => !/^\d+\.\d+\.\d+\.\d+$/.test(ip))) {
  console.error('Uso: node scripts/certificado-servidor.mjs <IP del servidor> [otra IP...]');
  process.exit(1);
}
if (!existsSync('certs/ca.key')) {
  console.error('Falta la autoridad local (certs/ca.key). Corre primero: npm run certificado');
  process.exit(1);
}
const OPENSSL = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'].find((p) => {
  try {
    execFileSync(p, ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (!OPENSSL) {
  console.error('No encontré openssl (viene con Git para Windows).');
  process.exit(1);
}
const ssl = (...args) => execFileSync(OPENSSL, args, { stdio: 'inherit' });

const dir = 'certs/servidor-musica';
mkdirSync(dir, { recursive: true });
const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(', ');
writeFileSync(
  `${dir}/servidor.cnf`,
  `[req]
distinguished_name = dn
prompt = no
[dn]
CN = ${ips[0]}
O = Musica - servidor
[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = ${san}
authorityKeyIdentifier = keyid
subjectKeyIdentifier = hash
`,
);
ssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/servidor.key`, '-out', `${dir}/servidor.csr`, '-config', `${dir}/servidor.cnf`);
ssl('x509', '-req', '-in', `${dir}/servidor.csr`, '-CA', 'certs/ca.crt', '-CAkey', 'certs/ca.key', '-CAcreateserial', '-days', '800', '-sha256', '-extfile', `${dir}/servidor.cnf`, '-extensions', 'ext', '-out', `${dir}/servidor.crt`);
console.log(`✓ Certificado del servidor de música para: ${san}  (vence en 800 días)`);
