-- Playlists importadas de Spotify: de dónde vienen y qué canciones faltaban en el servidor.
-- Cuando se sube una canción que calza con una que falta, se agrega sola al final de la playlist y se borra de aquí.
ALTER TABLE playlists ADD COLUMN origen text;              -- enlace de Spotify (solo en las importadas)

CREATE TABLE playlist_faltantes (
  id          bigserial   PRIMARY KEY,
  playlist_id text        NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  posicion    int         NOT NULL,                       -- lugar en la playlist de Spotify (para mostrarlas en orden)
  spotify_id  text,
  titulo      text        NOT NULL,
  artistas    text[]      NOT NULL DEFAULT '{}',
  duracion    int,                                        -- segundos
  creada      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playlist_faltantes_playlist ON playlist_faltantes (playlist_id, posicion);
