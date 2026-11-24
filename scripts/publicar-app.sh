#!/bin/sh
# Compila la app y la publica en el servidor de casa: queda en https://<servidor>:8443/
#   sh scripts/publicar-app.sh
# Se cambia de una vez (la versión anterior queda en ~/reproductor/web-anterior por si hay que volver).
set -eu
cd "$(dirname "$0")/.."
HOST=${SERVIDOR:-server}
npm run build
tar -czf - -C dist . | ssh "$HOST" 'set -e
  R=~/reproductor
  rm -rf $R/web-nueva && mkdir -p $R/web-nueva
  tar -xzf - -C $R/web-nueva
  rm -rf $R/web-anterior
  [ -d $R/web ] && mv $R/web $R/web-anterior
  mv $R/web-nueva $R/web
  systemctl --user restart reproductor
  sleep 2
  systemctl --user is-active reproductor'
echo "✓ app publicada en $HOST"
