#!/bin/bash
# Pasos de ADMINISTRADOR para el reproductor en el VPS. Los corre el dueño UNA vez:
#   sudo bash ~/reproductor/app/sistema/vps-admin.sh
#
# Qué hace (y qué NO toca):
#  - Instala ffmpeg y PostgreSQL 18 (sin crear la base del sistema: el reproductor usa la suya propia,
#    en ~/reproductor/datos, puerto 5433, solo accesible desde el mismo VPS).
#  - Deja que los programas de zuih arranquen solos al encender el VPS (linger).
#  - Agrega a nginx UN sitio nuevo: musica.empanados.io -> 127.0.0.1:3100. No modifica los demás sitios.
#  - Saca su certificado gratuito (Let's Encrypt) solo para ese subdominio.
set -euo pipefail

DOM=musica.empanados.io
USUARIO=zuih
PUERTO=3100
IP_VPS=$(curl -4 -s --max-time 5 https://api.ipify.org || true)

echo "== 1/4 ffmpeg y PostgreSQL"
apt-get update -qq
apt-get install -y -qq postgresql-common >/dev/null
# Que no cree la base "main" del sistema (no hace falta y así no ocupa el puerto 5432).
sed -i 's/^#\?\s*create_main_cluster\s*=.*/create_main_cluster = false/' /etc/postgresql-common/createcluster.conf
apt-get install -y -qq ffmpeg postgresql-18 >/dev/null
echo "   listo: $(ffmpeg -version | head -1 | cut -d' ' -f1-3), $(/usr/lib/postgresql/18/bin/postgres --version)"

echo "== 2/4 Arranque automático de los programas de $USUARIO"
loginctl enable-linger "$USUARIO"
echo "   listo"

echo "== 3/4 Sitio nuevo en nginx: $DOM"
SITIO=/etc/nginx/sites-available/$DOM
if [ ! -f "$SITIO" ]; then
  cat > "$SITIO" <<NGINX
# Reproductor de música (lo agregó vps-admin.sh). Solo este sitio; los demás no se tocan.
server {
    listen 80;
    listen [::]:80;
    server_name $DOM;

    client_max_body_size 600m;        # subir canciones (WAV grandes) desde el panel

    # Avisos en vivo (amigos, escuchar juntos): sin búfer y sin cortar la conexión.
    location /api/eventos {
        proxy_pass http://127.0.0.1:$PUERTO;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }

    location / {
        proxy_pass http://127.0.0.1:$PUERTO;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_request_buffering off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
NGINX
fi
ln -sf "$SITIO" /etc/nginx/sites-enabled/$DOM
nginx -t
systemctl reload nginx
echo "   listo"

echo "== 4/4 Certificado (candado) para $DOM"
IP_DOM=$(getent ahostsv4 "$DOM" | awk 'NR==1{print $1}' || true)
if [ -z "$IP_DOM" ] || { [ -n "$IP_VPS" ] && [ "$IP_DOM" != "$IP_VPS" ]; }; then
  echo "   FALTA: $DOM todavía no apunta a este VPS ($IP_VPS). Crea el registro DNS tipo A y vuelve a correr este script."
  exit 1
fi
certbot --nginx -d "$DOM" --non-interactive --agree-tos --redirect --register-unsafely-without-email
echo
echo "Todo listo. Avisa en el chat para que Claude termine y pruebe https://$DOM"
