use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub(crate) struct ProjectionGate(pub Mutex<ProjectionState>);
#[derive(Default)]
pub(crate) struct ProjectionState {
    snapshot: Option<Value>, target: Option<String>, retired: Vec<String>,
    next_operation: u64, prepared: Option<Prepared>,
}
struct Prepared { operation: u64, monitor_id: String, session_id: String }
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
        if self.prepared.as_ref().map(|value| value.session_id == session_id).unwrap_or(false) { self.prepared = None; }
        if current { self.snapshot = None; } current
    }
    fn prepare(&mut self, monitor_id: &str) -> Result<u64, String> {
        let session_id = self.snapshot.as_ref().and_then(|value| value["sessionId"].as_str()).ok_or("projection: Clase cerrada")?.to_string();
        self.next_operation += 1; self.target = None;
        self.prepared = Some(Prepared { operation: self.next_operation, monitor_id: monitor_id.to_string(), session_id });
        Ok(self.next_operation)
    }
    fn prepared_monitor(&self, operation: u64) -> Option<String> {
        self.prepared.as_ref().filter(|value| value.operation == operation &&
            self.snapshot.as_ref().and_then(|snapshot| snapshot["sessionId"].as_str()) == Some(value.session_id.as_str()))
            .map(|value| value.monitor_id.clone())
    }
    fn abort(&mut self, operation: u64) -> bool {
        let current = self.prepared.as_ref().map(|value| value.operation == operation).unwrap_or(false);
        if current { self.prepared = None; self.target = None; } current
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
    // Wayland may not expose an OS primary monitor; use the teacher's output then.
    let primary = window.primary_monitor().map_err(|e| e.to_string())?
        .or_else(|| window.current_monitor().ok().flatten());
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
    // Match the manifest envelope: 50 bounded layers can exceed 256 KB when
    // text uses multibyte UTF-8. Keep the byte limit and per-layer validation.
    if data.to_string().len() > 700000 || data["revision"].as_u64().is_none() || data["sessionId"].as_str().map(|s| s.len() > 80).unwrap_or(true) { return false; }
    if !data["currentBuild"].is_null() && data["currentBuild"].as_u64().filter(|value| *value <= 50).is_none() { return false; }
    let source = &data["source"];
    if !source["layers"].is_null() {
        let Some(layers) = source["layers"].as_array().filter(|layers| layers.len() <= 50) else { return false; };
        for layer in layers {
            for key in ["x", "y", "width", "height"] {
                if layer[key].as_f64().filter(|value| value.is_finite() && *value >= 0.0 && *value <= 100.0).is_none() { return false; }
            }
            if layer["width"].as_f64().unwrap_or(0.0) <= 0.0 || layer["height"].as_f64().unwrap_or(0.0) <= 0.0 || layer["x"].as_f64().unwrap_or(0.0) + layer["width"].as_f64().unwrap_or(0.0) > 100.0 || layer["y"].as_f64().unwrap_or(0.0) + layer["height"].as_f64().unwrap_or(0.0) > 100.0 { return false; }
            match layer["type"].as_str() {
                Some("image") => if !layer["url"].as_str().map(|url| url.len() <= 4096 && ["asset://localhost/", "http://asset.localhost/", "https://asset.localhost/"].iter().any(|prefix| url.starts_with(prefix))).unwrap_or(false) { return false; },
                Some("text" | "answer") => if layer["text"].as_str().map(|text| text.len() <= 8000).unwrap_or(false) == false || layer["fontSize"].as_f64().filter(|value| *value >= 0.5 && *value <= 20.0).is_none() { return false; },
                _ => return false,
            }
        }
    }
    source.is_null() || source["url"].as_str().map(|url| {
        url.len() <= 4096 && (["asset://localhost/", "http://asset.localhost/", "https://asset.localhost/"].iter().any(|prefix| url.starts_with(prefix)) || media_url_shape(url))
    }).unwrap_or(false)
}
fn media_url_shape(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("http://127.0.0.1:") else { return false; };
    let Some((port, token)) = rest.split_once("/media/") else { return false; };
    port.parse::<u16>().map(|port| port > 0).unwrap_or(false) && token.len() == 64 && token.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn hide(app: &tauri::AppHandle, gate: &ProjectionGate) -> Result<(), String> {
    { let mut state = gate.0.lock().map_err(|_| "projection: Estado no disponible")?; state.target = None; state.prepared = None; }
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
            if let Some(url) = snapshot["source"]["url"].as_str().filter(|url| media_url_shape(url)) {
                if !app.state::<crate::local_media::MediaServer>().allows_url(url) { return Err("projection: Recurso multimedia no autorizado".into()); }
            }
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
        "prepare" => {
            let monitors = displays(&window)?;
            if monitors.len() < 2 { return Err("projection: Sin segunda pantalla".into()); }
            let requested = data.as_ref().and_then(|value| value["monitorId"].as_str()).ok_or("projection: Selecciona monitor")?;
            let monitor = monitors.iter().find(|monitor| monitor.id == requested).ok_or("projection: Monitor desconectado")?;
            let audience = if let Some(audience) = app.get_webview_window("audience") { audience } else {
                WebviewWindowBuilder::new(&app, "audience", WebviewUrl::App("index.html".into()))
                    .title("Active Classroom · Proyector").visible(false).decorations(false).resizable(false).skip_taskbar(true).focused(false)
                    .build().map_err(|e| e.to_string())?
            };
            // Hide before selecting a monitor. Wayland ignores absolute window positioning.
            // The teacher's SDK calls setFullscreenOnMonitor before "activate" can show audience.
            audience.hide().map_err(|e| e.to_string())?;
            let mut state = gate.0.lock().map_err(|_| "projection: Estado no disponible")?;
            let operation = state.prepare(&monitor.id)?;
            eprintln!("[Active Classroom Projection] {}", json!({
                "event": "MONITOR_SELECTED", "operation": operation, "selectedMonitor": monitor.id,
                "name": monitor.name, "position": { "x": monitor.x, "y": monitor.y },
                "resolution": { "width": monitor.width, "height": monitor.height },
                "scaleFactor": monitor.scale_factor, "primary": monitor.primary,
                "sessionType": std::env::var("XDG_SESSION_TYPE").unwrap_or_default()
            }));
            Ok(json!({ "operation": operation, "monitor": monitor }))
        }
        "activate" => {
            let operation = data.as_ref().and_then(|value| value["operation"].as_u64()).ok_or("projection: Operación ausente")?;
            let monitors = displays(&window)?;
            let audience = app.get_webview_window("audience").ok_or("projection: Ventana ausente")?;
            let mut state = gate.0.lock().map_err(|_| "projection: Estado no disponible")?;
            let monitor_id = state.prepared_monitor(operation).ok_or("projection: Operación cancelada")?;
            if monitors.len() < 2 || !monitors.iter().any(|monitor| monitor.id == monitor_id) {
                state.abort(operation); return Err("projection: Monitor desconectado".into());
            }
            audience.show().map_err(|e| e.to_string())?;
            state.prepared = None; state.target = Some(monitor_id.clone());
            let snapshot = state.snapshot.clone().unwrap_or(Value::Null);
            app.emit_to("audience", "classroom-projection", snapshot).map_err(|e| e.to_string())?;
            eprintln!("[Active Classroom Projection] {}", json!({ "event": "SET_FULLSCREEN_ON_MONITOR", "operation": operation, "selectedMonitor": monitor_id, "result": "ok" }));
            // Focusing the teacher never moves it or makes it fullscreen.
            let _ = window.set_focus();
            Ok(Value::Null)
        }
        "abort" => {
            let operation = data.as_ref().and_then(|value| value["operation"].as_u64()).ok_or("projection: Operación ausente")?;
            let current = gate.0.lock().map_err(|_| "projection: Estado no disponible")?.abort(operation);
            if current { if let Some(audience) = app.get_webview_window("audience") { let _ = audience.hide(); } }
            eprintln!("[Active Classroom Projection] {}", json!({ "event": "PROJECTION_OPEN_FAILED", "operation": operation, "result": "error" }));
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
        data["source"]["url"] = json!(format!("http://127.0.0.1:34567/media/{}", "a".repeat(64)));
        assert!(valid_snapshot(&data));
        for url in ["https://google.com/file", "http://asset.localhost.evil/file", "file:///etc/passwd"] { data["source"]["url"] = json!(url); assert!(!valid_snapshot(&data)); }
    }
    #[test] fn monitor_identity_is_stable_and_distinct() {
        assert_eq!(monitor_id("HDMI", 1920, 1080, 1920, 0), monitor_id("HDMI", 1920, 1080, 1920, 0));
        assert_ne!(monitor_id("HDMI", 1920, 1080, 1920, 0), monitor_id("HDMI", 1920, 1080, 0, 0));
    }
    #[test] fn build_state_and_assets_remain_local_and_bounded() {
        let mut data = json!({"sessionId":"session","revision":1,"currentBuild":2,"source":{"url":"asset://localhost/base.png","layers":[{"type":"answer","text":"Respuesta","x":10,"y":20,"width":30,"height":10,"fontSize":3}]}});
        assert!(valid_snapshot(&data));
        data["currentBuild"] = json!(51); assert!(!valid_snapshot(&data));
        data["currentBuild"] = json!(2);
        data["source"]["layers"][0] = json!({"type":"image","url":"https://example.com/remote.png","x":10,"y":20,"width":30,"height":10});
        assert!(!valid_snapshot(&data));
        data["source"]["layers"][0]["url"] = json!("asset://localhost/cache/asset.png"); assert!(valid_snapshot(&data));
        data["source"]["layers"][0]["width"] = json!(100); assert!(!valid_snapshot(&data));
        let layer = json!({"type":"answer","text":"答".repeat(2000),"x":10,"y":20,"width":30,"height":10,"fontSize":3});
        data["source"]["layers"] = json!(vec![layer; 50]);
        assert!(data.to_string().len() > 256000);
        assert!(valid_snapshot(&data));
        data["source"]["layers"][0]["text"] = json!("x".repeat(700000));
        assert!(!valid_snapshot(&data));
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
    #[test] fn closed_class_cannot_activate_pending_window() {
        let mut state = ProjectionState::default();
        assert!(state.prepare("HDMI-1").is_err());
        state.accept(&json!({ "sessionId": "first", "revision": 1 }));
        let operation = state.prepare("HDMI-1").unwrap();
        assert_eq!(state.prepared_monitor(operation), Some("HDMI-1".into()));
        state.retire("first"); assert_eq!(state.prepared_monitor(operation), None);
    }
    #[test] fn stale_operation_cannot_show_or_hide_new_monitor_selection() {
        let mut state = ProjectionState::default();
        state.accept(&json!({ "sessionId": "first", "revision": 1 }));
        let old = state.prepare("HDMI-1").unwrap();
        let current = state.prepare("HDMI-2").unwrap();
        assert_eq!(state.prepared_monitor(old), None);
        assert!(!state.abort(old));
        assert_eq!(state.prepared_monitor(current), Some("HDMI-2".into()));
        assert!(state.abort(current)); assert_eq!(state.prepared_monitor(current), None);
    }
}
