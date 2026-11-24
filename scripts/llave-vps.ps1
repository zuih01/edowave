# Instala en el VPS la llave SSH de este PC, para que Claude pueda entrar con "ssh vps" sin contraseña.
# Uso:  powershell -ExecutionPolicy Bypass -File "...\scripts\llave-vps.ps1" -Servidor 203.0.113.25
# Te pide la contraseña del VPS UNA vez (la escribes tú; no se ve mientras la escribes).
param([Parameter(Mandatory = $true)][string]$Servidor)

$llave = (Get-Content "$env:USERPROFILE\.ssh\id_ed25519_vps.pub" -Raw).Trim()
Write-Host ""
Write-Host "Conectando a $Servidor para instalar la llave..." -ForegroundColor Cyan
Write-Host "Si pregunta 'Are you sure you want to continue connecting', escribe yes y Enter." -ForegroundColor Cyan
Write-Host "Cuando pida 'password', escribe la contrasena del VPS (no se ve al escribir) y presiona Enter." -ForegroundColor Cyan
Write-Host ""
ssh "zuih@$Servidor" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && (grep -qF '$llave' ~/.ssh/authorized_keys || echo '$llave' >> ~/.ssh/authorized_keys) && echo LLAVE-INSTALADA"
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Listo: la llave quedo instalada en $Servidor. Ya puedes volver al chat." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "No se pudo (direccion equivocada, contrasena incorrecta o el VPS no responde). Avisa en el chat." -ForegroundColor Yellow
}
