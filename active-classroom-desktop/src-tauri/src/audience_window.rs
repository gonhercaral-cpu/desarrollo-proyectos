use serde::Serialize;
use tauri::{Manager, PhysicalPosition, PhysicalSize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudienceStatus {
    visible: bool,
    fullscreen: bool,
    width: u32,
    height: u32,
    monitor_count: usize,
    available: bool,
}

#[tauri::command]
pub(crate) fn show_audience_window(app: tauri::AppHandle) -> Result<(), String> {
    let audience = app
        .get_webview_window("audience")
        .ok_or_else(|| "No se encontró la ventana del alumnado".to_string())?;
    let monitors = audience
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let primary = audience
        .primary_monitor()
        .map_err(|error| error.to_string())?;
    let secondary = monitors.iter().find(|monitor| {
        primary
            .as_ref()
            .map(|main| monitor.position() != main.position())
            .unwrap_or(true)
    });
    audience
        .set_fullscreen(false)
        .map_err(|error| error.to_string())?;
    let target_monitor = secondary.or(primary.as_ref());
    if let Some(monitor) = target_monitor {
        let position = monitor.position();
        let size = monitor.size();
        audience
            .set_position(PhysicalPosition::new(position.x, position.y))
            .map_err(|error| error.to_string())?;
        audience
            .set_size(PhysicalSize::new(size.width, size.height))
            .map_err(|error| error.to_string())?;
        eprintln!(
            "Active Classroom: audience display at ({}, {}) {}x{}",
            position.x, position.y, size.width, size.height
        );
    }
    audience.show().map_err(|error| error.to_string())?;
    audience
        .set_fullscreen(true)
        .map_err(|error| error.to_string())?;
    let fullscreen = audience
        .is_fullscreen()
        .map_err(|error| error.to_string())?;
    if !fullscreen {
        audience.maximize().map_err(|error| error.to_string())?;
    }
    eprintln!("Active Classroom: audience fullscreen={fullscreen}");
    Ok(())
}

#[tauri::command]
pub(crate) fn audience_status(app: tauri::AppHandle) -> Result<AudienceStatus, String> {
    let audience = app
        .get_webview_window("audience")
        .ok_or_else(|| "No se encontró la ventana del alumnado".to_string())?;
    let monitors = audience
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let monitor = audience
        .current_monitor()
        .map_err(|error| error.to_string())?;
    let size = monitor.as_ref().map(|value| value.size());
    Ok(AudienceStatus {
        visible: audience.is_visible().map_err(|error| error.to_string())?,
        fullscreen: audience
            .is_fullscreen()
            .map_err(|error| error.to_string())?,
        width: size.map(|value| value.width).unwrap_or(1920),
        height: size.map(|value| value.height).unwrap_or(1080),
        monitor_count: monitors.len(),
        available: monitor.is_some(),
    })
}
