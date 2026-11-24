# Compila la página web del reproductor y la publica en el VPS (https://musica.empanados.io).
#
#   Uso (desde la carpeta del proyecto):   powershell -ExecutionPolicy Bypass -File scripts\publicar-web.ps1
#   O con doble clic en:                     publicar-web.cmd
#
# Qué hace, en orden:
#   1. Revisa el código (TypeScript) y compila la página (Vite)              -> dist\
#   2. La sube al VPS y la cambia de una vez (la anterior queda en ~/reproductor/web-anterior por si hay que volver)
#   3. Comprueba que la página nueva responde
# No reinicia el servidor: la música que esté sonando no se corta.
# Si algo falla, dice en qué paso fue y muestra el error (también queda en dist-error.log).
# (La app de Android se publica aparte con scripts\compilar-apk.ps1 -Publicar.)

$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot
Set-Location $Raiz
$Log = Join-Path $Raiz 'dist-error.log'
$script:Paso = 'inicio'

function Paso($n, $texto) {
  $script:Paso = "$n. $texto"
  Write-Host ''
  Write-Host "== $n. $texto" -ForegroundColor Cyan
}
function Ok($texto) { Write-Host "   OK  $texto" -ForegroundColor Green }
function Correr($exe, [string[]]$argumentos, $que) {
  $ErrorActionPreference = 'Continue'
  $salida = & $exe @argumentos 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { throw "$que falló (código $LASTEXITCODE).`n$(($salida | Select-Object -Last 60) -join "`n")" }
  return $salida
}

try {
  Paso 1 'Compilar la página'
  Correr 'npx.cmd' @('tsc', '-b') 'La revisión del código (TypeScript)' | Out-Null
  Correr 'npx.cmd' @('vite', 'build') 'La compilación (Vite)' | Out-Null
  if (-not (Test-Path (Join-Path $Raiz 'dist\index.html'))) { throw 'La compilación terminó pero no hay dist\index.html' }
  Ok 'dist\ listo'

  Paso 2 'Subir al VPS'
  $paquete = Join-Path $env:TEMP 'reproductor-web.tar.gz'
  Correr 'tar.exe' @('-czf', $paquete, '-C', (Join-Path $Raiz 'dist'), '.') 'Empaquetar la página' | Out-Null
  Correr 'scp' @('-q', '-o', 'ConnectTimeout=15', $paquete, 'vps:/tmp/reproductor-web.tar.gz') 'Subir al VPS' | Out-Null
  Correr 'ssh' @('-o', 'ConnectTimeout=15', 'vps', 'set -e; R=~/reproductor; rm -rf $R/web-nueva; mkdir -p $R/web-nueva; tar -xzf /tmp/reproductor-web.tar.gz -C $R/web-nueva; rm -f /tmp/reproductor-web.tar.gz; rm -rf $R/web-anterior; [ -d $R/web ] && mv $R/web $R/web-anterior; mv $R/web-nueva $R/web') 'Cambiar la página en el VPS' | Out-Null
  Remove-Item $paquete -ErrorAction SilentlyContinue
  Ok 'subida'

  Paso 3 'Comprobar'
  $r = Invoke-WebRequest -UseBasicParsing -Uri 'https://musica.empanados.io/' -TimeoutSec 20
  if ($r.StatusCode -ne 200) { throw "La página respondió $($r.StatusCode)" }
  Ok 'https://musica.empanados.io responde'
  Remove-Item $Log -ErrorAction SilentlyContinue
  Write-Host ''
  Write-Host 'LISTO: la página nueva ya está publicada (recarga la página para verla).' -ForegroundColor Green
  exit 0
} catch {
  Write-Host ''
  Write-Host "ERROR en el paso: $script:Paso" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  "[$(Get-Date)] Paso: $script:Paso`n$($_.Exception.Message)" | Set-Content $Log -Encoding UTF8
  Write-Host "El detalle quedó en: $Log" -ForegroundColor Yellow
  exit 1
}
