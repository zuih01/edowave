-- Canciones que los usuarios piden que se suban al servidor (las ve el admin en su panel).
CREATE TABLE sugerencias (
  id          bigserial   PRIMARY KEY,
  usuario_id  bigint      REFERENCES usuarios(id) ON DELETE SET NULL,
  titulo      text        NOT NULL,
  artista     text        NOT NULL,
  creada      timestamptz NOT NULL DEFAULT now(),
  estado      text        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'subida', 'descartada'))
);
CREATE INDEX sugerencias_estado ON sugerencias (estado, creada DESC);
