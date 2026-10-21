//! CI-only artifact verification using the updater's pinned crypto library.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        return Err("Uso: verify_updater <artifact> <signature> <version>".into());
    }
    let key = std::env::var("ACTIVE_CLASSROOM_UPDATER_PUBLIC_KEY")?;
    let key = String::from_utf8(STANDARD.decode(key.trim())?)?;
    let text = std::fs::read_to_string(&args[2])?;
    let text = String::from_utf8(STANDARD.decode(text.trim())?)?;
    let signature = Signature::decode(&text)?;
    let public_key = PublicKey::decode(&key)?;
    public_key.verify(&std::fs::read(&args[1])?, &signature, true)?;
    let expected = format!("version:{}", args[3]);
    if !signature.trusted_comment().split('\t').any(|field| field == expected) {
        return Err("Versión de firma incorrecta".into());
    }
    println!("Firma updater y versión verificadas con clave pública compilada");
    Ok(())
}
