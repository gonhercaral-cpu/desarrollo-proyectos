//! Program updates never write device identity, content or projection settings.
use serde::Serialize;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{sync::Mutex, time::Duration};
use tauri::Emitter;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: String,
    pub current_version: String,
    pub new_version: Option<String>,
    pub notes: Option<String>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub message: String,
}
#[derive(Default)]
pub struct UpdateGate(Mutex<Session>);
#[derive(Default)]
struct Session { busy: bool, installed: bool, update: Option<Update>, status: Status }
fn publish(app: &tauri::AppHandle, gate: &UpdateGate, status: Status) {
    if let Ok(mut session) = gate.0.lock() { session.status = status.clone(); }
    let _ = app.emit_to("teacher", "classroom-app-update", status);
}
fn valid_configuration(config: &serde_json::Value) -> bool {
    if config.get("requireSignedVersion").and_then(|v| v.as_bool()) != Some(true) { return false; }
    let Some(key) = config.get("pubkey").and_then(|v| v.as_str()) else { return false; };
    let Ok(decoded) = STANDARD.decode(key.trim()) else { return false; };
    let Ok(public_key) = std::str::from_utf8(&decoded) else { return false; };
    if minisign_verify::PublicKey::decode(public_key).is_err() { return false; }
    config.get("endpoints").and_then(|v| v.as_array()).is_some_and(|endpoints| {
        !endpoints.is_empty() && endpoints.iter().all(|endpoint| {
            endpoint.as_str().and_then(|value| tauri::Url::parse(value).ok()).is_some_and(|url| {
                url.scheme() == "https" && url.host_str().is_some() && url.username().is_empty()
                    && url.password().is_none() && url.query().is_none() && url.fragment().is_none()
            })
        })
    })
}
fn configured(app: &tauri::AppHandle) -> bool {
    app.config().plugins.0.get("updater").is_some_and(valid_configuration)
}
fn trusted_deb_url(url: &str, version: &str, endpoint: &str) -> bool {
    let prefix = endpoint.strip_suffix("/releases/latest/download/latest.json").unwrap_or("");
    !prefix.is_empty() && prefix.starts_with("https://github.com/")
        && url.starts_with(&format!("{prefix}/releases/download/active-classroom-v{version}/"))
        && url.ends_with(".deb") && !url.contains('?') && !url.contains('#')
}
fn allowed_download(update: &Update, app: &tauri::AppHandle) -> bool {
    let Some(endpoint) = app.config().plugins.0.get("updater").and_then(|v| v.get("endpoints")).and_then(|v| v.get(0)).and_then(|v| v.as_str()) else { return false; };
    #[cfg(feature = "updater-acceptance")]
    if endpoint.starts_with("https://127.0.0.1:") && std::env::var_os("ACTIVE_CLASSROOM_UPDATER_STAGE").is_some() {
        let prefix = endpoint.strip_suffix("/releases/latest/download/latest.json").unwrap_or("");
        return update.download_url.as_str().starts_with(&format!("{prefix}/releases/download/active-classroom-v{}/", update.version)) && update.download_url.path().ends_with(".deb");
    }
    trusted_deb_url(update.download_url.as_str(), &update.version, endpoint)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configuration_requires_valid_key_https_endpoint_and_signed_version() {
        let mut raw = [7_u8; 42]; raw[0] = b'E'; raw[1] = b'd';
        let key = STANDARD.encode(format!("untrusted comment: CI public key\n{}\n", STANDARD.encode(raw)));
        let valid = serde_json::json!({"pubkey":key,"endpoints":["https://github.com/owner/repo/releases/latest/download/latest.json"],"requireSignedVersion":true});
        assert!(valid_configuration(&valid));
        for key in ["", "   ", "not-a-key", "c2VjcmV0"] {
            let mut bad = valid.clone(); bad["pubkey"] = key.into(); assert!(!valid_configuration(&bad));
        }
        for endpoints in [serde_json::json!([]), serde_json::json!(["http://github.com/owner/repo"]), serde_json::json!(["https://user:password@github.com/repo"]), serde_json::json!(["invalid"])] {
            let mut bad = valid.clone(); bad["endpoints"] = endpoints; assert!(!valid_configuration(&bad));
        }
        let mut bad = valid; bad["requireSignedVersion"] = false.into(); assert!(!valid_configuration(&bad));
    }
    #[test]
    fn accepts_only_same_https_release_version_and_deb() {
        let endpoint = "https://github.com/owner/repo/releases/latest/download/latest.json";
        let url = "https://github.com/owner/repo/releases/download/active-classroom-v1.0.1/Active%20Classroom_1.0.1_amd64.deb";
        assert!(trusted_deb_url(url, "1.0.1", endpoint));
        assert!(!trusted_deb_url(url, "1.0.2", endpoint));
        for bad in [url.replace("https:", "http:"), url.replace("github.com/", "github.com.evil/"), url.replace("owner/repo/", "other/repo/"), url.replace(".deb", ".AppImage"), format!("{url}?token=secret"), format!("{url}#fragment")] {
            assert!(!trusted_deb_url(&bad, "1.0.1", endpoint));
        }
    }
}
#[tauri::command]
pub async fn classroom_app_update(window: tauri::WebviewWindow, app: tauri::AppHandle,
    gate: tauri::State<'_, UpdateGate>, action: String, startup: Option<bool>) -> Result<Status, String> {
    if window.label() != "teacher" { return Err("Ventana no autorizada".into()); }
    let mut status = {
        let mut session = gate.0.lock().map_err(|_| "Actualizador ocupado")?;
        if session.status.current_version.is_empty() {
            session.status = Status { phase: if configured(&app) { "idle" } else { "unconfigured" }.into(),
                current_version: app.package_info().version.to_string(), message: if configured(&app) { "Sin comprobar" } else { "Actualizaciones no configuradas en esta instalación" }.into(), ..Status::default() };
        }
        if action == "status" { return Ok(session.status.clone()); }
        if session.busy { return Err("Ya hay una actualización en curso".into()); }
        if action == "restart" {
            if !session.installed { return Err("No hay actualización instalada para reiniciar".into()); }
            drop(session);
            // Release the D-Bus name before Tauri spawns the updated executable.
            tauri_plugin_single_instance::destroy(&app);
            app.restart();
        }
        if session.installed || !configured(&app) { return Ok(session.status.clone()); }
        if action != "check" && action != "install" { return Err("Acción no válida".into()); }
        if action == "install" && session.update.is_none() { return Err("Busca una actualización primero".into()); }
        if action == "check" {
            session.update = None;
            session.status.new_version = None; session.status.notes = None;
            session.status.downloaded = 0; session.status.total = None;
        }
        session.busy = true;
        session.status.clone()
    };
    let result: Result<(), String> = if action == "check" {
        status.phase = "checking".into(); status.message = "Buscando actualizaciones del programa…".into(); publish(&app, &gate, status.clone());
        match app.updater_builder().timeout(Duration::from_secs(8)).build() {
            Err(_) => Err("No se pudo buscar actualizaciones".into()),
            Ok(updater) => match updater.check().await {
                Ok(update) => {
                    if update.as_ref().is_some_and(|v| !allowed_download(v, &app)) { Err("La actualización no corresponde al instalador oficial.".into()) }
                    else {
                        status.phase = if update.is_some() { "available" } else { "current" }.into();
                        status.new_version = update.as_ref().map(|v| v.version.clone()); status.notes = update.as_ref().and_then(|v| v.body.clone());
                        status.message = update.as_ref().map(|v| format!("Nueva versión disponible: {}", v.version)).unwrap_or_else(|| "Estás usando la versión más reciente".into());
                        gate.0.lock().map_err(|_| "Actualizador ocupado")?.update = update; Ok(())
                    }
                }
                Err(error) => {
                    #[cfg(feature = "updater-acceptance")]
                    eprintln!("UPDATER_CHECK_FIXTURE_ERROR {error:?}");
                    let _ = error;
                    Err("No se pudo buscar actualizaciones".into())
                },
            },
        }
    } else {
        let mut update = gate.0.lock().map_err(|_| "Actualizador ocupado")?.update.clone().ok_or("No hay actualización")?;
        // A stalled boot download returns to the Library within one minute.
        // Manual updates retain their existing timeout.
        update.timeout = Some(Duration::from_secs(if startup == Some(true) { 60 } else { 15 * 60 }));
        status.phase = "downloading".into(); status.downloaded = 0; status.total = None;
        status.message = "Descargando actualización del programa…".into(); publish(&app, &gate, status.clone());
        let mut progress = status.clone();
        let bytes = update.download(|chunk, total| {
            progress.downloaded += chunk as u64; progress.total = total; publish(&app, &gate, progress.clone());
        }, || {
            let mut verifying = status.clone(); verifying.phase = "verifying".into(); verifying.message = "Verificando firma criptográfica…".into(); publish(&app, &gate, verifying);
        }).await;
        match bytes {
            Err(_) => Err("Descarga o firma no válida. No se instaló la actualización; puedes reintentar.".into()),
            Ok(bytes) => {
                status.phase = "installing".into(); status.downloaded = bytes.len() as u64; status.total = Some(bytes.len() as u64);
                status.message = "Instalando… Linux puede pedir autorización de administrador.".into(); publish(&app, &gate, status.clone());
                match tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await {
                    Ok(Ok(())) => {
                        gate.0.lock().map_err(|_| "Actualizador ocupado")?.installed = true;
                        status.phase = "installed".into(); status.message = "Actualización instalada. Reinicia Active Classroom para usar la nueva versión.".into(); Ok(())
                    }
                    _ => Err("Linux no completó la instalación. Revisa la autorización y reintenta; tus clases y activación se conservan.".into()),
                }
            }
        }
    };
    if let Err(message) = result { status.phase = "failed".into(); status.message = message; }
    gate.0.lock().map_err(|_| "Actualizador ocupado")?.busy = false;
    publish(&app, &gate, status.clone()); Ok(status)
}
