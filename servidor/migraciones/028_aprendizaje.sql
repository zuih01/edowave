-- Aprendizaje de las recomendaciones.
-- Qué se le recomendó a cada cuenta y por qué: al cruzarlo con sus escuchas se sabe si acertó. El panel solo ve
-- totales agrupados; el detalle por cuenta lo usa únicamente el algoritmo de esa misma cuenta.
CREATE TABLE IF NOT EXISTS reco_mostradas (
  usuario_id  bigint NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cancion     text   NOT NULL,
  lista       text   NOT NULL,   -- accesos, radio, descubrimiento, mix-diario
  motivo      text   NOT NULL,   -- parecido, colab, explora, conocida, radio, billboard
  dia         date   NOT NULL,
  PRIMARY KEY (usuario_id, cancion, lista, dia)
);
CREATE INDEX IF NOT EXISTS reco_mostradas_dia ON reco_mostradas (dia);

-- Listas personales ya armadas: se mantienen iguales durante su período (la semana o el día).
CREATE TABLE IF NOT EXISTS reco_listas (
  usuario_id  bigint NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id          text   NOT NULL,   -- descubrimiento-semanal, diario-1, diario-2, diario-3
  periodo     text   NOT NULL,   -- fecha del lunes (semanal) o del día (diario)
  titulo      text   NOT NULL,
  ids         text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (usuario_id, id)
);
