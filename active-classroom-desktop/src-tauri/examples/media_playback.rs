//! Headless Linux acceptance of the production transport/renderers/layout. No Auth/backend.
#[path = "../src/local_media.rs"] mod local_media;
#[path = "../src/media_report.rs"] mod media_report;
#[path = "../src/offline_cache.rs"] mod offline_cache;
#[path = "../src/device_identity.rs"] mod device_identity;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, sync::{Arc, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
struct Fixture(Value);
#[derive(Default)]
struct Audience(std::sync::Mutex<Value>);
#[tauri::command]
fn fixture_audience_state(state: tauri::State<'_, Audience>, report: Option<Value>) -> Value {
    let mut value = state.0.lock().unwrap(); if let Some(report) = report { *value = report; } value.clone()
}
#[tauri::command]
fn fixture_project(app: tauri::AppHandle, snapshot: Option<Value>) {
    if let Some(window) = app.get_webview_window("audience") {
        if snapshot.is_some() { window.show().unwrap(); } else { window.hide().unwrap(); }
        app.emit_to("audience", "fixture-projection", snapshot).unwrap();
    }
}
#[tauri::command]
fn media_fixture(fixture: tauri::State<'_, Fixture>) -> Value { fixture.0.clone() }
#[tauri::command]
fn fixture_fullscreen(window: tauri::WebviewWindow, active: bool) { window.set_fullscreen(active).unwrap(); }
#[tauri::command]
fn fixture_size(window: tauri::WebviewWindow, width: f64, height: f64) { window.set_size(tauri::LogicalSize::new(width, height)).unwrap(); }
#[tauri::command]
fn fixture_memory() -> Value {
    let mut processes = Vec::new(); let mut pending = vec![std::process::id()];
    while let Some(pid) = pending.pop() {
        let status = fs::read_to_string(format!("/proc/{pid}/status")).unwrap_or_default();
        let field = |name: &str| status.lines().find_map(|line| line.strip_prefix(name)).unwrap_or("").trim().to_string();
        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default(); let ticks: Vec<_> = stat.rsplit_once(") ").map(|(_, value)| value.split_whitespace().collect()).unwrap_or_default();
        let cpu_ticks: u64 = [11usize,12].into_iter().filter_map(|index| ticks.get(index).and_then(|value| value.parse::<u64>().ok())).sum();
        let io = fs::read_to_string(format!("/proc/{pid}/io")).unwrap_or_default();
        processes.push(json!({"pid":pid,"name":field("Name:"),"rss":field("VmRSS:"),"peak":field("VmHWM:"),"cpuTicks":cpu_ticks,"io":io,"stdinOpen":fs::metadata(format!("/proc/{pid}/fd/0")).is_ok(),"threads":field("Threads:"),"descriptors":fs::read_dir(format!("/proc/{pid}/fd")).map(|entries| entries.count()).unwrap_or(0)}));
        for entry in fs::read_dir(format!("/proc/{pid}/task")).into_iter().flatten().flatten() {
            if let Ok(children) = fs::read_to_string(entry.path().join("children")) {
                pending.extend(children.split_whitespace().filter_map(|child| child.parse::<u32>().ok()));
            }
        }
    }
    json!(processes)
}
#[tauri::command]
fn fixture_metrics(server: tauri::State<'_, local_media::MediaServer>) -> Value { server.metrics() }
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
    // Valid MP4 containers with sparse free boxes exercise large transfers.
    // Encoding stays small; hashing and every HTTP body use bounded reads.
    let mut large_sources = Vec::new();
    for mib in [120u64, 600, 1024] {
        let large_size = mib * 1024 * 1024;
        let temporary = root.join(format!("large-{mib}.mp4"));
        let mut large = fs::File::create(&temporary).unwrap(); large.write_all(&bytes).unwrap();
        large.write_all(&((large_size - bytes.len() as u64) as u32).to_be_bytes()).unwrap(); large.write_all(b"free").unwrap(); large.set_len(large_size).unwrap(); drop(large);
        let mut file = fs::File::open(&temporary).unwrap(); let mut digest = Sha256::new(); let mut block = [0u8; 65536];
        loop { let read = file.read(&mut block).unwrap(); if read == 0 { break; } digest.update(&block[..read]); }
        let large_hash = format!("{:x}", digest.finalize()); drop(file); fs::rename(temporary, root.join("objects").join(&large_hash)).unwrap();
        let mut large_manifest = manifest.clone(); large_manifest["resources"][0]["download"]["sizeBytes"] = json!(large_size); large_manifest["resources"][0]["download"]["checksums"]["sha256"] = json!(large_hash);
        let mut content = large_manifest.clone(); for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().unwrap().remove(key); }
        large_manifest["integrity"]["contentHash"] = json!(format!("{:x}", Sha256::digest(canonical(&content).as_bytes())));
        fs::write(directory.join("manifest.json"), serde_json::to_vec(&large_manifest).unwrap()).unwrap();
        let checked = server.inspect(&root, manifest["unit"]["unitId"].as_str().unwrap(), manifest["version"].as_u64().unwrap(), manifest["resources"][0]["resourceId"].as_str().unwrap()).unwrap(); assert!(checked.url.is_some(), "{}", checked.error.unwrap_or_default());
        large_sources.push(json!({"url": checked.url, "mimeType": "video/mp4", "codecMime": checked.codec_mime, "name": format!("H264 AAC {mib} MiB"), "sizeBytes": large_size}));
    }
    // Copy/hash the real encoded large video with bounded buffers as well.
    let encoded_path = std::path::PathBuf::from(std::env::var("ACTIVE_CLASSROOM_MEDIA_FIXTURE").unwrap()).parent().unwrap().join("encoded-large.mp4");
    let encoded_size = fs::metadata(&encoded_path).unwrap().len(); assert!(encoded_size > 500 * 1024 * 1024);
    let temporary = root.join("encoded-large.mp4");
    let mut input = fs::File::open(encoded_path).unwrap(); let mut output = fs::File::create(&temporary).unwrap();
    let mut digest = Sha256::new(); let mut block = [0u8; 65536];
    loop { let read = input.read(&mut block).unwrap(); if read == 0 { break; } digest.update(&block[..read]); output.write_all(&block[..read]).unwrap(); }
    let encoded_hash = format!("{:x}", digest.finalize()); drop(output); fs::rename(temporary, root.join("objects").join(&encoded_hash)).unwrap();
    let mut encoded_manifest = manifest.clone(); encoded_manifest["resources"][0]["download"]["sizeBytes"] = json!(encoded_size); encoded_manifest["resources"][0]["download"]["checksums"]["sha256"] = json!(encoded_hash);
    let mut content = encoded_manifest.clone(); for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().unwrap().remove(key); }
    encoded_manifest["integrity"]["contentHash"] = json!(format!("{:x}", Sha256::digest(canonical(&content).as_bytes())));
    fs::write(directory.join("manifest.json"), serde_json::to_vec(&encoded_manifest).unwrap()).unwrap();
    let checked = server.inspect(&root, manifest["unit"]["unitId"].as_str().unwrap(), manifest["version"].as_u64().unwrap(), manifest["resources"][0]["resourceId"].as_str().unwrap()).unwrap(); assert!(checked.url.is_some(), "{}", checked.error.unwrap_or_default());
    let large_source = json!({"url":checked.url,"mimeType":"video/mp4","codecMime":checked.codec_mime,"name":"H264 AAC encoded >500 MiB","sizeBytes":encoded_size});
    large_sources.push(large_source.clone());
    let performance_mode = std::env::var("ACTIVE_CLASSROOM_MEDIA_PERFORMANCE").as_deref() == Ok("1");
    let mut performance_source = source.clone();
    if performance_mode {
        let original = std::path::PathBuf::from(std::env::var("ACTIVE_CLASSROOM_MEDIA_FIXTURE").unwrap()).parent().unwrap().join("performance.mp4");
        let mut input = fs::File::open(&original).unwrap(); let mut digest = Sha256::new(); let mut block = [0u8;65536];
        loop { let read = input.read(&mut block).unwrap(); if read == 0 { break; } digest.update(&block[..read]); }
        let hash = format!("{:x}", digest.finalize()); let size = fs::metadata(&original).unwrap().len(); fs::copy(&original, root.join("objects").join(&hash)).unwrap();
        let mut published = manifest.clone(); published["resources"][0]["download"]["sizeBytes"] = json!(size); published["resources"][0]["download"]["checksums"]["sha256"] = json!(hash);
        let mut content = published.clone(); for key in ["version","publishedAt","integrity"] { content.as_object_mut().unwrap().remove(key); }
        published["integrity"]["contentHash"] = json!(format!("{:x}", Sha256::digest(canonical(&content).as_bytes()))); fs::write(directory.join("manifest.json"), serde_json::to_vec(&published).unwrap()).unwrap();
        let inspected = server.inspect(&root, manifest["unit"]["unitId"].as_str().unwrap(), manifest["version"].as_u64().unwrap(), manifest["resources"][0]["resourceId"].as_str().unwrap()).unwrap();
        performance_source = json!({"url":inspected.url,"mimeType":"video/mp4","codecMime":inspected.codec_mime,"name":"Performance H264 AAC 240 seconds","sizeBytes":size});
    }
    let script = fs::read(std::env::var("ACTIVE_CLASSROOM_MEDIA_SCRIPT").unwrap()).unwrap();
    let png_directory = std::path::PathBuf::from(std::env::var("ACTIVE_CLASSROOM_MEDIA_FIXTURE").unwrap()).parent().unwrap().to_path_buf();
    let mut build_manifest = manifest.clone(); build_manifest["mainPresentationId"] = json!("state-0"); build_manifest["generalResourceIds"] = json!([]);
    let mut build_resources = Vec::new(); let mut paths = serde_json::Map::new(); let mut allowed_paths = Vec::new();
    for index in 0..3 {
        let png = fs::read(png_directory.join(format!("state-{index}.png"))).unwrap(); let hash = format!("{:x}", Sha256::digest(&png));
        let path = root.join("objects").join(&hash); fs::write(&path, &png).unwrap();
        let mut resource = manifest["resources"][0].clone(); resource["resourceId"] = json!(format!("state-{index}")); resource["kind"] = json!("image"); resource["deliveryMime"] = json!("image/png"); resource["download"]["mimeType"] = json!("image/png"); resource["download"]["sizeBytes"] = json!(png.len()); resource["download"]["checksums"]["sha256"] = json!(hash);
        paths.insert(format!("state-{index}"), json!(path)); allowed_paths.push(path); build_resources.push(resource);
    }
    build_manifest["resources"] = json!(build_resources);
    build_manifest["slides"] = json!([
        {"slideId":"interactive","index":0,"title":"Revelados","metadata":{"pageNumber":1,"presentationResourceId":"state-0"},"resourceIds":[],"interactionMode":"builds","buildCount":2,"interaction":{"mode":"builds","buildCount":2,"source":"pptx"},"builds":[{"order":1,"resourceId":"state-1"},{"order":2,"resourceId":"state-2"}]},
        {"slideId":"static","index":1,"title":"Estática","metadata":{"pageNumber":1,"presentationResourceId":"state-0"},"resourceIds":[]}
    ]);
    let build_fixture = json!({"manifest":build_manifest,"paths":paths});
    let mut music_manifest = build_manifest.clone();
    let wave = fs::read(png_directory.join("music.wav")).unwrap(); let music_hash = format!("{:x}", Sha256::digest(&wave));
    let music_path = root.join("objects").join(&music_hash); fs::write(&music_path, &wave).unwrap();
    let mut audio = manifest["resources"][0].clone();
    audio["resourceId"] = json!("music-wave"); audio["name"] = json!("Trabajo tranquilo"); audio["kind"] = json!("audio"); audio["deliveryMime"] = json!("audio/wav"); audio["download"]["mimeType"] = json!("audio/wav"); audio["download"]["sizeBytes"] = json!(wave.len()); audio["download"]["checksums"]["sha256"] = json!(music_hash);
    music_manifest["resources"].as_array_mut().unwrap().push(audio.clone());
    music_manifest["resources"].as_array_mut().unwrap().push(manifest["resources"][0].clone());
    music_manifest["generalResourceIds"] = json!([manifest["resources"][0]["resourceId"]]);
    music_manifest["backgroundMusic"] = json!([{"id":"music-wave","resourceId":"music-wave","title":"Trabajo tranquilo","sourceType":"file","order":0,"mime":"audio/wav","size":wave.len(),"sha256":music_hash,"storagePath":audio["download"]["path"],"generation":audio["download"]["generation"]}]);
    let mut content = music_manifest.clone(); for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().unwrap().remove(key); }
    music_manifest["integrity"]["contentHash"] = json!(format!("{:x}", Sha256::digest(canonical(&content).as_bytes())));
    fs::write(directory.join("manifest.json"), serde_json::to_vec(&music_manifest).unwrap()).unwrap();
    let checked = server.inspect(&root, manifest["unit"]["unitId"].as_str().unwrap(), manifest["version"].as_u64().unwrap(), "music-wave").unwrap(); assert!(checked.url.is_some());
    let music_source = json!({"url":checked.url,"mimeType":"audio/wav","name":"Trabajo tranquilo","sizeBytes":wave.len()});
    let mut music_paths = paths.clone(); music_paths.insert("music-wave".into(), json!(music_path));
    let pdf = fs::read(png_directory.join("transition.pdf")).unwrap(); let pdf_hash = format!("{:x}", Sha256::digest(&pdf));
    let pdf_path = root.join("objects").join(&pdf_hash); fs::write(&pdf_path, &pdf).unwrap(); allowed_paths.push(pdf_path.clone());
    let mut pdf_resource = audio.clone(); pdf_resource["resourceId"] = json!("transition-pdf"); pdf_resource["name"] = json!("PDF transición"); pdf_resource["kind"] = json!("document"); pdf_resource["deliveryMime"] = json!("application/pdf"); pdf_resource["download"]["mimeType"] = json!("application/pdf"); pdf_resource["download"]["sizeBytes"] = json!(pdf.len()); pdf_resource["download"]["checksums"]["sha256"] = json!(pdf_hash);
    music_manifest["resources"].as_array_mut().unwrap().push(pdf_resource);
    music_manifest["generalResourceIds"].as_array_mut().unwrap().push(json!("transition-pdf"));
    let mut content = music_manifest.clone(); for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().unwrap().remove(key); }
    music_manifest["integrity"]["contentHash"] = json!(format!("{:x}", Sha256::digest(canonical(&content).as_bytes())));
    music_paths.insert("transition-pdf".into(), json!(pdf_path));
    music_paths.insert(manifest["resources"][0]["resourceId"].as_str().unwrap().into(), json!(path));
    // Global music shares the exact cached WAV object, outside every Unit manifest.
    let mut ambient = json!({"schemaVersion":1,"ambientCatalogVersion":1,"tracks":[{"id":music_hash,"sha256":music_hash,"title":"Trabajo tranquilo","sourceType":"file","mime":"audio/wav","size":wave.len(),"storagePath":format!("active-classroom/publications/files/{music_hash}"),"generation":"1","order":0,"active":true}],"playlists":[]});
    ambient["integrity"] = json!({"algorithm":"sha256","contentHash":format!("{:x}",Sha256::digest(canonical(&json!({"schemaVersion":1,"tracks":ambient["tracks"],"playlists":ambient["playlists"]})).as_bytes()))});
    let ambient_directory = root.join("ambient/versions/1"); fs::create_dir_all(&ambient_directory).unwrap(); fs::write(ambient_directory.join("catalog.json"),serde_json::to_vec(&ambient).unwrap()).unwrap();
    let global_checked = server.inspect_ambient(&root,1,&music_hash).unwrap(); assert!(global_checked.url.is_some());
    let global_source = json!({"url":global_checked.url,"mimeType":"audio/wav","name":"Trabajo tranquilo","sizeBytes":wave.len()});
    let global_tracks = json!([{"id":music_hash,"resourceId":music_hash,"title":"Trabajo tranquilo","sourceType":"file","order":0}]);
    let music_fixture = json!({"manifest":music_manifest,"paths":music_paths,"source":music_source,"globalSource":global_source,"globalTracks":global_tracks});
    let css = format!("{}\n{}\n{}", include_str!("../../src/design-system.css"), include_str!("../../src/styles.css"), include_str!("../../src/player/player.css"));
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap(); let csp = config["app"]["security"]["csp"].as_str().unwrap().to_string();
    let mut context = tauri::generate_context!(); context.config_mut().app.windows.clear();
    let passed = Arc::new(AtomicBool::new(false));
    let app = tauri::Builder::default().manage(Fixture(json!({"source": source, "largeSource": large_source, "largeSources": large_sources, "path": path, "manifest": manifest, "buildFixture": build_fixture, "musicFixture":music_fixture,"nativeProjection": true,"performance":performance_mode,"performanceSource":performance_source}))).manage(Audience::default()).manage(server).manage(passed.clone())
        .register_uri_scheme_protocol("tauri", move |_, request| {
            let (mime, body) = match request.uri().path() {
                "/test.js" => ("text/javascript", script.clone()), "/style.css" => ("text/css", css.as_bytes().to_vec()),
                _ => ("text/html", b"<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/style.css'></head><body><div id='app'></div><div id='media' style='height:240px'></div><div id='audience' style='height:100px'></div><script src='/test.js'></script></body></html>".to_vec()),
            };
            tauri::http::Response::builder().header("Content-Type", mime).header("Content-Security-Policy", &csp).body(body).unwrap()
        })
        .invoke_handler(tauri::generate_handler![media_fixture, fixture_report, fixture_fullscreen, fixture_size, fixture_memory, fixture_metrics, fixture_project, fixture_audience_state, local_media::classroom_media_diagnostic])
        .setup(move |app| {
            app.asset_protocol_scope().allow_file(&path)?;
            for png_path in &allowed_paths { app.asset_protocol_scope().allow_file(png_path)?; }
            // Direct Cargo builds use devUrl unless custom-protocol is enabled.
            // Select the installed app's origin explicitly for this fixture.
            WebviewWindowBuilder::new(app, "teacher", WebviewUrl::CustomProtocol("tauri://localhost/media-test.html".parse().unwrap())).title("Media + scroll fixture").inner_size(1240.0, 820.0)
                .on_page_load(|_, page| eprintln!("MEDIA_FIXTURE_PAGE {:?} {}", page.event(), page.url()))
                .build()?;
            WebviewWindowBuilder::new(app, "audience", WebviewUrl::CustomProtocol("tauri://localhost/projection-test.html".parse().unwrap())).title("Media audience fixture").inner_size(800.0, 600.0).visible(false).build()?; Ok(())
        }).build(context).unwrap();
    let handle = app.handle().clone(); let success = passed.clone();
    std::thread::spawn(move || { std::thread::sleep(Duration::from_secs(480)); if !success.load(Ordering::SeqCst) { eprintln!("MEDIA_NATIVE_TIMEOUT"); handle.exit(1); } });
    app.run(|_, _| {}); fs::remove_dir_all(root).unwrap(); assert!(passed.load(Ordering::SeqCst), "Native media/scroll acceptance failed");
}
