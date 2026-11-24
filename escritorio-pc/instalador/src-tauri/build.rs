fn main() {
    // Si cambia la app que va adentro, se vuelve a armar el instalador.
    println!("cargo:rerun-if-env-changed=MUSICA_EXE");
    if let Ok(p) = std::env::var("MUSICA_EXE") {
        println!("cargo:rerun-if-changed={p}");
    }
    tauri_build::build()
}
