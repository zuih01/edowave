# Edowave

Reproductor de música propio, con biblioteca compartida en un servidor y recomendaciones personales por cuenta.

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

## Licencia

[MIT](LICENSE)
