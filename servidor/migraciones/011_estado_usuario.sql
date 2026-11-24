-- Todo lo de cada usuario vive en el servidor (no en el teléfono): así el feed, el historial, los ajustes y
-- la canción que estaba sonando son iguales en el teléfono, la tablet o el PC.
-- (Las escuchas y los "me gusta" ya tenían su tabla: `escuchas` y `valoraciones`.)
CREATE TABLE estado_usuario (
  usuario_id  bigint      PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  ajustes     jsonb       NOT NULL DEFAULT '{}',   -- ecualizador, rack, volumen, reproducción automática…
  cola        jsonb,                               -- lo que estaba sonando: cola, canción, segundo
  busquedas   jsonb       NOT NULL DEFAULT '{"queries": [], "tracks": []}',  -- búsquedas recientes
  migrado     boolean     NOT NULL DEFAULT false,  -- ya se subió lo que había guardado en el teléfono
  actualizado timestamptz NOT NULL DEFAULT now()
);
