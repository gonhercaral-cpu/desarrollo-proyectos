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
// Per-thread so concurrent tests cannot disturb each other's count of hashed objects.
#[cfg(test)]
thread_local! {
    static HASHED_OBJECTS: std::cell::Cell<usize> = std::cell::Cell::new(0);
    static HASHED_BYTES: std::cell::Cell<u64> = std::cell::Cell::new(0);
}

#[cfg(unix)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct CacheSignature {
    dev: u64,
    ino: u64,
    len: u64,
    mtime_sec: i64,
    mtime_nsec: i64,
    ctime_sec: i64,
    ctime_nsec: i64,
}

#[cfg(unix)]
impl CacheSignature {
    fn from_metadata(meta: &fs::Metadata) -> Self {
        use std::os::unix::fs::MetadataExt;
        Self {
            dev: meta.dev(),
            ino: meta.ino(),
            len: meta.len(),
            mtime_sec: meta.mtime(),
            mtime_nsec: meta.mtime_nsec(),
            ctime_sec: meta.ctime(),
            ctime_nsec: meta.ctime_nsec(),
        }
    }
}

#[cfg(unix)]
const SETTLED_AGE: std::time::Duration = std::time::Duration::from_secs(2);

#[cfg(unix)]
fn valid_timestamp(sec: i64, nsec: i64) -> Option<std::time::Duration> {
    if sec < 0 || !(0..1_000_000_000).contains(&nsec) { return None; }
    Some(std::time::Duration::new(sec as u64, nsec as u32))
}

#[cfg(unix)]
fn now_since_epoch() -> Option<std::time::Duration> {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()
}

// A signature may be cached (lookup and insert) only if its ctime was already at least
// SETTLED_AGE old when verification started, before any byte was read. Future, negative or
// out-of-range timestamps are never eligible. Not a guarantee against root, clock rollback or remote FS.
#[cfg(unix)]
impl CacheSignature {
    fn settled_at(&self, now: std::time::Duration) -> bool {
        let (Some(mtime), Some(ctime)) = (valid_timestamp(self.mtime_sec, self.mtime_nsec), valid_timestamp(self.ctime_sec, self.ctime_nsec)) else { return false };
        mtime <= now && now.checked_sub(ctime).map(|age| age >= SETTLED_AGE).unwrap_or(false)
    }
}

#[cfg(unix)]
type CacheKey = (PathBuf, String, u64);

#[cfg(unix)]
struct VerifiedCache {
    entries: std::collections::HashMap<CacheKey, CacheSignature>,
    order: std::collections::VecDeque<CacheKey>,
}

#[cfg(unix)]
impl VerifiedCache {
    const CAPACITY: usize = 1024;
    fn new() -> Self {
        Self {
            entries: std::collections::HashMap::new(),
            order: std::collections::VecDeque::new(),
        }
    }
    fn get(&self, key: &CacheKey, sig: &CacheSignature) -> bool {
        self.entries.get(key).map(|s| s == sig).unwrap_or(false)
    }
    fn insert(&mut self, key: CacheKey, sig: CacheSignature) {
        if self.entries.insert(key.clone(), sig).is_none() {
            self.order.push_back(key);
        }
        while self.entries.len() > Self::CAPACITY {
            if let Some(evicted) = self.order.pop_front() {
                self.entries.remove(&evicted);
            } else {
                self.entries.clear();
                break;
            }
        }
    }
    fn remove(&mut self, key: &CacheKey) {
        self.entries.remove(key);
        self.order.retain(|entry| entry != key);
    }
}

#[cfg(unix)]
static VERIFIED_CACHE: std::sync::OnceLock<Mutex<VerifiedCache>> = std::sync::OnceLock::new();
#[cfg(unix)]
fn cache_store() -> &'static Mutex<VerifiedCache> {
    VERIFIED_CACHE.get_or_init(|| Mutex::new(VerifiedCache::new()))
}
#[cfg(all(unix, test))]
fn clear_verified_cache(root: &Path) {
    if let Ok(mut cache) = cache_store().lock() {
        let keys: Vec<_> = cache.entries.keys().filter(|key| key.0.starts_with(root)).cloned().collect();
        for key in keys { cache.remove(&key); }
    }
}

pub(crate) fn verified(path: &Path, hash: &str, size: u64) -> Result<bool, String> {
    // Instant taken before any byte is read; cache eligibility depends only on it.
    #[cfg(unix)]
    let started = now_since_epoch();
    let sym_meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(io_error(e)),
    };
    if sym_meta.file_type().is_symlink() || !sym_meta.is_file() || sym_meta.len() != size { return Ok(false); }
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(io_error(e)),
    };
    let desc_meta = file.metadata().map_err(io_error)?;
    if !desc_meta.is_file() || desc_meta.len() != size { return Ok(false); }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if sym_meta.dev() != desc_meta.dev() || sym_meta.ino() != desc_meta.ino() { return Ok(false); }
        let sig_before = CacheSignature::from_metadata(&desc_meta);
        let settled = started.map(|now| sig_before.settled_at(now)).unwrap_or(false);
        let key = (path.to_path_buf(), hash.to_string(), size);
        let hit = settled && cache_store().lock().map(|cache| cache.get(&key, &sig_before)).unwrap_or(false);
        if hit {
            let sym_after = match fs::symlink_metadata(path) {
                Ok(m) => m,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    if let Ok(mut cache) = cache_store().lock() { cache.remove(&key); }
                    return Ok(false);
                }
                Err(e) => return Err(io_error(e)),
            };
            let desc_after = file.metadata().map_err(io_error)?;
            if sym_after.file_type().is_symlink() || !sym_after.is_file() || !desc_after.is_file() || CacheSignature::from_metadata(&sym_after) != sig_before || CacheSignature::from_metadata(&desc_after) != sig_before {
                if let Ok(mut cache) = cache_store().lock() { cache.remove(&key); }
                return Ok(false);
            }
            return Ok(true);
        }
    }

    #[cfg(test)]
    {
        HASHED_OBJECTS.with(|count| count.set(count.get() + 1));
    }
    let mut digest = Sha256::new();
    let mut chunk = [0u8; 65536];
    loop {
        let read = file.read(&mut chunk).map_err(io_error)?; if read == 0 { break; }
        #[cfg(test)] HASHED_BYTES.with(|bytes| bytes.set(bytes.get() + read as u64));
        digest.update(&chunk[..read]);
    }
    let valid = format!("{:x}", digest.finalize()) == hash;
    if !valid {
        #[cfg(unix)]
        if let Ok(mut cache) = cache_store().lock() { cache.remove(&(path.to_path_buf(), hash.to_string(), size)); }
        return Ok(false);
    }

    let sym_after = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(io_error(e)),
    };
    let desc_after = file.metadata().map_err(io_error)?;
    if sym_after.file_type().is_symlink() || !sym_after.is_file() || !desc_after.is_file() || sym_after.len() != size || desc_after.len() != size {
        return Ok(false);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if sym_after.dev() != desc_after.dev() || sym_after.ino() != desc_after.ino() { return Ok(false); }
        let sig_before = CacheSignature::from_metadata(&desc_meta);
        let sig_after = CacheSignature::from_metadata(&desc_after);
        if sig_before != sig_after || CacheSignature::from_metadata(&sym_after) != sig_after { return Ok(false); }
        if !started.map(|now| sig_before.settled_at(now)).unwrap_or(false) { return Ok(true); }
        if let Ok(mut cache) = cache_store().lock() {
            cache.insert((path.to_path_buf(), hash.to_string(), size), sig_after);
        }
    }

    Ok(true)
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
    let manifest = parse_manifest(file)?;
    checked_manifest(&manifest)?;
    Ok(manifest)
}
// A failing read is a storage error (cache:/disk-full:), not a damaged manifest;
// only syntax/EOF/data errors mean the local JSON is corrupt.
fn parse_manifest<R: Read>(reader: R) -> Result<Value, String> {
    serde_json::from_reader(reader).map_err(|error| if error.is_io() { io_error(error.into()) } else { "manifest: JSON local dañado".into() })
}
fn paths(root: &Path, manifest: &Value) -> Result<Value, String> {
    cached_paths(root, manifest, &mut BTreeMap::new())
}
fn cached_paths(root: &Path, manifest: &Value, verified_objects: &mut BTreeMap<(String, u64), bool>) -> Result<Value, String> {
    checked_manifest(manifest)?;
    let mut paths = serde_json::Map::new();
    for resource in manifest["resources"].as_array().ok_or("manifest: Recursos inválidos")? {
        let hash = text(&resource["download"]["checksums"], "sha256")?;
        let path = root.join("objects").join(hash);
        let size = resource["download"]["sizeBytes"].as_u64().unwrap();
        let key = (hash.to_string(), size);
        let valid = match verified_objects.get(&key) { Some(valid) => *valid, None => { let valid = verified(&path, hash, size)?; verified_objects.insert(key, valid); valid } };
        if !valid { return Err("integrity: Archivo local ausente o corrupto. Sincroniza de nuevo.".into()); }
        paths.insert(text(resource, "resourceId")?.to_string(), json!(path.to_string_lossy()));
    }
    Ok(Value::Object(paths))
}
pub(crate) fn version_dir(root: &Path, unit: &str, version: u64) -> Result<PathBuf, String> {
    safe_id(unit)?;
    if version == 0 || version > 9007199254740991 { return Err("manifest: Versión inválida".into()); }
    Ok(root.join("units").join(unit).join("versions").join(version.to_string()))
}
pub(crate) fn ambient_catalog(root: &Path, version: u64) -> Result<Value, String> {
    let path = root.join("ambient").join("versions").join(version.to_string()).join("catalog.json");
    let file = File::open(path).map_err(io_error)?;
    if file.metadata().map_err(io_error)?.len() > 700000 { return Err("manifest: Catálogo excesivo".into()); }
    let catalog: Value = serde_json::from_reader(file).map_err(|_| "manifest: Catálogo de música ilegible")?;
    checked_ambient(&catalog)?; if catalog["ambientCatalogVersion"] != version { return Err("manifest: Versión de música incorrecta".into()); } Ok(catalog)
}
fn checked_ambient(catalog: &Value) -> Result<(), String> {
    if catalog.to_string().len() > 700000 || catalog["schemaVersion"] != 1 || catalog["ambientCatalogVersion"].as_u64().filter(|v| *v > 0 && *v <= 9007199254740991).is_none() { return Err("manifest: Catálogo de música inválido".into()); }
    let tracks = catalog["tracks"].as_array().filter(|tracks| tracks.len() <= 200).ok_or("manifest: Pistas inválidas")?;
    let mut ids = std::collections::HashSet::new();
    for (order, track) in tracks.iter().enumerate() {
        let hash = hash_id(text(track, "sha256")?)?;
        if track["id"] != hash || !ids.insert(hash) || track["order"] != order || track["sourceType"] != "file" || track["active"].as_bool().is_none() || track["size"].as_u64().filter(|size| *size <= maximum_file_bytes()).is_none() || !text(track, "mime")?.starts_with("audio/") || text(track,"title")?.trim().is_empty() || text(track,"title")?.len() > 640 { return Err("manifest: Pista de música inválida".into()); }
        let path = text(track,"storagePath")?.strip_prefix("active-classroom/publications/files/").ok_or("manifest: Ruta de música inválida")?; hash_id(path)?;
        let generation = text(track,"generation")?; if generation.is_empty() || !generation.bytes().all(|byte| byte.is_ascii_digit()) { return Err("manifest: Generación de música inválida".into()); }
    }
    let playlists = catalog["playlists"].as_array().filter(|items| items.len() <= 50).ok_or("manifest: Listas inválidas")?;
    let mut playlist_ids = std::collections::HashSet::new();
    for playlist in playlists {
        let id = safe_id(text(playlist,"id")?)?; if !playlist_ids.insert(id) || text(playlist,"title")?.trim().is_empty() || text(playlist,"title")?.len() > 640 { return Err("manifest: Lista inválida".into()); }
        let track_ids = playlist["trackIds"].as_array().ok_or("manifest: Pistas de lista inválidas")?; let mut seen = std::collections::HashSet::new();
        for track in track_ids { let id = track.as_str().ok_or("manifest: Pista de lista inválida")?; if !ids.contains(id) || !seen.insert(id) { return Err("manifest: Pista de lista inexistente o duplicada".into()); } }
    }
    if catalog["integrity"]["algorithm"] != "sha256" || text(&catalog["integrity"],"contentHash")? != digest(canonical(&json!({"schemaVersion":1,"tracks":catalog["tracks"],"playlists":catalog["playlists"]})).as_bytes()) { return Err("integrity: Catálogo de música dañado".into()); } Ok(())
}
fn ambient_paths(root: &Path, catalog: &Value) -> Result<(), String> {
    for track in catalog["tracks"].as_array().unwrap().iter().filter(|track| track["active"] == true) {
        let hash = text(track,"sha256")?;
        if !verified(&root.join("objects").join(hash), hash, track["size"].as_u64().unwrap())? { return Err("integrity: Audio global ausente o dañado".into()); }
    } Ok(())
}
fn prepare(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(io_error)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700)).map_err(io_error)?;
    }
    fs::create_dir_all(root.join("objects")).map_err(io_error)?;
    fs::create_dir_all(root.join("temporary")).map_err(io_error)?;
    Ok(())
}
// Startup inventory: committed manifests whose objects exist with the declared
// size. It never reads object bytes, so it is availability for the UI and NOT
// integrity: list/open/has/finish keep hashing the real bytes.
fn structurally_available(root: &Path, manifest: &Value, checked: &mut BTreeMap<(String, u64), bool>) -> Result<bool, String> {
    for resource in manifest["resources"].as_array().ok_or("manifest: Recursos inválidos")? {
        let hash = text(&resource["download"]["checksums"], "sha256")?;
        let size = resource["download"]["sizeBytes"].as_u64().ok_or("manifest: Tamaño inválido")?;
        let key = (hash.to_string(), size);
        let present = match checked.get(&key) {
            Some(present) => *present,
            None => {
                let present = match fs::metadata(root.join("objects").join(hash)) { Ok(meta) => meta.is_file() && meta.len() == size, Err(error) if error.kind() == std::io::ErrorKind::NotFound => false, Err(error) => return Err(io_error(error)) };
                checked.insert(key, present); present
            }
        };
        if !present { return Ok(false); }
    }
    Ok(true)
}
// Only NotFound means "absent"; any other directory failure is a storage error.
fn directory_entries(path: &Path) -> Result<Vec<fs::DirEntry>, String> {
    let entries = match fs::read_dir(path) { Ok(entries) => entries, Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()), Err(error) => return Err(io_error(error)) };
    let mut directories = Vec::new();
    for entry in entries {
        let entry = entry.map_err(io_error)?;
        if entry.file_type().map_err(io_error)?.is_dir() { directories.push(entry); }
    }
    Ok(directories)
}
// Ok(None): no usable committed manifest (absent, not a file, or this unit's own
// JSON/integrity is invalid). Err: storage failure, so an unreadable catalog is
// never reported as an empty one.
fn committed_manifest(path: &Path) -> Result<Option<Value>, String> {
    match fs::metadata(path) {
        Ok(meta) if meta.is_file() => {}
        Ok(_) => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error(error)),
    }
    match load(path) {
        Ok(manifest) => Ok(Some(manifest)),
        Err(error) if error.starts_with("manifest:") || error.starts_with("integrity:") => Ok(None),
        Err(error) => Err(error),
    }
}
fn inventory(root: &Path) -> Result<Value, String> {
    let mut units = BTreeMap::<String, Value>::new();
    let mut checked = BTreeMap::new();
    for unit in directory_entries(&root.join("units"))? {
        for version in directory_entries(&unit.path().join("versions"))? {
            // Only the atomically renamed manifest.json; staged versions stay invisible.
            let Some(manifest) = committed_manifest(&version.path().join("manifest.json"))? else { continue };
            let id = manifest["unit"]["unitId"].as_str().ok_or("manifest: Falta unitId")?.to_string();
            if unit.file_name().to_string_lossy() != id || version.file_name().to_string_lossy() != manifest["version"].to_string() { continue; }
            if units.get(&id).map(|old| old["version"].as_u64() >= manifest["version"].as_u64()).unwrap_or(false) { continue; }
            if structurally_available(root, &manifest, &mut checked)? { units.insert(id, manifest); }
        }
    }
    Ok(json!(units.into_values().collect::<Vec<_>>()))
}
fn execute(root: &Path, action: &str, data: Value) -> Result<Value, String> {
    prepare(root)?;
    match action {
        "inventory" => inventory(root),
        "ambient-read" => {
            let mut versions = fs::read_dir(root.join("ambient/versions")).into_iter().flatten().flatten().filter_map(|entry| entry.file_name().to_str()?.parse::<u64>().ok()).collect::<Vec<_>>(); versions.sort_unstable();
            for version in versions.into_iter().rev() { if let Ok(catalog) = ambient_catalog(root, version) { if ambient_paths(root, &catalog).is_ok() { return Ok(catalog); } } } Ok(Value::Null)
        }
        "ambient-commit" => {
            checked_ambient(&data)?; ambient_paths(root, &data)?;
            let version = data["ambientCatalogVersion"].as_u64().unwrap(); let directory = root.join("ambient/versions").join(version.to_string()); fs::create_dir_all(&directory).map_err(io_error)?;
            let final_path = directory.join("catalog.json");
            if final_path.exists() { let previous = ambient_catalog(root, version)?; if previous != data { return Err("version: Catálogo de música inmutable".into()); } return Ok(Value::Null); }
            let temporary = directory.join("catalog.pending"); write_synced(&temporary, data.to_string().as_bytes())?; fs::rename(temporary, final_path).map_err(io_error)?; sync_directory(&directory)?; Ok(Value::Null)
        }
        "list" | "pending" => {
            let mut units = BTreeMap::<String, Value>::new();
            let mut verified_objects = BTreeMap::new();
            if let Ok(folders) = fs::read_dir(root.join("units")) {
                for unit in folders.flatten() {
                    if let Ok(versions) = fs::read_dir(unit.path().join("versions")) {
                        for version in versions.flatten() {
                            if let Ok(manifest) = load(&version.path().join(if action == "pending" { "manifest.staged" } else { "manifest.json" })) {
                                let id = manifest["unit"]["unitId"].as_str().unwrap().to_string();
                                if unit.file_name().to_string_lossy() != id || version.file_name().to_string_lossy() != manifest["version"].to_string() { continue; }
                                if cached_paths(root, &manifest, &mut verified_objects).is_ok() && units.get(&id).map(|old| old["version"].as_u64() < manifest["version"].as_u64()).unwrap_or(true) { units.insert(id, manifest); }
                            }
                        }
                    }
                }
            }
            Ok(json!(units.into_values().collect::<Vec<_>>()))
        }
        "commit" | "stage" => {
            checked_manifest(&data)?;
            paths(root, &data)?;
            let directory = version_dir(root, text(&data["unit"], "unitId")?, data["version"].as_u64().unwrap())?;
            fs::create_dir_all(&directory).map_err(io_error)?;
            let final_path = directory.join(if action == "stage" { "manifest.staged" } else { "manifest.json" });
            if final_path.exists() {
                if let Ok(existing) = load(&final_path) {
                    if existing != data { return Err("version: La versión local es inmutable".into()); }
                    if action == "commit" { let _ = fs::remove_file(directory.join("manifest.staged")); }
                    return Ok(Value::Null);
                }
                fs::remove_file(&final_path).map_err(io_error)?;
            }
            let temporary = directory.join("manifest.pending");
            write_synced(&temporary, serde_json::to_string(&data).map_err(|e| e.to_string())?.as_bytes())?;
            // The manifest rename is the sole visibility/activation boundary.
            fs::rename(temporary, final_path).map_err(io_error)?;
            sync_directory(&directory)?;
            if action == "commit" { let _ = fs::remove_file(directory.join("manifest.staged")); }
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
    // An already adopted cache must not be scanned (and hashed) on every launch.
    let marker = root.join("legacy-adopted");
    if marker.exists() { return Ok(Value::Null); }
    // The discarded full "list" only ever created the cache layout; do that without hashing.
    prepare(root)?;
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
        // Immutable catalogs and atomically renamed SHA objects permit these
        // reads without holding the write gate or delaying Unit opens.
        // "inventory" only reads atomically renamed manifests and file metadata; "open"
        // verifies the SHA of immutable objects. execute() first runs prepare(), which
        // only idempotently creates/chmods the cache layout directories (no manifest or
        // object is written), so a long adoption or activation holding the gate must
        // not delay showing or opening a visible Unit.
        if matches!(action.as_str(), "ambient-read" | "inventory" | "open" | "has") { return execute(&root,&action,data); }
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
    fn ambient_catalog_activation_is_verified_immutable_and_offline() {
        let root = std::env::temp_dir().join(format!("ac-ambient-{}", std::process::id()));
        let hash = digest(b"offline audio");
        execute(&root,"begin",json!({"hash":hash})).unwrap(); execute(&root,"append",json!({"hash":hash,"offset":0,"chunk":b"offline audio".to_vec()})).unwrap(); execute(&root,"finish",json!({"hash":hash,"size":13})).unwrap();
        let mut catalog = json!({"schemaVersion":1,"ambientCatalogVersion":1,"tracks":[{"id":hash,"sha256":hash,"title":"Calma","sourceType":"file","mime":"audio/mpeg","size":13,"storagePath":format!("active-classroom/publications/files/{hash}"),"generation":"1","order":0,"active":true}],"playlists":[]});
        fn seal(catalog: &mut Value) { catalog["integrity"] = json!({"algorithm":"sha256","contentHash":digest(canonical(&json!({"schemaVersion":1,"tracks":catalog["tracks"],"playlists":catalog["playlists"]})).as_bytes())}); }
        seal(&mut catalog); execute(&root,"ambient-commit",catalog.clone()).unwrap(); assert_eq!(execute(&root,"ambient-read",Value::Null).unwrap(),catalog);
        let mut next = catalog.clone(); next["tracks"][0]["title"] = json!("Writing"); seal(&mut next); assert!(execute(&root,"ambient-commit",next.clone()).is_err());
        next["ambientCatalogVersion"] = json!(2); next["tracks"][0]["sha256"] = json!(digest(b"missing")); next["tracks"][0]["id"] = next["tracks"][0]["sha256"].clone(); seal(&mut next);
        assert!(execute(&root,"ambient-commit",next).is_err()); assert_eq!(execute(&root,"ambient-read",Value::Null).unwrap(),catalog);
        fs::remove_dir_all(root).unwrap();
    }
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
    fn staged_update_stays_invisible_until_verified_atomic_activation() {
        let root = std::env::temp_dir().join(format!("ac-cache-staged-{}", std::process::id()));
        let mut manifest: Value = serde_json::from_str(include_str!("../../../docs/active-classroom-manifest.example.json")).unwrap();
        let hash = digest(b"offline");
        for resource in manifest["resources"].as_array_mut().unwrap() { resource["download"]["sizeBytes"] = json!(7); resource["download"]["checksums"]["sha256"] = json!(hash); }
        let mut content = manifest.clone();
        for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().unwrap().remove(key); }
        manifest["integrity"]["contentHash"] = json!(digest(canonical(&content).as_bytes()));
        assert!(execute(&root, "stage", manifest.clone()).is_err());
        execute(&root, "begin", json!({"hash": hash})).unwrap();
        execute(&root, "append", json!({"hash": hash, "offset": 0, "chunk": b"offline".to_vec()})).unwrap();
        execute(&root, "finish", json!({"hash": hash, "size": 7})).unwrap();
        execute(&root, "commit", manifest.clone()).unwrap();
        let mut next = manifest.clone(); next["version"] = json!(2);
        execute(&root, "stage", next.clone()).unwrap();
        assert_eq!(execute(&root, "list", Value::Null).unwrap()[0]["version"], 1);
        assert_eq!(execute(&root, "pending", Value::Null).unwrap()[0]["version"], 2);
        execute(&root, "open", json!({"unitId": manifest["unit"]["unitId"], "version": 1})).unwrap();
        execute(&root, "commit", next).unwrap();
        assert_eq!(execute(&root, "list", Value::Null).unwrap()[0]["version"], 2);
        assert_eq!(execute(&root, "pending", Value::Null).unwrap(), json!([]));
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

// Separate from `tests` on purpose: CI expects exactly seven tests there.
#[cfg(test)]
mod startup_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    // Exclusive temporary directory; Drop only removes the directory this fixture created.
    struct Fixture(PathBuf);
    impl Fixture {
        fn new(label: &str) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            loop {
                let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
                let path = std::env::temp_dir().join(format!("ac-startup-{label}-{}-{}-{nanos}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)));
                match fs::create_dir(&path) { Ok(()) => return Fixture(path), Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue, Err(error) => panic!("fixture: {error}") }
            }
        }
        fn cache(&self) -> PathBuf { self.0.join("cache") }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    fn hashed() -> usize { HASHED_OBJECTS.with(|count| count.get()) }
    fn hashed_bytes() -> u64 { HASHED_BYTES.with(|count| count.get()) }
    fn reset_hashed() {
        HASHED_OBJECTS.with(|count| count.set(0));
        HASHED_BYTES.with(|count| count.set(0));
    }
    // Waits once so every object published so far has a ctime older than the cache margin, then
    // forces one settled verification of each committed object. Never call it per object or from publish().
    #[cfg(unix)]
    fn settle(root: &Path) {
        std::thread::sleep(std::time::Duration::from_millis(2100));
        execute(root, "list", Value::Null).unwrap();
    }
    fn manifest_for(unit: &str, version: u64, payload: &[u8]) -> Value {
        let mut manifest: Value = serde_json::from_str(include_str!("../../../docs/active-classroom-manifest.example.json")).unwrap();
        manifest["unit"]["unitId"] = json!(unit);
        manifest["version"] = json!(version);
        for resource in manifest["resources"].as_array_mut().unwrap() { resource["download"]["sizeBytes"] = json!(payload.len()); resource["download"]["checksums"]["sha256"] = json!(digest(payload)); }
        let mut content = manifest.clone();
        for key in ["version", "publishedAt", "integrity"] { content.as_object_mut().unwrap().remove(key); }
        manifest["integrity"]["contentHash"] = json!(digest(canonical(&content).as_bytes()));
        manifest
    }
    fn put_object(root: &Path, payload: &[u8]) {
        let hash = digest(payload);
        execute(root, "begin", json!({"hash": hash})).unwrap();
        execute(root, "append", json!({"hash": hash, "offset": 0, "chunk": payload.to_vec()})).unwrap();
        execute(root, "finish", json!({"hash": hash, "size": payload.len()})).unwrap();
    }
    fn publish(root: &Path, action: &str, unit: &str, version: u64, payload: &[u8]) -> Value {
        put_object(root, payload);
        let manifest = manifest_for(unit, version, payload);
        execute(root, action, manifest.clone()).unwrap();
        manifest
    }
    fn object(root: &Path, payload: &[u8]) -> PathBuf { root.join("objects").join(digest(payload)) }
    fn manifest_path(root: &Path, unit: &str, version: u64) -> PathBuf { version_dir(root, unit, version).unwrap().join("manifest.json") }
    fn listed(root: &Path) -> Vec<(String, u64)> {
        execute(root, "inventory", Value::Null).unwrap().as_array().unwrap().iter().map(|m| (m["unit"]["unitId"].as_str().unwrap().to_string(), m["version"].as_u64().unwrap())).collect()
    }

    #[test]
    fn inventario_de_60_clases_no_lee_bytes_de_objetos() {
        let fixture = Fixture::new("sixty");
        let root = fixture.cache();
        for index in 0..60 { publish(&root, "commit", &format!("clase{index}"), 1, format!("audio {index}").as_bytes()); }
        // One wait for all 60 fixtures; the settling pass leaves every object verified and cached.
        #[cfg(unix)]
        settle(&root);
        reset_hashed();
        let inventory = execute(&root, "inventory", Value::Null).unwrap();
        assert_eq!(inventory.as_array().unwrap().len(), 60);
        assert_eq!(hashed(), 0, "el inventario no debe calcular SHA de objetos");
        assert_eq!(hashed_bytes(), 0);

        // Adaptación a caché caliente:
        // `publish` ejecuta `commit`, el cual llama a `verified` y puebla la caché volátil en Unix.
        // En caliente, `list` verifica las rutas de los 60 objetos mediante `verified`, pero no recalcula SHA.
        let list_hot = execute(&root, "list", Value::Null).unwrap();
        assert_eq!(list_hot.as_array().unwrap().len(), 60);
        #[cfg(unix)]
        {
            assert_eq!(hashed(), 0, "con caché caliente list no debe recalcular hashes");
            assert_eq!(hashed_bytes(), 0);

            // Al vaciar la caché volátil (escenario en frío), `list` calcula y verifica el SHA de los 60 objetos.
            clear_verified_cache(&root);
            reset_hashed();
            let list_cold = execute(&root, "list", Value::Null).unwrap();
            assert_eq!(list_cold.as_array().unwrap().len(), 60);
            assert_eq!(hashed(), 60, "en frío list debe verificar y hashear cada objeto");
            assert!(hashed_bytes() > 0, "debe registrar los bytes hasheados en frío");

            // Una llamada posterior vuelve a beneficiarse de la caché caliente
            reset_hashed();
            assert_eq!(execute(&root, "list", Value::Null).unwrap().as_array().unwrap().len(), 60);
            assert_eq!(hashed(), 0);
            assert_eq!(hashed_bytes(), 0);
        }
        #[cfg(not(unix))]
        {
            assert!(hashed() > 0, "sin soporte Unix no hay reutilización sin firma equivalente");
        }
    }

    #[test]
    fn veinte_reaperturas_mismo_objeto_sin_rehashear() {
        let fixture = Fixture::new("twenty-reopen");
        let root = fixture.cache();
        let payload = b"video o audio para reapertura continua";
        publish(&root, "commit", "u_reopen", 1, payload);
        #[cfg(unix)]
        {
            // Settle once so the first open is a cold, cacheable verification.
            settle(&root);
            clear_verified_cache(&root);
        }
        reset_hashed();

        // Primera apertura: verificación en frío
        let first = execute(&root, "open", json!({"unitId": "u_reopen", "version": 1})).unwrap();
        assert!(first["paths"].is_object());
        #[cfg(unix)]
        {
            assert_eq!(hashed(), 1, "la primera verificación debe calcular el hash");
            let bytes_first = hashed_bytes();
            assert_eq!(bytes_first, payload.len() as u64);

            // 20 reaperturas consecutivas del mismo objeto
            for _ in 0..20 {
                let reopened = execute(&root, "open", json!({"unitId": "u_reopen", "version": 1})).unwrap();
                assert!(reopened["paths"].is_object());
            }
            assert_eq!(hashed(), 1, "las 20 reaperturas no deben volver a hashear el objeto");
            assert_eq!(hashed_bytes(), bytes_first, "el contador de bytes hasheados no debe aumentar");
        }
    }

    #[test]
    fn mutacion_mismo_tamano_con_mtime_restaurada_invalida_por_ctime() {
        let fixture = Fixture::new("mtime-restored");
        let root = fixture.cache();
        let payload_orig = b"archivo_original_12345";
        let payload_tamp = b"archivo_alterado_12345"; // 22 bytes
        assert_eq!(payload_orig.len(), payload_tamp.len());

        publish(&root, "commit", "u_tamper", 1, payload_orig);
        let obj_path = object(&root, payload_orig);

        // Settle once so the baseline verification is a true cache hit.
        #[cfg(unix)]
        settle(&root);
        reset_hashed();
        assert!(verified(&obj_path, &digest(payload_orig), payload_orig.len() as u64).unwrap());
        #[cfg(unix)]
        assert_eq!(hashed(), 0);

        let meta_orig = fs::metadata(&obj_path).unwrap();
        let orig_mtime = meta_orig.modified().unwrap();

        // Mutamos el contenido con igual tamaño
        fs::write(&obj_path, payload_tamp).unwrap();

        // Restauramos mtime al valor original mediante standard library
        let file = File::options().write(true).open(&obj_path).unwrap();
        let times = fs::FileTimes::new().set_modified(orig_mtime);
        file.set_times(times).unwrap();
        drop(file);

        let meta_after = fs::metadata(&obj_path).unwrap();
        assert_eq!(meta_after.modified().unwrap(), orig_mtime);

        // ctime se actualizó por el cambio en inodo/escritura; la firma no coincidirá
        reset_hashed();
        let is_valid = verified(&obj_path, &digest(payload_orig), payload_orig.len() as u64).unwrap();
        assert!(!is_valid, "el contenido alterado debe ser rechazado aunque el mtime coincida");
        #[cfg(unix)]
        {
            assert_eq!(hashed(), 1, "debió recalcular el hash por discrepancia de ctime");
            assert_eq!(hashed_bytes(), payload_orig.len() as u64);
        }
    }

    #[test]
    fn reemplazo_de_archivo_cambia_inodo_y_no_reutiliza_cache() {
        let fixture = Fixture::new("inode-replace");
        let root = fixture.cache();
        let payload = b"contenido inodo test";
        publish(&root, "commit", "u_inode", 1, payload);
        let obj_path = object(&root, payload);

        // Settle once so the baseline verification is a true cache hit.
        #[cfg(unix)]
        settle(&root);
        reset_hashed();
        assert!(verified(&obj_path, &digest(payload), payload.len() as u64).unwrap());
        #[cfg(unix)]
        assert_eq!(hashed(), 0);

        // Reemplazo atómico / nuevo archivo crea nuevo inodo
        fs::remove_file(&obj_path).unwrap();
        fs::write(&obj_path, payload).unwrap();

        reset_hashed();
        assert!(verified(&obj_path, &digest(payload), payload.len() as u64).unwrap());
        #[cfg(unix)]
        {
            assert_eq!(hashed(), 1, "nuevo inodo debe forzar re-verificación");
            assert_eq!(hashed_bytes(), payload.len() as u64);
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_en_cache_es_rechazado_sin_hashear() {
        let fixture = Fixture::new("symlink-reject");
        let payload = b"archivo real";
        let target = fixture.0.join("real_file");
        fs::write(&target, payload).unwrap();

        let symlink_path = fixture.0.join("symlink_file");
        std::os::unix::fs::symlink(&target, &symlink_path).unwrap();

        reset_hashed();
        let res = verified(&symlink_path, &digest(payload), payload.len() as u64).unwrap();
        assert!(!res, "los symlinks deben ser rechazados tajantemente");
        assert_eq!(hashed(), 0, "no se deben leer ni hashear bytes a través de symlinks");
        assert_eq!(hashed_bytes(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn limite_de_tabla_cache_a_1024_entradas_desaloja_elementos_antiguos() {
        let fixture = Fixture::new("cache-limit");
        let path = fixture.0.join("sample"); fs::write(&path, b"sample").unwrap();
        let signature = CacheSignature::from_metadata(&fs::metadata(path).unwrap());
        let mut cache = VerifiedCache::new();
        let key = |index: usize| (PathBuf::from(format!("object-{index}")), String::from("hash"), 6);
        for index in 0..1025 { cache.insert(key(index), signature); }
        assert_eq!(cache.entries.len(), 1024); assert_eq!(cache.order.len(), 1024);
        assert!(!cache.get(&key(0), &signature)); assert!(cache.get(&key(1024), &signature));
        // Repeated invalidation must bound the eviction queue as well as the map.
        for _ in 0..2048 { cache.remove(&key(1024)); cache.insert(key(1024), signature); }
        assert_eq!(cache.entries.len(), 1024); assert_eq!(cache.order.len(), 1024);
    }

    #[cfg(unix)]
    #[test]
    fn elegibilidad_de_cache_exige_ctime_asentada_con_tiempo_inyectado() {
        use std::time::Duration;
        let sig = |mtime: (i64, i64), ctime: (i64, i64)| CacheSignature { dev: 1, ino: 1, len: 1, mtime_sec: mtime.0, mtime_nsec: mtime.1, ctime_sec: ctime.0, ctime_nsec: ctime.1 };
        let now = Duration::new(1000, 500);
        assert!(sig((900, 0), (998, 500)).settled_at(now), "exactamente 2 s es el límite elegible");
        assert!(!sig((900, 0), (998, 501)).settled_at(now), "un nanosegundo menos no es elegible");
        assert!(sig((900, 0), (0, 0)).settled_at(now));
        assert!(!sig((900, 0), (1000, 0)).settled_at(now), "ctime reciente");
        assert!(!sig((900, 0), (1000, 501)).settled_at(now), "ctime futura");
        assert!(!sig((1000, 501), (900, 0)).settled_at(now), "mtime futura");
        assert!(!sig((-1, 0), (900, 0)).settled_at(now), "mtime negativa");
        assert!(!sig((900, 0), (-1, 0)).settled_at(now), "ctime negativa");
        assert!(!sig((900, 0), (900, -1)).settled_at(now), "nsec negativo");
        assert!(!sig((900, 1_000_000_000), (900, 0)).settled_at(now), "nsec fuera de rango");
    }

    #[cfg(unix)]
    #[test]
    fn firma_no_asentada_repetida_hashea_siempre_y_no_entra_en_cache() {
        let fixture = Fixture::new("fresh-signature");
        let path = fixture.0.join("recien");
        let payload = b"recien escrito";
        let hash = digest(payload);
        fs::write(&path, payload).unwrap();
        let file = File::options().write(true).open(&path).unwrap();
        file.set_times(fs::FileTimes::new().set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(3600))).unwrap();
        drop(file);
        for _ in 0..3 {
            reset_hashed();
            assert!(verified(&path, &hash, payload.len() as u64).unwrap());
            assert_eq!(hashed(), 1, "una firma reciente debe hashear en cada verificación");
        }
        let key = (path.clone(), hash.clone(), payload.len() as u64);
        assert!(!cache_store().lock().unwrap().entries.contains_key(&key), "una firma reciente no debe tener entrada");
        fs::write(&path, b"RECIEN ESCRITO").unwrap();
        assert!(!verified(&path, &hash, payload.len() as u64).unwrap(), "mutación inmediata del mismo tamaño debe detectarse");
    }

    #[test]
    fn objeto_corrupto_del_mismo_tamano_es_provisional_y_la_verificacion_lo_rechaza() {
        let fixture = Fixture::new("corrupt");
        let root = fixture.cache();
        let manifest = publish(&root, "commit", "u", 1, b"offline");
        fs::write(object(&root, b"offline"), b"offlinX").unwrap();
        reset_hashed();
        assert_eq!(listed(&root), vec![("u".to_string(), 1)]);
        assert_eq!(hashed(), 0);
        assert_eq!(execute(&root, "list", Value::Null).unwrap(), json!([]));
        assert!(hashed() > 0);
        assert!(execute(&root, "open", json!({"unitId": "u", "version": 1})).unwrap_err().starts_with("integrity:"));
        assert_eq!(execute(&root, "has", json!({"hash": digest(b"offline"), "size": 7})).unwrap(), json!(false));
        let mut next = manifest.clone(); next["version"] = json!(2);
        assert!(execute(&root, "commit", next).is_err());
        assert!(!manifest_path(&root, "u", 2).exists());
        let hash = digest(b"offline");
        execute(&root, "begin", json!({"hash": hash})).unwrap();
        execute(&root, "append", json!({"hash": hash, "offset": 0, "chunk": b"offlinX".to_vec()})).unwrap();
        assert!(execute(&root, "finish", json!({"hash": hash, "size": 7})).unwrap_err().starts_with("integrity:"));
    }

    #[test]
    fn inventario_omite_unidades_no_disponibles_y_nunca_muestra_preparadas() {
        let fixture = Fixture::new("omit");
        let root = fixture.cache();
        publish(&root, "commit", "ok", 1, b"ok bytes");
        publish(&root, "commit", "gone", 1, b"gone bytes");
        fs::remove_file(object(&root, b"gone bytes")).unwrap();
        publish(&root, "commit", "short", 1, b"short bytes");
        fs::write(object(&root, b"short bytes"), b"x").unwrap();
        publish(&root, "commit", "isdir", 1, b"isdir bytes");
        fs::remove_file(object(&root, b"isdir bytes")).unwrap();
        fs::create_dir(object(&root, b"isdir bytes")).unwrap();
        publish(&root, "commit", "badjson", 1, b"badjson bytes");
        fs::write(manifest_path(&root, "badjson", 1), b"{no es json").unwrap();
        publish(&root, "commit", "badhash", 1, b"badhash bytes");
        let mut tampered: Value = serde_json::from_slice(&fs::read(manifest_path(&root, "badhash", 1)).unwrap()).unwrap();
        tampered["unit"]["levelId"] = json!("otro");
        fs::write(manifest_path(&root, "badhash", 1), tampered.to_string()).unwrap();
        publish(&root, "commit", "mandir", 1, b"mandir bytes");
        fs::remove_file(manifest_path(&root, "mandir", 1)).unwrap();
        fs::create_dir(manifest_path(&root, "mandir", 1)).unwrap();
        publish(&root, "stage", "soloprep", 1, b"staged only");
        publish(&root, "commit", "mixed", 1, b"mixed v1");
        publish(&root, "stage", "mixed", 2, b"mixed v2");
        assert_eq!(listed(&root), vec![("mixed".to_string(), 1), ("ok".to_string(), 1)]);
    }

    #[test]
    fn inventario_elige_la_version_mas_alta_disponible() {
        let fixture = Fixture::new("versions");
        let root = fixture.cache();
        for (version, payload) in [(1, "v1"), (2, "v2"), (3, "v3")] { publish(&root, "commit", "u", version, payload.as_bytes()); }
        assert_eq!(listed(&root), vec![("u".to_string(), 3)]);
        fs::write(object(&root, b"v3"), b"?").unwrap();
        assert_eq!(listed(&root), vec![("u".to_string(), 2)]);
        fs::remove_file(object(&root, b"v2")).unwrap();
        assert_eq!(listed(&root), vec![("u".to_string(), 1)]);
    }

    #[test]
    fn marcador_legacy_existente_no_recorre_ni_calcula_hashes() {
        let fixture = Fixture::new("legacy");
        let users = fixture.0.join("users");
        let root = users.join("actual");
        publish(&users.join("anterior"), "commit", "u", 1, b"legacy bytes");
        prepare(&root).unwrap();
        write_synced(&root.join("legacy-adopted"), b"1").unwrap();
        reset_hashed();
        adopt_legacy(&root).unwrap();
        assert_eq!(hashed(), 0);
        assert!(!root.join("units").exists());
    }

    #[test]
    fn fallos_de_almacenamiento_no_se_confunden_con_catalogo_vacio() {
        let fixture = Fixture::new("io");
        let root = fixture.cache();
        // Absent catalog is a legitimately empty inventory.
        assert_eq!(inventory(&root).unwrap(), json!([]));
        fs::create_dir_all(&root).unwrap();
        assert_eq!(inventory(&root).unwrap(), json!([]));
        assert!(directory_entries(&root.join("nada")).unwrap().is_empty());
        // `units` that is a file: read_dir fails with a non-NotFound error.
        fs::write(root.join("units"), b"no es directorio").unwrap();
        assert!(inventory(&root).unwrap_err().starts_with("cache:"));
        fs::remove_file(root.join("units")).unwrap();
        // `versions` that is a file under a real unit directory fails the same way.
        fs::create_dir_all(root.join("units").join("u")).unwrap();
        fs::write(root.join("units").join("u").join("versions"), b"x").unwrap();
        assert!(inventory(&root).unwrap_err().starts_with("cache:"));
        // Stray plain files next to unit directories are ignored, not errors.
        fs::remove_file(root.join("units").join("u").join("versions")).unwrap();
        fs::write(root.join("units").join("suelto"), b"x").unwrap();
        assert_eq!(inventory(&root).unwrap(), json!([]));
    }

    // Delivers a JSON prefix and then fails, like a disk that dies mid-read.
    struct FailingReader { prefix: &'static [u8], code: i32 }
    impl Read for FailingReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.prefix.is_empty() { return Err(std::io::Error::from_raw_os_error(self.code)); }
            let len = self.prefix.len().min(buf.len());
            buf[..len].copy_from_slice(&self.prefix[..len]);
            self.prefix = &self.prefix[len..];
            Ok(len)
        }
    }

    #[test]
    fn error_de_lectura_no_se_confunde_con_json_corrupto() {
        let partial: &'static [u8] = br#"{"schemaVersion": 2, "resources": ["#;
        let io = parse_manifest(FailingReader { prefix: partial, code: 5 }).unwrap_err();
        assert!(io.starts_with("cache:"), "{io}");
        assert!(!io.starts_with("manifest:"), "{io}");
        // Same JSON prefix ending for real (EOF) or with bad syntax is a corrupt manifest.
        assert!(parse_manifest(partial).unwrap_err().starts_with("manifest:"));
        assert!(parse_manifest(&b"{no es json}"[..]).unwrap_err().starts_with("manifest:"));
        // inventory would skip "manifest:" errors; the IO error must not match that filter.
        assert!(!(io.starts_with("manifest:") || io.starts_with("integrity:")));
    }
}
