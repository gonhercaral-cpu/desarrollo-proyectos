//! Headless Linux acceptance of the production transport/renderers/layout. No Auth/backend.
#[path = "../src/local_media.rs"] mod local_media;
#[path = "../src/offline_cache.rs"] mod offline_cache;
#[path = "../src/device_identity.rs"] mod device_identity;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, sync::{Arc, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
struct Fixture(Value);
#[tauri::command]
fn media_fixture(fixture: tauri::State<'_, Fixture>) -> Value { fixture.0.clone() }
#[tauri::command]
fn fixture_fullscreen(window: tauri::WebviewWindow, active: bool) { window.set_fullscreen(active).unwrap(); }
#[tauri::command]
fn fixture_size(window: tauri::WebviewWindow, width: f64, height: f64) { window.set_size(tauri::LogicalSize::new(width, height)).unwrap(); }
#[tauri::command]
fn fixture_report(app: tauri::AppHandle, ok: bool, result: Value) { println!("MEDIA_NATIVE_RESULT {}", json!({"ok": ok, "result": result})); app.state::<Arc<AtomicBool>>().store(ok, Ordering::SeqCst); app.exit(if ok { 0 } else { 1 }); }
fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => { let sorted: std::collections::BTreeMap<_, _> = map.iter().collect(); format!("{{{}}}", sorted.iter().map(|(key, value)| format!("{}:{}", serde_json::to_string(key).unwrap(), canonical(value))).collect::<Vec<_>>().join(",")) },
        Value::Array(items) => format!("[{}]", items.iter().map(canonical).collect::<Vec<_>>().join(",")), _ => value.to_string(),
    }
}
fn main() {
    let bytes = fs::read(std::env::var("ACTIVE_CLASSROOM_MEDIA_FIXTURE").expect("fixture MP4")).unwrap();
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let root = std::env::temp_dir().join(format!("ac-native-media-{}", std::process::id())); fs::create_dir_all(root.join("objects")).unwrap();
    let path = root.join("objects").join(&hash); fs::write(&path, &bytes).unwrap();
    let mut manifest: Value = serde_json::from_str(include_str!("../../../docs/active-classroom-manifest.example.json")).unwrap();
    manifest["resources"][0]["download"]["mimeType"] = json!("video/mp4"); manifest["resources"][0]["download"]["sizeBytes"] = json!(bytes.len()); manifest["resources"][0]["download"]["checksums"]["sha256"] = json!(hash);
    let mut content = manifest.clone(); for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().unwrap().remove(key); }
    manifest["integrity"]["contentHash"] = json!(format!("{:x}", Sha256::digest(canonical(&content).as_bytes())));
    let directory = offline_cache::version_dir(&root, manifest["unit"]["unitId"].as_str().unwrap(), manifest["version"].as_u64().unwrap()).unwrap(); fs::create_dir_all(&directory).unwrap(); fs::write(directory.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    let server = local_media::MediaServer::start().unwrap();
    let source = server.inspect(&root, manifest["unit"]["unitId"].as_str().unwrap(), manifest["version"].as_u64().unwrap(), manifest["resources"][0]["resourceId"].as_str().unwrap()).unwrap(); assert!(source.url.is_some(), "{}", source.error.unwrap_or_default());
    let source = json!({"url": source.url, "mimeType": "video/mp4", "codecMime": source.codec_mime, "name": "H264 AAC fixture", "sizeBytes": bytes.len()});
    // A valid MP4 followed by a sparse 'free' box exercises a 600 MiB container
    // without a huge encoder fixture or any full-file allocation in the test.
    let large_size: u64 = 600 * 1024 * 1024;
    let temporary = root.join("large.mp4");
    let mut large = fs::File::create(&temporary).unwrap(); large.write_all(&bytes).unwrap();
    large.write_all(&((large_size - bytes.len() as u64) as u32).to_be_bytes()).unwrap(); large.write_all(b"free").unwrap(); large.set_len(large_size).unwrap(); drop(large);
    let mut file = fs::File::open(&temporary).unwrap(); let mut digest = Sha256::new(); let mut block = [0u8; 65536];
    loop { let read = file.read(&mut block).unwrap(); if read == 0 { break; } digest.update(&block[..read]); }
    let large_hash = format!("{:x}", digest.finalize()); drop(file); fs::rename(temporary, root.join("objects").join(&large_hash)).unwrap();
    let mut large_manifest = manifest.clone(); large_manifest["resources"][0]["download"]["sizeBytes"] = json!(large_size); large_manifest["resources"][0]["download"]["checksums"]["sha256"] = json!(large_hash);
    let mut content = large_manifest.clone(); for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().unwrap().remove(key); }
    large_manifest["integrity"]["contentHash"] = json!(format!("{:x}", Sha256::digest(canonical(&content).as_bytes())));
    fs::write(directory.join("manifest.json"), serde_json::to_vec(&large_manifest).unwrap()).unwrap();
    let large_source = server.inspect(&root, manifest["unit"]["unitId"].as_str().unwrap(), manifest["version"].as_u64().unwrap(), manifest["resources"][0]["resourceId"].as_str().unwrap()).unwrap(); assert!(large_source.url.is_some(), "{}", large_source.error.unwrap_or_default());
    let large_source = json!({"url": large_source.url, "mimeType": "video/mp4", "codecMime": large_source.codec_mime, "name": "H264 AAC 600 MiB fixture", "sizeBytes": large_size});
    let script = fs::read(std::env::var("ACTIVE_CLASSROOM_MEDIA_SCRIPT").unwrap()).unwrap();
    let css = format!("{}\n{}\n{}", include_str!("../../src/design-system.css"), include_str!("../../src/styles.css"), include_str!("../../src/player/player.css"));
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap(); let csp = config["app"]["security"]["csp"].as_str().unwrap().to_string();
    let mut context = tauri::generate_context!(); context.config_mut().app.windows.clear();
    let passed = Arc::new(AtomicBool::new(false));
    let app = tauri::Builder::default().manage(Fixture(json!({"source": source, "largeSource": large_source, "path": path, "manifest": manifest}))).manage(server).manage(passed.clone())
        .register_uri_scheme_protocol("tauri", move |_, request| {
            let (mime, body) = match request.uri().path() {
                "/test.js" => ("text/javascript", script.clone()), "/style.css" => ("text/css", css.as_bytes().to_vec()),
                _ => ("text/html", b"<!doctype html><html><head><link rel='stylesheet' href='/style.css'></head><body><div id='app'></div><div id='media' style='height:240px'></div><div id='audience' style='height:100px'></div><script src='/test.js'></script></body></html>".to_vec()),
            };
            tauri::http::Response::builder().header("Content-Type", mime).header("Content-Security-Policy", &csp).body(body).unwrap()
        })
        .invoke_handler(tauri::generate_handler![media_fixture, fixture_report, fixture_fullscreen, fixture_size, local_media::classroom_media_diagnostic])
        .setup(move |app| {
            app.asset_protocol_scope().allow_file(&path)?;
            // Direct Cargo builds use devUrl unless custom-protocol is enabled.
            // Select the installed app's origin explicitly for this fixture.
            WebviewWindowBuilder::new(app, "teacher", WebviewUrl::CustomProtocol("tauri://localhost/media-test.html".parse().unwrap())).title("Media + scroll fixture").inner_size(1240.0, 820.0)
                .on_page_load(|_, page| eprintln!("MEDIA_FIXTURE_PAGE {:?} {}", page.event(), page.url()))
                .build()?; Ok(())
        }).build(context).unwrap();
    let handle = app.handle().clone(); let success = passed.clone();
    std::thread::spawn(move || { std::thread::sleep(Duration::from_secs(70)); if !success.load(Ordering::SeqCst) { eprintln!("MEDIA_NATIVE_TIMEOUT"); handle.exit(1); } });
    app.run(|_, _| {}); fs::remove_dir_all(root).unwrap(); assert!(passed.load(Ordering::SeqCst), "Native media/scroll acceptance failed");
}
