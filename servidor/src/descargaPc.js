// Página https://musica.empanados.io/download-beta: descargar la app de PC (Windows 10 y 11) y, en "Más opciones", la de Android.
// No es la app (no carga el reproductor ni pide iniciar sesión): es una página sola, servida por el servidor.
// Mismo estilo que el instalador (tema "Reproductor"): fondo oscuro con el logo difuminado, botón blanco.
// `v` = el version.json que sube scripts\compilar-pc.ps1 -Publicar: { version, archivo, mb, fecha, firma } (o null).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function paginaDescargaPc(v, android) {
  const hay = v && /^[\w.-]+\.exe$/.test(v.archivo ?? '');
  const apk = android && /^[\w.-]+\.apk$/.test(android.apk ?? '') ? android.apk : null;
  // Logo de Windows (cuatro cuadros) y de Android, dibujados simples.
  const winIcono = '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M0 0h7.5v7.5H0zM8.5 0H16v7.5H8.5zM0 8.5h7.5V16H0zM8.5 8.5H16V16H8.5z"/></svg>';
  const androidIcono = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 18c0 .55.45 1 1 1h1v3.5a1.5 1.5 0 0 0 3 0V19h2v3.5a1.5 1.5 0 0 0 3 0V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8A1.5 1.5 0 0 0 2 9.5v7a1.5 1.5 0 0 0 3 0v-7A1.5 1.5 0 0 0 3.5 8zm17 0A1.5 1.5 0 0 0 19 9.5v7a1.5 1.5 0 0 0 3 0v-7A1.5 1.5 0 0 0 20.5 8zm-4.97-5.84 1.3-1.3a.5.5 0 0 0-.7-.71l-1.48 1.48A5.96 5.96 0 0 0 12 1c-.96 0-1.86.23-2.66.63L7.85.15a.5.5 0 0 0-.7.7l1.31 1.31A5.97 5.97 0 0 0 6 7h12a5.97 5.97 0 0 0-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z"/></svg>';
  const flecha = '<svg width="16" height="16" viewBox="0 0 12 12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" d="M2.5 4.5 6 8l3.5-3.5"/></svg>';
  const opciones = apk
    ? `<details class="mas">
         <summary class="btn borde solo-flecha" aria-label="Más opciones" title="Más opciones">${flecha}</summary>
         <div class="menu">
           <a href="/android/${esc(apk)}" download>${androidIcono}<span>Android<small>Archivo .apk</small></span></a>
         </div>
       </details>`
    : '';
  const boton = hay
    ? `<div class="botones">
         <a class="btn" href="/pc/${esc(v.archivo)}" download>${winIcono}Descargar para Windows</a>
         ${opciones}
       </div>
       <p class="datos">Versión ${esc(v.version)} · ${esc(v.mb)} MB</p>`
    : `<p class="datos">Todavía no hay una versión para descargar.</p>`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Descargar Edowave</title>
<link rel="icon" href="/icon.svg?v=5" type="image/svg+xml" />
<style>
  :root { color-scheme: dark; font-family: 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #fff; position: relative; isolation: isolate; overflow-x: hidden;
    background: linear-gradient(160deg, color-mix(in srgb, #5b4a8a 55%, #101010) 0%, color-mix(in srgb, #5b4a8a 22%, #0e0e0e) 55%, #0e0e0e 100%);
  }
  .fondo { position: fixed; inset: -80px; z-index: -1; background: url('/icon.svg?v=5') center / min(70vw, 700px) no-repeat; filter: blur(80px) saturate(1.3); opacity: 0.35; pointer-events: none; }
  main { width: min(440px, 100%); display: flex; flex-direction: column; align-items: center; text-align: center; gap: 20px; }
  .logo { width: 104px; height: 104px; }
  h1 { margin: 4px 0 0; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
  .beta { display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; vertical-align: 5px; background: rgba(255, 255, 255, 0.14); }
  .botones { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; height: 44px; padding: 0 24px; border-radius: 10px; background: #fff; color: #000; font: inherit; font-weight: 600; font-size: 15px; text-decoration: none; cursor: pointer; transition: transform 0.15s, background 0.15s; }
  .btn:hover { transform: scale(1.03); }
  .btn.borde { background: rgba(0, 0, 0, 0.25); color: #fff; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28); }
  .btn.borde:hover { background: rgba(255, 255, 255, 0.08); }
  .solo-flecha { width: 44px; padding: 0; }
  .mas { position: relative; }
  .mas summary { list-style: none; }
  .mas summary::-webkit-details-marker { display: none; }
  .mas[open] summary svg { transform: rotate(180deg); }
  .menu { position: absolute; top: calc(100% + 8px); right: 0; min-width: 220px; padding: 6px; border-radius: 12px; background: #1d1b22; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.1); text-align: left; z-index: 2; }
  .menu a { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; }
  .menu a:hover { background: rgba(255, 255, 255, 0.08); }
  .menu small { display: block; font-size: 12px; font-weight: 400; color: rgba(255, 255, 255, 0.55); }
  .datos { margin: -8px 0 0; font-size: 13px; color: rgba(255, 255, 255, 0.55); }
  .aviso { margin-top: 8px; padding: 14px 16px; border-radius: 12px; background: rgba(0, 0, 0, 0.25); font-size: 13px; line-height: 1.6; color: rgba(255, 255, 255, 0.7); text-align: left; }
  .aviso b { color: #fff; font-weight: 600; }
  .pie { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 16px; font-size: 12.5px; color: rgba(255, 255, 255, 0.5); }
  .pie a { color: rgba(255, 255, 255, 0.72); text-decoration: none; }
  .pie a:hover { color: #fff; text-decoration: underline; }
</style>
</head>
<body>
  <div class="fondo" aria-hidden="true"></div>
  <main>
    <img class="logo" src="/icon.svg?v=5" alt="" />
    <h1>Descargar Edowave<span class="beta">Beta</span></h1>
    ${boton}
    <div class="aviso">
      Es una versión de prueba y puede tener errores.<br />
      Si al abrir el instalador Windows dice <b>“Windows protegió su PC”</b>, toca <b>Más información</b> y luego <b>Ejecutar de todas formas</b>.<br />
      Al instalar, Windows pide permiso de administrador: Edowave se instala en Archivos de programa.
    </div>
    <nav class="pie" aria-label="Más información">
      <a href="https://github.com/zuih01/edowave" rel="noopener">Código abierto (GitHub, MIT)</a>
      <a href="https://github.com/zuih01/edowave/blob/main/CODE_SIGNING.md" rel="noopener">Code signing policy</a>
      <a href="https://github.com/zuih01/edowave/blob/main/TERMS.md" rel="noopener">Términos de uso</a>
      <a href="https://github.com/zuih01/edowave/blob/main/PRIVACY.md" rel="noopener">Privacidad</a>
    </nav>
  </main>
</body>
</html>`;
}
