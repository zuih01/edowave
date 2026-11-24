-- Privacidad: si es false, los amigos no ven lo que escucha esta cuenta ni pueden escuchar con ella.
ALTER TABLE usuarios ADD COLUMN compartir_escucha boolean NOT NULL DEFAULT true;
