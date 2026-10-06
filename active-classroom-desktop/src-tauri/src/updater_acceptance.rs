//! Installed .deb acceptance in isolated Linux CI, absent from production builds.
use crate::{app_updater::{classroom_app_update, UpdateGate}, device_identity::{classroom_device, DeviceGate}, offline_cache::{classroom_cache, CacheGate}};
use serde_json::json;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[tauri::command]
fn acceptance_stage() -> String { std::env::var("ACTIVE_CLASSROOM_UPDATER_STAGE").unwrap() }
#[tauri::command]
async fn acceptance_ready(window: tauri::WebviewWindow, app: tauri::AppHandle, preferences_valid: bool) -> Result<(), String> {
    if !preferences_valid { app.exit(1); return Err("Preferencias WebKit no conservadas".into()); }
    let report = std::env::var("ACTIVE_CLASSROOM_UPDATER_REPORT").unwrap();
    let stage = acceptance_stage();
    let identity = classroom_device(window.clone(), app.state::<DeviceGate>(), "load".into()).await?;
    assert_eq!(identity["activated"], true); assert_eq!(identity["name"], "Salón updater CI"); assert_eq!(identity["deviceId"], "a".repeat(32));
    let cached = classroom_cache(app.clone(), window.clone(), app.state::<CacheGate>(), format!("ac-device-{}", "a".repeat(32)), "open".into(), json!({"unitId":"unit-ci","version":1})).await?;
    assert_eq!(cached["manifest"]["unit"]["unitId"], "unit-ci");
    if stage == "restarted" {
        assert_eq!(app.package_info().version.to_string(), "1.0.5");
        std::fs::write(report, json!({"ok":true,"version":"1.0.5","restarted":true,"activationPreserved":true,"deviceIdPreserved":true,"displayNamePreserved":true,"monitorPreferencePreserved":true}).to_string()).unwrap(); app.exit(0); return Ok(());
    }
    assert_eq!(app.package_info().version.to_string(), "1.0.4");
    let checked = classroom_app_update(window.clone(), app.clone(), app.state::<UpdateGate>(), "check".into()).await?;
    if stage == "current" { assert_eq!(checked.phase, "current"); assert_eq!(checked.message, "Estás usando la versión más reciente"); app.exit(0); return Ok(()); }
    if stage == "offline" { assert_eq!(checked.phase, "failed"); assert_eq!(checked.message, "No se pudo buscar actualizaciones"); app.exit(0); return Ok(()); }
    assert_eq!(checked.phase, "available", "{}", checked.message); assert_eq!(checked.new_version.as_deref(), Some("1.0.5"));
    assert_eq!(checked.message, "Nueva versión disponible: 1.0.5");
    let installed = classroom_app_update(window.clone(), app.clone(), app.state::<UpdateGate>(), "install".into()).await?;
    if stage == "corrupt" || stage == "replay" { assert_eq!(installed.phase, "failed"); app.exit(0); return Ok(()); }
    assert_eq!(installed.phase, "installed", "{}", installed.message);
    std::env::set_var("ACTIVE_CLASSROOM_UPDATER_STAGE", "restarted");
    classroom_app_update(window, app.clone(), app.state::<UpdateGate>(), "restart".into()).await?;
    Ok(())
}
pub fn run() {
    let mut context = tauri::generate_context!(); context.config_mut().app.windows.clear();
    let script = std::fs::read(std::env::var("ACTIVE_CLASSROOM_UPDATER_SCRIPT").unwrap()).unwrap();
    let app = tauri::Builder::default().plugin(tauri_plugin_updater::Builder::new().build())
        .manage(UpdateGate::default()).manage(DeviceGate::default()).manage(CacheGate::default())
        .register_uri_scheme_protocol("tauri", move |_, request| {
            let (mime, bytes) = if request.uri().path() == "/updater-test.js" { ("text/javascript", script.clone()) }
                else { ("text/html", b"<!doctype html><h1>Updater acceptance</h1><script src='/updater-test.js'></script>".to_vec()) };
            tauri::http::Response::builder().header("Content-Type", mime).body(bytes).unwrap()
        })
        .invoke_handler(tauri::generate_handler![acceptance_stage, acceptance_ready])
        .setup(|app| { WebviewWindowBuilder::new(app, "teacher", WebviewUrl::CustomProtocol("tauri://localhost/updater-test".parse().unwrap())).build()?; Ok(()) })
        .build(context).unwrap();
    let handle = app.handle().clone(); std::thread::spawn(move || { std::thread::sleep(std::time::Duration::from_secs(60)); handle.exit(1); });
    app.run(|_, _| {});
}
