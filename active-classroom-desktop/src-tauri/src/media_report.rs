//! Opt-in, bounded diagnostics. No media bytes, identities, credentials or paths.
use serde_json::{json, Value};
use std::{collections::VecDeque, sync::{Mutex, OnceLock, atomic::{AtomicBool, Ordering}}, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;
static ENABLED: AtomicBool = AtomicBool::new(false);
static EVENTS: OnceLock<Mutex<VecDeque<Value>>> = OnceLock::new();
pub(crate) fn enabled() -> bool { ENABLED.load(Ordering::Relaxed) }
pub(crate) fn record(value: Value) {
    if !enabled() { return; }
    if let Ok(mut events) = EVENTS.get_or_init(Mutex::default).lock() {
        if events.len() >= 2048 { events.pop_front(); }
        events.push_back(json!({"atMs":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,"data":value}));
    }
}
fn processes() -> Value {
    let mut result = Vec::new(); let mut pending = vec![std::process::id()]; let mut seen = std::collections::HashSet::new();
    while let Some(pid) = pending.pop() {
        if !seen.insert(pid) { continue; }
        let status = std::fs::read_to_string(format!("/proc/{pid}/status")).unwrap_or_default();
        let field = |prefix: &str| status.lines().find_map(|line| line.strip_prefix(prefix)).unwrap_or("").trim().to_string();
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
        let ticks: Vec<_> = stat.rsplit_once(") ").map(|(_, value)| value.split_whitespace().collect()).unwrap_or_default();
        let cpu: u64 = [11usize, 12].into_iter().filter_map(|index| ticks.get(index).and_then(|value| value.parse::<u64>().ok())).sum();
        result.push(json!({"pid":pid,"process":field("Name:"),"rss":field("VmRSS:"),"peak":field("VmHWM:"),"threads":field("Threads:"),"cpuTicks":cpu,"descriptors":std::fs::read_dir(format!("/proc/{pid}/fd")).map(|entries| entries.count()).unwrap_or(0)}));
        for task in std::fs::read_dir(format!("/proc/{pid}/task")).into_iter().flatten().flatten() {
            if let Ok(children) = std::fs::read_to_string(task.path().join("children")) { pending.extend(children.split_whitespace().filter_map(|child| child.parse::<u32>().ok())); }
        }
    }
    json!(result)
}
pub(crate) fn sample(streams: Value) { if enabled() { record(json!({"event":"process-sample","streams":streams,"processes":processes()})); } }
#[tauri::command]
pub(crate) async fn classroom_media_report(app: tauri::AppHandle, window: tauri::WebviewWindow, server: tauri::State<'_, crate::local_media::MediaServer>, action: String) -> Result<String, String> {
    if window.label() != "teacher" { return Err("media: Ventana inválida".into()); }
    match action.as_str() {
        "start" => { ENABLED.store(false, Ordering::Relaxed); EVENTS.get_or_init(Mutex::default).lock().map_err(|_| "Diagnóstico ocupado")?.clear(); ENABLED.store(true, Ordering::Relaxed); sample(server.metrics()); Ok("Diagnóstico iniciado".into()) },
        "stop" => { ENABLED.store(false, Ordering::Relaxed); Ok("Diagnóstico detenido".into()) },
        "export" => {
            sample(server.metrics());
            let events: Vec<Value> = EVENTS.get_or_init(Mutex::default).lock().map_err(|_| "Diagnóstico ocupado")?.iter().cloned().collect();
            let directory = app.path().download_dir().map_err(|_| "Carpeta Descargas no disponible")?;
            let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
            let name = format!("Active-Classroom-diagnostico-{stamp}.json");
            let os = std::fs::read_to_string("/etc/os-release").unwrap_or_default().lines().find_map(|line| line.strip_prefix("PRETTY_NAME=")).unwrap_or("Linux").trim_matches('"').to_string();
            let report = json!({"schemaVersion":1,"appVersion":app.package_info().version.to_string(),"os":os,"events":events});
            tauri::async_runtime::spawn_blocking(move || std::fs::write(directory.join(&name), serde_json::to_vec_pretty(&report).map_err(|_| "No se pudo preparar diagnóstico")?).map(|_| name).map_err(|_| "No se pudo guardar diagnóstico".to_string())).await.map_err(|_| "No se pudo guardar diagnóstico".to_string())?
        },
        _ => Err("Diagnóstico inválido".into()),
    }
}
