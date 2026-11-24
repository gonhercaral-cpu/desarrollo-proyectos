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
    let mut last_error = None;
    for _ in 0..100 {
        // Wry queues initial scripts until the first page is ready, without
        // retaining eval callbacks. Navigation can also replace the JS context.
        // Retry readiness observations; the condition must still become true.
        match evaluate(view, expression).await {
            Ok(value) if value == true => return Ok(()),
            Ok(_) => {},
            Err(error) => last_error = Some(error),
        }
        delay(100).await;
    }
    Err(format!("No se cumplió la condición de la fixture: {expression}; {last_error:?}"))
}
async fn action(app: &tauri::AppHandle, action: &str, data: Option<Value>) -> Result<Value, String> {
    let teacher = app.get_webview("teacher").ok_or("Falta teacher")?;
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
// XTest pointer/keyboard input verifies that the native overlay does not eat
// clicks on the teacher toolbar and that the page itself remains interactive.
async fn pointer(app: &tauri::AppHandle, x: f64, y: f64, text: Option<&str>) -> Result<(), String> {
    let scale = app.get_window("teacher").ok_or("Falta docente")?.scale_factor().map_err(|e| e.to_string())?;
    let found = std::process::Command::new("xdotool").args(["search","--onlyvisible","--name","^Browser geometry fixture$"]).output().map_err(|e|e.to_string())?;
    let id = String::from_utf8_lossy(&found.stdout).lines().next().ok_or("Falta ventana X11 de prueba")?.to_string();
    let clicked = std::process::Command::new("xdotool").args(["mousemove","--window",&id,&format!("{}",(x*scale).round() as i32),&format!("{}",(y*scale).round() as i32),"click","1"]).status().map_err(|e|e.to_string())?;
    if !clicked.success() { return Err("Falló el clic nativo".into()); }
    if let Some(text) = text {
        let typed = std::process::Command::new("xdotool").args(["type","--clearmodifiers",text]).status().map_err(|e|e.to_string())?;
        if !typed.success() { return Err("Falló el teclado nativo".into()); }
    }
    Ok(())
}
async fn teacher_pointer(app: &tauri::AppHandle) -> Result<(), String> {
    if std::env::var("XDG_SESSION_TYPE").as_deref() != Ok("x11") { return Ok(()); }
    let teacher = app.get_webview("teacher").ok_or("Falta docente")?;
    evaluate(&teacher,"window.toolbarClicks=0;true").await?;
    pointer(app,30.,30.,None).await?;
    until(&teacher,"window.toolbarClicks===1").await
}
// Observe GTK allocations and mapped ancestors, not just JS state. A page can
// execute normally while its native parent is hidden or half the window tall.
#[cfg(target_os = "linux")]
async fn geometry(view: &tauri::Webview) -> Result<Value, String> {
    use gtk::prelude::*;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    view.with_webview(move |platform| {
        let widget = platform.inner();
        let allocation = widget.allocation();
        let position = widget.toplevel().and_then(|top| widget.translate_coordinates(&top, 0, 0));
        let _ = sender.try_send(json!({"drawable":widget.is_drawable(), "width":allocation.width(), "height":allocation.height(),
            "x":position.map(|p|p.0),"y":position.map(|p|p.1)}));
    }).map_err(|e| e.to_string())?;
    receiver.recv().await.ok_or("No llegó geometría GTK".into())
}
#[cfg(not(target_os = "linux"))]
async fn geometry(_: &tauri::Webview) -> Result<Value, String> { Err("Solo Linux".into()) }
async fn assert_geometry(view: &tauri::Webview, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    let mut actual = Value::Null;
    for _ in 0..100 {
        actual = geometry(view).await?;
        if actual["drawable"] == true && [("x",x),("y",y),("width",width),("height",height)].iter()
            .all(|(key,expected)| actual[*key].as_i64().map(|v|(v-*expected as i64).abs()<=2).unwrap_or(false)) { return Ok(()); }
        delay(30).await;
    }
    Err(format!("Vista no visible o geometría incorrecta: {actual}; esperado {x},{y},{width},{height}"))
}
async fn acceptance(app: &tauri::AppHandle, base: &str, downloads: &AtomicUsize) -> Result<Value, String> {
    delay(800).await;
    let teacher = app.get_webview("teacher").ok_or("Falta docente")?;
    until(&teacher, "document.readyState==='complete'").await?;
    evaluate(&teacher,"window.toolbarClicks=0;window.hostClicks=0;document.querySelector('#toolbar').onclick=()=>window.toolbarClicks++;document.querySelector('#inside').onclick=()=>window.hostClicks++;true").await?;
    let teacher_before = evaluate(&teacher, "({width:innerWidth,height:innerHeight})").await?;
    let bounds = json!({"x":10,"y":100,"width":760,"height":450});
    let opened = action(app, "open", Some(json!({"url":format!("{base}/first"),"bounds":bounds}))).await?;
    assert_eq!(opened["open"], true);
    let view = app.get_webview("classroom-browser").ok_or("No se creó child webview")?;
    println!("BROWSER_CHECKPOINT initial-geometry");
    assert_geometry(&view, 10, 100, 760, 450).await?;
    assert_eq!(evaluate(&teacher, "({width:innerWidth,height:innerHeight})").await?,teacher_before,"Se dividió la ventana docente");
    println!("BROWSER_CHECKPOINT initial-load");
    until(&view, "window.fixtureReady===true").await?;
    teacher_pointer(app).await?;
    if std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("x11") {
        pointer(app,30.,120.,Some("teclado")).await?;
        until(&view,"document.querySelector('#answer').value.includes('teclado')").await?;
    }
    evaluate(&view, "document.querySelector('#answer').value='conservar';sessionStorage.setItem('lesson','47');document.cookie='fixture=47';true").await?;
    // All these are forbidden from a real remote-origin webview, not a DOM mock.
    println!("BROWSER_CHECKPOINT teacher-cache-with-child");
    let teacher = app.get_webview("teacher").ok_or("Falta vista docente")?;
    evaluate(&teacher, "window.cacheWorks=false;window.__TAURI_INTERNALS__.invoke('classroom_cache',{owner:'browser-ci',action:'inventory',data:{}}).then(value=>window.cacheWorks=Array.isArray(value),()=>{});true").await?;
    until(&teacher, "window.cacheWorks===true").await?;
    println!("BROWSER_CHECKPOINT remote-ipc");
    evaluate(&view, "window.ipcDenied=false;window.dialogDenied=false;window.cacheDenied=false; const invoke=window.__TAURI_INTERNALS__?.invoke;if(!invoke){window.ipcDenied=true;window.dialogDenied=true;window.cacheDenied=true;}else{invoke('classroom_browser',{action:'close'}).then(()=>{},()=>window.ipcDenied=true);invoke('plugin:dialog|open',{options:{}}).then(()=>{},()=>window.dialogDenied=true);invoke('classroom_cache',{owner:'browser-ci',action:'inventory',data:{}}).then(()=>{},()=>window.cacheDenied=true);}true").await?;
    until(&view, "window.ipcDenied===true && window.dialogDenied===true && window.cacheDenied===true").await?;
    evaluate(&view, "window.open('/next');document.querySelector('#popup').click();true").await?;
    delay(300).await; assert_eq!(app.webviews().len(), 2, "Popup creó otra vista");
    assert!(action(app,"navigate",Some(json!({"url":"file:///etc/passwd"}))).await.is_err());
    assert!(action(app,"navigate",Some(json!({"url":"asset://localhost/private"}))).await.is_err());
    // A normal H.264/AAC resource must load in the remote webview too.
    println!("BROWSER_CHECKPOINT remote-video");
    until(&view, "document.querySelector('#clip').readyState>=2 && document.querySelector('#clip').videoWidth>0").await?;
    evaluate(&view, "document.querySelector('#clip').play().catch(()=>{});true").await?;
    until(&view, "document.querySelector('#clip').currentTime>0.1").await?;
    let media_ready = true;
    let mut cycles = 0;
    if std::env::var_os("CLASSROOM_BROWSER_PROJECT").is_some() {
        let teacher = app.get_webview("teacher").unwrap();
        let current = teacher.window().current_monitor().map_err(|e| e.to_string())?.ok_or("Monitor docente ausente")?;
        let monitors = audience_window::classroom_projection(app.clone(),teacher.clone(),app.state(),"monitors".into(),None).await?;
        let target = monitors["monitors"].as_array().unwrap().iter().find(|m| m["x"]!=current.position().x || m["y"]!=current.position().y).ok_or("Falta segunda pantalla virtual")?;
        for cycle in 0..30 {
            println!("BROWSER_CHECKPOINT projection-cycle-{cycle}");
            let shown=action(app,"present",Some(json!({"monitorId":target["id"]}))).await?;
            assert_eq!(shown["presenting"],true);
            let screen = app.get_window("classroom-browser-screen").ok_or("Falta ventana externa")?;
            let mut on_target = false;
            for _ in 0..100 {
                on_target = screen.current_monitor().map_err(|e|e.to_string())?.map(|monitor|
                    Some(monitor.position().x as i64) == target["x"].as_i64() && Some(monitor.position().y as i64) == target["y"].as_i64()).unwrap_or(false);
                if on_target { break; }
                delay(30).await;
            }
            assert!(on_target, "La página no llegó a la pantalla seleccionada");
            let scale = target["scaleFactor"].as_f64().ok_or("Falta escala de pantalla")?;
            assert_geometry(&view,0,0,(target["width"].as_f64().unwrap()/scale) as i32,(target["height"].as_f64().unwrap()/scale) as i32).await?;
            assert_eq!(evaluate(&view,"document.querySelector('#answer').value==='conservar' && sessionStorage.getItem('lesson')==='47'").await?,true);
            let returned=action(app,"return",Some(json!({"bounds":bounds}))).await?;
            assert_eq!(returned["presenting"],false);
            assert_geometry(&view,10,100,760,450).await?;
            assert_eq!(evaluate(&teacher, "({width:innerWidth,height:innerHeight})").await?,teacher_before,"El retorno dividió la ventana docente");
            assert_eq!(evaluate(&view,"document.querySelector('#answer').value==='conservar' && document.cookie.includes('fixture=47')").await?,true);
            cycles+=1;
        }
    }
    println!("BROWSER_CHECKPOINT history");
    action(app,"navigate",Some(json!({"url":format!("{base}/second")}))).await?;
    until(&view,"location.pathname==='/second' && window.fixtureReady===true").await?;
    action(app,"back",None).await?; until(&view,"location.pathname==='/first'").await?;
    action(app,"forward",None).await?; until(&view,"location.pathname==='/second'").await?;
    action(app,"reload",None).await?; until(&view,"window.fixtureReady===true && location.pathname==='/second'").await?;
    println!("BROWSER_CHECKPOINT download");
    action(app,"navigate",Some(json!({"url":format!("{base}/download")}))).await?;
    for _ in 0..50 { if downloads.load(Ordering::SeqCst)>0 {break;} delay(100).await; }
    assert!(downloads.load(Ordering::SeqCst)>0,"No se intentó descarga"); delay(200).await;
    action(app,"close",None).await?; assert!(app.get_webview("classroom-browser").is_none());
    teacher_pointer(app).await?;
    if std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("x11") {
        pointer(app,30.,130.,None).await?;
        until(&teacher,"window.hostClicks===1").await?;
    }
    println!("BROWSER_CHECKPOINT fresh-session");
    action(app,"open",Some(json!({"url":format!("{base}/fresh"),"bounds":bounds}))).await?;
    let fresh=app.get_webview("classroom-browser").unwrap(); until(&fresh,"window.fixtureReady===true").await?;
    assert_eq!(evaluate(&fresh,"sessionStorage.getItem('lesson')===null && !document.cookie.includes('fixture=47')").await?,true,"La sesión efímera no se liberó");
    action(app,"close",None).await?;
    Ok(json!({"ok":true,"session":std::env::var("XDG_SESSION_TYPE").unwrap_or_default(),"projectionCycles":cycles,"mediaReady":media_ready,"ipcDenied":true,"teacherCacheWithChild":true,"remoteCacheDenied":true,"popupDenied":true,"ephemeralSessionCleared":true,"nativeGeometryVerified":true,"teacherViewportPreserved":true,"nativePointerVerified":std::env::var("XDG_SESSION_TYPE").as_deref()==Ok("x11")}))
}
fn main() {
    #[cfg(not(target_os="linux"))] { eprintln!("Acceptance requires Linux"); return; }
    #[allow(unreachable_code)] {
        let (base, downloads)=fixture();
        let mut context=tauri::generate_context!();context.config_mut().app.windows.clear();
        let passed=Arc::new(AtomicBool::new(false));let success=passed.clone();
        let app=tauri::Builder::default().plugin(tauri_plugin_dialog::init()).manage(browser::BrowserGate::default()).manage(audience_window::ProjectionGate::default()).manage(offline_cache::CacheGate::default())
            .on_window_event(browser::window_event)
            .register_uri_scheme_protocol("tauri", |_, _| tauri::http::Response::builder().header("Content-Type","text/html").body(br#"<!doctype html><title>Teacher browser fixture</title><button id="toolbar" style="position:fixed;left:10px;top:10px;width:150px;height:50px">Control docente</button><button id="inside" style="position:fixed;left:10px;top:110px;width:150px;height:50px">Clase</button>"#.to_vec()).unwrap())
            .invoke_handler(tauri::generate_handler![browser::classroom_browser,offline_cache::classroom_cache])
            .setup(move |app| {
                let teacher=WebviewWindowBuilder::new(app,"teacher",WebviewUrl::CustomProtocol("tauri://localhost/browser-test".parse().unwrap())).title("Browser geometry fixture").decorations(false).inner_size(800.,600.).build()?;
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
