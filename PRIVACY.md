# Política de privacidad de Edowave

*Última actualización: 27 de noviembre de 2026.* · [English below](#privacy-policy-english)

Edowave es un reproductor de música de código abierto. La app (web, Android y Windows) se conecta a **un solo servidor**: `musica.empanados.io`, que administra el responsable del proyecto. La app no tiene publicidad, no usa servicios de analítica de terceros y no vende ni comparte datos.

## Qué datos guarda el servidor

| Dato | Para qué |
|---|---|
| Nombre de usuario y contraseña (guardada con scrypt, nunca en texto) | Iniciar sesión |
| Canciones escuchadas (cuál, cuándo, si se terminó o se saltó), "me gusta" y playlists | Historial, recomendaciones, mixes y la radio de tu cuenta |
| Búsquedas recientes y ajustes (tema, reproducción automática, rack…) | Que sean iguales en todos tus dispositivos. El ecualizador se guarda solo en cada dispositivo |
| Foto, banner, descripción, color del perfil y lista de amigos | Tu perfil y lo social |
| Lo que estás escuchando ahora | Mostrárselo a tus amigos y "Escuchar juntos". Se apaga en **Configuración → Privacidad → Compartir lo que escucho** |
| Tipo de dispositivo y versión de la app, cada minuto con la app abierta | Saber qué versiones se usan y si la app está abierta (para la Party y los amigos) |
| Dirección IP | Bloquear intentos de entrar con contraseñas equivocadas y contar visitas por país. No se guarda junto a tu historial |

## Otros servicios

- **Cloudflare** transporta el tráfico entre la app y el servidor.
- El **servidor** (no tu dispositivo) busca letras, carátulas y datos de las canciones en LRCLIB, MusicBrainz, iTunes, Deezer, YouTube Music y páginas públicas de Spotify. Solo envía el nombre de la canción y del artista, nunca datos de tu cuenta.
- **Discord** (solo app de Windows): muestra en tu estado de Discord la canción que suena únicamente si lo activas en **Configuración → Este PC**.
- La app de Windows revisa si hay versiones nuevas leyendo `https://musica.empanados.io/pc/version.json`. No descarga ni ejecuta nada por su cuenta.

## Lo que queda en tu dispositivo

La sesión, una copia de tus playlists, hasta 3 canciones temporales (la que suena, la anterior y la siguiente) y, en web y Android, las canciones que descargues. Al cerrar sesión se borran.

## Borrar tus datos

Pide al administrador del servidor que borre tu cuenta: se borran tu historial, "me gusta", playlists y perfil. Contacto: abre un *issue* en [github.com/zuih01/edowave](https://github.com/zuih01/edowave/issues).

---

# Privacy policy (English)

Edowave is an open source music player. The app (web, Android and Windows) connects to **a single server**, `musica.empanados.io`, run by the project maintainer. There are no ads, no third-party analytics, and no data is sold or shared.

**Stored on the server:** username and password (scrypt hash); listening history (which song, when, finished or skipped), likes and playlists — for history and recommendations; recent searches and settings (the equalizer stays on each device); profile photo, banner, description, color and friends; what you are playing now, shown to friends (can be turned off in *Settings → Privacy → Share what I listen to*); device type and app version every minute while the app is open; IP address, to block password guessing and count visits by country (not stored with your history).

**Other services:** Cloudflare carries the traffic. The server (not your device) looks up lyrics, artwork and song data on LRCLIB, MusicBrainz, iTunes, Deezer, YouTube Music and public Spotify pages using only song and artist names. Discord Rich Presence (Windows app) is used only if you turn it on. The Windows app checks for new versions by reading a JSON file; it never downloads or runs installers by itself.

**On your device:** your session, a copy of your playlists, up to 3 temporary songs and (web/Android) songs you download. They are removed when you sign out.

**Deleting your data:** ask the server administrator to delete your account by opening an issue at [github.com/zuih01/edowave](https://github.com/zuih01/edowave/issues).
