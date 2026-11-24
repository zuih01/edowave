-- Estadísticas (las ve solo el admin, en números agrupados).

-- Cada escucha guarda además: desde dónde se puso, el país (nunca la IP), el aparato y la versión de la app.
ALTER TABLE escuchas ADD COLUMN origen text;   -- accesos, busqueda, radio, playlist, album, artista, amigos, comunidad…
ALTER TABLE escuchas ADD COLUMN pais text;     -- código de 2 letras (CL, MX…), sacado de la IP sin guardarla
ALTER TABLE escuchas ADD COLUMN aparato text;  -- android-app, android-web, iphone, pc
ALTER TABLE escuchas ADD COLUMN version text;

-- Cuántas veces se MOSTRÓ cada canción (para el CTR). Solo totales por día: no se guarda a quién.
CREATE TABLE impresiones (
  dia     date    NOT NULL,
  cancion text    NOT NULL,
  origen  text    NOT NULL,
  veces   int     NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, cancion, origen)
);

-- Tiempo con la app abierta y tiempo sonando, por usuario, día y aparato (la app avisa cada minuto).
CREATE TABLE uso_app (
  usuario_id bigint NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  dia        date   NOT NULL,
  aparato    text   NOT NULL,
  version    text,
  pais       text,
  abierta_s  int    NOT NULL DEFAULT 0,  -- segundos con la app en pantalla
  sonando_s  int    NOT NULL DEFAULT 0,  -- segundos con música sonando (en pantalla o de fondo)
  PRIMARY KEY (usuario_id, dia, aparato)
);

-- Búsquedas que no encontraron nada (para saber qué canciones faltan en el servidor).
CREATE TABLE busquedas_vacias (
  texto  text        PRIMARY KEY,
  veces  int         NOT NULL DEFAULT 1,
  ultima timestamptz NOT NULL DEFAULT now()
);

-- Sesiones de "escuchar juntos".
CREATE TABLE juntos_sesiones (
  id         bigserial   PRIMARY KEY,
  anfitrion  bigint      REFERENCES usuarios(id) ON DELETE SET NULL,
  oyente     bigint      REFERENCES usuarios(id) ON DELETE SET NULL,
  inicio     timestamptz NOT NULL DEFAULT now(),
  fin        timestamptz
);

CREATE INDEX escuchas_cancion ON escuchas (cancion);
CREATE INDEX escuchas_empezo ON escuchas (empezo);
