// Instalador de Edowave para PC (Windows 10 y 11). La app va adentro de este mismo .exe.
//
// Instalar: copia Musica.exe a %LOCALAPPDATA%\Programs\Musica (sin pedir administrador), crea los accesos
// directos (escritorio y menú Inicio) y la agrega a "Agregar o quitar programas".
// Desinstalar: este mismo .exe queda copiado como Desinstalar.exe; Windows lo abre con --desinstalar.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::process::Command;

/// La app de PC, metida dentro del instalador al compilar (scripts\compilar-pc.ps1 pone la ruta en MUSICA_EXE).
const APP: &[u8] = include_bytes!(env!("MUSICA_EXE"));
const VERSION: &str = env!("CARGO_PKG_VERSION");
const NOMBRE: &str = "Edowave";
/// Nombre que tenía la app antes (sus accesos directos se reemplazan por los nuevos).
const NOMBRE_ANTERIOR: &str = "Música";
const CLAVE_DESINSTALAR: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Musica";

fn carpeta() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir().ok_or("No se encontró tu carpeta de usuario")?;
    Ok(base.join("Programs").join("Musica"))
}
fn acceso_escritorio() -> Option<PathBuf> {
    dirs::desktop_dir().map(|d| d.join(format!("{NOMBRE}.lnk")))
}
fn acceso_inicio() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(r"Microsoft\Windows\Start Menu\Programs").join(format!("{NOMBRE}.lnk")))
}
fn accesos_anteriores() -> [Option<PathBuf>; 2] {
    [
        dirs::desktop_dir().map(|d| d.join(format!("{NOMBRE_ANTERIOR}.lnk"))),
        dirs::data_dir().map(|d| d.join(r"Microsoft\Windows\Start Menu\Programs").join(format!("{NOMBRE_ANTERIOR}.lnk"))),
    ]
}

fn crear_acceso(destino: &PathBuf, exe: &PathBuf) -> Result<(), String> {
    let mut l = mslnk::ShellLink::new(exe).map_err(|e| e.to_string())?;
    l.set_working_dir(exe.parent().map(|p| p.to_string_lossy().into_owned()));
    l.set_icon_location(Some(exe.to_string_lossy().into_owned()));
    l.create_lnk(destino).map_err(|e| e.to_string())
}

/// ¿Abrió Windows este .exe para desinstalar?
#[tauri::command]
fn modo() -> &'static str {
    if std::env::args().any(|a| a == "--desinstalar") { "desinstalar" } else { "instalar" }
}

#[tauri::command]
fn version() -> &'static str {
    VERSION
}

#[tauri::command]
fn instalar(acceso_directo: bool) -> Result<(), String> {
    copiar_todo(Some(acceso_directo))
}

/// Instala o actualiza. `acceso_directo`: Some(sí/no) al instalar; None al actualizar (el del escritorio queda
/// como estaba: si lo borraste, no vuelve a aparecer).
fn copiar_todo(acceso_directo: Option<bool>) -> Result<(), String> {
    let dir = carpeta()?;
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    let exe = dir.join("Musica.exe");
    // Al actualizar, la app se está cerrando: se reintenta unos segundos hasta que suelte el archivo.
    let mut intento = 0;
    loop {
        match fs::write(&exe, APP) {
            Ok(_) => break,
            Err(_) if intento < 40 => {
                intento += 1;
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
            Err(_) => return Err("No se pudo copiar la app. Si Edowave está abierta, ciérrala y vuelve a intentar.".to_string()),
        }
    }

    // El desinstalador: este mismo programa, que con --desinstalar borra todo.
    let desinstalador = dir.join("Desinstalar.exe");
    if let Ok(yo) = std::env::current_exe() {
        if yo != desinstalador {
            let _ = fs::copy(&yo, &desinstalador);
        }
    }

    // Accesos con el nombre anterior: se borran (si había uno en el escritorio, se crea el nuevo en su lugar).
    let [viejo_escritorio, viejo_inicio] = accesos_anteriores();
    let habia_viejo = viejo_escritorio.as_ref().is_some_and(|p| p.exists());
    for p in [viejo_escritorio, viejo_inicio].into_iter().flatten() {
        let _ = fs::remove_file(p);
    }
    if let Some(p) = acceso_escritorio() {
        let crear = match acceso_directo {
            Some(si) => si,
            None => p.exists() || habia_viejo,
        };
        if crear {
            crear_acceso(&p, &exe)?;
        }
    }
    if let Some(p) = acceso_inicio() {
        let _ = crear_acceso(&p, &exe);
    }

    // "Agregar o quitar programas" (solo para este usuario: no pide administrador).
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    if let Ok((k, _)) = hkcu.create_subkey(CLAVE_DESINSTALAR) {
        let d = dir.to_string_lossy().into_owned();
        let _ = k.set_value("DisplayName", &NOMBRE);
        let _ = k.set_value("DisplayVersion", &VERSION);
        let _ = k.set_value("Publisher", &"Edowave");
        let _ = k.set_value("DisplayIcon", &exe.to_string_lossy().into_owned());
        let _ = k.set_value("InstallLocation", &d);
        let _ = k.set_value("UninstallString", &format!("\"{}\" --desinstalar", desinstalador.to_string_lossy()));
        let _ = k.set_value("NoModify", &1u32);
        let _ = k.set_value("NoRepair", &1u32);
        let _ = k.set_value("EstimatedSize", &((APP.len() / 1024) as u32));
    }
    Ok(())
}

#[tauri::command]
fn desinstalar() -> Result<(), String> {
    let dir = carpeta()?;
    let [a, b] = accesos_anteriores();
    for p in [acceso_escritorio(), acceso_inicio(), a, b].into_iter().flatten() {
        let _ = fs::remove_file(p);
    }
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey_all(CLAVE_DESINSTALAR);
    // "Abrir al iniciar Windows" (si lo había activado en Configuración): acceso en la carpeta Inicio, y la
    // entrada del registro que usaba la beta.61.
    if let Some(d) = dirs::data_dir() {
        let _ = fs::remove_file(d.join(r"Microsoft\Windows\Start Menu\Programs\Startup\Edowave.lnk"));
    }
    if let Ok(run) = hkcu.open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Run", winreg::enums::KEY_SET_VALUE) {
        let _ = run.delete_value("Edowave");
    }
    let _ = fs::remove_file(dir.join("Musica.exe"));
    // Desinstalar.exe está abierto (es este programa): la carpeta se borra unos segundos después de cerrar.
    let _ = Command::new("cmd")
        .args(["/C", "timeout", "/T", "3", "/NOBREAK", ">NUL", "&", "rmdir", "/S", "/Q"])
        .arg(&dir)
        .spawn();
    Ok(())
}

#[tauri::command]
fn abrir_musica(app: tauri::AppHandle) -> Result<(), String> {
    let exe = carpeta()?.join("Musica.exe");
    Command::new(exe).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

fn main() {
    // Actualización automática (la abre la app): sin ventana; reemplaza la app.
    //  - `--actualizar --sin-abrir`: la app (que bajó la versión nueva sola, en segundo plano) lo lanza al CERRARSE;
    //    se copia todo y NO se vuelve a abrir: la próxima vez que la persona la abra, ya está actualizada.
    //  - `--actualizar` a secas: el flujo anterior (apps viejas con el botón "Actualizar"): copia y la reabre.
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--actualizar") {
        let _ = copiar_todo(None);
        if !args.iter().any(|a| a == "--sin-abrir") {
            if let Ok(dir) = carpeta() {
                let _ = Command::new(dir.join("Musica.exe")).spawn();
            }
        }
        return;
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![modo, version, instalar, desinstalar, abrir_musica])
        .run(tauri::generate_context!())
        .expect("no se pudo abrir el instalador");
}
