-- Integrantes de cada grupo (desde MusicBrainz), para que el buscador encuentre a Queen escribiendo
-- "Freddie Mercury". Una fila por artista tal como aparece en las canciones (también los de "A & B", "feat.").
CREATE TABLE artistas_info (
  nombre      text        PRIMARY KEY,           -- como está escrito en las canciones
  mb_artista  text,                              -- id del artista en MusicBrainz (si se encontró)
  tipo        text,                              -- Group, Person… (lo que diga MusicBrainz)
  miembros    text[]      NOT NULL DEFAULT '{}', -- integrantes (de antes y de ahora)
  estado      text        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'listo', 'sin_resultado', 'error')),
  revisado    timestamptz
);
CREATE INDEX artistas_info_pendientes ON artistas_info (estado) WHERE estado = 'pendiente';
