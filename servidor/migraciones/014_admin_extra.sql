-- Una cuenta NORMAL (de la app) también puede entrar al panel de admin con su mismo usuario y contraseña,
-- sin perder la app. (La cuenta de administrador principal sigue siendo la de es_admin.)
ALTER TABLE usuarios ADD COLUMN puede_admin boolean NOT NULL DEFAULT false;
UPDATE usuarios SET puede_admin = true WHERE nombre_clave = 'criiis' AND NOT es_admin;
