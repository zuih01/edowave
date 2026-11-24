-- Estilo del perfil que elige cada persona: color principal y fondo animado ({"color": "#ff4e6a", "fondo": "particulas"}).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil_estilo jsonb NOT NULL DEFAULT '{}'::jsonb;
