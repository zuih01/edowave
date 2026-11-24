-- Dónde va cada canción que falta en una playlist importada, para mostrarla en su lugar (en gris, "Canción no
-- disponible") y, cuando se sube, ponerla ahí mismo y no al final.
--   despues_de = clave de la canción de la playlist que va justo antes ('s:<id>')
--   ''         = va al principio
--   NULL       = al final (las importadas antes de este cambio)
ALTER TABLE playlist_faltantes ADD COLUMN despues_de text;
