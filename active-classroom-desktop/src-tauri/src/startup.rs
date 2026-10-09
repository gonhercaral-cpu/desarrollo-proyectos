//! Session startup preferences. Never writes identity, content or projector data.
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::{Manager, PhysicalPosition};
use tauri_plugin_autostart::ManagerExt;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledUpdate { pub from: String, pub target: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub autostart: Option<bool>, pub kiosk: bool,
    pub installed_update: Option<InstalledUpdate>, pub resume_autostart: bool,
}
impl Default for Preferences {
    fn default() -> Self { Self { autostart: None, kiosk: true, installed_update: None, resume_autostart: false } }
}
pub struct StartupGate { settings: Mutex<Preferences>, path: PathBuf, readable: bool, automatic: bool }
impl StartupGate {
    pub fn load(app: &tauri::AppHandle) -> Self {
        let path = app.path().app_config_dir().unwrap_or_default().join("startup-v1.json");
        let loaded = match if path.is_absolute() { fs::read(&path) } else { Err(std::io::Error::other("Unavailable configuration directory")) } {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| ()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
            Err(_) => Err(()),
        };
        let readable = loaded.is_ok() && path.is_absolute();
        if !readable { eprintln!("[Active Classroom Startup] preferences-unavailable; continuing locally"); }
        let settings = loaded.unwrap_or_default();
        let automatic = std::env::args().any(|argument| argument == "--from-autostart") || settings.resume_autostart;
        Self { settings: Mutex::new(settings), path, readable, automatic }
    }
    fn save(&self, settings: &Preferences) -> Result<(), String> {
        if !self.readable { return Err("No se pudieron leer las preferencias de inicio".into()); }
        save_preferences(&self.path, settings)
    }
}
fn save_preferences(path: &Path, settings: &Preferences) -> Result<(), String> {
    let directory = path.parent().ok_or("Configuración de inicio no disponible")?;
    fs::create_dir_all(directory).map_err(|_| "No se pudo guardar la configuración de inicio")?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(settings).map_err(|_| "Configuración no válida")?;
    use std::io::Write;
    let mut options = fs::OpenOptions::new(); options.write(true).create(true).truncate(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(&temporary).map_err(|_| "No se pudo guardar la configuración de inicio")?;
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|_| "No se pudo guardar la configuración de inicio")?;
    drop(file);
    fs::rename(&temporary, path).map_err(|_| "No se pudo confirmar la configuración de inicio")?;
    Ok(())
}
pub fn autostart_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_autostart::Builder::new().app_name("Active Classroom").args(["--from-autostart"]).build()
}
pub fn single_instance_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("teacher") {
            let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
        }
    })
}
pub fn enter_kiosk(window: &tauri::WebviewWindow) -> Result<(), String> {
    if let Some(monitor) = window.primary_monitor().map_err(|_| "No se pudo consultar el monitor principal")? {
        let position = monitor.position();
        window.set_fullscreen_on_monitor(PhysicalPosition::new(position.x as f64, position.y as f64))
            .map_err(|_| "No se pudo iniciar el modo kiosco")?;
    } else { window.set_fullscreen(true).map_err(|_| "No se pudo iniciar el modo kiosco")?; }
    window.show().map_err(|_| "No se pudo mostrar Active Classroom")?;
    let _ = window.unminimize(); let _ = window.set_focus();
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub autostart: bool, pub kiosk: bool, pub kiosk_active: bool, pub launched_automatically: bool,
    pub installed_update: Option<InstalledUpdate>,
}
#[tauri::command]
pub async fn classroom_startup(window: tauri::WebviewWindow, app: tauri::AppHandle,
    gate: tauri::State<'_, StartupGate>, action: String, value: Option<bool>, target: Option<String>) -> Result<Status, String> {
    if window.label() != "teacher" { return Err("Ventana no autorizada".into()); }
    // The existing secure identity is authoritative, including activation after installation.
    let activated = if action == "initialize" {
        let identity = crate::device_identity::classroom_device(window.clone(), app.state(), "load".into()).await?;
        identity["activated"] == true && identity["revoked"] != true
    } else { false };
    let mut settings = gate.settings.lock().map_err(|_| "Configuración ocupada")?;
    match action.as_str() {
        "initialize" if activated && settings.autostart.is_none() && cfg!(target_os = "linux") => {
            app.autolaunch().enable().map_err(|_| "No se pudo habilitar el inicio automático")?;
            let mut next = settings.clone(); next.autostart = Some(true); gate.save(&next)?; *settings = next;
        }
        "initialize" | "status" => {}
        "autostart" => {
            let enabled = value.ok_or("Preferencia no válida")?;
            if enabled { app.autolaunch().enable() } else { app.autolaunch().disable() }.map_err(|_| "No se pudo cambiar el inicio automático")?;
            let mut next = settings.clone(); next.autostart = Some(enabled); gate.save(&next)?; *settings = next;
        }
        "kiosk" => { let mut next = settings.clone(); next.kiosk = value.ok_or("Preferencia no válida")?; gate.save(&next)?; *settings = next; }
        "exit-kiosk" => { window.set_fullscreen(false).map_err(|_| "No se pudo salir del modo kiosco")?; window.maximize().map_err(|_| "No se pudo restaurar la ventana")?; }
        "library-ready" => {
            if gate.automatic && settings.kiosk { enter_kiosk(&window)?; }
            if settings.resume_autostart { let mut next = settings.clone(); next.resume_autostart = false; gate.save(&next)?; *settings = next; }
        }
        "remember-update" => {
            let target = target.ok_or("Versión no válida")?;
            let parsed = semver::Version::parse(&target).map_err(|_| "Versión no válida")?;
            let current = app.package_info().version.clone();
            if parsed <= current || !parsed.pre.is_empty() { return Err("Actualización no válida".into()); }
            let mut next = settings.clone(); next.installed_update = Some(InstalledUpdate { from: current.to_string(), target });
            next.resume_autostart = gate.automatic; gate.save(&next)?; *settings = next;
        }
        _ => return Err("Acción de inicio no válida".into()),
    }
    Ok(Status { autostart: app.autolaunch().is_enabled().map_err(|_| "No se pudo consultar el inicio automático")?,
        kiosk: settings.kiosk, kiosk_active: window.is_fullscreen().unwrap_or(false), launched_automatically: gate.automatic,
        installed_update: settings.installed_update.clone() })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_activation_defaults_and_explicit_opt_out_are_distinct() {
        let defaults = Preferences::default(); assert_eq!(defaults.autostart, None); assert!(defaults.kiosk);
        let stored: Preferences = serde_json::from_str(r#"{"autostart":false,"kiosk":false}"#).unwrap();
        assert_eq!(stored.autostart, Some(false)); assert!(!stored.kiosk);
    }
    #[test]
    fn startup_settings_round_trip_preserves_restart_guard_and_other_preferences() {
        let directory = std::env::temp_dir().join(format!("ac-startup-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap(); let path = directory.join("startup-v1.json");
        let settings = Preferences { autostart: Some(false), kiosk: false, installed_update: Some(InstalledUpdate { from: "1.0.6".into(), target: "1.0.7".into() }), resume_autostart: true };
        save_preferences(&path, &settings).unwrap();
        let restored: Preferences = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap(); assert_eq!(settings, restored);
        assert!(!path.with_extension("json.tmp").exists()); fs::remove_file(path).unwrap(); fs::remove_dir(directory).unwrap();
    }
}
