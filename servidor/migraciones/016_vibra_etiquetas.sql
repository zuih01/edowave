-- "Vibe" de cada canción, calculada escuchando el audio con Essentia (src/analisis/vibra.js): de 0 a 1.
CREATE TABLE vibras (
  cancion_id   text PRIMARY KEY REFERENCES canciones(id) ON DELETE CASCADE,
  feliz        real,
  triste       real,
  relajada     real,
  agresiva     real,
  fiesta       real,
  bailable     real,
  acustica     real,
  electronica  real,
  instrumental real,
  error        text,          -- si no se pudo analizar (no se reintenta en cada vuelta)
  fecha        timestamptz NOT NULL DEFAULT now()
);

-- Etiquetas de Last.fm de cada canción ("chill", "sad", "jazz", "80s"…), con su peso 0–100 (src/datos/lastfm.js).
CREATE TABLE etiquetas (
  cancion_id text PRIMARY KEY REFERENCES canciones(id) ON DELETE CASCADE,
  tags       jsonb NOT NULL DEFAULT '[]',  -- [{"n": "chill", "c": 100}, ...]
  fuente     text,                          -- 'cancion' | 'artista' | 'nada'
  fecha      timestamptz NOT NULL DEFAULT now()
);
