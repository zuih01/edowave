; Edowave: pasos extra del instalador estándar (NSIS de Tauri).
;  - Antes de instalar: quita la instalación vieja (el instalador casero de las betas 57-68, que Windows Defender
;    marcaba como troyano): su carpeta, su entrada en "Agregar o quitar programas" y sus accesos directos.
;  - Después de instalar: pregunta UNA vez si abrir Edowave al iniciar Windows (lo hace el instalador, como
;    cualquier programa; la app ya no toca la carpeta de Inicio).
;  - Al desinstalar: quita ese acceso y lo guardado.

!macro NSIS_HOOK_PREINSTALL
  RMDir /r "$LOCALAPPDATA\Programs\Musica"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Musica"
  Delete "$DESKTOP\Música.lnk"
  Delete "$SMPROGRAMS\Música.lnk"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $0 HKCU "Software\Edowave" "AutoinicioPreguntado"
  ${If} $0 != "1"
    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION "¿Quieres que Edowave se abra solo al iniciar Windows?$\r$\n(Puedes cambiarlo después volviendo a instalar.)" IDNO edowave_sin_autoinicio
      CreateShortCut "$SMSTARTUP\Edowave.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      edowave_sin_autoinicio:
      WriteRegStr HKCU "Software\Edowave" "AutoinicioPreguntado" "1"
    ${EndIf}
  ${ElseIf} ${FileExists} "$SMSTARTUP\Edowave.lnk"
    ; Ya lo tenía: se rehace apuntando a la app nueva.
    CreateShortCut "$SMSTARTUP\Edowave.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SMSTARTUP\Edowave.lnk"
  DeleteRegKey HKCU "Software\Edowave"
!macroend
