//! Installed .deb startup acceptance in isolated Linux CI, absent from production.
use crate::{app_updater::{classroom_app_update, UpdateGate}, device_identity::{classroom_device, DeviceGate}, offline_cache::{classroom_cache, CacheGate}, startup::{classroom_startup, StartupGate}};
use serde_json::json;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[tauri::command]
fn acceptance_stage() -> String { std::env::var("ACTIVE_CLASSROOM_UPDATER_STAGE").unwrap() }
#[tauri::command]
async fn acceptance_duplicate() -> Result<(), String> {
    // Same executable, identifier and D-Bus session; the first process stays alive.
    tauri::async_runtime::spawn_blocking(|| {
        let status = std::process::Command::new(std::env::current_exe().unwrap()).arg("--from-autostart").status().map_err(|error| error.to_string())?;
        if !status.success() { return Err("La segunda instancia no terminó correctamente".into()); }
        Ok(())
    }).await.map_err(|error| error.to_string())?
}
#[tauri::command]
async fn acceptance_restart(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    std::env::set_var("ACTIVE_CLASSROOM_UPDATER_STAGE", "restarted");
    classroom_app_update(window, app.clone(), app.state::<UpdateGate>(), "restart".into(), Some(true)).await?;
    Ok(())
}
#[tauri::command]
async fn acceptance_ready(window: tauri::WebviewWindow, app: tauri::AppHandle, preferences_valid: bool, automatic_valid: bool) -> Result<(), String> {
    assert!(preferences_valid, "Preferencias WebKit no conservadas");
    assert!(automatic_valid, "Flujo frontend automático no completado");
    let stage = acceptance_stage();
    let identity = classroom_device(window.clone(), app.state::<DeviceGate>(), "load".into()).await?;
    assert_eq!(identity["activated"], true); assert_eq!(identity["name"], "Salón updater CI"); assert_eq!(identity["deviceId"], "a".repeat(32));
    let cached = classroom_cache(app.clone(), window.clone(), app.state::<CacheGate>(), format!("ac-device-{}", "a".repeat(32)), "open".into(), json!({"unitId":"unit-ci","version":1})).await?;
    assert_eq!(cached["manifest"]["unit"]["unitId"], "unit-ci");
    let startup = classroom_startup(window.clone(), app.clone(), app.state::<StartupGate>(), "status".into(), None, None).await?;
    assert!(startup.autostart && startup.kiosk && startup.launched_automatically && startup.kiosk_active);
    assert!(app.get_webview_window("audience").is_none(), "Kiosco no abre el proyector");
    assert_eq!(window.current_monitor().map_err(|error| error.to_string())?.unwrap().position(), window.primary_monitor().map_err(|error| error.to_string())?.unwrap().position());
    let status = classroom_app_update(window, app.clone(), app.state::<UpdateGate>(), "status".into(), Some(true)).await?;
    let expected = if stage.ends_with("restarted") { "1.0.7" } else { "1.0.6" };
    assert_eq!(app.package_info().version.to_string(), expected);
    assert_eq!(status.phase, if stage == "current" || stage == "restarted" || stage == "current-restarted" { "current" } else { "failed" });
    if stage == "restarted" {
        let marker = startup.installed_update.unwrap(); assert_eq!(marker.from, "1.0.6"); assert_eq!(marker.target, "1.0.7");
        std::fs::write(std::env::var("ACTIVE_CLASSROOM_UPDATER_REPORT").unwrap(), json!({"ok":true,"version":"1.0.7","restarted":true,"automaticUpdate":true,"noRestartLoop":true,"autostartEnabled":true,"kioskPrimaryMonitor":true,"singleInstance":true,"activationPreserved":true,"deviceIdPreserved":true,"displayNamePreserved":true,"monitorPreferencePreserved":true}).to_string()).unwrap();
    } else {
        std::fs::write(std::env::var("ACTIVE_CLASSROOM_UPDATER_REPORT").unwrap(), json!({"ok":true,"stage":stage,"version":expected}).to_string()).unwrap();
    }
    app.exit(0); Ok(())
}
pub fn run() {
    let mut context = tauri::generate_context!(); context.config_mut().app.windows.clear();
    let script = std::fs::read(std::env::var("ACTIVE_CLASSROOM_UPDATER_SCRIPT").unwrap()).unwrap();
    let app = tauri::Builder::default()
        .plugin(crate::startup::single_instance_plugin()).plugin(crate::startup::autostart_plugin())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(UpdateGate::default()).manage(DeviceGate::default()).manage(CacheGate::default())
        .register_uri_scheme_protocol("tauri", move |_, request| {
            let (mime, bytes) = if request.uri().path() == "/updater-test.js" { ("text/javascript", script.clone()) }
                else { ("text/html", b"<!doctype html><h1>Startup acceptance</h1><script src='/updater-test.js'></script>".to_vec()) };
            tauri::http::Response::builder().header("Content-Type", mime).body(bytes).unwrap()
        })
        .invoke_handler(tauri::generate_handler![acceptance_stage, acceptance_ready, acceptance_restart, acceptance_duplicate, classroom_startup, classroom_app_update])
        .setup(|app| {
            app.manage(StartupGate::load(app.handle()));
            WebviewWindowBuilder::new(app, "teacher", WebviewUrl::CustomProtocol("tauri://localhost/updater-test".parse().unwrap())).build()?; Ok(())
        }).build(context).unwrap();
    let handle = app.handle().clone(); std::thread::spawn(move || { std::thread::sleep(std::time::Duration::from_secs(90)); handle.exit(1); });
    app.run(|_, _| {});
}
