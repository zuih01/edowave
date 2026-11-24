-- Esquema inicial del servidor del reproductor.
--
-- Una canción se identifica con una "clave" de texto:
--   s:<id>      canción del servidor (tabla `canciones`)
--   l:<huella>  canción importada en el celular del usuario (solo sus datos, el archivo no se sube)
-- Así los me gusta, las escuchas y las playlists funcionan igual para las dos.

-- ---------------- Cuentas ----------------

CREATE TABLE usuarios (
  id            bigserial PRIMARY KEY,
  nombre        text        NOT NULL,                 -- como lo escribió el usuario
  nombre_clave  text        NOT NULL UNIQUE,          -- en minúsculas, para que no se repitan
  clave_hash    text        NOT NULL,                 -- contraseña cifrada (scrypt); nunca en texto
  es_admin      boolean     NOT NULL DEFAULT false,   -- la cuenta de administrador es aparte
  creado        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invitaciones (
  id          bigserial PRIMARY KEY,
  codigo      text        NOT NULL UNIQUE,
  nota        text,                                   -- para quién es (opcional)
  creada_por  bigint      REFERENCES usuarios(id) ON DELETE SET NULL,
  creada      timestamptz NOT NULL DEFAULT now(),
  vence       timestamptz NOT NULL,
  usada_por   bigint      REFERENCES usuarios(id) ON DELETE SET NULL,
  usada       timestamptz                             -- sirve una sola vez
);

-- Un aparato con la sesión abierta (queda abierta hasta cerrar sesión o que el admin la cierre).
CREATE TABLE sesiones (
  id          bigserial PRIMARY KEY,
  usuario_id  bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  bytea       NOT NULL UNIQUE,            -- solo la huella del token, no el token
  aparato     text,
  creada      timestamptz NOT NULL DEFAULT now(),
  ultimo_uso  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sesiones_usuario ON sesiones (usuario_id);

-- ---------------- Música del servidor ----------------

CREATE TABLE canciones (
  id          text        PRIMARY KEY,
  archivo     text        NOT NULL,                   -- nombre dentro de biblioteca/musica (MP3 tal cual se subió)
  sha256      text        NOT NULL UNIQUE,            -- para avisar si se sube dos veces
  titulo      text        NOT NULL,
  artista     text        NOT NULL,
  album       text,
  artista_album text,
  anio        int,
  generos     text[]      NOT NULL DEFAULT '{}',
  pista       int,
  duracion    real        NOT NULL,
  bitrate     int,
  tamano      bigint      NOT NULL,
  portada     text,                                   -- archivo dentro de biblioteca/portadas
  subida      timestamptz NOT NULL DEFAULT now(),
  subida_por  bigint      REFERENCES usuarios(id) ON DELETE SET NULL
);

-- Análisis hecho una vez en el servidor: ritmo para el Automix, volumen para el nivelador y rasgos para el algoritmo.
CREATE TABLE analisis (
  cancion_id  text        PRIMARY KEY REFERENCES canciones(id) ON DELETE CASCADE,
  ritmo       jsonb,                                  -- BPM, golpes, puntos de mezcla
  lufs        real,
  pico        real,
  rasgos      jsonb,                                  -- energía, dinámica, brillo… (lo que usa el algoritmo)
  actualizado timestamptz NOT NULL DEFAULT now()
);

-- ---------------- Datos de cada usuario (alimentan su algoritmo en cualquier aparato) ----------------

-- La música importada en el celular: solo sus datos, para que el algoritmo la conozca en todos los aparatos.
CREATE TABLE canciones_locales (
  usuario_id  bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  clave       text        NOT NULL,                   -- l:<huella>
  titulo      text        NOT NULL,
  artista     text        NOT NULL,
  album       text,
  anio        int,
  generos     text[]      NOT NULL DEFAULT '{}',
  duracion    real,
  rasgos      jsonb,
  actualizado timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, clave)
);

-- Me gusta (1) y no me gusta (-1).
CREATE TABLE valoraciones (
  usuario_id  bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cancion     text        NOT NULL,
  valor       smallint    NOT NULL CHECK (valor IN (1, -1)),
  fecha       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, cancion)
);

-- Cada vez que sonó una canción: cuánto se escuchó, si se terminó o se saltó, qué sonó antes.
CREATE TABLE escuchas (
  id          bigserial   PRIMARY KEY,
  usuario_id  bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cliente_id  text        NOT NULL,                   -- id del aparato: si llega dos veces (sin conexión), no se duplica
  cancion     text        NOT NULL,
  empezo      timestamptz NOT NULL,
  escuchado   real        NOT NULL,
  duracion    real        NOT NULL,
  completa    boolean     NOT NULL,
  saltada     boolean     NOT NULL,
  anterior    text,
  UNIQUE (usuario_id, cliente_id)
);
CREATE INDEX escuchas_usuario_fecha ON escuchas (usuario_id, empezo);

CREATE TABLE playlists (
  id          text        PRIMARY KEY,
  usuario_id  bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre      text        NOT NULL,
  creada      timestamptz NOT NULL DEFAULT now(),
  actualizada timestamptz NOT NULL DEFAULT now(),
  reproducida timestamptz,
  borrada     boolean     NOT NULL DEFAULT false      -- se marca (no se borra) para que los otros aparatos se enteren
);
CREATE INDEX playlists_usuario ON playlists (usuario_id);

CREATE TABLE playlist_canciones (
  playlist_id text        NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  posicion    int         NOT NULL,
  cancion     text        NOT NULL,
  PRIMARY KEY (playlist_id, posicion)
);
