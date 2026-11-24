//! Passive rendering of the teacher's existing page. No second browser/session,
//! page scripts, desktop capture, or remote IPC permissions are involved.
use std::sync::{Arc, atomic::{AtomicBool, AtomicU64, Ordering}};

#[derive(Default)]
pub(super) struct MirrorControl {
    pub cancelled: AtomicBool,
    pub failed: AtomicBool,
    pub captures: AtomicU64,
    pub paints: AtomicU64,
}
impl MirrorControl {
    pub fn stop(&self) { self.cancelled.store(true, Ordering::SeqCst); }
}

#[cfg(target_os = "linux")]
pub(super) async fn start(view: &tauri::Webview, screen: &tauri::Window) -> Result<Arc<MirrorControl>, String> {
    use gtk::{prelude::*, cairo::{Context, ImageSurface}, glib::{self, ControlFlow}};
    use webkit2gtk::{WebViewExt, SnapshotRegion, SnapshotOptions, gio::{Cancellable, prelude::*}};
    use std::{cell::{Cell, RefCell}, rc::Rc, time::{Duration, Instant}};
    let control = Arc::new(MirrorControl::default());
    let state = control.clone();
    let host = screen.clone();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    view.with_webview(move |platform| {
        let result = (|| -> Result<(), String> {
            let container = host.default_vbox().map_err(|e|e.to_string())?;
            let page = platform.inner();
            let area = gtk::DrawingArea::new();
            area.set_widget_name("classroom-browser-mirror");
            area.set_hexpand(true); area.set_vexpand(true);
            let frame: Rc<RefCell<Option<ImageSurface>>> = Rc::new(RefCell::new(None));
            let drawn_frame = frame.clone(); let drawn_state = state.clone();
            area.connect_draw(move |area, context: &Context| {
                context.set_source_rgb(0.,0.,0.);
                let _ = context.paint();
                if drawn_state.cancelled.load(Ordering::SeqCst) { return glib::Propagation::Stop; }
                if let Some(image) = drawn_frame.borrow().as_ref() {
                    let (dx,dy) = image.device_scale();
                    let width = image.width() as f64 / dx;
                    let height = image.height() as f64 / dy;
                    let allocation = area.allocation();
                    let scale = (allocation.width() as f64 / width).min(allocation.height() as f64 / height);
                    let painted = (|| -> Result<(), gtk::cairo::Error> {
                        context.save()?;
                        context.translate((allocation.width() as f64-width*scale)/2.,(allocation.height() as f64-height*scale)/2.);
                        context.scale(scale,scale);
                        context.set_source_surface(image,0.,0.)?;
                        context.paint()?;
                        context.restore()
                    })();
                    if painted.is_ok() { drawn_state.paints.fetch_add(1,Ordering::SeqCst); }
                }
                glib::Propagation::Stop
            });
            container.pack_start(&area,true,true,0);
            container.show_all();

            let source = page.downgrade(); let destination = area.downgrade();
            let busy = Rc::new(Cell::new(false));
            let last_frame = Rc::new(Cell::new(Instant::now()));
            let cancellable = Cancellable::new();
            let task_cancel = cancellable.clone();
            let timer_id = Rc::new(RefCell::new(None::<glib::SourceId>));
            let timer_slot = timer_id.clone();
            let timer_state = state.clone();
            let timer = glib::timeout_add_local(Duration::from_millis(50),move || {
                let stop = timer_state.cancelled.load(Ordering::SeqCst);
                let stale = last_frame.get().elapsed() > Duration::from_secs(5);
                if stop || stale {
                    if stale && !stop {
                        timer_state.failed.store(true,Ordering::SeqCst);
                        if let Some(area) = destination.upgrade() {
                            if let Some(window) = area.toplevel() { window.hide(); }
                        }
                    }
                    *frame.borrow_mut()=None;
                    task_cancel.cancel(); timer_slot.borrow_mut().take();
                    return ControlFlow::Break;
                }
                let (Some(page),Some(area)) = (source.upgrade(),destination.upgrade()) else {
                    *frame.borrow_mut()=None;
                    task_cancel.cancel(); timer_slot.borrow_mut().take(); return ControlFlow::Break;
                };
                // One capture in flight and one retained frame; no growing queue.
                if !busy.replace(true) {
                    let pending = busy.clone(); let output = frame.clone();
                    let ready = last_frame.clone(); let status = timer_state.clone();
                    let target = area.downgrade();
                    page.snapshot(SnapshotRegion::Visible,SnapshotOptions::NONE,Some(&task_cancel),move |result| {
                        pending.set(false);
                        if status.cancelled.load(Ordering::SeqCst) || status.failed.load(Ordering::SeqCst) { return; }
                        if let Ok(surface) = result {
                            if let Ok(image) = ImageSurface::try_from(surface) {
                                if image.width()>0 && image.height()>0 {
                                    *output.borrow_mut()=Some(image);
                                    ready.set(Instant::now());
                                    status.captures.fetch_add(1,Ordering::SeqCst);
                                    if let Some(area)=target.upgrade() { area.queue_draw(); }
                                }
                            }
                        }
                    });
                }
                ControlFlow::Continue
            });
            *timer_id.borrow_mut()=Some(timer);
            let destroyed_state = state.clone();
            area.connect_destroy(move |_| {
                destroyed_state.stop(); cancellable.cancel();
                if let Some(timer)=timer_id.borrow_mut().take() { timer.remove(); }
            });
            Ok(())
        })();
        let _=sender.try_send(result);
    }).map_err(|e|e.to_string())?;
    receiver.recv().await.ok_or("No se pudo preparar el espejo del navegador")??;
    screen.show().map_err(|e|e.to_string())?;
    // Do not report success merely because a window exists: a real page frame
    // must have reached the drawing callback while both views remain present.
    for _ in 0..100 {
        if control.paints.load(Ordering::SeqCst)>0 { return Ok(control); }
        if control.failed.load(Ordering::SeqCst) { break; }
        tauri::async_runtime::spawn_blocking(||std::thread::sleep(std::time::Duration::from_millis(50))).await.map_err(|e|e.to_string())?;
    }
    control.stop();
    let _=screen.destroy();
    Err("No se pudo dibujar el navegador en la pantalla externa. La página permanece disponible en el equipo docente.".into())
}

#[cfg(not(target_os = "linux"))]
pub(super) async fn start(_: &tauri::Webview, _: &tauri::Window) -> Result<Arc<MirrorControl>, String> {
    Err("La duplicación del navegador requiere Linux con WebKitGTK".into())
}
