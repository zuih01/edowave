#!/bin/sh
# Respaldo nocturno de la base de datos del reproductor (se guardan los últimos 14 días).
# Restaurar en un servidor nuevo:  gunzip -c db-AAAA-MM-DD.sql.gz | psql "$DATABASE_URL"
set -eu
R="$HOME/reproductor"
set -a; . "$R/app/.env"; set +a
mkdir -p "$R/respaldos/db"
F="$R/respaldos/db/db-$(date +%F).sql.gz"
/usr/lib/postgresql/18/bin/pg_dump --no-owner "$DATABASE_URL" | gzip -9 > "$F.tmp"
mv "$F.tmp" "$F"
ls -1t "$R/respaldos/db"/db-*.sql.gz | tail -n +15 | xargs -r rm -f
echo "respaldo listo: $F"
