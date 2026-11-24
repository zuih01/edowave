-- Reportes de canciones: alguien avisa que una canción está mal (se corta, mala calidad, otra versión…).
-- El administrador los ve en el panel (pestaña Reportes) y decide si la reemplaza.
CREATE TABLE reportes (
  id          bigserial PRIMARY KEY,
  cancion     text        NOT NULL,
  usuario_id  bigint      REFERENCES usuarios(id) ON DELETE SET NULL,
  comentario  text        NOT NULL DEFAULT '',
  estado      text        NOT NULL DEFAULT 'pendiente',
  creado      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reportes_estado ON reportes (estado, creado DESC);
