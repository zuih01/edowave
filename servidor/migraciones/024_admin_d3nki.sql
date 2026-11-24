-- Acceso al panel para D3nki (con su misma contraseña de la app), como Criiis y Sandreus.
UPDATE usuarios SET puede_admin = true WHERE id = 25 AND nombre = 'D3nki' AND NOT es_admin;
