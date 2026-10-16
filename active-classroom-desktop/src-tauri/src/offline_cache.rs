use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}, sync::{Arc, Mutex}};
use tauri::Manager;

#[derive(Default)]
pub struct CacheGate(pub Arc<Mutex<()>>);
fn maximum_file_bytes() -> u64 {
    static LIMIT: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    *LIMIT.get_or_init(|| serde_json::from_str::<Value>(include_str!("../../../drive/activeClassroomPublicationLimits.json")).expect("publication limits")["maxFileBytes"].as_u64().expect("publication byte limit"))
}
fn io_error(error: std::io::Error) -> String {
    match error.raw_os_error() {
        Some(28) | Some(112) | Some(39) if error.kind() != std::io::ErrorKind::NotFound => "disk-full: Espacio insuficiente. Libera espacio y reintenta.".into(),
        _ => format!("cache: No se pudo acceder al caché: {error}"),
    }
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> { value[key].as_str().ok_or_else(|| format!("manifest: Falta {key}")) }
fn safe_id(value: &str) -> Result<&str, String> {
    if value.is_empty() || value.len() > 200 || !value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') { return Err("manifest: Identificador inválido".into()); }
    Ok(value)
}
fn hash_id(value: &str) -> Result<&str, String> {
    if value.len() != 64 || !value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) { return Err("manifest: SHA-256 inválido".into()); }
    Ok(value)
}
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => { let sorted: BTreeMap<_, _> = map.iter().collect(); format!("{{{}}}", sorted.iter().map(|(key, value)| format!("{}:{}", serde_json::to_string(key).unwrap(), canonical(value))).collect::<Vec<_>>().join(",")) },
        Value::Array(items) => format!("[{}]", items.iter().map(canonical).collect::<Vec<_>>().join(",")),
        _ => value.to_string(),
    }
}
fn checked_manifest(manifest: &Value) -> Result<(), String> {
    if manifest.to_string().len() > 700000 || manifest["schemaVersion"] != 2 || manifest["version"].as_u64().filter(|v| *v > 0 && *v <= 9007199254740991).is_none() { return Err("manifest: Versión incompatible".into()); }
    safe_id(text(&manifest["unit"], "unitId")?)?;
    safe_id(text(&manifest["unit"], "levelId")?)?;
    let resources = manifest["resources"].as_array().ok_or("manifest: Faltan recursos")?;
    if resources.is_empty() || resources.len() > 200 { return Err("manifest: Cantidad de recursos inválida".into()); }
    let mut ids = std::collections::HashSet::new();
    for resource in resources {
        let id = safe_id(text(resource, "resourceId")?)?;
        if !ids.insert(id) { return Err("manifest: Recurso duplicado".into()); }
        hash_id(text(&resource["download"]["checksums"], "sha256")?)?;
        if resource["download"]["sizeBytes"].as_u64().filter(|size| *size <= maximum_file_bytes()).is_none() { return Err("manifest: Tamaño inválido".into()); }
    }
    let expected = hash_id(text(&manifest["integrity"], "contentHash")?)?;
    let mut content = manifest.clone();
    for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().ok_or("manifest: JSON inválido")?.remove(key); }
    if digest(canonical(&content).as_bytes()) != expected { return Err("integrity: El manifest no coincide con su SHA-256".into()); }
    Ok(())
}
fn verified(path: &Path, hash: &str, size: u64) -> Result<bool, String> {
    let mut file = match File::open(path) { Ok(file) => file, Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false), Err(error) => return Err(io_error(error)) };
    if file.metadata().map_err(io_error)?.len() != size { return Ok(false); }
    let mut digest = Sha256::new();
    let mut chunk = [0u8; 65536];
    loop { let read = file.read(&mut chunk).map_err(io_error)?; if read == 0 { break; } digest.update(&chunk[..read]); }
    Ok(format!("{:x}", digest.finalize()) == hash)
}
fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    File::open(path).and_then(|file| file.sync_all()).map_err(io_error)?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = File::create(path).map_err(io_error)?;
    file.write_all(bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)
}
pub(crate) fn load(path: &Path) -> Result<Value, String> {
    let file = File::open(path).map_err(io_error)?;
    if file.metadata().map_err(io_error)?.len() > 700000 { return Err("manifest: Manifest demasiado grande".into()); }
    let manifest = serde_json::from_reader(file).map_err(|_| "manifest: JSON local dañado")?;
    checked_manifest(&manifest)?;
    Ok(manifest)
}
fn paths(root: &Path, manifest: &Value) -> Result<Value, String> {
    checked_manifest(manifest)?;
    let mut paths = serde_json::Map::new();
    for resource in manifest["resources"].as_array().ok_or("manifest: Recursos inválidos")? {
        let hash = text(&resource["download"]["checksums"], "sha256")?;
        let path = root.join("objects").join(hash);
        if !verified(&path, hash, resource["download"]["sizeBytes"].as_u64().unwrap())? { return Err("integrity: Archivo local ausente o corrupto. Sincroniza de nuevo.".into()); }
        paths.insert(text(resource, "resourceId")?.to_string(), json!(path.to_string_lossy()));
    }
    Ok(Value::Object(paths))
}
pub(crate) fn version_dir(root: &Path, unit: &str, version: u64) -> Result<PathBuf, String> {
    safe_id(unit)?;
    if version == 0 || version > 9007199254740991 { return Err("manifest: Versión inválida".into()); }
    Ok(root.join("units").join(unit).join("versions").join(version.to_string()))
}
fn execute(root: &Path, action: &str, data: Value) -> Result<Value, String> {
    fs::create_dir_all(root).map_err(io_error)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700)).map_err(io_error)?;
    }
    fs::create_dir_all(root.join("objects")).map_err(io_error)?;
    fs::create_dir_all(root.join("temporary")).map_err(io_error)?;
    match action {
        "list" => {
            let mut units = BTreeMap::<String, Value>::new();
            if let Ok(folders) = fs::read_dir(root.join("units")) {
                for unit in folders.flatten() {
                    if let Ok(versions) = fs::read_dir(unit.path().join("versions")) {
                        for version in versions.flatten() {
                            if let Ok(manifest) = load(&version.path().join("manifest.json")) {
                                let id = manifest["unit"]["unitId"].as_str().unwrap().to_string();
                                if unit.file_name().to_string_lossy() != id || version.file_name().to_string_lossy() != manifest["version"].to_string() { continue; }
                                if paths(root, &manifest).is_ok() && units.get(&id).map(|old| old["version"].as_u64() < manifest["version"].as_u64()).unwrap_or(true) { units.insert(id, manifest); }
                            }
                        }
                    }
                }
            }
            Ok(json!(units.into_values().collect::<Vec<_>>()))
        }
        "commit" => {
            checked_manifest(&data)?;
            paths(root, &data)?;
            let directory = version_dir(root, text(&data["unit"], "unitId")?, data["version"].as_u64().unwrap())?;
            fs::create_dir_all(&directory).map_err(io_error)?;
            let final_path = directory.join("manifest.json");
            if final_path.exists() {
                if let Ok(existing) = load(&final_path) {
                    if existing != data { return Err("version: La versión local es inmutable".into()); }
                    return Ok(Value::Null);
                }
                fs::remove_file(&final_path).map_err(io_error)?;
            }
            let temporary = directory.join("manifest.pending");
            write_synced(&temporary, serde_json::to_string(&data).map_err(|e| e.to_string())?.as_bytes())?;
            // The manifest rename is the sole visibility/activation boundary.
            fs::rename(temporary, final_path).map_err(io_error)?;
            sync_directory(&directory)?;
            Ok(Value::Null)
        }
        "open" => {
            let directory = version_dir(root, text(&data, "unitId")?, data["version"].as_u64().ok_or("manifest: Versión inválida")?)?;
            let manifest = load(&directory.join("manifest.json"))?;
            if manifest["unit"]["unitId"] != data["unitId"] || manifest["version"] != data["version"] { return Err("integrity: Identidad local inválida".into()); }
            Ok(json!({ "paths": paths(root, &manifest)?, "manifest": manifest }))
        }
        "has" | "begin" | "append" | "finish" | "discard" => {
            let hash = hash_id(text(&data, "hash")?)?;
            let temporary = root.join("temporary").join(format!("{hash}.part"));
            let target = root.join("objects").join(hash);
            match action {
                "has" => Ok(json!(verified(&target, hash, data["size"].as_u64().ok_or("manifest: Tamaño inválido")?)?)),
                "begin" => { write_synced(&temporary, &[])?; Ok(Value::Null) }
                "append" => {
                    let offset = data["offset"].as_u64().ok_or("cache: Offset inválido")?;
                    let bytes: Vec<u8> = serde_json::from_value(data["chunk"].clone()).map_err(|_| "cache: Bloque inválido")?;
                    if bytes.len() > 65536 || offset.checked_add(bytes.len() as u64).filter(|size| *size <= maximum_file_bytes()).is_none() { return Err("cache: Bloque demasiado grande".into()); }
                    let mut file = OpenOptions::new().append(true).open(&temporary).map_err(io_error)?;
                    if file.metadata().map_err(io_error)?.len() != offset { return Err("cache: Descarga concurrente o fuera de orden".into()); }
                    file.write_all(&bytes).map_err(io_error)?;
                    Ok(Value::Null)
                }
                "finish" => {
                    let size = data["size"].as_u64().ok_or("manifest: Tamaño inválido")?;
                    if !verified(&temporary, hash, size)? { return Err("integrity: Tamaño o SHA-256 incorrecto. Reintenta.".into()); }
                    OpenOptions::new().write(true).open(&temporary).and_then(|file| file.sync_all()).map_err(io_error)?;
                    if verified(&target, hash, size)? { fs::remove_file(temporary).map_err(io_error)?; }
                    else {
                        // Windows cannot rename onto an existing corrupt object.
                        #[cfg(windows)]
                        if target.exists() { fs::remove_file(&target).map_err(io_error)?; }
                        fs::rename(temporary, &target).map_err(io_error)?;
                        sync_directory(&root.join("objects"))?;
                    }
                    Ok(Value::Null)
                }
                _ => { if temporary.exists() { fs::remove_file(temporary).map_err(io_error)?; } Ok(Value::Null) }
            }
        }
        _ => Err("cache: Operación desconocida".into()),
    }
}

// Adopt verified publications from the previous email-based cache without
// deleting originals or downloading the same objects again. The format stays v1.
fn adopt_legacy(root: &Path) -> Result<Value, String> {
    execute(root, "list", Value::Null)?;
    let marker = root.join("legacy-adopted");
    if marker.exists() { return Ok(Value::Null); }
    let users = root.parent().ok_or("cache: Ruta inválida")?;
    for entry in fs::read_dir(users).map_err(io_error)?.flatten() {
        let source = entry.path();
        if source == root || !entry.file_type().map_err(io_error)?.is_dir() { continue; }
        let manifests = execute(&source, "list", Value::Null)?;
        for manifest in manifests.as_array().ok_or("cache: Lista inválida")? {
            let directory = version_dir(root, text(&manifest["unit"], "unitId")?, manifest["version"].as_u64().unwrap())?;
            if directory.join("manifest.json").exists() { continue; }
            for resource in manifest["resources"].as_array().unwrap() {
                let hash = text(&resource["download"]["checksums"], "sha256")?;
                let size = resource["download"]["sizeBytes"].as_u64().unwrap();
                let target = root.join("objects").join(hash);
                if !verified(&target, hash, size)? {
                    let temporary = root.join("temporary").join(format!("{hash}.adopt"));
                    if temporary.exists() { fs::remove_file(&temporary).map_err(io_error)?; }
                    if fs::hard_link(source.join("objects").join(hash), &temporary).is_err() {
                        fs::copy(source.join("objects").join(hash), &temporary).map_err(io_error)?;
                    }
                    if !verified(&temporary, hash, size)? { return Err("integrity: Caché anterior dañado".into()); }
                    fs::rename(temporary, target).map_err(io_error)?;
                    sync_directory(&root.join("objects"))?;
                }
            }
            execute(root, "commit", manifest.clone())?;
        }
    }
    write_synced(&marker, b"1")?;
    sync_directory(root)?;
    Ok(Value::Null)
}

#[tauri::command]
pub async fn classroom_cache(app: tauri::AppHandle, window: tauri::WebviewWindow, gate: tauri::State<'_, CacheGate>, owner: String, action: String, data: Value) -> Result<Value, String> {
    if window.label() != "teacher" || owner.is_empty() || owner.len() > 200 { return Err("cache: Sesión local inválida".into()); }
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("offline-v1").join("users").join(digest(owner.as_bytes()));
    let lock = gate.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "cache: Caché ocupado")?;
        if action == "adopt" {
            if !crate::device_identity::authorized_owner(&owner)? { return Err("cache: Equipo no activado".into()); }
            return adopt_legacy(&root);
        }
        execute(&root, &action, data)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_path_traversal_and_bad_hash() {
        assert!(safe_id("../secret").is_err()); assert!(hash_id("../secret").is_err());
    }
    #[test]
    fn verifies_file_bytes_and_size() {
        let root = std::env::temp_dir().join(format!("ac-cache-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("bytes"); write_synced(&path, b"offline").unwrap();
        assert!(verified(&path, &digest(b"offline"), 7).unwrap());
        assert!(!verified(&path, &digest(b"corrupt"), 7).unwrap());
        assert!(!verified(&path, &digest(b"offline"), 8).unwrap());
        fs::remove_file(path).unwrap(); fs::remove_dir(root).unwrap();
    }
    #[test]
    fn accepts_published_contract() {
        let example: Value = serde_json::from_str(include_str!("../../../docs/active-classroom-manifest.example.json")).unwrap();
        checked_manifest(&example).unwrap();
    }
    #[test]
    fn large_cache_verifies_and_activates_atomically() {
        let root = std::env::temp_dir().join(format!("ac-cache-large-{}", std::process::id()));
        let size = 300_u64 * 1024 * 1024;
        let block = [0_u8; 65536];
        let mut sha = Sha256::new();
        for _ in 0..size / block.len() as u64 { sha.update(block); }
        let hash = format!("{:x}", sha.finalize());
        execute(&root, "begin", json!({"hash": hash})).unwrap();
        let temporary = root.join("temporary").join(format!("{hash}.part"));
        // Sparse prefix avoids allocating or buffering a 300 MiB test fixture.
        OpenOptions::new().write(true).open(&temporary).unwrap().set_len(size - block.len() as u64).unwrap();
        execute(&root, "append", json!({"hash": hash, "offset": size - block.len() as u64, "chunk": block.to_vec()})).unwrap();
        assert!(execute(&root, "finish", json!({"hash": hash, "size": size + 1})).is_err());
        assert_eq!(execute(&root, "list", Value::Null).unwrap(), json!([]));
        execute(&root, "finish", json!({"hash": hash, "size": size})).unwrap();
        let mut manifest: Value = serde_json::from_str(include_str!("../../../docs/active-classroom-manifest.example.json")).unwrap();
        for resource in manifest["resources"].as_array_mut().unwrap() {
            resource["download"]["sizeBytes"] = json!(size);
            resource["download"]["checksums"]["sha256"] = json!(hash);
        }
        let mut content = manifest.clone();
        for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().unwrap().remove(key); }
        manifest["integrity"]["contentHash"] = json!(digest(canonical(&content).as_bytes()));
        execute(&root, "commit", manifest.clone()).unwrap();
        assert_eq!(execute(&root, "list", Value::Null).unwrap()[0], manifest);
        manifest["resources"][0]["download"]["sizeBytes"] = json!(maximum_file_bytes() + 1);
        assert!(checked_manifest(&manifest).unwrap_err().starts_with("manifest: Tamaño"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn committed_cache_survives_reopen_and_failed_update() {
        let root = std::env::temp_dir().join(format!("ac-cache-commit-{}", std::process::id()));
        let mut manifest: Value = serde_json::from_str(include_str!("../../../docs/active-classroom-manifest.example.json")).unwrap();
        let hash = digest(b"offline");
        for resource in manifest["resources"].as_array_mut().unwrap() {
            resource["download"]["sizeBytes"] = json!(7);
            resource["download"]["checksums"]["sha256"] = json!(hash);
        }
        let mut content = manifest.clone();
        for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().unwrap().remove(key); }
        manifest["integrity"]["contentHash"] = json!(digest(canonical(&content).as_bytes()));
        execute(&root, "begin", json!({"hash": hash})).unwrap();
        execute(&root, "append", json!({"hash": hash, "offset": 0, "chunk": b"offline".to_vec()})).unwrap();
        assert!(execute(&root, "commit", manifest.clone()).is_err());
        assert_eq!(execute(&root, "list", json!({})).unwrap(), json!([]));
        execute(&root, "finish", json!({"hash": hash, "size": 7})).unwrap();
        execute(&root, "commit", manifest.clone()).unwrap();
        // Isolate adoption from unrelated temporary directories.
        let migration = root.join("migration");
        let legacy = migration.join("legacy");
        let device = migration.join("device");
        fs::create_dir_all(legacy.join("objects")).unwrap();
        fs::copy(root.join("objects").join(&hash), legacy.join("objects").join(&hash)).unwrap();
        execute(&legacy, "commit", manifest.clone()).unwrap();
        adopt_legacy(&device).unwrap();
        assert_eq!(execute(&device, "list", Value::Null).unwrap()[0], manifest);
        assert!(legacy.join("objects").join(&hash).exists());
        adopt_legacy(&device).unwrap();
        assert_eq!(execute(&device, "list", Value::Null).unwrap().as_array().unwrap().len(), 1);
        assert_eq!(execute(&root, "list", json!({})).unwrap()[0]["version"], 1);
        let opened = execute(&root, "open", json!({"unitId": manifest["unit"]["unitId"], "version": 1})).unwrap();
        assert_eq!(opened["manifest"], manifest);
        let mut next = manifest.clone(); next["version"] = json!(2);
        next["resources"][0]["download"]["checksums"]["sha256"] = json!(digest(b"missing"));
        let mut content = next.clone();
        for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().unwrap().remove(key); }
        next["integrity"]["contentHash"] = json!(digest(canonical(&content).as_bytes()));
        assert!(execute(&root, "commit", next).is_err());
        assert_eq!(execute(&root, "list", json!({})).unwrap()[0]["version"], 1);
        execute(&root, "discard", json!({"hash": hash})).unwrap();
        fs::remove_file(root.join("objects").join(&hash)).unwrap();
        assert!(execute(&root, "open", json!({"unitId": manifest["unit"]["unitId"], "version": 1})).is_err());
        // This directory is created exclusively by this test under temp_dir.
        fs::remove_dir_all(root).unwrap();
    }
}
