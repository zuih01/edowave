#!/bin/bash
# Crea la base de datos del reproductor en el VPS (sin permisos de administrador), con:
#   - las CUENTAS de casa (admin, usuarios, invitaciones, amigos, sugerencias), para que el panel funcione;
#   - SIN canciones (el dueño las sube desde el panel).
# Uso: bash ~/reproductor/app/sistema/vps-base.sh   (se puede volver a correr: no repite lo hecho)
set -euo pipefail
B=/usr/lib/postgresql/18/bin
D=$HOME/reproductor/datos/postgres
SOCK=$HOME/reproductor/datos
set -a; . "$HOME/reproductor/app/.env"; set +a
CLAVE=$(echo "$DATABASE_URL" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')

if [ ! -f "$D/PG_VERSION" ]; then
  "$B/initdb" -D "$D" -U zuih --auth-local=peer --auth-host=scram-sha-256 -E UTF8 --locale=C.UTF-8 >/dev/null
  cat >> "$D/postgresql.conf" <<EOF
port = 5433
listen_addresses = 'localhost'
unix_socket_directories = '$SOCK'
EOF
fi
systemctl --user daemon-reload
systemctl --user enable --now reproductor-db >/dev/null 2>&1
sleep 2
systemctl --user is-active reproductor-db

ADMIN="$B/psql -h $SOCK -p 5433 -d postgres -v ON_ERROR_STOP=1 -qtA"
if [ -z "$($ADMIN -c "SELECT 1 FROM pg_roles WHERE rolname = 'reproductor'")" ]; then
  $ADMIN -c "CREATE ROLE reproductor LOGIN PASSWORD '$CLAVE'"
fi
if [ -z "$($ADMIN -c "SELECT 1 FROM pg_database WHERE datname = 'reproductor'")" ]; then
  $ADMIN -c "CREATE DATABASE reproductor OWNER reproductor"
  gunzip -c "$HOME/reproductor/respaldos/db/desde-casa.sql.gz" | "$B/psql" "$DATABASE_URL" -q -v ON_ERROR_STOP=1 >/dev/null
  # Sin canciones: se borran las de la copia (y lo que apuntaba a ellas). Las cuentas quedan.
  "$B/psql" "$DATABASE_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM canciones;
DELETE FROM valoraciones WHERE cancion LIKE 's:%';
DELETE FROM playlist_canciones WHERE cancion LIKE 's:%';
DELETE FROM escuchas WHERE cancion LIKE 's:%';
COMMIT;
SQL
fi
"$B/psql" "$DATABASE_URL" -tAc "SELECT 'usuarios: ' || (SELECT count(*) FROM usuarios) || ' · admin: ' || (SELECT string_agg(nombre, ',') FROM usuarios WHERE es_admin) || ' · canciones: ' || (SELECT count(*) FROM canciones)"
