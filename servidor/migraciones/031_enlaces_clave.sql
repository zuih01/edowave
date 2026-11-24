-- Enlaces de un solo uso para que una persona ponga su propia contraseña (los genera zuih en el panel).
-- Solo se guarda la huella (sha256) del token: quien lea la base no puede usar los enlaces.
CREATE TABLE enlaces_clave (
  token_hash bytea PRIMARY KEY,
  usuario_id bigint  NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creado     timestamptz NOT NULL DEFAULT now(),
  vence      timestamptz NOT NULL
);
CREATE INDEX enlaces_clave_usuario ON enlaces_clave (usuario_id);
