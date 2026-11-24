-- Descripción del perfil: la escribe cada persona y la ven los demás en su perfil.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS descripcion text NOT NULL DEFAULT '';
