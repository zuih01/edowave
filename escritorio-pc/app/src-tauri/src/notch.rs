// Notch (Configuración → Este PC, apagado por defecto): una píldora negra arriba al centro de la pantalla, encima de
// todo, con la carátula, play/pausa y siguiente. Casi siempre está escondida (solo se ve una rayita); se abre sola
// unos segundos al cambiar de canción y cuando pasas el mouse por la rayita, sin hacer clic.
//
// Es una segunda ventana (etiqueta "notch") con su propia página, notch.html. La ventana principal le manda lo que
// suena y ella le devuelve los botones (eventos notch-estado / notch-accion, en src/escritorio/NotchPc.tsx).
//
// Escondida, la ventana se achica al tamaño de la rayita, así no tapa nada más; al abrirse crece a la píldora entera.
// (No se usa "dejar pasar los clics": en Windows eso vuelve la ventana una capa sin dibujar y no se veía.) El "mouse
// encima" lo mide Rust cada 90 ms y se lo avisa a la página (evento notch-hover).
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const ETIQUETA: &str = "notch";
/// Tamaño de la ventana (la píldora abierta cabe justa).
const ANCHO: f64 = 400.0;
const ALTO: f64 = 76.0;
/// Escondida: la ventana mide lo de la rayita (un poco más, para que sea fácil pasarle el mouse).
const ANCHO_RAYA: f64 = 170.0;
const ALTO_RAYA: f64 = 10.0;
/// Lo que tarda la página en cerrar la píldora antes de achicar la ventana (notch.css: 0,42 s).
const CIERRE_MS: u64 = 460;

static ABIERTO: AtomicBool = AtomicBool::new(false);
static VIGILANDO: AtomicBool = AtomicBool::new(false);
/// Centro (x) y borde de arriba (y) de la pantalla principal, en píxeles reales.
static CENTRO_X: AtomicI32 = AtomicI32::new(0);
static ARRIBA_Y: AtomicI32 = AtomicI32::new(0);

/// Pone la ventana del tamaño pedido (en medidas lógicas), centrada arriba.
fn medir(w: &WebviewWindow, ancho: f64, alto: f64) {
    let escala = w.scale_factor().unwrap_or(1.0);
    let (a, h) = ((ancho * escala).round() as i32, (alto * escala).round() as i32);
    let _ = w.set_size(PhysicalSize::new(a as u32, h as u32));
    let _ = w.set_position(PhysicalPosition::new(CENTRO_X.load(Ordering::SeqCst) - a / 2, ARRIBA_Y.load(Ordering::SeqCst)));
}

/// Prende o apaga el notch. Es asíncrono a propósito: en Windows, crear una ventana desde un comando síncrono deja
/// su WebView trabado en blanco (advertencia de Tauri en WebviewWindowBuilder::new).
#[tauri::command]
pub async fn notch(app: AppHandle, activar: bool) -> Result<(), String> {
    if !activar {
        cerrar(&app);
        return Ok(());
    }
    if app.get_webview_window(ETIQUETA).is_some() {
        return Ok(());
    }
    let pantalla = app.primary_monitor().map_err(|e| e.to_string())?.ok_or("sin pantalla")?;
    let escala = pantalla.scale_factor();
    let (px, py) = (pantalla.position().x as f64, pantalla.position().y as f64);
    let ancho_pantalla = pantalla.size().width as f64;
    let w = WebviewWindowBuilder::new(&app, ETIQUETA, WebviewUrl::App("notch.html".into()))
        .title("Edowave")
        // Mismo esquema que la ventana principal (https://tauri.localhost): con el otro la página quedaba en blanco.
        .use_https_scheme(true)
        .inner_size(ANCHO_RAYA, ALTO_RAYA)
        // Sin esto Windows no deja una ventana de menos de 39 px de alto (taparía clics arriba de la pantalla).
        .min_inner_size(10.0, 4.0)
        .position(px / escala + (ancho_pantalla / escala - ANCHO_RAYA) / 2.0, py / escala)
        .decorations(false)
        .transparent(true)
        // Fondo del WebView transparente (sin esto se veía un recuadro semitransparente alrededor de la píldora).
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        // No le quita el foco a lo que estés usando, ni al abrirse ni al tocarlo.
        .focused(false)
        .focusable(false)
        .build()
        .map_err(|e| e.to_string())?;
    // Centrado exacto en píxeles reales (el paso de arriba usa medidas lógicas).
    CENTRO_X.store((px + ancho_pantalla / 2.0).round() as i32, Ordering::SeqCst);
    ARRIBA_Y.store(py as i32, Ordering::SeqCst);
    ABIERTO.store(false, Ordering::SeqCst);
    medir(&w, ANCHO_RAYA, ALTO_RAYA);
    if !VIGILANDO.swap(true, Ordering::SeqCst) {
        let app = app.clone();
        std::thread::spawn(move || vigilar(app));
    }
    Ok(())
}

pub fn cerrar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(ETIQUETA) {
        let _ = w.destroy();
    }
}

/// La página del notch avisa si se ve abierta (true) o escondida. Abierta: la ventana crece al tiro. Escondida: se
/// achica cuando la página terminó de cerrar la píldora (si no se volvió a abrir entretanto).
#[tauri::command]
pub fn notch_abierto(app: AppHandle, abierto: bool) {
    ABIERTO.store(abierto, Ordering::SeqCst);
    let Some(w) = app.get_webview_window(ETIQUETA) else { return };
    if abierto {
        medir(&w, ANCHO, ALTO);
    } else {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(CIERRE_MS));
            if !ABIERTO.load(Ordering::SeqCst) {
                medir(&w, ANCHO_RAYA, ALTO_RAYA);
            }
        });
    }
}

/// Mira dónde está el mouse y le avisa a la página del notch cuando entra o sale de la ventana (escondida mide lo de
/// la rayita; abierta, la píldora entera). Termina sola cuando se cierra el notch.
fn vigilar(app: AppHandle) {
    let mut encima = false;
    loop {
        std::thread::sleep(Duration::from_millis(90));
        let Some(w) = app.get_webview_window(ETIQUETA) else {
            VIGILANDO.store(false, Ordering::SeqCst);
            return;
        };
        let (Ok(pos), Ok(tam), Ok(cursor)) = (w.outer_position(), w.outer_size(), app.cursor_position()) else {
            continue;
        };
        let (x0, y0) = (pos.x as f64, pos.y as f64);
        let dentro = cursor.x >= x0 && cursor.x <= x0 + tam.width as f64 && cursor.y >= y0 - 4.0 && cursor.y <= y0 + tam.height as f64;
        if dentro != encima {
            encima = dentro;
            let _ = app.emit_to(ETIQUETA, "notch-hover", encima);
        }
    }
}
