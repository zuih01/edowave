fn main() {
    // La clave pública de las actualizaciones la pone scripts\compilar-pc.ps1.
    println!("cargo:rerun-if-env-changed=MUSICA_CLAVE_PUBLICA");
    tauri_build::build()
}
