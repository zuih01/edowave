# Compila la app de PC (Windows 10 y 11) de Edowave, hecha en Rust con Tauri, con su instalador ESTÁNDAR (NSIS).
# TODO el proceso está aquí: no hay que compilar nada a mano.
#
#   Uso (desde la carpeta del proyecto):   powershell -ExecutionPolicy Bypass -File scripts\compilar-pc.ps1
#   O con doble clic en:                     compilar-pc.cmd
#
# Qué hace, en orden:
#   1. RESPALDO del proyecto en este PC                                   -> backups\pc-<fecha>\
#   2. Herramientas (solo la primera vez): Rust y las Build Tools de C++ de Microsoft; Tauri (npm)
#   3. Íconos de la app (a partir de public\icon.svg)
#   4. Compila la interfaz de PC (la misma app en React, conectada a https://musica.empanados.io) -> dist-pc\
#   5. Compila la app (Rust/Tauri) y su instalador estándar NSIS         -> pc\Musica-Setup-<versión>.exe
#   6. REVISIÓN CON WINDOWS DEFENDER: si marca la app o el instalador, NO se publica (y lo dice).
# Si algo falla, dice en qué paso fue y muestra el error (también queda en pc\ultimo-error.log).
#
# Con -Publicar: sube SOLA la versión (1.0.0 → 1.0.1; en betas, beta.N → beta.N+1) antes de compilar, y al final sube el instalador al VPS:
# queda para descargar en https://musica.empanados.io/download-beta y las apps instaladas muestran "Hay una versión
# nueva → Descargar" (abre esa página). Con -Version 0.9.0-beta.80 se usa esa versión exacta.
#   Uso: compilar-pc.cmd -Publicar
#
# Por qué un instalador estándar y por qué la app no se actualiza sola: el instalador casero (un .exe con otro .exe
# adentro, que se borraba con "cmd timeout & rmdir") y una app que baja y ejecuta instaladores parecen un virus
# "dropper/descargador", y Windows Defender las borraba (Trojan:Win32/Bearfoos.A!ml, betas 61 y 63-68).

param(
  # Además de compilar, sube la versión y publica el instalador en la página de descarga.
  [switch]$Publicar,
  # Versión exacta (si no, con -Publicar se suma 1 a la beta).
  [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Raiz = Split-Path -Parent $PSScriptRoot
Set-Location $Raiz
$Fecha = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$Salida = Join-Path $Raiz 'pc'
$Log = Join-Path $Salida 'ultimo-error.log'
$Pc = Join-Path $Raiz 'escritorio-pc'
New-Item -ItemType Directory -Force $Salida | Out-Null
$script:Paso = 'inicio'

function Paso($n, $texto) {
  $script:Paso = "$n. $texto"
  Write-Host ''
  Write-Host "== $n. $texto" -ForegroundColor Cyan
}
function Ok($texto) { Write-Host "   OK  $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "   !   $texto" -ForegroundColor Yellow }

# Corre un programa y falla (con sus últimas líneas) si no termina bien. Los avisos en la salida de error no
# cuentan como fallo: lo dice el código de salida.
function Correr($exe, [string[]]$argumentos, $que) {
  $ErrorActionPreference = 'Continue'
  $salida = & $exe @argumentos 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) {
    $ultimas = ($salida | Select-Object -Last 60) -join "`n"
    throw "$que falló (código $LASTEXITCODE).`n$ultimas"
  }
  return $salida
}

# ¿Están las herramientas de C++ de Microsoft (las necesita Rust para crear programas de Windows)?
function HayBuildTools {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path $vswhere)) { return $false }
  $r = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  return [bool]$r
}

try {
  $confRuta = Join-Path $Pc 'app\src-tauri\tauri.conf.json'
  $cargoRuta = Join-Path $Pc 'app\src-tauri\Cargo.toml'
  $Actual = (Get-Content $confRuta -Raw | ConvertFrom-Json).version
  if (-not $Version) {
    $Version = $Actual
    if ($Publicar) {
      # Estable: 1.0.0 → 1.0.1. Beta: beta.N → beta.N+1. (Así nunca se publica dos veces el mismo número.)
      if ($Actual -match '^(\d+\.\d+\.)(\d+)$') { $Version = $Matches[1] + ([int]$Matches[2] + 1) }
      elseif ($Actual -match '^(.*-beta\.)(\d+)$') { $Version = $Matches[1] + ([int]$Matches[2] + 1) }
      else { throw "No sé subir la versión '$Actual': usa -Version" }
    }
  }
  if ($Version -ne $Actual) {
    foreach ($f in $confRuta, $cargoRuta) {
      $t = [System.IO.File]::ReadAllText($f)
      $t = $t.Replace('"' + $Actual + '"', '"' + $Version + '"')
      [System.IO.File]::WriteAllText($f, $t, (New-Object System.Text.UTF8Encoding($false)))
    }
  }
  Write-Host "Edowave para PC — versión $Version" -ForegroundColor White

  # ---------------------------------------------------------------------------------------------------------
  Paso 1 'Respaldo del proyecto'
  $Resp = Join-Path $Raiz "backups\pc-$Fecha"
  New-Item -ItemType Directory -Force $Resp | Out-Null
  Correr 'tar.exe' @('-czf', (Join-Path $Resp 'proyecto.tar.gz'),
    '--exclude=./node_modules', '--exclude=./backups', '--exclude=./apk', '--exclude=./pc', '--exclude=./dist',
    '--exclude=./dist-android', '--exclude=./dist-pc', '--exclude=./escritorio-pc/target',
    '--exclude=./android/build', '--exclude=./android/app/build', '--exclude=./android/.gradle',
    '--exclude=./servidor/node_modules', '-C', $Raiz, '.') 'La copia del proyecto' | Out-Null
  Ok "proyecto -> backups\pc-$Fecha\proyecto.tar.gz"

  # ---------------------------------------------------------------------------------------------------------
  Paso 2 'Herramientas (Rust, Build Tools de C++ y Tauri)'
  $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
  if (-not (HayBuildTools)) {
    Aviso 'Instalando las Build Tools de C++ de Microsoft (solo la primera vez, unos minutos; Windows pedirá permiso)...'
    Correr 'winget' @('install', '--id', 'Microsoft.VisualStudio.2022.BuildTools', '-e', '--source', 'winget',
      '--accept-source-agreements', '--accept-package-agreements',
      '--override', '--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended') 'La instalación de las Build Tools' | Out-Null
    if (-not (HayBuildTools)) { throw 'Las Build Tools de C++ no quedaron instaladas. Instálalas y vuelve a correr el script.' }
  }
  Ok 'Build Tools de C++'
  if (-not (Test-Path (Join-Path $cargoBin 'cargo.exe'))) {
    Aviso 'Instalando Rust (solo la primera vez)...'
    Correr 'winget' @('install', '--id', 'Rustlang.Rustup', '-e', '--source', 'winget',
      '--accept-source-agreements', '--accept-package-agreements') 'La instalación de Rust' | Out-Null
  }
  $env:Path = "$cargoBin;$env:Path"
  Correr (Join-Path $cargoBin 'rustup.exe') @('default', 'stable') 'Preparar Rust' | Out-Null
  $rv = (Correr (Join-Path $cargoBin 'rustc.exe') @('--version') 'Revisar Rust') -join ''
  Ok $rv
  if (-not (Test-Path (Join-Path $Raiz 'node_modules\@tauri-apps\cli'))) {
    Correr 'npm.cmd' @('install', '--save-dev', '--no-audit', '--no-fund', '@tauri-apps/cli@2') 'Instalar Tauri' | Out-Null
  }
  Ok 'Tauri'

  # Clave para firmar las actualizaciones (se crea una sola vez y queda en ESTE PC; no se sube a ningún lado).
  # La app instalada solo acepta actualizaciones firmadas con ella. Si se pierde, las apps ya instaladas no
  # podrán actualizarse solas (habría que bajar el instalador a mano una vez): conviene respaldarla.
  $claves = Join-Path $env:LOCALAPPDATA 'reproductor-pc'
  $clavePriv = Join-Path $claves 'actualizaciones.key'
  New-Item -ItemType Directory -Force $claves | Out-Null
  if (-not (Test-Path $clavePriv)) {
    Aviso 'Creando la clave de las actualizaciones (solo la primera vez)...'
    Correr 'npx.cmd' @('tauri', 'signer', 'generate', '--ci', '-w', $clavePriv) 'Crear la clave de actualizaciones' | Out-Null
  }
  Ok 'clave de firma (para las apps viejas, que solo abren instaladores firmados)'

  # ---------------------------------------------------------------------------------------------------------
  Paso 3 'Íconos'
  $png = Join-Path $Pc 'icono-1024.png'
  Correr 'node' @('-e', "const{Resvg}=require('@resvg/resvg-js');const fs=require('fs');fs.writeFileSync(process.argv[1],new Resvg(fs.readFileSync('public/icon.svg','utf8'),{fitTo:{mode:'width',value:1024}}).render().asPng())", $png) 'Crear el ícono' | Out-Null
  foreach ($p in 'app') {
    Correr 'npx.cmd' @('tauri', 'icon', $png, '-o', (Join-Path $Pc "$p\src-tauri\icons")) "Íconos de $p" | Out-Null
  }
  Ok 'íconos listos'

  # ---------------------------------------------------------------------------------------------------------
  Paso 4 'Interfaz de PC (React)'
  $env:VITE_SERVIDOR = 'https://musica.empanados.io'
  $env:VITE_PLATAFORMA = 'pc'
  $env:VITE_VERSION_WEB = $Version
  try {
    Correr 'npx.cmd' @('vite', 'build', '--outDir', 'dist-pc', '--emptyOutDir') 'La compilación de la interfaz (Vite)' | Out-Null
  } finally { Remove-Item Env:\VITE_SERVIDOR, Env:\VITE_PLATAFORMA, Env:\VITE_VERSION_WEB -ErrorAction SilentlyContinue }
  Ok 'dist-pc\ listo'

  # ---------------------------------------------------------------------------------------------------------
  $env:CARGO_TARGET_DIR = Join-Path $Pc 'target'
  # Desde aquí cuenta cualquier detección de Defender (también la que pasa mientras se compila).
  $desde = (Get-Date).AddSeconds(-5)
  Paso 5 'App de PC y su instalador estándar (NSIS)'
  $bundle = Join-Path $env:CARGO_TARGET_DIR 'release\bundle\nsis'
  Remove-Item "$bundle\*" -Force -ErrorAction SilentlyContinue
  Push-Location (Join-Path $Pc 'app')
  try { Correr 'npx.cmd' @('tauri', 'build', '--bundles', 'nsis') 'La compilación de la app y del instalador' | Out-Null } finally { Pop-Location }
  $setup = Get-ChildItem $bundle -Filter '*-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $setup) { throw "No apareció el instalador en $bundle" }
  $final = Join-Path $Salida "Musica-Setup-$Version.exe"
  Copy-Item $setup.FullName $final -Force
  $mb = [math]::Round((Get-Item $final).Length / 1MB, 1)
  Ok "instalador listo ($mb MB)"

  # ---------------------------------------------------------------------------------------------------------
  Paso 6 'Revisión con Windows Defender'
  # Se copian la app y el instalador a una carpeta nueva (Defender revisa lo que se escribe) y se escanean; después
  # se espera un rato por si la nube de Microsoft decide algo. Si marca cualquiera, NO se publica.
  $prueba = Join-Path $Salida 'revision-defender'
  Remove-Item $prueba -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $prueba | Out-Null
  $app = Join-Path $env:CARGO_TARGET_DIR 'release\musica.exe'
  Copy-Item $app (Join-Path $prueba 'Edowave.exe') -Force
  Copy-Item $final (Join-Path $prueba (Split-Path $final -Leaf)) -Force
  $mp = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
  foreach ($f in (Get-ChildItem $prueba)) { & $mp -Scan -ScanType 3 -File $f.FullName -DisableRemediation | Out-Null }
  Start-Sleep -Seconds 45
  $nuestros = @($app, $final, $prueba, $bundle) | ForEach-Object { [string]$_ }
  $todas = @(Get-MpThreatDetection -ErrorAction SilentlyContinue | Where-Object {
    $_.InitialDetectionTime -gt $desde -and ($_.Resources | Where-Object { $r = $_; $nuestros | Where-Object { $r -like "*$_*" } })
  })
  # Mientras cargo (el compilador de Rust) escribe el .exe, Defender a veces lo marca y a veces no, con el MISMO
  # código: es la heurística de "un programa que crea ejecutables". Eso solo se avisa. Lo que bloquea es que marque
  # la copia de la app o el instalador (lo que se publica), o que los borre.
  $alCompilar = @($todas | Where-Object { $_.ProcessName -like '*\cargo.exe' -or $_.ProcessName -like '*\rustc.exe' })
  $marcas = @($todas | Where-Object { $alCompilar -notcontains $_ })
  if ($alCompilar.Count) { Aviso 'Defender marcó el .exe mientras el compilador lo escribía (pasa al azar al compilar; no es lo que se publica).' }
  $faltan = @($final, (Join-Path $prueba 'Edowave.exe')) | Where-Object { -not (Test-Path $_) }
  if ($marcas.Count -or $faltan) {
    $que = ($marcas | ForEach-Object { $_.Resources }) -join "`n"
    throw "Windows Defender marcó la compilación: NO se publica.`n$que`nNo la marques como permitida: avisa para revisar qué la gatilla."
  }
  Remove-Item $prueba -Recurse -Force -ErrorAction SilentlyContinue
  Ok 'Defender no la marca'

  # Firma (solo para las apps viejas, betas 57-68: abren el instalador nuevo únicamente si esta clave lo firmó).
  Remove-Item "$final.sig" -ErrorAction SilentlyContinue
  Correr 'npx.cmd' @('tauri', 'signer', 'sign', '-f', $clavePriv, $final) 'Firmar el instalador' | Out-Null
  $firma = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((Get-Content "$final.sig" -Raw).Trim()))

  # ---------------------------------------------------------------------------------------------------------
  if ($Publicar) {
    Paso 7 'Publicar en https://musica.empanados.io/download-beta'
    $archivo = Split-Path $final -Leaf
    $json = Join-Path $Salida 'version.json'
    $info = [ordered]@{ version = $Version; archivo = $archivo; mb = "$mb".Replace('.', ','); fecha = $Fecha; firma = $firma }
    [System.IO.File]::WriteAllText($json, ($info | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
    Correr 'ssh' @('-o', 'ConnectTimeout=15', 'vps', 'mkdir -p ~/reproductor/pc') 'Preparar la carpeta en el VPS' | Out-Null
    Correr 'scp' @('-q', $final, "vps:reproductor/pc/$archivo") 'Subir el instalador' | Out-Null
    # version.json va al final: la página muestra la versión nueva recién cuando el instalador ya está completo.
    Correr 'scp' @('-q', $json, 'vps:reproductor/pc/version.json') 'Subir version.json' | Out-Null
    Correr 'ssh' @('vps', 'cd ~/reproductor/pc && ls -t Musica-Setup-*.exe | tail -n +3 | xargs -r rm -f') 'Limpiar versiones viejas' | Out-Null
    Ok "publicada: https://musica.empanados.io/download-beta ($archivo)"
  }

  Write-Host ''
  Write-Host "LISTO: $final ($mb MB)" -ForegroundColor Green
  Write-Host 'Ábrelo con doble clic. Windows puede decir "Windows protegió su PC" (el programa no tiene firma de pago):'
  Write-Host 'toca "Más información" y luego "Ejecutar de todas formas".'
  exit 0
} catch {
  $msg = $_.Exception.Message
  Write-Host ''
  Write-Host "ERROR en el paso: $script:Paso" -ForegroundColor Red
  Write-Host $msg -ForegroundColor Red
  "[$(Get-Date)] Paso: $script:Paso`n$msg`n`n$($_.ScriptStackTrace)" | Set-Content $Log -Encoding UTF8
  Write-Host ''
  Write-Host "El detalle quedó en: $Log" -ForegroundColor Yellow
  exit 1
}
