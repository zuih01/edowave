; Edowave: pasos extra del instalador estándar (NSIS de Tauri), instalación para todo el equipo en Archivos de
; programa (tauri.conf.json → installMode "perMachine").
;
;  Antes de instalar:
;   - Avisa si falta Microsoft Edge WebView2 (sin él la app no abre). No lo baja ni lo ejecuta: abre la página
;     oficial para que la persona lo instale.
;   - Quita la instalación anterior "solo para mi usuario" (versiones hasta la 1.0.2, en %LOCALAPPDATA%\Edowave):
;     la app, su desinstalador, su entrada en "Aplicaciones" y sus accesos. La sesión y los ajustes NO se tocan
;     (están en %LOCALAPPDATA%\io.empanados.musica y la app nueva los sigue usando).
;   - Quita el acceso de "Abrir al iniciar Windows" que preguntaban las versiones anteriores: un programa sin firma
;     que se copia a AppData y arranca con Windows es lo que Windows Defender marcaba (Bearfoos.A!ml).
;   - Quita lo que quede del instalador casero de las betas 57-68.
;  Al desinstalar: quita lo que haya quedado de esas versiones. (Borrar la sesión y los ajustes es la casilla
;  "Borrar los datos de la aplicación" del desinstalador.)

!macro EDOWAVE_LIMPIAR_USUARIO
  ; Lo de la cuenta de quien instala (no de todo el equipo).
  SetShellVarContext current
  ${If} ${FileExists} "$LOCALAPPDATA\Edowave\musica.exe"
    !insertmacro CheckIfAppIsRunning "$LOCALAPPDATA\Edowave\musica.exe" "${PRODUCTNAME}"
  ${EndIf}
  Delete "$LOCALAPPDATA\Edowave\musica.exe"
  Delete "$LOCALAPPDATA\Edowave\uninstall.exe"
  RMDir "$LOCALAPPDATA\Edowave"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Edowave"
  Delete "$SMPROGRAMS\Edowave.lnk"
  Delete "$DESKTOP\Edowave.lnk"
  Delete "$SMSTARTUP\Edowave.lnk"
  DeleteRegKey HKCU "Software\Edowave"
  ; Instalador casero de las betas 57-68
  RMDir /r "$LOCALAPPDATA\Programs\Musica"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Musica"
  Delete "$DESKTOP\Música.lnk"
  Delete "$SMPROGRAMS\Música.lnk"
  SetShellVarContext all
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; WebView2: se busca en el equipo y en el usuario (versión distinta de vacía y de 0.0.0.0).
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONINFORMATION "Edowave necesita Microsoft Edge WebView2, que no está instalado en este equipo.$\r$\n$\r$\nLa instalación va a seguir, y se abrirá la página oficial de Microsoft para descargarlo. Instálalo antes de abrir Edowave."
      ExecShell "open" "https://developer.microsoft.com/microsoft-edge/webview2/"
    ${EndIf}
  ${EndIf}

  !insertmacro EDOWAVE_LIMPIAR_USUARIO
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro EDOWAVE_LIMPIAR_USUARIO
!macroend
