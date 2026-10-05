//! Native placement acceptance under a real Wayland compositor with two virtual outputs.
//! Test-only binary: blank pages, no Auth, Player, cache, network or production UI changes.
use std::sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, Arc};
use std::time::Duration;
use tauri::{Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

fn fullscreen_on(window: &tauri::WebviewWindow, monitor: &tauri::Monitor) -> tauri::Result<()> {
    let position = monitor.position();
    window.set_fullscreen_on_monitor(PhysicalPosition::new(position.x as f64, position.y as f64))
}

fn check_and_advance(app: &tauri::AppHandle, phase: &AtomicUsize) -> tauri::Result<bool> {
    let teacher = app.get_webview_window("placement-teacher").expect("teacher fixture");
    let audience = app.get_webview_window("placement-audience").expect("audience fixture");
    let monitors = teacher.available_monitors()?;
    assert_eq!(monitors.len(), 2, "Fixture Wayland requiere dos salidas");
    let current = phase.load(Ordering::SeqCst);
    if current == 1 || current == 3 {
        // hide() queues a native operation. Let the main loop process it before
        // selecting the next output, exactly as separate frontend IPC calls do.
        if audience.is_visible()? { return Ok(false); }
        let next = if current == 1 { &monitors[0] } else { &monitors[1] };
        println!("WAYLAND_HIDDEN_OK phase={current}");
        fullscreen_on(&audience, next)?;
        audience.show()?;
        phase.store(current + 1, Ordering::SeqCst);
        return Ok(false);
    }
    let target = if current == 2 { &monitors[0] } else { &monitors[1] };
    let teacher_monitor = teacher.current_monitor()?;
    let audience_monitor = audience.current_monitor()?;
    let correct = teacher_monitor.as_ref().map(|monitor| monitor.position() == monitors[0].position()).unwrap_or(false)
        && audience_monitor.as_ref().map(|monitor| monitor.position() == target.position()).unwrap_or(false)
        && audience.is_fullscreen()? && audience.is_visible()?;
    if !correct { return Ok(false); }
    println!("WAYLAND_MONITOR_OK phase={current} position={:?} teacher_position={:?}", target.position(), teacher_monitor.unwrap().position());
    if current == 4 { phase.store(5, Ordering::SeqCst); return Ok(true); }
    audience.hide()?;
    phase.store(current + 1, Ordering::SeqCst);
    Ok(false)
}

fn main() {
    assert_eq!(std::env::var("GDK_BACKEND").as_deref(), Ok("wayland"));
    assert_eq!(std::env::var("XDG_SESSION_TYPE").as_deref(), Ok("wayland"));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear(); // Never bootstrap the production Library/Auth.
    let phase = Arc::new(AtomicUsize::new(0));
    let passed = Arc::new(AtomicBool::new(false));
    let app = tauri::Builder::default().setup(|app| {
        let url = WebviewUrl::External("about:blank".parse().unwrap());
        let teacher = WebviewWindowBuilder::new(app, "placement-teacher", url.clone())
            .title("Wayland test · profesor").visible(false).build()?;
        let monitors = teacher.available_monitors()?;
        assert_eq!(monitors.len(), 2, "Weston debe proporcionar dos monitores Wayland reales");
        assert_ne!(monitors[0].position(), monitors[1].position());
        println!("WAYLAND_MONITORS {:?}", monitors);
        fullscreen_on(&teacher, &monitors[0])?;
        teacher.show()?;
        let audience = WebviewWindowBuilder::new(app, "placement-audience", url)
            .title("Wayland test · proyector").visible(false).decorations(false).focused(false).build()?;
        fullscreen_on(&audience, &monitors[1])?;
        assert!(!audience.is_visible()?, "Audiencia no debe mostrarse antes de seleccionar monitor");
        audience.show()?;
        Ok(())
    }).build(context).expect("Tauri Wayland fixture");
    let handle = app.handle().clone();
    let success = passed.clone();
    std::thread::spawn(move || {
        for _ in 0..100 {
            std::thread::sleep(Duration::from_millis(250));
            if success.load(Ordering::SeqCst) { return; }
            let state = phase.clone(); let result = success.clone(); let check = handle.clone();
            handle.run_on_main_thread(move || match check_and_advance(&check, &state) {
                Ok(true) => { result.store(true, Ordering::SeqCst); println!("WAYLAND_PROJECTION_OK: secondary, change, restore; teacher unchanged"); check.exit(0); }
                Ok(false) => {}
                Err(error) => { eprintln!("WAYLAND_PROJECTION_ERROR: {error}"); check.exit(1); }
            }).expect("Wayland main-thread check");
        }
        eprintln!("WAYLAND_PROJECTION_TIMEOUT"); handle.exit(1);
    });
    app.run(|_, _| {});
    assert!(passed.load(Ordering::SeqCst));
}
