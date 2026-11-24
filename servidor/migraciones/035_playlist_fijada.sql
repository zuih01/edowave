-- Playlists fijadas arriba en la barra (cuándo se fijó: la primera fijada va primero). NULL = no está fijada.
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS fijada timestamptz;
