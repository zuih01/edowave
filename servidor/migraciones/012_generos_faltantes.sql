-- Las canciones sin género o sin año se vuelven a buscar (ahora también se toman de iTunes): la radio los
-- necesita para seguir el mismo estilo y la misma época.
UPDATE canciones SET datos_estado = 'pendiente' WHERE cardinality(generos) = 0 OR anio IS NULL;
