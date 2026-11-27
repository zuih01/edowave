-- Letras de las canciones (vienen de LRCLIB y se guardan una sola vez por canción).
--   estado: sincronizada (con tiempos), normal (sin tiempos), instrumental, sin_letra (no se encontró) o error.
CREATE TABLE IF NOT EXISTS letras (
  cancion     text        PRIMARY KEY REFERENCES canciones(id) ON DELETE CASCADE,
  estado      text        NOT NULL,
  lrc         text,
  texto       text,
  desfase_ms  int         NOT NULL DEFAULT 0,
  lrclib_id   bigint,
  buscada     timestamptz NOT NULL DEFAULT now(),
  editada_por bigint      REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS letras_buscada ON letras (buscada);
