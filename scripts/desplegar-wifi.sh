#!/bin/sh
# Envía el almacén de audio al servidor "wifi" (casa) y lo reinicia junto con el túnel hacia el VPS.
#   sh scripts/desplegar-wifi.sh
# No toca la música guardada ni la clave (~/reproductor/almacen/.clave).
set -eu
cd "$(dirname "$0")/.."
HOST=${WIFI:-server}
tar -czf - -C servidor-wifi . | ssh "$HOST" 'set -e
  A=~/reproductor/almacen
  mkdir -p $A ~/.config/systemd/user
  tar -xzf - -C $A
  cp $A/*.service ~/.config/systemd/user/
  systemctl --user daemon-reload
  systemctl --user enable reproductor-almacen reproductor-tunel >/dev/null 2>&1
  systemctl --user restart reproductor-almacen reproductor-tunel
  sleep 3
  systemctl --user is-active reproductor-almacen reproductor-tunel'
echo "✓ almacén desplegado en $HOST"
