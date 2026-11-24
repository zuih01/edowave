@echo off
chcp 65001 >nul
title Comparar musica con el servidor
cd /d "%~dp0"
set "CARPETA=%~1"
if "%CARPETA%"=="" (
  for /f "usebackq delims=" %%C in (`powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0elegir-carpeta.ps1"`) do set "CARPETA=%%C"
)
if "%CARPETA%"=="" (
  echo No elegiste ninguna carpeta.
  pause
  exit /b 1
)
echo Carpeta: %CARPETA%
echo.
node comparar.mjs "%CARPETA%"
if errorlevel 1 (
  echo.
  echo Algo fallo. Revisa el mensaje de arriba.
  pause
  exit /b 1
)
for /f "delims=" %%F in ('dir /b /o-d faltan-*.txt') do (
  start "" notepad "%%F"
  goto :fin
)
:fin
pause
