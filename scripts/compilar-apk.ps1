# Compila la app de Android (.apk) del reproductor.
#
#   Uso (desde la carpeta del proyecto):   powershell -ExecutionPolicy Bypass -File scripts\compilar-apk.ps1
#   O con doble clic en:                     compilar-apk.cmd
#
# Qué hace, en orden:
#   1. RESPALDO en este PC: copia del proyecto + copia de la base de datos del VPS  -> backups\apk-<fecha>\
#   2. Herramientas de Android (solo la primera vez): Java 21 y el Android SDK      -> %LOCALAPPDATA%\reproductor-android
#   3. Prepara el proyecto Android (Capacitor)
#   4. Compila el .apk                                                               -> apk\Musica-<fecha>.apk
# Si algo falla, dice en qué paso fue y muestra el error completo (también queda en apk\ultimo-error.log).
#
# Con -Publicar, además sube la versión al VPS (/android/) y los teléfonos se actualizan solos:
#   - si solo cambió la interfaz, la bajan en silencio y la usan la próxima vez que abran la app;
#   - si cambió la parte de Android (android-nativo\, permisos…), les aparece "Hay una versión nueva".
#   Uso: powershell -ExecutionPolicy Bypass -File scripts\compilar-apk.ps1 -Publicar

param(
  # Además de compilar, sube la versión al VPS: la app instalada en los teléfonos se actualiza sola.
  [switch]$Publicar
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # sin barra de progreso (descargas mucho más rápidas)

$Raiz = Split-Path -Parent $PSScriptRoot
Set-Location $Raiz
$Fecha = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$Herr = Join-Path $env:LOCALAPPDATA 'reproductor-android'
$Jdk = Join-Path $Herr 'jdk-21'
$Sdk = Join-Path $Herr 'sdk'
$Salida = Join-Path $Raiz 'apk'
$Log = Join-Path $Salida 'ultimo-error.log'
New-Item -ItemType Directory -Force $Salida, $Herr | Out-Null
$script:Paso = 'inicio'

function Paso($n, $texto) {
  $script:Paso = "$n. $texto"
  Write-Host ''
  Write-Host "== $n. $texto" -ForegroundColor Cyan
}
function Ok($texto) { Write-Host "   OK  $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "   !   $texto" -ForegroundColor Yellow }

# Corre un programa y falla (con su salida) si no termina bien.
function Correr($exe, [string[]]$argumentos, $que) {
  # Muchos programas escriben avisos en la salida de error aunque todo vaya bien: aquí NO se toman como fallo
  # (en PowerShell 5 lo serían); el fallo lo dice su código de salida.
  $ErrorActionPreference = 'Continue'
  $salida = & $exe @argumentos 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) {
    $ultimas = ($salida | Select-Object -Last 60) -join "`n"
    throw "$que falló (código $LASTEXITCODE).`n$ultimas"
  }
  return $salida
}

# Guarda texto en UTF-8 SIN la marca BOM (PowerShell 5 la pone y Gradle no la acepta).
function Escribir($ruta, $texto) {
  [System.IO.File]::WriteAllText($ruta, $texto.TrimStart([char]0xFEFF), (New-Object System.Text.UTF8Encoding($false)))
}

function Descargar($url, $archivo) {
  $ErrorActionPreference = 'Continue'
  & curl.exe -L -s -S --fail --retry 3 -o $archivo $url 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $archivo)) { throw "No se pudo descargar $url (revisa tu internet)." }
}

try {
  # ---------------------------------------------------------------------------------------------------------
  Paso 1 'Respaldo (proyecto y base de datos del VPS)'
  $Resp = Join-Path $Raiz "backups\apk-$Fecha"
  New-Item -ItemType Directory -Force $Resp | Out-Null
  Correr 'tar.exe' @('-czf', (Join-Path $Resp 'proyecto.tar.gz'),
    '--exclude=./node_modules', '--exclude=./backups', '--exclude=./apk', '--exclude=./dist',
    '--exclude=./android/build', '--exclude=./android/app/build', '--exclude=./android/.gradle',
    '--exclude=./servidor/node_modules', '-C', $Raiz, '.') 'La copia del proyecto' | Out-Null
  Ok "proyecto -> backups\apk-$Fecha\proyecto.tar.gz"
  try {
    $remoto = "/tmp/respaldo-apk-$Fecha.sql.gz"
    Correr 'ssh' @('-o', 'ConnectTimeout=15', 'vps',
      "/usr/lib/postgresql/18/bin/pg_dump `"`$(grep ^DATABASE_URL ~/reproductor/app/.env | cut -d= -f2-)`" | gzip > $remoto") 'La copia de la base de datos' | Out-Null
    Correr 'scp' @('-q', "vps:$remoto", (Join-Path $Resp 'base-de-datos.sql.gz')) 'La descarga de la base de datos' | Out-Null
    Correr 'ssh' @('vps', "rm -f $remoto") 'Borrar la copia temporal' | Out-Null
    Ok "base de datos -> backups\apk-$Fecha\base-de-datos.sql.gz"
  } catch {
    Aviso "No se pudo copiar la base de datos del VPS (se sigue igual): $($_.Exception.Message.Split("`n")[0])"
  }

  # ---------------------------------------------------------------------------------------------------------
  Paso 2 'Herramientas de Android'
  if (-not (Test-Path (Join-Path $Jdk 'bin\java.exe'))) {
    Write-Host '   Descargando Java 21 (una sola vez, ~200 MB)...'
    $zip = Join-Path $Herr 'jdk.zip'
    Descargar 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse' $zip
    $tmp = Join-Path $Herr 'jdk-tmp'
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Expand-Archive $zip $tmp
    Move-Item (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName $Jdk
    Remove-Item -Recurse -Force $tmp, $zip
  }
  Ok 'Java 21'
  $env:JAVA_HOME = $Jdk
  $env:ANDROID_HOME = $Sdk
  $env:ANDROID_SDK_ROOT = $Sdk
  $env:Path = "$Jdk\bin;$Sdk\platform-tools;$env:Path"

  $sdkmanager = Join-Path $Sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
  if (-not (Test-Path $sdkmanager)) {
    Write-Host '   Descargando las herramientas de Android (una sola vez)...'
    $zip = Join-Path $Herr 'cmdline-tools.zip'
    Descargar 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' $zip
    $tmp = Join-Path $Herr 'cmd-tmp'
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Expand-Archive $zip $tmp
    New-Item -ItemType Directory -Force (Join-Path $Sdk 'cmdline-tools') | Out-Null
    Move-Item (Join-Path $tmp 'cmdline-tools') (Join-Path $Sdk 'cmdline-tools\latest')
    Remove-Item -Recurse -Force $tmp, $zip
  }
  # Licencias de Google del SDK: se aceptan para poder compilar (se responde "y" a todas, por cmd).
  if (-not (Test-Path (Join-Path $Sdk 'licenses\android-sdk-license'))) {
    Write-Host '   Aceptando las licencias del Android SDK...'
    $ErrorActionPreference = 'Continue'
    # Un .cmd temporal con un archivo de respuestas "y" (pasarlo directo desde PowerShell no funciona).
    $si = Join-Path $Herr 'si.txt'
    $bat = Join-Path $Herr 'licencias.cmd'
    Set-Content $si ((1..40 | ForEach-Object { 'y' }) -join "`r`n") -Encoding ASCII
    Set-Content $bat "@call `"$sdkmanager`" --sdk_root=`"$Sdk`" --licenses < `"$si`"" -Encoding ASCII
    & cmd.exe /c $bat 2>&1 | Out-Null
    Remove-Item $si, $bat -ErrorAction SilentlyContinue
    $ErrorActionPreference = 'Stop'
    if (-not (Test-Path (Join-Path $Sdk 'licenses\android-sdk-license'))) { throw 'No se pudieron aceptar las licencias del Android SDK.' }
  }
  if (-not (Test-Path (Join-Path $Sdk 'build-tools\34.0.0')) -or -not (Test-Path (Join-Path $Sdk 'platforms\android-35'))) {
    Write-Host '   Instalando Android SDK 35 (una sola vez, ~1 GB, tarda unos minutos)...'
    Correr $sdkmanager @("--sdk_root=$Sdk", 'platform-tools', 'platforms;android-35', 'build-tools;35.0.0', 'build-tools;34.0.0') 'La instalación del Android SDK' | Out-Null
    if (-not (Test-Path (Join-Path $Sdk 'platforms\android-35'))) { throw 'El Android SDK no quedó instalado (revisa tu internet y vuelve a correr el script).' }
  }
  Ok 'Android SDK 35'

  # ---------------------------------------------------------------------------------------------------------
  Paso 3 'Proyecto Android'
  if (-not (Test-Path (Join-Path $Raiz 'node_modules\@capacitor\android'))) {
    Correr 'npm.cmd' @('install', '--no-audit', '--no-fund') 'npm install' | Out-Null
  }
  # La interfaz va DENTRO del .apk (no abre ninguna página): se compila aquí, apuntando al servidor.
  Write-Host '   Compilando la interfaz de la app...'
  Correr 'npx.cmd' @('tsc', '-b') 'La revisión del código de la app (TypeScript)' | Out-Null
  $env:VITE_SERVIDOR = 'https://musica.empanados.io'
  # Versiones: la de la interfaz es la fecha; la de Android es una huella de todo lo nativo (si no cambia, los
  # teléfonos solo bajan la interfaz nueva; si cambia, necesitan instalar el .apk nuevo).
  $nativos = @(Get-ChildItem (Join-Path $Raiz 'android-nativo') -Filter *.java | Sort-Object Name | ForEach-Object { $_.FullName }) +
    @((Join-Path $Raiz 'capacitor.config.json'), $PSCommandPath)
  $sha = [System.Security.Cryptography.SHA1]::Create()
  $todo = ($nativos | ForEach-Object { [System.IO.File]::ReadAllText($_) }) -join "`n"
  # Los plugins nativos de Capacitor (micrófono, barra de estado…) también son parte nativa: si se agrega uno,
  # los teléfonos tienen que instalar el .apk nuevo (bajar solo la interfaz no alcanza).
  $paquete = Get-Content (Join-Path $Raiz 'package.json') -Raw | ConvertFrom-Json
  $todo += "`n" + (($paquete.dependencies.PSObject.Properties | Where-Object { $_.Name -like '@capacitor*' } | Sort-Object Name | ForEach-Object { "$($_.Name)@$($_.Value)" }) -join "`n")
  $VersionNativa = (($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($todo)) | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 12)
  $env:VITE_VERSION_WEB = $Fecha
  $env:VITE_VERSION_NATIVA = $VersionNativa
  try {
    Correr 'npx.cmd' @('vite', 'build', '--outDir', 'dist-android', '--emptyOutDir') 'La compilación de la interfaz (Vite)' | Out-Null
  } finally { Remove-Item Env:\VITE_SERVIDOR, Env:\VITE_VERSION_WEB, Env:\VITE_VERSION_NATIVA -ErrorAction SilentlyContinue }

  $nueva = -not (Test-Path (Join-Path $Raiz 'android\app'))
  if ($nueva) { Correr 'npx.cmd' @('cap', 'add', 'android') 'Crear el proyecto Android' | Out-Null }
  Correr 'npx.cmd' @('cap', 'sync', 'android') 'Sincronizar el proyecto Android' | Out-Null

  # Código nativo propio (música de fondo, notificación, pantalla de bloqueo): android-nativo\ -> proyecto.
  $java = Join-Path $Raiz 'android\app\src\main\java\io\empanados\musica'
  New-Item -ItemType Directory -Force $java | Out-Null
  Copy-Item (Join-Path $Raiz 'android-nativo\*.java') $java -Force

  $manifest = Join-Path $Raiz 'android\app\src\main\AndroidManifest.xml'
  $m = Get-Content $manifest -Raw
  # Siempre en vertical, como app de celular.
  if ($m -notmatch 'screenOrientation') { $m = $m -replace '<activity', '<activity android:screenOrientation="portrait"' }
  # Permisos para seguir sonando con la pantalla apagada y mostrar los controles.
  foreach ($perm in 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'POST_NOTIFICATIONS', 'WAKE_LOCK', 'REQUEST_INSTALL_PACKAGES') {
    if ($m -notmatch "android.permission.$perm`"") {
      $m = $m -replace '</manifest>', "    <uses-permission android:name=`"android.permission.$perm`" />`n</manifest>"
    }
  }
  if ($m -notmatch 'ReproduccionService') {
    $m = $m -replace '</application>', "    <service android:name=`".ReproduccionService`" android:exported=`"false`" android:foregroundServiceType=`"mediaPlayback`" />`n    </application>"
  }
  Escribir $manifest $m

  $gradle = Join-Path $Raiz 'android\app\build.gradle'
  $g = Get-Content $gradle -Raw
  if ($g -notmatch 'androidx.media:media') {
    $g = $g -replace "implementation project\(':capacitor-android'\)", "implementation project(':capacitor-android')`n    implementation 'androidx.media:media:1.7.0'"
  }
  # Número de versión nuevo en cada compilación (así Android acepta el .apk como actualización y la app deja
  # de usar una interfaz bajada antes).
  $codigo = [int][math]::Floor(((Get-Date) - (Get-Date '2026-01-01')).TotalMinutes)
  $g = $g -replace 'versionCode \d+', "versionCode $codigo" -replace 'versionName "[^"]*"', "versionName `"$Fecha`""
  Escribir $gradle $g
  # Ícono de la app (el mismo del reproductor).
  $icono = Join-Path $Raiz 'public\icons\icon-512.png'
  $res = Join-Path $Raiz 'android\app\src\main\res'
  Remove-Item -Recurse -Force (Join-Path $res 'mipmap-anydpi-v26') -ErrorAction SilentlyContinue
  Get-ChildItem $res -Directory -Filter 'mipmap-*' | ForEach-Object {
    foreach ($n in 'ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png') { Copy-Item $icono (Join-Path $_.FullName $n) -Force }
  }
  Set-Content (Join-Path $Raiz 'android\local.properties') ("sdk.dir=" + ($Sdk -replace '\\', '\\')) -Encoding ASCII
  Ok 'listo'

  # ---------------------------------------------------------------------------------------------------------
  Paso 4 'Compilar el .apk (la primera vez tarda más: baja Gradle)'
  Push-Location (Join-Path $Raiz 'android')
  try {
    Correr '.\gradlew.bat' @('assembleDebug', '--no-daemon', '-q') 'La compilación (Gradle)' | Out-Null
  } finally { Pop-Location }
  $apk = Join-Path $Raiz 'android\app\build\outputs\apk\debug\app-debug.apk'
  if (-not (Test-Path $apk)) { throw "Gradle terminó pero no apareció el .apk en $apk" }
  $final = Join-Path $Salida "Musica-$Fecha.apk"
  Copy-Item $apk $final -Force
  Remove-Item $Log -ErrorAction SilentlyContinue
  $mb = [math]::Round((Get-Item $final).Length / 1MB, 1)

  Write-Host ''
  if ($Publicar) {
    Paso 5 'Publicar en el servidor (los teléfonos se actualizan solos)'
    $pub = Join-Path $Salida "publicar-$Fecha"
    New-Item -ItemType Directory -Force $pub | Out-Null
    $zip = "interfaz-$Fecha.zip"
    # tar.exe arma el .zip con "/" en las rutas (Compress-Archive de PowerShell 5 pone "\" y Android no lo entiende).
    Correr 'tar.exe' @('-a', '-c', '-f', (Join-Path $pub $zip), '-C', (Join-Path $Raiz 'dist-android'), '.') 'Armar la interfaz (.zip)' | Out-Null
    Copy-Item $final (Join-Path $pub "Musica-$Fecha.apk")
    $version = @{ web = $Fecha; nativa = $VersionNativa; interfaz = $zip; apk = "Musica-$Fecha.apk" } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText((Join-Path $pub 'version.json'), $version, (New-Object System.Text.UTF8Encoding($false)))
    Correr 'ssh' @('-o', 'ConnectTimeout=15', 'vps', 'mkdir -p ~/reproductor/android') 'Preparar la carpeta en el VPS' | Out-Null
    # Primero los archivos y al final version.json: así nadie ve una versión a medio subir.
    Correr 'scp' @('-q', (Join-Path $pub $zip), (Join-Path $pub "Musica-$Fecha.apk"), 'vps:reproductor/android/') 'Subir la versión al VPS' | Out-Null
    Correr 'scp' @('-q', (Join-Path $pub 'version.json'), 'vps:reproductor/android/version.json') 'Subir version.json' | Out-Null
    # Se dejan solo las 2 últimas versiones en el VPS.
    Correr 'ssh' @('vps', 'cd ~/reproductor/android && ls -t interfaz-*.zip | tail -n +3 | xargs -r rm -f; ls -t Musica-*.apk | tail -n +3 | xargs -r rm -f') 'Limpiar versiones viejas' | Out-Null
    Remove-Item -Recurse -Force $pub
    Ok "publicada la versión $Fecha (Android $VersionNativa)"
  }

  Write-Host "LISTO: $final ($mb MB)" -ForegroundColor Green
  Write-Host 'Pásalo al teléfono e instálalo (Android pedirá permitir "instalar apps de origen desconocido").'
  exit 0
} catch {
  $msg = $_.Exception.Message
  Write-Host ''
  Write-Host "ERROR en el paso: $script:Paso" -ForegroundColor Red
  Write-Host $msg -ForegroundColor Red
  "[$(Get-Date)] Paso: $script:Paso`n$msg`n`n$($_.ScriptStackTrace)" | Set-Content $Log -Encoding UTF8
  Write-Host ''
  Write-Host "El detalle quedó en: $Log" -ForegroundColor Yellow
  Write-Host "El respaldo (si se alcanzó a hacer) está en: backups\apk-$Fecha" -ForegroundColor Yellow
  exit 1
}
