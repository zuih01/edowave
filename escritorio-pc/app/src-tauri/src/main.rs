// Edowave para PC: una ventana de Windows con la versión de PC de la app (la misma interfaz en React),
// conectada al servidor de música. Usa el WebView2 que ya trae Windows 10 y 11 (no incluye un navegador).
//
// Se instala con un instalador ESTÁNDAR (NSIS, el que genera Tauri; ver tauri.conf.json → bundle) y la app NO
// descarga ni ejecuta instaladores, ni toca la carpeta de Inicio de Windows ni el registro: Windows Defender
// marcaba como troyano a las versiones que lo hacían (un .exe que baja otro .exe y lo ejecuta parece un virus
// "descargador"). Cuando hay una versión nueva, la interfaz avisa y el botón abre la página de descarga en el
// navegador; "Abrir al iniciar Windows" es una pregunta del instalador.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bandeja;
mod discord;

use tauri::Manager;

const SERVIDOR: &str = "https://musica.empanados.io";
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(serde::Deserialize)]
struct Publicada {
    version: String,
}

fn version_publicada() -> Result<Publicada, String> {
    let texto = ureq::get(&format!("{SERVIDOR}/pc/version.json"))
        .call()
        .map_err(|e| format!("Sin conexión con el servidor ({e})"))?
        .body_mut()
        .read_to_string()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&texto).map_err(|e| e.to_string())
}

fn es_mas_nueva(v: &str) -> bool {
    match (semver::Version::parse(v), semver::Version::parse(VERSION)) {
        (Ok(nueva), Ok(actual)) => nueva > actual,
        _ => false,
    }
}

/// La versión publicada, si es más nueva que esta. (None = estás al día.) Solo lee un JSON: no baja nada más.
#[tauri::command]
fn buscar_actualizacion() -> Result<Option<String>, String> {
    let p = version_publicada()?;
    Ok(es_mas_nueva(&p.version).then_some(p.version))
}

#[tauri::command]
fn version_app() -> &'static str {
    VERSION
}

/// Abre la página de descarga en el navegador de la persona (ahí baja el instalador nuevo, como cualquier
/// programa). Solo esa dirección: la interfaz no puede pedir abrir otra.
#[tauri::command]
fn abrir_descarga(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(format!("{SERVIDOR}/download-beta"), None::<&str>).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        // Una sola ventana: si ya está abierta y la vuelves a abrir (acceso directo), se trae al frente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        // "Minimizar a la bandeja" (si está encendido): al minimizar se esconde y queda el ícono junto al reloj.
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Resized(_) = e {
                bandeja::al_cambiar_tamano(w);
            }
        })
        // Abrir la página de descarga en el navegador (ver abrir_descarga).
        .plugin(tauri_plugin_opener::init())
        // Recuerda el tamaño y la posición de la ventana entre una vez y otra. El marco NO: la ventana va sin marco
        // de Windows (los botones están dentro de la interfaz) y las versiones anteriores guardaron "con marco".
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::DECORATIONS)
                .build(),
        )
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_decorations(false);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![buscar_actualizacion, version_app, abrir_descarga, discord::discord_actividad, bandeja::bandeja])
        .run(tauri::generate_context!())
        .expect("no se pudo abrir Edowave");
}
