-- Recomendaciones de YouTube Music (sin sesión, iguales para todos): por cada canción, su radio y "Relacionado".
-- Se guardan por nombre (artista y título) y se cruzan con el catálogo al cargarlas: así una canción que se suba
-- después también cuenta.
--   estado: listo, sin_video (YouTube Music no la encontró) o error.
CREATE TABLE IF NOT EXISTS ytm_relaciones (
  cancion   text        PRIMARY KEY REFERENCES canciones(id) ON DELETE CASCADE,
  estado    text        NOT NULL,
  video_id  text,
  radio     jsonb       NOT NULL DEFAULT '[]',
  similares jsonb       NOT NULL DEFAULT '[]',
  artistas  jsonb       NOT NULL DEFAULT '[]',
  buscada   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ytm_relaciones_buscada ON ytm_relaciones (buscada);

-- Chequeo de la API (uno por hora y cada falla al usarla), para la pestaña Bot del panel.
CREATE TABLE IF NOT EXISTS ytm_salud (
  hora    timestamptz PRIMARY KEY DEFAULT now(),
  ok      boolean     NOT NULL,
  pruebas jsonb       NOT NULL DEFAULT '[]'
);
