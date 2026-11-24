-- Año ORIGINAL de cada canción (cuando salió por primera vez), no el del compilado o la reedición del archivo:
-- "Toni Basil – Hey Mickey" venía de una reedición de 2012 y es de 1982. Lo busca src/datos/anioOriginal.js.
ALTER TABLE canciones ADD COLUMN anio_subido integer;          -- el año que traía el archivo (por si acaso)
ALTER TABLE canciones ADD COLUMN anio_revisado timestamptz;    -- cuándo se buscó el año original (null = falta)
UPDATE canciones SET anio_subido = anio;
