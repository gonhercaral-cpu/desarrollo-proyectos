//! Read-only production endpoint check with the official, pinned updater.
//! No device identity, content, installation, or restart. Run only in CI.
use std::{sync::{Arc, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

fn main() {
    assert_eq!(std::env::var("CI").as_deref(), Ok("true"));
    let current = std::env::var("CLASSROOM_CHECK_CURRENT").unwrap_or_else(|_| "1.0.14".into());
    let expected = std::env::var("CLASSROOM_CHECK_EXPECTED").unwrap_or_else(|_| "1.0.15".into());
    let mut context = tauri::generate_context!(); context.config_mut().app.windows.clear();
    context.package_info_mut().version = current.parse().unwrap();
    let passed = Arc::new(AtomicBool::new(false)); let success = passed.clone();
    let app = tauri::Builder::default().plugin(tauri_plugin_updater::Builder::new().build()).setup(move |app| {
        let updater = app.updater_builder().target("linux-x86_64-deb").timeout(Duration::from_secs(240)).build()?;
        let handle = app.handle().clone(); let success = success.clone(); let expected = expected.clone();
        tauri::async_runtime::spawn(async move {
            match updater.check().await {
                Ok(Some(update)) if update.version == expected && !update.signature.is_empty() && update.body.as_ref().is_some_and(|notes| !notes.is_empty()) => {
                    println!("UPDATER_PRODUCTION_CHECK current={} available={} target=linux-x86_64-deb anonymous=true signature_present=true notes=true", update.current_version, update.version);
                    match update.download(|_, _| {}, || {}).await {
                        Ok(bytes) if !bytes.is_empty() => {
                            println!("UPDATER_PRODUCTION_DOWNLOAD bytes={} signature_verified=true install=false", bytes.len());
                            success.store(true, Ordering::SeqCst); handle.exit(0);
                        }
                        result => { eprintln!("UPDATER_PRODUCTION_DOWNLOAD failed: {}", match result { Ok(_) => "empty package".into(), Err(error) => error.to_string() }); handle.exit(1); }
                    }
                }
                result => { eprintln!("UPDATER_PRODUCTION_CHECK failed: {}", match result { Ok(Some(update)) => format!("version {}", update.version), Ok(None) => "no update".into(), Err(error) => error.to_string() }); handle.exit(1); }
            }
        }); Ok(())
    }).build(context).unwrap();
    app.run(|_, _| {}); assert!(passed.load(Ordering::SeqCst), "Actualización publicada no detectada");
}
