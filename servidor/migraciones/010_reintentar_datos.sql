-- Se vuelven a buscar los datos de las canciones que MusicBrainz no encontró (ahora el título se limpia antes
-- de buscar y, si no está, se busca en iTunes / Deezer). Solo afecta a las que quedaron sin resultado o sin álbum.
UPDATE canciones SET datos_estado = 'pendiente'
 WHERE datos_estado IN ('sin_resultado', 'error') OR coalesce(album, '') = '';
