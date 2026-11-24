// Discord: "Escuchando Edowave · <canción>" en el perfil, mientras suena algo.
//
// Discord (la app de escritorio) abre un canal local en este mismo PC (\\.\pipe\discord-ipc-0…9) para que los
// programas muestren su actividad (Rich Presence). Nada sale a internet desde aquí: se le habla a Discord en el
// mismo computador. Si Discord está cerrado no pasa nada: se reintenta en silencio y se conecta cuando lo abras.
//
// Protocolo: cada mensaje es [op: u32 LE][largo: u32 LE][JSON]. op 0 = saludo (con el id de la aplicación de
// Discord), op 1 = comando (SET_ACTIVITY). Un hilo aparte hace todo: la interfaz solo manda "suena X" / "nada".
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Id de la aplicación "Edowave" en el Discord Developer Portal (no es secreto: lo ve cualquiera).
const APP_ID: &str = "1572334314077683753";

#[derive(Clone, PartialEq, serde::Deserialize)]
pub struct Cancion {
    titulo: String,
    artista: String,
    album: Option<String>,
    /// URL pública de la carátula (https://musica.empanados.io/api/portadas/…): Discord la muestra grande.
    portada: Option<String>,
    /// Cuándo empezó y cuándo termina (ms desde 1970): Discord dibuja la barra de tiempo.
    inicio: Option<u64>,
    fin: Option<u64>,
}

static CANAL: OnceLock<Mutex<Sender<Option<Cancion>>>> = OnceLock::new();

fn canal() -> &'static Mutex<Sender<Option<Cancion>>> {
    CANAL.get_or_init(|| {
        let (tx, rx) = channel::<Option<Cancion>>();
        std::thread::spawn(move || {
            let mut conexion: Option<File> = None;
            let mut deseado: Option<Cancion> = None;
            let mut enviado: Option<Option<Cancion>> = None; // lo último que Discord ya tiene
            let mut ultimo_intento = Instant::now() - Duration::from_secs(60);
            loop {
                // Espera cambios; si llegan varios seguidos (saltar canciones), queda el último.
                match rx.recv_timeout(Duration::from_secs(15)) {
                    Ok(c) => {
                        deseado = c;
                        std::thread::sleep(Duration::from_millis(800));
                        while let Ok(c) = rx.try_recv() {
                            deseado = c;
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
                if enviado.as_ref() == Some(&deseado) {
                    continue;
                }
                if conexion.is_none() {
                    if deseado.is_none() || ultimo_intento.elapsed() < Duration::from_secs(30) {
                        continue;
                    }
                    ultimo_intento = Instant::now();
                    conexion = conectar();
                }
                let Some(c) = conexion.as_mut() else { continue };
                if poner(c, deseado.as_ref()).is_ok() {
                    enviado = Some(deseado.clone());
                } else {
                    conexion = None; // Discord se cerró: se reintenta más tarde
                    enviado = None;
                }
            }
        });
        Mutex::new(tx)
    })
}

fn escribir(c: &mut File, op: u32, json: &serde_json::Value) -> std::io::Result<serde_json::Value> {
    let datos = json.to_string().into_bytes();
    let mut msg = Vec::with_capacity(8 + datos.len());
    msg.extend_from_slice(&op.to_le_bytes());
    msg.extend_from_slice(&(datos.len() as u32).to_le_bytes());
    msg.extend_from_slice(&datos);
    c.write_all(&msg)?;
    c.flush()?;
    // Cada mensaje tiene su respuesta: se lee para que no se acumule en el canal.
    let mut cab = [0u8; 8];
    c.read_exact(&mut cab)?;
    let largo = u32::from_le_bytes([cab[4], cab[5], cab[6], cab[7]]) as usize;
    if largo > 64 * 1024 {
        return Err(std::io::Error::other("respuesta muy grande"));
    }
    let mut resp = vec![0u8; largo];
    c.read_exact(&mut resp)?;
    Ok(serde_json::from_slice(&resp).unwrap_or(serde_json::Value::Null))
}

fn conectar() -> Option<File> {
    if APP_ID.is_empty() {
        return None;
    }
    for i in 0..10 {
        let ruta = format!(r"\\.\pipe\discord-ipc-{i}");
        if let Ok(mut c) = OpenOptions::new().read(true).write(true).open(&ruta) {
            let saludo = serde_json::json!({ "v": 1, "client_id": APP_ID });
            if let Ok(r) = escribir(&mut c, 0, &saludo) {
                if r.get("evt").and_then(|e| e.as_str()) == Some("READY") {
                    return Some(c);
                }
            }
        }
    }
    None
}

/// Discord limita los textos a 128 caracteres.
fn corto(s: &str) -> String {
    let s = s.trim();
    if s.chars().count() <= 120 {
        s.to_string()
    } else {
        s.chars().take(119).collect::<String>() + "…"
    }
}

fn poner(c: &mut File, cancion: Option<&Cancion>) -> std::io::Result<()> {
    let actividad = cancion.map(|s| {
        let mut a = serde_json::json!({
            "type": 2,                 // "Escuchando"
            "status_display_type": 2,  // en la lista de miembros se ve el detalle: el nombre de la canción
            "details": corto(&s.titulo),
            "state": corto(&s.artista),
            "assets": { "small_image": "logo", "small_text": "Edowave" },
        });
        if let Some(p) = s.portada.as_deref().filter(|p| p.starts_with("https://")) {
            a["assets"]["large_image"] = p.into();
            if let Some(al) = s.album.as_deref().filter(|al| al.trim().chars().count() >= 2) {
                a["assets"]["large_text"] = corto(al).into();
            }
        }
        if let (Some(i), Some(f)) = (s.inicio, s.fin) {
            if f > i {
                a["timestamps"] = serde_json::json!({ "start": i, "end": f });
            }
        }
        a
    });
    let nonce = format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let cmd = serde_json::json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": actividad },
        "nonce": nonce,
    });
    let r = escribir(c, 1, &cmd)?;
    if r.get("evt").and_then(|e| e.as_str()) == Some("ERROR") {
        return Err(std::io::Error::other("Discord rechazó la actividad"));
    }
    Ok(())
}

/// La interfaz avisa qué suena (o `null` en pausa / sin canción / ajuste apagado).
#[tauri::command]
pub fn discord_actividad(cancion: Option<Cancion>) {
    if APP_ID.is_empty() {
        return;
    }
    if let Ok(tx) = canal().lock() {
        let _ = tx.send(cancion);
    }
}
