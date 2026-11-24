-- Dónde está el audio de cada canción: 'vps' (como siempre) o 'wifi' (el servidor de casa).
-- mudar = subida con wifi activo: cuando termine de analizarse se manda a wifi.
ALTER TABLE canciones
  ADD COLUMN IF NOT EXISTS almacen text NOT NULL DEFAULT 'vps',
  ADD COLUMN IF NOT EXISTS mudar boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS canciones_mudar ON canciones (subida) WHERE mudar;

-- Archivos de wifi que hay que borrar (si wifi estaba apagado cuando se borró la canción).
CREATE TABLE IF NOT EXISTS wifi_borrar (
  archivo text PRIMARY KEY,
  creado timestamptz NOT NULL DEFAULT now()
);
