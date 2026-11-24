#!/bin/sh
# Envía el programa del servidor (carpeta servidor/) al Ubuntu de casa y lo reinicia.
#   sh scripts/desplegar-servidor.sh
# No toca .env, certs, la base de datos ni la música (viven en el servidor).
set -eu
cd "$(dirname "$0")/.."
HOST=${SERVIDOR:-server}
node scripts/motor-servidor.mjs >/dev/null
tar -czf - --exclude=node_modules -C servidor . | ssh "$HOST" 'set -e
  A=~/reproductor/app
  mkdir -p $A
  tar -xzf - -C $A
  cd $A && npm install --omit=dev --no-audit --no-fund --loglevel=error
  chmod +x $A/sistema/respaldo.sh
  mkdir -p ~/.config/systemd/user
  cp $A/sistema/*.service $A/sistema/*.timer ~/.config/systemd/user/
  systemctl --user daemon-reload
  systemctl --user enable --now reproductor-respaldo.timer >/dev/null
  systemctl --user enable reproductor >/dev/null 2>&1
  systemctl --user restart reproductor
  sleep 2
  systemctl --user is-active reproductor'
echo "✓ servidor desplegado en $HOST"
