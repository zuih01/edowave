-- Amigos (con solicitud: son amigos cuando la otra persona acepta) y playlists públicas.

CREATE TABLE amistades (
  id          bigserial   PRIMARY KEY,
  de          bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,  -- quien mandó la solicitud
  para        bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estado      text        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada')),
  creada      timestamptz NOT NULL DEFAULT now(),
  aceptada    timestamptz,
  CHECK (de <> para)
);
-- Una sola relación por pareja, sin importar quién la pidió.
CREATE UNIQUE INDEX amistades_pareja ON amistades (LEAST(de, para), GREATEST(de, para));
CREATE INDEX amistades_para ON amistades (para);

-- Pública: la ven todos los usuarios ("De la comunidad") y sus amigos en su perfil.
ALTER TABLE playlists ADD COLUMN publica boolean NOT NULL DEFAULT false;
CREATE INDEX playlists_publicas ON playlists (actualizada) WHERE publica AND NOT borrada;
