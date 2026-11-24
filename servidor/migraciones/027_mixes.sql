-- Mixes de "Para ti", editables desde el panel (antes estaban escritos en el código y cambiarlos pedía reiniciar).
-- Cada mix: canciones fijas (las que agrega el admin, van primero y en su orden) + reglas automáticas opcionales
-- (años, géneros que sí / que no, categoría) para completarse solo con lo que se suba.
CREATE TABLE IF NOT EXISTS mixes (
  id             text        PRIMARY KEY,
  titulo         text        NOT NULL,
  portada        text,                                   -- archivo en biblioteca/portadas-mixes (sin portada: mosaico)
  orden          int         NOT NULL DEFAULT 0,         -- orden para quien todavía no tiene historial
  activo         boolean     NOT NULL DEFAULT true,
  tamano         int         NOT NULL DEFAULT 50,
  anio_desde     int,
  anio_hasta     int,
  generos        text[]      NOT NULL DEFAULT '{}',      -- al menos uno de estos (vacío = cualquiera)
  sin_generos    text[]      NOT NULL DEFAULT '{}',      -- ninguno de estos
  categoria      text,                                   -- 'anime' / 'meme' / 'ost-videojuego' (vacío = sin categoría especial)
  fijas          text[]      NOT NULL DEFAULT '{}',      -- ids de canciones agregadas a mano, en orden
  lista_externa  text,                                   -- 'anime-now': además, las de la playlist de Spotify que estén subidas
  actualizado    timestamptz NOT NULL DEFAULT now()
);

-- Los 4 mixes que había, tal como estaban.
INSERT INTO mixes (id, titulo, portada, orden, anio_desde, anio_hasta, generos, sin_generos, categoria, lista_externa) VALUES
  ('essential-2000s', 'Essential 2000''s', 'essential-2000s.webp', 1, 2000, 2009,
     ARRAY['pop', 'dance-pop', 'pop rock', 'teen pop', 'electropop', 'synth-pop'],
     ARRAY['reggaeton', 'reggaetón', 'latin', 'latino', 'urbano'], NULL, NULL),
  ('essential-90s', 'Essential 90''s', 'essential-90s.webp', 2, 1990, 1999, '{}', '{}', NULL, NULL),
  ('mix-reggaeton', 'Mix Reggaeton', NULL, 3, NULL, NULL,
     ARRAY['reggaeton', 'reggaetón', 'urbano latino', 'latin urban', 'dembow', 'trap latino', 'latin trap', 'perreo'], '{}', NULL, NULL),
  ('anime-now', 'Anime Now', 'anime-now.jpg', 4, NULL, NULL, '{}', '{}', 'anime', 'anime-now')
ON CONFLICT (id) DO NOTHING;
