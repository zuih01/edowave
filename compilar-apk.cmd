@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\compilar-apk.ps1" %*
pause
