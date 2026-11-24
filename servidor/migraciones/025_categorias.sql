-- Categorías especiales de una canción: 'meme', 'anime', 'ost-videojuego' (las marca el admin en el panel).
-- Una canción con categoría solo suena en la radio después de otra de la misma categoría.
ALTER TABLE canciones ADD COLUMN IF NOT EXISTS categorias text[] NOT NULL DEFAULT '{}';

-- Sugerencias automáticas (gratis, sin IA: géneros, palabras del título/álbum, la lista Anime Now, el mismo
-- artista o álbum que otra ya marcada). Nunca se aplican solas: el admin las acepta o rechaza en el panel.
CREATE TABLE IF NOT EXISTS categoria_sugerencias (
  id         bigserial   PRIMARY KEY,
  cancion_id text        NOT NULL REFERENCES canciones(id) ON DELETE CASCADE,
  categoria  text        NOT NULL CHECK (categoria IN ('meme', 'anime', 'ost-videojuego')),
  motivo     text        NOT NULL,
  estado     text        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada', 'rechazada')),
  creada     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cancion_id, categoria)
);
CREATE INDEX IF NOT EXISTS categoria_sugerencias_pendientes ON categoria_sugerencias (creada) WHERE estado = 'pendiente';

-- Wacky World (ZAMination y la versión de Friday Night Funkin'): OST de videojuego (lo pidió el admin).
UPDATE canciones SET categorias = ARRAY['ost-videojuego'], datos_revisado = now()
 WHERE titulo ILIKE 'Wacky World%' AND NOT ('ost-videojuego' = ANY (categorias));
