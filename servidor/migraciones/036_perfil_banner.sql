-- Banner del perfil (opcional): archivo dentro de biblioteca/banners (JPG 1500x500 o GIF 960x320). Sin banner, se ve el color del perfil.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS banner text;
