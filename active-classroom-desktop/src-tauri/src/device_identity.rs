//! Device secrets live only in the Linux Secret Service, never in the cache/WebView.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs::File, io::{Read, Write}, process::{Command, Stdio}, sync::{Arc, Mutex}, time::{Duration, Instant}};

const ATTRIBUTES: [&str; 4] = ["application", "com.activeclassroom.desktop", "credential", "device-v1"];
#[derive(Default)]
pub struct DeviceGate(pub Arc<Mutex<()>>);
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Identity {
    device_id: String,
    credential: String,
    name: String,
    activated: bool,
    revoked: bool,
}
fn valid_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn decode(value: &str) -> Result<Identity, String> {
    let identity: Identity = serde_json::from_str(value).map_err(|_| "device: Identidad local dañada; solicita asistencia técnica.")?;
    if !valid_hex(&identity.device_id, 32) || !valid_hex(&identity.credential, 64) || identity.name.is_empty() || identity.name.len() > 200 {
        return Err("device: Identidad local inválida; solicita asistencia técnica.".into());
    }
    Ok(identity)
}
fn random_hex(length: usize) -> Result<String, String> {
    let mut bytes = vec![0; length];
    File::open("/dev/urandom").and_then(|mut file| file.read_exact(&mut bytes)).map_err(|_| "device: No se pudo generar identidad segura.")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn secret_tool(operation: &str, value: Option<&str>) -> Result<Option<String>, String> {
    if !cfg!(target_os = "linux") { return Err("device: La identidad segura requiere Linux con Secret Service.".into()); }
    // Never ask teachers to unlock a keyring. Provisioning must configure the
    // login collection to unlock with the Linux session (PAM).
    let unlocked = Command::new("/usr/bin/gdbus").args(["call", "--session", "--timeout", "5", "--dest", "org.freedesktop.secrets", "--object-path", "/org/freedesktop/secrets/aliases/default", "--method", "org.freedesktop.DBus.Properties.Get", "org.freedesktop.Secret.Collection", "Locked"]).output()
        .map_err(|_| "device: Configura Secret Service y el llavero del equipo.")?;
    let property = String::from_utf8_lossy(&unlocked.stdout).chars().filter(|c| !c.is_whitespace()).collect::<String>();
    if !unlocked.status.success() || property != "(<false>,)" { return Err("device: Llavero bloqueado o no configurado. Solicita asistencia técnica.".into()); }
    let mut command = Command::new("/usr/bin/secret-tool");
    command.arg(if operation == "lookup" { "search" } else { operation });
    if operation == "store" { command.args(["--label", "Active Classroom · identidad del salón"]); }
    let mut child = command.args(ATTRIBUTES).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|_| "device: Instala libsecret-tools y configura el llavero del equipo.")?;
    if let Some(value) = value {
        if let Err(_error) = child.stdin.take().unwrap().write_all(value.as_bytes()) {
            let _ = child.kill(); let _ = child.wait();
            return Err("device: No se pudo guardar identidad en el llavero.".into());
        }
    } else { drop(child.stdin.take()); }
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < Duration::from_secs(30) => std::thread::sleep(Duration::from_millis(50)),
            _ => { let _ = child.kill(); let _ = child.wait(); return Err("device: Llavero no disponible. Solicita asistencia técnica.".into()); }
        }
    }
    let output = child.wait_with_output().map_err(|_| "device: Llavero no disponible.")?;
    if output.status.success() {
        let text = String::from_utf8(output.stdout).map_err(|_| "device: Respuesta inválida del llavero.")?;
        if operation == "lookup" {
            if text.trim().is_empty() { return Ok(None); }
            return text.lines().find_map(|line| line.strip_prefix("secret = ").map(str::to_owned)).map(Some)
                .ok_or_else(|| "device: Llavero bloqueado o identidad no disponible.".into());
        }
        return Ok(Some(text.trim().to_string()));
    }
    if operation == "lookup" && output.status.code() == Some(1) && output.stderr.is_empty() { return Ok(None); }
    Err("device: Llavero bloqueado o no disponible. Solicita asistencia técnica.".into())
}
fn load() -> Result<Identity, String> {
    if let Some(value) = secret_tool("lookup", None)? { return decode(&value); }
    let name = std::fs::read_to_string("/etc/hostname").unwrap_or_else(|_| "Equipo del salón".into()).trim().chars().take(50).collect();
    let identity = Identity { device_id: random_hex(16)?, credential: random_hex(32)?, name, activated: false, revoked: false };
    save(&identity)?;
    Ok(identity)
}
fn save(identity: &Identity) -> Result<(), String> {
    secret_tool("store", Some(&serde_json::to_string(identity).map_err(|_| "device: Identidad inválida.")?))?;
    Ok(())
}
pub fn authorized_owner(owner: &str) -> Result<bool, String> {
    let identity = load()?;
    Ok(identity.activated && !identity.revoked && owner == format!("ac-device-{}", identity.device_id))
}
fn operate(mut identity: Identity, action: &str) -> Result<(Identity, Value), String> {
    match action {
        "load" => {},
        "proof" => return Ok((identity.clone(), json!({ "deviceId": identity.device_id, "credential": identity.credential, "name": identity.name }))),
        "activated" => { identity.activated = true; identity.revoked = false; },
        "revoked" => { identity.activated = false; identity.revoked = true; },
        _ => return Err("device: Operación inválida.".into()),
    }
    let public = json!({ "deviceId": identity.device_id, "name": identity.name, "activated": identity.activated, "revoked": identity.revoked });
    Ok((identity, public))
}
#[tauri::command]
pub async fn classroom_device(window: tauri::WebviewWindow, gate: tauri::State<'_, DeviceGate>, action: String) -> Result<Value, String> {
    if window.label() != "teacher" { return Err("device: Ventana no autorizada.".into()); }
    let mutex = gate.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = mutex.lock().map_err(|_| "device: Identidad ocupada.")?;
        let original = load()?;
        let (identity, public) = operate(original.clone(), &action)?;
        if identity.activated != original.activated || identity.revoked != original.revoked { save(&identity)?; }
        Ok(public)
    }).await.map_err(|_| "device: No se pudo acceder al llavero.".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Identity { Identity { device_id: "a".repeat(32), credential: "b".repeat(64), name: "Salón 1".into(), activated: false, revoked: false } }
    #[test]
    fn public_identity_never_contains_secret() {
        let (_, value) = operate(fixture(), "load").unwrap();
        assert!(value.get("credential").is_none());
        assert_eq!(value["activated"], false);
    }
    #[test]
    fn activation_survives_secure_store_serialization() {
        let (identity, _) = operate(fixture(), "activated").unwrap();
        let restored = decode(&serde_json::to_string(&identity).unwrap()).unwrap();
        assert!(restored.activated); assert_eq!(restored.device_id, fixture().device_id);
    }
    #[test]
    fn revocation_blocks_offline_authorization() {
        let (identity, _) = operate(fixture(), "activated").unwrap();
        let (revoked, _) = operate(identity, "revoked").unwrap();
        assert!(!revoked.activated); assert!(revoked.revoked);
    }
    #[test]
    fn rejects_corrupt_identity_and_unknown_actions() {
        assert!(decode("{}").is_err());
        let mut identity = fixture(); identity.credential = "x".repeat(64);
        assert!(decode(&serde_json::to_string(&identity).unwrap()).is_err());
        assert!(operate(fixture(), "reset").is_err());
    }
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires an isolated unlocked Secret Service"]
    fn linux_keyring_round_trip() {
        assert_eq!(std::env::var("ACTIVE_CLASSROOM_TEST_KEYRING").as_deref(), Ok("1"));
        secret_tool("clear", None).unwrap();
        let first = load().unwrap();
        assert!(!first.activated);
        let (active, _) = operate(first.clone(), "activated").unwrap();
        save(&active).unwrap();
        let reboot = load().unwrap();
        assert_eq!(reboot.device_id, first.device_id);
        assert_eq!(reboot.credential, first.credential);
        assert!(reboot.activated);
        let (revoked, _) = operate(reboot, "revoked").unwrap();
        save(&revoked).unwrap();
        assert!(load().unwrap().revoked);
        secret_tool("clear", None).unwrap();
        let locked = Command::new("/usr/bin/secret-tool").args(["lock", "--collection", "default"]).output().unwrap();
        assert!(locked.status.success());
        assert!(load().is_err(), "locked keyring must fail without asking for a password or creating a new identity");
    }
}
