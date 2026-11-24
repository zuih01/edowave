@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\compilar-pc.ps1" %*
pause
