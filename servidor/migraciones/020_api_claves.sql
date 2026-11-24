-- Claves para que otras aplicaciones lean la lista de canciones (GET /api/v1/canciones).
-- Solo se guarda la huella (sha256) de cada clave: la clave misma se muestra una sola vez al crearla.
CREATE TABLE api_claves (
  id         bigserial   PRIMARY KEY,
  nombre     text        NOT NULL,                -- para quién es ("Bot de Discord", "App de Sandro")
  huella     text        NOT NULL UNIQUE,         -- sha256 de la clave, en hex
  activa     boolean     NOT NULL DEFAULT true,
  creada     timestamptz NOT NULL DEFAULT now(),
  ultimo_uso timestamptz,
  usos       bigint      NOT NULL DEFAULT 0
);
