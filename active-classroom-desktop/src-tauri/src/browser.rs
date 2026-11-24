//! Untrusted Internet content has its own webview, ephemeral context and no ACL.
//! Only the local teacher webview can operate it. No external browser is launched.
#[path = "browser_mirror.rs"] mod mirror;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{webview::{NewWindowResponse, PageLoadEvent, PermissionResponse, WebviewBuilder}, Manager};

const VIEW: &str = "classroom-browser";
const SCREEN: &str = "classroom-browser-screen";

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserStatus {
    open: bool, url: String, title: String, loading: bool, presenting: bool,
    projection_error: Option<String>,
}
#[derive(Clone, Copy, Debug, Deserialize)]
struct Bounds { x: f64, y: f64, width: f64, height: f64 }
#[derive(Default)]
struct Session { status: BrowserStatus, bounds: Option<Bounds>, target: Option<String>, mirror: Option<std::sync::Arc<mirror::MirrorControl>> }
#[derive(Default)]
pub(crate) struct BrowserGate {
    operation: tauri::async_runtime::Mutex<()>,
    session: Mutex<Session>,
}

fn allowed_url(value: &str) -> Result<tauri::Url, String> {
    if value.len() > 8192 || value.chars().any(char::is_control) { return Err("Dirección web inválida".into()); }
    let url = tauri::Url::parse(value).map_err(|_| "Escribe una dirección http o https válida")?;
    let host = url.host_str().ok_or("La dirección necesita un servidor")?.trim_end_matches('.');
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some()
        || host.eq_ignore_ascii_case("localhost") || host.to_ascii_lowercase().ends_with(".localhost")
        || host.trim_matches(['[', ']']).parse::<std::net::IpAddr>().map(|ip| ip.is_loopback() || ip.is_unspecified() || ip.is_multicast()).unwrap_or(false) {
        return Err("Solo se permiten sitios http o https; los recursos internos están bloqueados".into());
    }
    Ok(url)
}
fn bounds(data: &Value) -> Result<Bounds, String> {
    let value: Bounds = serde_json::from_value(data["bounds"].clone()).map_err(|_| "Área del navegador no disponible")?;
    if [value.x, value.y, value.width, value.height].iter().any(|v| !v.is_finite())
        || value.x < 0.0 || value.y < 0.0 || value.width < 1.0 || value.height < 1.0
        || value.x + value.width > 20000.0 || value.y + value.height > 20000.0 {
        return Err("Área del navegador inválida".into());
    }
    Ok(value)
}
fn check_bounds(window: &tauri::Window, value: Bounds) -> Result<(), String> {
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    if value.x + value.width > size.width as f64 / scale + 1.0 || value.y + value.height > size.height as f64 / scale + 1.0 {
        return Err("El área excede la ventana docente".into());
    }
    Ok(())
}
// Tauri's GTK child views are packed into a vertical Box. Bounds on that
// container are ignored by Wry: a second child divides the teacher viewport.
// Keep the trusted view full-sized and place the browser in an overlay layer.
#[cfg(target_os = "linux")]
async fn place(view: &tauri::Webview, value: Bounds) -> Result<(), String> {
    use gtk::prelude::*;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    view.with_webview(move |platform| {
        let result = (|| -> Result<(), String> {
            let native = platform.inner();
            let parent = native.parent().ok_or("El navegador no tiene contenedor")?;
            let layer = if let Ok(layer) = parent.clone().downcast::<gtk::Layout>() {
                layer
            } else {
                let container = parent.downcast::<gtk::Box>().map_err(|_| "Contenedor del navegador incompatible")?;
                let existing = container.children().into_iter().find_map(|child| child.downcast::<gtk::Overlay>().ok());
                let overlay = match existing {
                    Some(overlay) => overlay,
                    None => {
                        let teacher = container.children().into_iter().find(|child| child.is::<webkit2gtk::WebView>() && child != native.upcast_ref::<gtk::Widget>())
                            .ok_or("Falta el contenido docente")?;
                        let overlay = gtk::Overlay::new();
                        container.remove(&teacher);
                        overlay.add(&teacher);
                        container.pack_start(&overlay, true, true, 0);
                        overlay.show_all();
                        overlay
                    }
                };
                let layer = overlay.children().into_iter().find_map(|child| child.downcast::<gtk::Layout>().ok())
                    .unwrap_or_else(|| {
                        let layer = gtk::Layout::new(None::<&gtk::Adjustment>, None::<&gtk::Adjustment>);
                        layer.set_halign(gtk::Align::Start); layer.set_valign(gtk::Align::Start);
                        // Empty input windows must not intercept the class after
                        // projection or close. The same layer is reused on return.
                        layer.connect_remove(|layer, _| layer.hide());
                        overlay.add_overlay(&layer);
                        layer
                    });
                container.remove(&native);
                layer.put(&native, 0, 0);
                layer
            };
            // Layout has no natural-size dependency on its children. WebKit can
            // retain the projector's preferred size; it must not enlarge the host.
            // Both the paint and input windows cover only the reserved rectangle.
            layer.set_margin_start(value.x.round() as i32); layer.set_margin_top(value.y.round() as i32);
            layer.set_size_request(value.width.round() as i32, value.height.round() as i32);
            layer.set_size(value.width.round() as u32, value.height.round() as u32);
            native.set_margin_start(0); native.set_margin_end(0);
            native.set_margin_top(0); native.set_margin_bottom(0);
            native.set_halign(gtk::Align::Fill); native.set_valign(gtk::Align::Fill);
            native.set_hexpand(false); native.set_vexpand(false);
            native.set_size_request(value.width.round() as i32, value.height.round() as i32);
            layer.queue_resize(); layer.show_all();
            Ok(())
        })();
        let _ = sender.try_send(result);
    }).map_err(|e| e.to_string())?;
    receiver.recv().await.ok_or("No se pudo ajustar el navegador")?
}
#[cfg(not(target_os = "linux"))]
async fn place(view: &tauri::Webview, value: Bounds) -> Result<(), String> {
    view.set_auto_resize(false).map_err(|e| e.to_string())?;
    view.set_position(tauri::LogicalPosition::new(value.x, value.y)).map_err(|e| e.to_string())?;
    view.set_size(tauri::LogicalSize::new(value.width, value.height)).map_err(|e| e.to_string())
}

fn status(gate: &BrowserGate) -> Result<BrowserStatus, String> {
    let mut session=gate.session.lock().map_err(|_| "Navegador ocupado")?;
    if session.mirror.as_ref().map(|mirror|mirror.failed.load(std::sync::atomic::Ordering::SeqCst) || mirror.cancelled.load(std::sync::atomic::Ordering::SeqCst)).unwrap_or(false) {
        session.status.presenting=false;
        session.status.projection_error=Some("Se interrumpió la imagen de la pantalla externa. El navegador sigue disponible en el equipo docente; puedes volver a duplicarlo.".into());
    }
    Ok(session.status.clone())
}
fn stop_projection(app: &tauri::AppHandle, gate: &BrowserGate) -> Result<(), String> {
    {
        let mut session=gate.session.lock().map_err(|_| "Navegador ocupado")?;
        if let Some(mirror)=session.mirror.take() { mirror.stop(); }
        session.target=None; session.status.presenting=false; session.status.projection_error=None;
    }
    if let Some(screen)=app.get_window(SCREEN) { screen.destroy().map_err(|e|e.to_string())?; }
    Ok(())
}
fn close(app: &tauri::AppHandle, gate: &BrowserGate) -> Result<(), String> {
    stop_projection(app,gate)?;
    if let Some(view)=app.get_webview(VIEW) { view.close().map_err(|e|e.to_string())?; }
    *gate.session.lock().map_err(|_| "Navegador ocupado")?=Session::default();
    Ok(())
}

pub(crate) fn mirror_counters(gate: &BrowserGate) -> (u64,u64) {
    gate.session.lock().ok().and_then(|session|session.mirror.as_ref().map(|m|(
        m.captures.load(std::sync::atomic::Ordering::SeqCst),m.paints.load(std::sync::atomic::Ordering::SeqCst)))).unwrap_or_default()
}

// Registered before navigating away from an inert page. These native signals
// cannot be bypassed by a site's scripts (including a nested file input).
#[cfg(target_os = "linux")]
async fn secure_linux(view: &tauri::Webview) -> Result<(), String> {
    use webkit2gtk::{FileChooserRequestExt, PermissionRequestExt, SettingsExt, WebViewExt};
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    view.with_webview(move |platform| {
        let native = platform.inner();
        native.connect_run_file_chooser(|_, request| { request.cancel(); true });
        native.connect_context_menu(|_, _, _, _| true);
        native.connect_print(|_, _| true);
        native.connect_permission_request(|_, request| { request.deny(); true });
        native.connect_enter_fullscreen(|_| true);
        native.connect_leave_fullscreen(|_| true);
        // Catch permission kinds not mapped by the cross-platform builder.
        if let Some(settings) = native.settings() {
            settings.set_enable_developer_extras(false);
            settings.set_allow_file_access_from_file_urls(false);
            settings.set_allow_universal_access_from_file_urls(false);
            settings.set_javascript_can_open_windows_automatically(false);
        }
        let _ = sender.try_send(());
    }).map_err(|e| e.to_string())?;
    receiver.recv().await.ok_or_else(|| "No se pudo aplicar la política nativa del navegador".to_string())
}
#[cfg(not(target_os = "linux"))]
async fn secure_linux(_: &tauri::Webview) -> Result<(), String> {
    Err("El navegador integrado requiere Linux con WebKitGTK".into())
}

#[tauri::command]
pub(crate) async fn classroom_browser(app: tauri::AppHandle, window: tauri::Webview,
    gate: tauri::State<'_, BrowserGate>, action: String, data: Option<Value>) -> Result<BrowserStatus, String> {
    if window.label() != "teacher" { return Err("Ventana sin permiso para controlar el navegador".into()); }
    let window = window.window();
    let _operation = gate.operation.lock().await;
    let data = data.unwrap_or(Value::Null);
    match action.as_str() {
        "open" => {
            #[allow(unused_variables)]
            let url = allowed_url(data["url"].as_str().ok_or("Escribe una dirección web")?)?;
            let value = bounds(&data)?; check_bounds(&window, value)?;
            if app.get_webview(VIEW).is_some() { return Err("El navegador ya está abierto".into()) }
            #[cfg(not(target_os = "linux"))]
            return Err("El navegador integrado requiere Linux con WebKitGTK".into());
            #[allow(unreachable_code)]
            {
                let handle = app.clone();
                let title_handle = app.clone();
                let bootstrap = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
                let navigation_bootstrap = bootstrap.clone();
                let builder = WebviewBuilder::new(VIEW, tauri::WebviewUrl::External("about:blank".parse().unwrap()))
                    .incognito(true).devtools(false).focused(false)
                    .on_navigation(move |url| {
                        if url.as_str() == "about:blank" { navigation_bootstrap.swap(false, std::sync::atomic::Ordering::SeqCst) }
                        else { allowed_url(url.as_str()).is_ok() }
                    })
                    .on_new_window(|_, _| NewWindowResponse::Deny)
                    .on_download(|_, _| false)
                    .on_permission_request(|_, _| PermissionResponse::Deny)
                    .on_document_title_changed(move |_, title| {
                        if let Ok(mut session) = title_handle.state::<BrowserGate>().session.lock() { session.status.title = title.chars().take(512).collect(); }
                    })
                    .on_page_load(move |_, payload| {
                        if let Ok(mut session) = handle.state::<BrowserGate>().session.lock() {
                            if allowed_url(payload.url().as_str()).is_ok() { session.status.url = payload.url().to_string(); }
                            session.status.loading = matches!(payload.event(), PageLoadEvent::Started);
                        }
                    });
                let teacher = app.get_window("teacher").ok_or("Ventana docente cerrada")?;
                let view = teacher.add_child(builder, tauri::LogicalPosition::new(value.x, value.y), tauri::LogicalSize::new(value.width, value.height)).map_err(|e| e.to_string())?;
                if let Err(error) = secure_linux(&view).await { let _ = close(&app, &gate); return Err(error); }
                bootstrap.store(false, std::sync::atomic::Ordering::SeqCst);
                {
                    let mut session = gate.session.lock().map_err(|_| "Navegador ocupado")?;
                    session.status = BrowserStatus { open: true, url: url.to_string(), loading: true, ..Default::default() };
                    session.bounds = Some(value);
                }
                if let Err(error) = place(&view, value).await { let _ = close(&app, &gate); return Err(error); }
                if let Err(error) = view.navigate(url) { let _ = close(&app, &gate); return Err(error.to_string()); }
                view.show().map_err(|e| e.to_string())?;
            }
        }
        "navigate" => {
            let url = allowed_url(data["url"].as_str().ok_or("Escribe una dirección web")?)?;
            app.get_webview(VIEW).ok_or("El navegador está cerrado")?.navigate(url).map_err(|e| e.to_string())?;
        }
        "back" | "forward" | "reload" => {
            let view = app.get_webview(VIEW).ok_or("El navegador está cerrado")?;
            // Fixed browser operations only; never evaluate text from a command or site.
            match action.as_str() {
                "back" => view.eval("history.back()"),
                "forward" => view.eval("history.forward()"),
                _ => view.reload(),
            }.map_err(|e| e.to_string())?;
        }
        "layout" => {
            let value = bounds(&data)?; check_bounds(&window, value)?;
            gate.session.lock().map_err(|_| "Navegador ocupado")?.bounds=Some(value);
            if let Some(view)=app.get_webview(VIEW) { place(&view,value).await?; }
        }
        "present" => {
            let id = data["monitorId"].as_str().ok_or("Selecciona una pantalla")?;
            let position = crate::audience_window::browser_monitor(&window, id)?;
            let view = app.get_webview(VIEW).ok_or("El navegador está cerrado")?;
            crate::audience_window::suspend_for_browser(&app)?;
            stop_projection(&app,&gate)?;
            let screen = match app.get_window(SCREEN) {
                Some(screen) => screen,
                None => tauri::window::WindowBuilder::new(&app, SCREEN)
                    .title("Active Classroom · Navegador web").visible(false).decorations(false)
                    .resizable(false).skip_taskbar(true).focused(false).focusable(false).build().map_err(|e| e.to_string())?,
            };
            screen.set_fullscreen_on_monitor(position).map_err(|e|e.to_string())?;
            // Keep the only browser in the teacher window. The external window
            // receives pixels, never ownership of the page or another session.
            let mirrored=match mirror::start(&view,&screen).await {
                Ok(mirrored)=>mirrored,
                Err(error)=>{ let _=screen.destroy(); return Err(error); }
            };
            if let Err(error)=crate::audience_window::browser_monitor(&window,id) {
                mirrored.stop(); let _=screen.destroy(); return Err(error);
            }
            let mut session=gate.session.lock().map_err(|_| "Navegador ocupado")?;
            session.target=Some(id.to_string()); session.status.presenting=true;
            session.status.projection_error=None; session.mirror=Some(mirrored);
            drop(session);
            let _=window.set_focus();
        }
        "return" => {
            stop_projection(&app,&gate)?;
            let _=window.set_focus();
        }
        "status" => {
            let target=gate.session.lock().map_err(|_| "Navegador ocupado")?.target.clone();
            if target.as_ref().map(|id| crate::audience_window::browser_monitor(&window, id).is_err()).unwrap_or(false) {
                stop_projection(&app,&gate)?;
            }
            if let Some(view) = app.get_webview(VIEW) {
                if let Ok(url) = view.url() {
                    if allowed_url(url.as_str()).is_ok() { gate.session.lock().map_err(|_| "Navegador ocupado")?.status.url = url.to_string(); }
                }
            }
        }
        "close" => { close(&app, &gate)?; let _ = window.set_focus(); }
        _ => return Err("Acción de navegador desconocida".into()),
    }
    status(&gate)
}

pub(crate) fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == SCREEN {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let gate = app.state::<BrowserGate>(); let _operation = gate.operation.lock().await;
                let _ = stop_projection(&app, &gate);
            });
        }
    } else if window.label() == "teacher" && matches!(event, tauri::WindowEvent::Destroyed) {
        let _ = close(window.app_handle(), &window.state::<BrowserGate>());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn remote_navigation_cannot_open_internal_resources_or_handlers() {
        for url in ["file:///etc/passwd", "asset://localhost/cache", "tauri://localhost", "javascript:alert(1)", "data:text/html,x", "blob:https://example.org/abc", "mailto:x@example.org", "https://user:pass@example.org/", "http://localhost:1420", "http://127.0.0.1:8000/media/x", "http://[::1]/", "http://0.0.0.0", "http://127.1/", "http://2130706433/", "https://x.localhost/"] { assert!(allowed_url(url).is_err(), "{url}"); }
        for url in ["https://example.org/a?q=1#x", "http://school.example/lesson", "https://192.168.1.20/lesson"] { assert!(allowed_url(url).is_ok()); }
    }
    #[test] fn native_layout_rejects_invalid_or_unbounded_geometry() {
        for data in [serde_json::json!({}), serde_json::json!({"bounds":{"x":-1,"y":0,"width":100,"height":100}}), serde_json::json!({"bounds":{"x":0,"y":0,"width":0,"height":100}}), serde_json::json!({"bounds":{"x":0,"y":0,"width":50000,"height":100}})] { assert!(bounds(&data).is_err()); }
        assert!(bounds(&serde_json::json!({"bounds":{"x":20,"y":100,"width":800,"height":400}})).is_ok());
    }
}
