-- El administrador y una cuenta normal pueden llamarse igual (por ejemplo "zuih" en el panel y "zuih" en la
-- app): son cuentas distintas. Entre cuentas normales el nombre sigue siendo único.
ALTER TABLE usuarios DROP CONSTRAINT usuarios_nombre_clave_key;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_nombre_clave_rol_key UNIQUE (nombre_clave, es_admin);
