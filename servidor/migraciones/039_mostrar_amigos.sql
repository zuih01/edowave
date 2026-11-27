-- Privacidad: mostrar (o no) mis amigos en mi perfil. Por defecto se muestran, como antes.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mostrar_amigos boolean NOT NULL DEFAULT true;
