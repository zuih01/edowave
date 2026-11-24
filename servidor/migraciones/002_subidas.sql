-- Subida de música desde el panel de admin y estado del análisis de cada canción.

ALTER TABLE canciones ADD COLUMN nombre_original text;  -- nombre del archivo como se subió

ALTER TABLE analisis ADD COLUMN estado text NOT NULL DEFAULT 'pendiente'
  CHECK (estado IN ('pendiente', 'listo', 'error'));
ALTER TABLE analisis ADD COLUMN error text;
ALTER TABLE analisis ALTER COLUMN actualizado DROP NOT NULL;

CREATE INDEX analisis_pendientes ON analisis (estado) WHERE estado = 'pendiente';
