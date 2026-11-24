-- Decisiones del admin sobre nombres de artista (se recuerdan para las subidas futuras):
--  - colaboración: "Alvaro Diaz & Feid – GATITAS" → "Alvaro Diaz – GATITAS (con Feid)";
--  - grupo: "Daryl Hall & John Oates", "Wisin & Yandel" quedan tal cual (no se vuelven a sugerir);
--  - nombre: "Alvaro Diaz" y "Álvaro Díaz" son el mismo → se usa uno solo (canonico).
CREATE TABLE IF NOT EXISTS artista_decisiones (
  clave      text        PRIMARY KEY,           -- el nombre sin mayúsculas ni tildes
  tipo       text        NOT NULL CHECK (tipo IN ('colaboracion', 'grupo', 'nombre', 'distintos')),
  original   text        NOT NULL,              -- cómo venía escrito
  principal  text,                              -- colaboración / nombre: el artista que queda
  invitados  text[]      NOT NULL DEFAULT '{}', -- colaboración: los que pasan a "(con …)"
  decidido   timestamptz NOT NULL DEFAULT now()
);
