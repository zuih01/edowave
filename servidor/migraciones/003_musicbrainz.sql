-- Datos desde MusicBrainz: el servidor completa lo que le falta a cada canción al subirla
-- (álbum, año, pista, géneros, portada) y guarda los créditos. Nunca pisa lo que venía en el archivo.

ALTER TABLE canciones ADD COLUMN datos_estado text NOT NULL DEFAULT 'pendiente'
  CHECK (datos_estado IN ('pendiente', 'listo', 'sin_resultado', 'error'));
ALTER TABLE canciones ADD COLUMN mb_grabacion text;               -- id de la grabación en MusicBrainz
ALTER TABLE canciones ADD COLUMN mb_completado text[] NOT NULL DEFAULT '{}';  -- qué campos vinieron de MusicBrainz
ALTER TABLE canciones ADD COLUMN creditos jsonb;                  -- intérpretes, autores, producción
ALTER TABLE canciones ADD COLUMN datos_revisado timestamptz;

CREATE INDEX canciones_datos_pendientes ON canciones (datos_estado) WHERE datos_estado = 'pendiente';
