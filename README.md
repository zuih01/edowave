# Edowave

Reproductor de música propio, con biblioteca compartida en un servidor y recomendaciones personales por cuenta.

*An open source music player for web, Android and Windows, with a shared library on a self-hosted server and per-account recommendations.*

## Descargar

- **Windows 10 y 11:** [musica.empanados.io/download-beta](https://musica.empanados.io/download-beta) o [Releases](https://github.com/zuih01/edowave/releases).
- **Web y iPhone (PWA):** [musica.empanados.io](https://musica.empanados.io).
- Se necesita una cuenta en el servidor (por invitación).

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/). Ver la [Code signing policy](CODE_SIGNING.md), los [términos de uso](TERMS.md) y la [política de privacidad](PRIVACY.md).

## Partes

| Carpeta | Qué es |
|---|---|
| `src/` | Interfaz (React + TypeScript + Vite). La misma para web, PWA, Android y PC |
| `servidor/` | API (Node + Fastify + PostgreSQL): catálogo, cuentas, búsqueda, radio, panel |
| `servidor-wifi/` | "Almacén": guarda y entrega audio; se conecta al servidor por un túnel SSH |
| `android/`, `android-nativo/` | App Android con Capacitor |
| `escritorio-pc/` | App de Windows con Tauri (Rust + WebView2) e instalador NSIS |
| `scripts/` | Compilar, publicar y desplegar |

## Funciones

- Cola, aleatorio, repetir, radio infinita y "me gusta".
- Ecualizador, rack de efectos estilo Pultec, nivelador de volumen, vinilo con scratch y flanger.
- Mixes diarios, Descubrimiento semanal y "Para ti", calculados con el historial de cada cuenta.
- Playlists, importación desde Spotify, amigos, perfiles y Party (escuchar en grupo).
- Modo sin conexión en web y Android.

## Desarrollo

```sh
npm install
npm run dev
```

El servidor está en `servidor/` (`npm install` y configurar un `.env` propio con la base de datos y las claves). Ningún secreto va en este repositorio.

### App de Windows

Se compila en GitHub Actions ([`.github/workflows/pc.yml`](.github/workflows/pc.yml)) a partir de una etiqueta `v*`: interfaz con Vite y app con Tauri 2 (Rust), instalador NSIS. Para compilarla a mano:

```sh
npm ci
VITE_SERVIDOR=https://musica.empanados.io VITE_PLATAFORMA=pc npx vite build --outDir dist-pc --emptyOutDir
cd escritorio-pc/app && npx tauri build --bundles nsis
```

## Licencia

[MIT](LICENSE)
