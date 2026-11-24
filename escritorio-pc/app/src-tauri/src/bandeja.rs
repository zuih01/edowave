// "Minimizar a la bandeja" (Configuración, apagado por defecto): al minimizar, la ventana se esconde de la barra de
// tareas y la app sigue sonando en segundo plano, con su ícono junto al reloj (la bandeja de Windows, el cajón
// de la flecha ^). Clic en el ícono: vuelve la ventana. Clic derecho: "Abrir Edowave" o "Salir".
// La interfaz guarda el ajuste y lo avisa al abrir (comando `bandeja`).
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, Window};

const ID: &str = "edowave";
static ACTIVA: AtomicBool = AtomicBool::new(false);

fn mostrar<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn crear<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if app.tray_by_id(ID).is_some() {
        return Ok(());
    }
    let abrir = MenuItem::with_id(app, "abrir", "Abrir Edowave", true, None::<&str>)?;
    let salir = MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &salir])?;
    let mut b = TrayIconBuilder::with_id(ID)
        .tooltip("Edowave")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "abrir" => mostrar(app),
            "salir" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                mostrar(tray.app_handle());
            }
        });
    if let Some(icono) = app.default_window_icon() {
        b = b.icon(icono.clone());
    }
    b.build(app)?;
    Ok(())
}

/// La interfaz avisa si el ajuste está encendido (al abrir la app y cuando se cambia).
#[tauri::command]
pub fn bandeja(app: AppHandle, activar: bool) -> Result<(), String> {
    ACTIVA.store(activar, Ordering::Relaxed);
    if activar {
        crear(&app).map_err(|e| e.to_string())
    } else {
        if app.remove_tray_by_id(ID).is_some() {
            mostrar(&app); // por si estaba escondida
        }
        Ok(())
    }
}

/// Al minimizar (con el ajuste encendido): se esconde de la barra de tareas; queda el ícono de la bandeja.
pub fn al_cambiar_tamano<R: Runtime>(w: &Window<R>) {
    if ACTIVA.load(Ordering::Relaxed) && w.is_minimized().unwrap_or(false) {
        let _ = w.hide();
    }
}
