# Arma el acuerdo que muestra el instalador de Windows (página "Acuerdo de licencia"): términos de uso,
# privacidad, qué hace el instalador y la licencia MIT. Sale en RTF porque NSIS lo muestra con tildes y negritas
# (un .txt en UTF-8 o UTF-16 salía con caracteres raros).
# Uso: python scripts/aviso-instalador.py
SECCIONES = [
    ('EDOWAVE PARA WINDOWS: TÉRMINOS DE USO, PRIVACIDAD Y LICENCIA', [
        'Lee esto antes de instalar. Al presionar "Acepto" aceptas los términos de uso y la política de privacidad de Edowave.',
    ]),
    ('1. Qué es Edowave', [
        'Edowave es un reproductor de música de código abierto. La app se conecta al servidor musica.empanados.io, administrado por el responsable del proyecto, donde están la biblioteca de música y tu cuenta.',
    ]),
    ('2. Términos de uso', [
        '• Cuentas: son por invitación y personales. No compartas tu contraseña. Puedes pedir que se borre tu cuenta cuando quieras.',
        '• Uso aceptable: no intentes entrar a cuentas ajenas, saturar o atacar el servidor, ni usar la app para molestar a otras personas (en perfiles, playlists públicas, la Party o los reportes).',
        '• Lo que subes: si subes canciones, imágenes (foto, banner, carátulas) o textos, eres responsable de tener derecho a hacerlo. El administrador puede quitar contenido o suspender cuentas que no cumplan estos términos.',
        '• Disponibilidad: el servicio es gratis y se ofrece tal como está, sin garantía de funcionamiento continuo. El servidor puede estar caído, cambiar o cerrar.',
        '• Cambios: estos términos pueden cambiar. La versión vigente está en https://github.com/zuih01/edowave/blob/main/TERMS.md',
    ]),
    ('3. Privacidad', [
        '• La app se conecta solo a musica.empanados.io para reproducir música y guardar tu cuenta: historial de escucha, "me gusta", playlists, búsquedas recientes, ajustes y perfil.',
        '• Mientras está abierta envía cada minuto el tipo de dispositivo y la versión de la app.',
        '• Tus amigos pueden ver lo que escuchas. Se apaga en Configuración > Privacidad.',
        '• Discord solo muestra lo que escuchas si lo activas.',
        '• No hay publicidad ni analítica de terceros. Los datos no se venden ni se comparten.',
        '• Política completa: https://github.com/zuih01/edowave/blob/main/PRIVACY.md',
    ]),
    ('4. Qué hace este instalador', [
        '• Instala Edowave en Archivos de programa (por eso Windows pide permiso de administrador).',
        '• Crea un acceso en el menú Inicio y, si lo eliges al final, otro en el escritorio.',
        '• No se abre solo al iniciar Windows, no instala otros programas y no cambia la configuración del sistema.',
        '• Si tenías una versión anterior instalada solo para tu usuario, la reemplaza. Tu sesión y tus ajustes se conservan.',
        '• Se desinstala desde Configuración de Windows > Aplicaciones. Al desinstalar puedes elegir si borrar también tus datos.',
        '• Requiere Windows 10 u 11 con Microsoft Edge WebView2 (viene en Windows 11 y en Windows 10 actualizado).',
    ]),
    ('5. Licencia del software (MIT)', [
        'Copyright (c) 2026 Edowave',
        'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
        'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
        'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
    ]),
]

def rtf(texto):
    out = []
    for c in texto:
        n = ord(c)
        if c in '\\{}':
            out.append('\\' + c)
        elif n < 128:
            out.append(c)
        else:
            out.append('\\u%d?' % (n if n < 32768 else n - 65536))
    return ''.join(out)

partes = [r'{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fswiss Segoe UI;}}\viewkind4\uc1\f0\fs17 ']
for i, (titulo, parrafos) in enumerate(SECCIONES):
    tam = r'\fs20' if i == 0 else r'\fs18'
    partes.append(r'{\b' + tam + ' ' + rtf(titulo) + r'}\par\sa60 ')
    for p in parrafos:
        partes.append(rtf(p) + r'\par ')
    partes.append(r'\par ')
partes.append('}')
open('escritorio-pc/app/src-tauri/aviso-instalador.rtf', 'w', encoding='ascii', newline='\r\n').write(''.join(partes))
print('listo: aviso-instalador.rtf')
