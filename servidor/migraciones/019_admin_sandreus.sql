-- Sandreus también entra al panel de admin con su mismo usuario y contraseña de la app (igual que Criiis).
UPDATE usuarios SET puede_admin = true WHERE nombre_clave = 'sandreus' AND NOT es_admin;
