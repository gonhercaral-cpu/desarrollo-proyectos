use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub(crate) struct ProjectionGate(pub Mutex<ProjectionState>);
#[derive(Default)]
pub(crate) struct ProjectionState { snapshot: Option<Value>, target: Option<String>, retired: Vec<String> }
impl ProjectionState {
    fn accept(&mut self, snapshot: &Value) -> bool {
        if self.retired.iter().any(|id| snapshot["sessionId"].as_str() == Some(id.as_str())) { return false; }
        if let Some(previous) = &self.snapshot {
            if previous["sessionId"] == snapshot["sessionId"] && previous["revision"].as_u64() >= snapshot["revision"].as_u64() { return false; }
        }
        self.snapshot = Some(snapshot.clone()); true
    }
    fn retire(&mut self, session_id: &str) -> bool {
        self.retired.push(session_id.to_string()); if self.retired.len() > 16 { self.retired.remove(0); }
        let current = self.snapshot.as_ref().map(|value| value["sessionId"].as_str() == Some(session_id)).unwrap_or(false);
        if current { self.snapshot = None; } current
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Display {
    id: String, name: String, primary: bool, width: u32, height: u32,
    x: i32, y: i32, scale_factor: f64,
}
fn monitor_id(name: &str, width: u32, height: u32, x: i32, y: i32) -> String {
    format!("{:x}", Sha256::digest(format!("{name}:{width}:{height}:{x}:{y}").as_bytes()))
}
fn displays(window: &tauri::WebviewWindow) -> Result<Vec<Display>, String> {
    let primary = window.primary_monitor().map_err(|e| e.to_string())?;
    Ok(window.available_monitors().map_err(|e| e.to_string())?.iter().map(|monitor| {
        let name = monitor.name().cloned().unwrap_or_else(|| "Pantalla".into());
        let size = monitor.size(); let position = monitor.position();
        Display { id: monitor_id(&name, size.width, size.height, position.x, position.y), name,
            primary: primary.as_ref().map(|main| main.position() == position).unwrap_or(false),
            width: size.width, height: size.height, x: position.x, y: position.y, scale_factor: monitor.scale_factor() }
    }).collect())
}
fn teacher(label: &str) -> Result<(), String> {
    if label == "teacher" { Ok(()) } else { Err("projection: Ventana sin permiso de control".into()) }
}
fn valid_snapshot(data: &Value) -> bool {
    if data.to_string().len() > 16000 || data["revision"].as_u64().is_none() || data["sessionId"].as_str().map(|s| s.len() > 80).unwrap_or(true) { return false; }
    let source = &data["source"];
    source.is_null() || source["url"].as_str().map(|url| {
        url.len() <= 4096 && ["asset://localhost/", "http://asset.localhost/", "https://asset.localhost/"].iter().any(|prefix| url.starts_with(prefix))
    }).unwrap_or(false)
}
fn hide(app: &tauri::AppHandle, gate: &ProjectionGate) -> Result<(), String> {
    gate.0.lock().map_err(|_| "projection: Estado no disponible")?.target = None;
    if let Some(audience) = app.get_webview_window("audience") { audience.hide().map_err(|e| e.to_string())?; audience.set_fullscreen(false).map_err(|e| e.to_string())?; }
    app.emit_to("audience", "classroom-projection", Value::Null).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn classroom_projection(app: tauri::AppHandle, window: tauri::WebviewWindow, gate: tauri::State<'_, ProjectionGate>, action: String, data: Option<Value>) -> Result<Value, String> {
    if action == "read" {
        if window.label() != "audience" { teacher(window.label())?; }
        return Ok(gate.0.lock().map_err(|_| "projection: Estado no disponible")?.snapshot.clone().unwrap_or(Value::Null));
    }
    teacher(window.label())?;
    match action.as_str() {
        "publish" => {
            let snapshot = data.ok_or("projection: Snapshot ausente")?;
            if !valid_snapshot(&snapshot) { return Err("projection: Snapshot local inválido".into()); }
            let mut state = gate.0.lock().map_err(|_| "projection: Estado no disponible")?;
            if !state.accept(&snapshot) { return Ok(Value::Null); }
            // Emit while holding the gate so retiring a Unit cannot overtake its last event.
            if state.target.is_some() { app.emit_to("audience", "classroom-projection", snapshot).map_err(|e| e.to_string())?; }
            Ok(Value::Null)
        }
        "monitors" => {
            let monitors = displays(&window)?;
            let target = gate.0.lock().map_err(|_| "projection: Estado no disponible")?.target.clone();
            let disconnected = target.as_ref().map(|id| monitors.len() < 2 || !monitors.iter().any(|monitor| &monitor.id == id)).unwrap_or(false);
            let visible = app.get_webview_window("audience").map(|audience| audience.is_visible().unwrap_or(false)).unwrap_or(false);
            if disconnected || (target.is_some() && !visible) { hide(&app, &gate)?; }
            Ok(json!({ "monitors": monitors, "projecting": target.is_some() && visible && !disconnected, "disconnected": disconnected }))
        }
        "hide" => { hide(&app, &gate)?; gate.0.lock().map_err(|_| "projection: Estado no disponible")?.snapshot = None; Ok(Value::Null) }
        "close" => {
            let session_id = data.as_ref().and_then(|value| value["sessionId"].as_str()).ok_or("projection: Sesión ausente")?;
            let mut state = gate.0.lock().map_err(|_| "projection: Estado no disponible")?;
            let current = state.retire(session_id); drop(state);
            if current { hide(&app, &gate)?; }
            Ok(Value::Null)
        }
        "show" => {
            let monitors = displays(&window)?;
            if monitors.len() < 2 { return Err("projection: Sin segunda pantalla".into()); }
            let requested = data.as_ref().and_then(|value| value["monitorId"].as_str()).ok_or("projection: Selecciona monitor")?;
            let monitor = monitors.iter().find(|monitor| monitor.id == requested).ok_or("projection: Monitor desconectado")?;
            let audience = if let Some(audience) = app.get_webview_window("audience") { audience } else {
                WebviewWindowBuilder::new(&app, "audience", WebviewUrl::App("index.html".into()))
                    .title("Active Classroom · Proyector").visible(false).decorations(false).resizable(false).skip_taskbar(true).focused(false)
                    .build().map_err(|e| e.to_string())?
            };
            audience.set_fullscreen(false).map_err(|e| e.to_string())?;
            audience.set_position(PhysicalPosition::new(monitor.x, monitor.y)).map_err(|e| e.to_string())?;
            audience.set_size(PhysicalSize::new(monitor.width, monitor.height)).map_err(|e| e.to_string())?;
            audience.set_fullscreen(true).map_err(|e| e.to_string())?;
            audience.show().map_err(|e| e.to_string())?;
            let mut state = gate.0.lock().map_err(|_| "projection: Estado no disponible")?;
            state.target = Some(monitor.id.clone()); let snapshot = state.snapshot.clone().unwrap_or(Value::Null); drop(state);
            app.emit_to("audience", "classroom-projection", snapshot).map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        _ => Err("projection: Acción desconocida".into()),
    }
}
pub(crate) fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == "audience" {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close(); let _ = hide(window.app_handle(), &window.state::<ProjectionGate>());
        }
    } else if window.label() == "teacher" && matches!(event, tauri::WindowEvent::Destroyed) {
        if let Some(audience) = window.get_webview_window("audience") { let _ = audience.destroy(); }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn projector_cannot_control_session() { assert!(teacher("teacher").is_ok()); assert!(teacher("audience").is_err()); }
    #[test] fn only_local_snapshots_are_accepted() {
        let mut data = json!({ "sessionId": "session", "revision": 1, "source": { "url": "asset://localhost/local.pdf" } });
        assert!(valid_snapshot(&data));
        for url in ["https://google.com/file", "http://asset.localhost.evil/file", "file:///etc/passwd"] { data["source"]["url"] = json!(url); assert!(!valid_snapshot(&data)); }
    }
    #[test] fn monitor_identity_is_stable_and_distinct() {
        assert_eq!(monitor_id("HDMI", 1920, 1080, 1920, 0), monitor_id("HDMI", 1920, 1080, 1920, 0));
        assert_ne!(monitor_id("HDMI", 1920, 1080, 1920, 0), monitor_id("HDMI", 1920, 1080, 0, 0));
    }
    #[test] fn late_updates_cannot_restore_closed_or_older_session() {
        let mut state = ProjectionState::default();
        let first = json!({ "sessionId": "first", "revision": 2 });
        assert!(state.accept(&first));
        assert!(!state.accept(&json!({ "sessionId": "first", "revision": 1 })));
        assert!(state.retire("first"));
        let second = json!({ "sessionId": "second", "revision": 1 });
        assert!(state.accept(&second));
        assert!(!state.accept(&first));
        assert!(!state.retire("first"));
        assert_eq!(state.snapshot, Some(second));
    }
}
