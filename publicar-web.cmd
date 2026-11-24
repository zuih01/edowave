@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\publicar-web.ps1" %*
pause
