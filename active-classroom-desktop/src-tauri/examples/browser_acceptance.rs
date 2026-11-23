//! Test-only Linux binary using the production browser, projector and policy.
//! The HTTP fixture is local; no Firebase, credentials or external sites are used.
#[path = "../src/browser.rs"] mod browser;
#[path = "../src/audience_window.rs"] mod audience_window;
#[path = "../src/local_media.rs"] mod local_media;
#[path = "../src/media_report.rs"] mod media_report;
#[path = "../src/offline_cache.rs"] mod offline_cache;
#[path = "../src/device_identity.rs"] mod device_identity;

use serde_json::{json, Value};
use std::{io::{Read, Write}, net::TcpListener, sync::{Arc, atomic::{AtomicBool, AtomicUsize, Ordering}}, time::Duration};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

async fn delay(ms: u64) {
    tauri::async_runtime::spawn_blocking(move || std::thread::sleep(Duration::from_millis(ms))).await.unwrap();
}
async fn evaluate(view: &tauri::Webview, source: &str) -> Result<Value, String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    view.eval_with_callback(source, move |data| { let _ = sender.try_send(data); }).map_err(|e| e.to_string())?;
    serde_json::from_str(&receiver.recv().await.ok_or("No llegó resultado JavaScript")?).map_err(|e| e.to_string())
}
async fn until(view: &tauri::Webview, expression: &str) -> Result<(), String> {
    for _ in 0..100 {
        if evaluate(view, expression).await? == true { return Ok(()); }
        delay(100).await;
    }
    Err(format!("No se cumplió la condición de la fixture: {expression}"))
}
async fn action(app: &tauri::AppHandle, action: &str, data: Option<Value>) -> Result<Value, String> {
    let teacher = app.get_webview_window("teacher").ok_or("Falta teacher")?;
    let status = browser::classroom_browser(app.clone(), teacher, app.state(), action.into(), data).await?;
    serde_json::to_value(status).map_err(|e| e.to_string())
}
fn fixture() -> (String, Arc<AtomicUsize>) {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = server.local_addr().unwrap().port();
    let downloads = Arc::new(AtomicUsize::new(0)); let counter = downloads.clone();
    let clip = std::fs::read(std::env::var("CLASSROOM_BROWSER_CLIP").expect("Fixture multimedia requerida")).unwrap();
    std::thread::spawn(move || {
        for mut socket in server.incoming().flatten() {
            let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));
            let mut request = [0u8; 8192]; let length = socket.read(&mut request).unwrap_or(0);
            let request = String::from_utf8_lossy(&request[..length]);
            let path = request.split_whitespace().nth(1).unwrap_or("/");
            let (mime, extra, bytes) = if path.starts_with("/clip.mp4") {
                ("video/mp4", "", clip.clone())
            } else if path.starts_with("/download") {
                counter.fetch_add(1, Ordering::SeqCst);
                ("application/octet-stream", "Content-Disposition: attachment; filename=escape.bin\r\n", b"blocked download".to_vec())
            } else {
                ("text/html", "", br#"<!doctype html><title>Browser acceptance</title>
                  <input id="answer"><input id="upload" type="file">
                  <a id="popup" href="/next" target="_blank">popup</a>
                  <video id="clip" muted autoplay loop playsinline src="/clip.mp4"></video>
                  <script>window.fixtureReady=true;</script>"#.to_vec())
            };
            let header = format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\n{extra}Connection: close\r\n\r\n", bytes.len());
            let _ = socket.write_all(header.as_bytes()); let _ = socket.write_all(&bytes);
        }
    });
    (format!("http://classroom-browser.test:{port}"), downloads)
}
async fn acceptance(app: &tauri::AppHandle, base: &str, downloads: &AtomicUsize) -> Result<Value, String> {
    delay(800).await;
    let bounds = json!({"x":10,"y":100,"width":760,"height":450});
    let opened = action(app, "open", Some(json!({"url":format!("{base}/first"),"bounds":bounds}))).await?;
    assert_eq!(opened["open"], true);
    let view = app.get_webview("classroom-browser").ok_or("No se creó child webview")?;
    until(&view, "window.fixtureReady===true").await?;
    evaluate(&view, "document.querySelector('#answer').value='conservar';sessionStorage.setItem('lesson','47');document.cookie='fixture=47';true").await?;
    // All these are forbidden from a real remote-origin webview, not a DOM mock.
    evaluate(&view, "window.ipcDenied=false;window.dialogDenied=false; const invoke=window.__TAURI_INTERNALS__?.invoke;if(!invoke){window.ipcDenied=true;window.dialogDenied=true;}else{invoke('classroom_browser',{action:'close'}).then(()=>{},()=>window.ipcDenied=true);invoke('plugin:dialog|open',{options:{}}).then(()=>{},()=>window.dialogDenied=true);}true").await?;
    until(&view, "window.ipcDenied===true && window.dialogDenied===true").await?;
    evaluate(&view, "window.open('/next');document.querySelector('#popup').click();true").await?;
    delay(300).await; assert_eq!(app.webviews().len(), 2, "Popup creó otra vista");
    assert!(action(app,"navigate",Some(json!({"url":"file:///etc/passwd"}))).await.is_err());
    assert!(action(app,"navigate",Some(json!({"url":"asset://localhost/private"}))).await.is_err());
    // A normal H.264/AAC resource must load in the remote webview too.
    until(&view, "document.querySelector('#clip').readyState>=2 && document.querySelector('#clip').videoWidth>0").await?;
    evaluate(&view, "document.querySelector('#clip').play().catch(()=>{});true").await?;
    until(&view, "document.querySelector('#clip').currentTime>0.1").await?;
    let media_ready = true;
    let mut cycles = 0;
    if std::env::var_os("CLASSROOM_BROWSER_PROJECT").is_some() {
        let teacher = app.get_webview_window("teacher").unwrap();
        let current = teacher.current_monitor().map_err(|e| e.to_string())?.ok_or("Monitor docente ausente")?;
        let monitors = audience_window::classroom_projection(app.clone(),teacher,app.state(),"monitors".into(),None).await?;
        let target = monitors["monitors"].as_array().unwrap().iter().find(|m| m["x"]!=current.position().x || m["y"]!=current.position().y).ok_or("Falta segunda pantalla virtual")?;
        for _ in 0..30 {
            let shown=action(app,"present",Some(json!({"monitorId":target["id"]}))).await?;
            assert_eq!(shown["presenting"],true); delay(80).await;
            assert_eq!(evaluate(&view,"document.querySelector('#answer').value==='conservar' && sessionStorage.getItem('lesson')==='47'").await?,true);
            let returned=action(app,"return",Some(json!({"bounds":bounds}))).await?;
            assert_eq!(returned["presenting"],false); delay(80).await;
            assert_eq!(evaluate(&view,"document.querySelector('#answer').value==='conservar' && document.cookie.includes('fixture=47')").await?,true);
            cycles+=1;
        }
    }
    action(app,"navigate",Some(json!({"url":format!("{base}/second")}))).await?;
    until(&view,"location.pathname==='/second' && window.fixtureReady===true").await?;
    action(app,"back",None).await?; until(&view,"location.pathname==='/first'").await?;
    action(app,"forward",None).await?; until(&view,"location.pathname==='/second'").await?;
    action(app,"reload",None).await?; until(&view,"window.fixtureReady===true && location.pathname==='/second'").await?;
    action(app,"navigate",Some(json!({"url":format!("{base}/download")}))).await?;
    for _ in 0..50 { if downloads.load(Ordering::SeqCst)>0 {break;} delay(100).await; }
    assert!(downloads.load(Ordering::SeqCst)>0,"No se intentó descarga"); delay(200).await;
    action(app,"close",None).await?; assert!(app.get_webview("classroom-browser").is_none());
    action(app,"open",Some(json!({"url":format!("{base}/fresh"),"bounds":bounds}))).await?;
    let fresh=app.get_webview("classroom-browser").unwrap(); until(&fresh,"window.fixtureReady===true").await?;
    assert_eq!(evaluate(&fresh,"sessionStorage.getItem('lesson')===null && !document.cookie.includes('fixture=47')").await?,true,"La sesión efímera no se liberó");
    action(app,"close",None).await?;
    Ok(json!({"ok":true,"session":std::env::var("XDG_SESSION_TYPE").unwrap_or_default(),"projectionCycles":cycles,"mediaReady":media_ready,"ipcDenied":true,"popupDenied":true,"ephemeralSessionCleared":true}))
}
fn main() {
    #[cfg(not(target_os="linux"))] { eprintln!("Acceptance requires Linux"); return; }
    #[allow(unreachable_code)] {
        let (base, downloads)=fixture();
        let mut context=tauri::generate_context!();context.config_mut().app.windows.clear();
        let passed=Arc::new(AtomicBool::new(false));let success=passed.clone();
        let app=tauri::Builder::default().manage(browser::BrowserGate::default()).manage(audience_window::ProjectionGate::default())
            .on_window_event(browser::window_event)
            .invoke_handler(tauri::generate_handler![browser::classroom_browser])
            .setup(move |app| {
                let teacher=WebviewWindowBuilder::new(app,"teacher",WebviewUrl::External("about:blank".parse().unwrap())).inner_size(800.,600.).build()?;
                if std::env::var_os("CLASSROOM_BROWSER_PROJECT").is_some() {
                    let monitors=teacher.available_monitors()?; assert_eq!(monitors.len(),2);
                    teacher.set_fullscreen_on_monitor(tauri::PhysicalPosition::new(monitors[0].position().x as f64,monitors[0].position().y as f64))?;
                }
                let handle=app.handle().clone();let watchdog=handle.clone();
                std::thread::spawn(move || {std::thread::sleep(Duration::from_secs(100));watchdog.exit(1);});
                tauri::async_runtime::spawn(async move {
                    match acceptance(&handle,&base,&downloads).await {
                        Ok(report)=>{println!("BROWSER_ACCEPTANCE {report}");success.store(true,Ordering::SeqCst);handle.exit(0);}
                        Err(error)=>{eprintln!("BROWSER_ACCEPTANCE_ERROR {error}");handle.exit(1);}
                    }
                });
                Ok(())
            }).build(context).expect("Tauri browser acceptance");
        app.run(|_,_|{});assert!(passed.load(Ordering::SeqCst));
    }
}
