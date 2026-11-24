/** Una canción de la biblioteca (solo datos; el audio vive aparte en la tabla `files`). */
export interface Track {
  id: string;
  fileName: string;
  format: string; // mp3 | wav | ogg
  size: number;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  year?: number;
  genres: string[];
  trackNo?: number;
  duration: number; // segundos
  coverId?: string; // clave en la tabla `covers`
  addedAt: number;
  /** Cuándo se buscaron sus datos en internet (para no repetir la búsqueda). */
  mbCheckedAt?: number;
  /** Qué campos se completaron desde internet (para mostrarlo en los créditos). */
  mbFilled?: string[];
  /** Grabación en MusicBrainz, para consultar créditos sin volver a buscarla. */
  mbRecordingId?: string;
  /** Canción del servidor de música (id `s:<id>`): el audio se descarga y queda guardado en el aparato. */
  server?: boolean;
  /** Integrantes del grupo (del servidor, desde MusicBrainz): "Freddie Mercury" encuentra a Queen. */
  members?: string[];
  /** Vibe (del servidor, escuchando el audio con Essentia): de 0 a 1. */
  vibe?: Vibe;
  /** Etiquetas de Last.fm ("chill", "sad", "jazz"…), con su peso 0–100. */
  tags?: { n: string; c: number }[];
  /** Qué tan bien le va con los usuarios del servidor (0–1): oyentes y retención (escuchada completa). */
  pop?: number;
  /** Estuvo en un Billboard Year-End Hot 100: un dato de popularidad histórica, no un género. */
  exito?: { anio: number; puesto: number; anios: number; valor: number };
  /**
   * Categorías especiales (las marca el admin en el panel): 'meme', 'anime', 'ost-videojuego'. Una canción con
   * categoría solo suena en la radio después de otra de la misma categoría (Wacky World no después de Sabrina
   * Carpenter).
   */
  categorias?: string[];
  /**
   * Categoría probable, aún sin confirmar en el panel (pistas confiables o el resto del artista). Solo evita que
   * la canción se cuele en radios y recomendaciones de música; los mixes de "Para ti" no la usan.
   */
  contexto?: string[];
}

export interface Vibe {
  feliz: number;
  triste: number;
  relajada: number;
  agresiva: number;
  fiesta: number;
  bailable: number;
  acustica: number;
  electronica: number;
  instrumental: number;
}

export interface Album {
  key: string;
  name: string;
  artist: string;
  year?: number;
  coverId?: string;
  tracks: Track[];
}

export interface Artist {
  name: string;
  coverId?: string;
  albums: Album[];
  tracks: Track[];
  /** Álbumes de otro artista (o de varios, como un OST) donde tiene canciones. */
  aparece?: Album[];
}

export const UNKNOWN_ARTIST = 'Artista desconocido';
export const UNKNOWN_ALBUM = 'Álbum desconocido';
