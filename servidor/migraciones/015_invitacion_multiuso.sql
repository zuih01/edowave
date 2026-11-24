-- Invitaciones de varios usos: no se marcan como usadas al crear una cuenta, solo cuentan cuántas veces sirvieron.
ALTER TABLE invitaciones ADD COLUMN multiuso boolean NOT NULL DEFAULT false;
ALTER TABLE invitaciones ADD COLUMN usos integer NOT NULL DEFAULT 0;
