-- Una sugerencia ahora puede ser un enlace de Spotify o YouTube (columna nueva). Cuando es un enlace o solo un
-- artista, `titulo` queda vacío ('' y no NULL: la columna ya era NOT NULL y así no se toca lo que existe).
ALTER TABLE sugerencias ADD COLUMN enlace text;
