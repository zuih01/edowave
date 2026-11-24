// Crea el certificado local para instalar la app en el iPhone por el Wi-Fi de casa (sin internet).
//
//  certs/ca.key + ca.crt        → "autoridad" local. Se instala UNA vez en el iPhone. Por seguridad SOLO puede
//                                  avalar direcciones de redes de casa (192.168.x.x, 10.x.x.x, 172.16–31.x.x) y
//                                  localhost: no sirve para hacerse pasar por ninguna página de internet.
//  certs/servidor.key + .crt     → el certificado del servidor de esta computadora (para su IP actual).
//  public/instalar/certificado.crt → copia PÚBLICA del certificado de la autoridad, para descargarlo en el iPhone.
//
// La clave privada (certs/*.key) nunca sale de esta computadora y no se comparte.
// Si cambia la IP de la computadora, vuelve a correr `npm run certificado` (la autoridad se conserva; no hay
// que reinstalar nada en el iPhone).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces, hostname } from 'node:os';

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

const ips = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
  .map((i) => i.address);

mkdirSync('certs', { recursive: true });
mkdirSync('public/instalar', { recursive: true });

// 1) Autoridad local (solo si no existe: así el iPhone no tiene que volver a instalar nada)
if (!existsSync('certs/ca.key')) {
  writeFileSync(
    'certs/ca.cnf',
    `[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no
[dn]
CN = Musica - certificado local (${hostname()})
O = Musica (solo red de casa)
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, permitted;IP:192.168.0.0/255.255.0.0, permitted;IP:10.0.0.0/255.0.0.0, permitted;IP:172.16.0.0/255.240.0.0, permitted;IP:127.0.0.0/255.0.0.0, permitted;DNS:localhost
`,
  );
  ssl('req', '-x509', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650', '-keyout', 'certs/ca.key', '-out', 'certs/ca.crt', '-config', 'certs/ca.cnf');
  console.log('✓ Autoridad local creada (certs/ca.crt)');
} else {
  console.log('✓ Autoridad local ya existía (se conserva)');
}

// 2) Certificado del servidor para las IP actuales de esta computadora (Apple exige 825 días o menos)
const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(', ');
writeFileSync(
  'certs/servidor.cnf',
  `[req]
distinguished_name = dn
prompt = no
[dn]
CN = ${ips[0] ?? 'localhost'}
[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = ${san}
authorityKeyIdentifier = keyid
subjectKeyIdentifier = hash
`,
);
ssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'certs/servidor.key', '-out', 'certs/servidor.csr', '-config', 'certs/servidor.cnf');
ssl('x509', '-req', '-in', 'certs/servidor.csr', '-CA', 'certs/ca.crt', '-CAkey', 'certs/ca.key', '-CAcreateserial', '-days', '800', '-sha256', '-extfile', 'certs/servidor.cnf', '-extensions', 'ext', '-out', 'certs/servidor.crt');

// 3) Copia pública del certificado de la autoridad para descargarlo en el iPhone
copyFileSync('certs/ca.crt', 'public/instalar/certificado.crt');

console.log(`✓ Certificado del servidor para: ${san}`);
console.log('\nAhora: npm run iphone  y en el iPhone abre  http://' + (ips[0] ?? 'IP-de-tu-PC') + ':5173/instalar/');
