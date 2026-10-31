//! Device secrets live in a native vault (AES-256-GCM, local CSPRNG key), never in the cache/WebView.
//!
//! Model (this module never deletes or rotates anything on its own):
//! * Steady state: the identity lives in `vault` (cipher in the private state dir, random key in a
//!   different private dir under `$XDG_CONFIG_HOME`, both outside `$APPDATA`). Once a v2 marker or a
//!   vault exists, load/proof/mark/reset-binding/`authorized_owner` never touch the Secret Service.
//! * First install: the legacy Secret Service is only *probed* (never written). A single accessible
//!   legacy identity is copied (wrapped) into the vault, read back in full and only then recorded in
//!   the marker; the legacy item stays untouched. A confirmed-empty store, or a missing service with
//!   no on-disk keyring/wallet evidence and no marker, creates a new identity in the vault.
//! * Locked, ambiguous, corrupt or erroring legacy stores, a legacy (v1) marker whose secret is gone,
//!   a v2 marker without its vault, and any corrupt vault fail closed: no new identity, no fallback.
//! * A public marker (`$XDG_STATE_HOME/active-classroom-identity`) records ids + origin only. v1 =
//!   legacy Secret Service collection, v2 = native vault (sentinel collection outside the real
//!   Secret Service namespace). `reset-binding` journals the next public ids in the marker *before*
//!   writing the new secret, so a crash is recovered on the next load.
//! * Honest limit: the vault key is a plain file protected by the OS (owner UID, 0700/0600), not by a
//!   password, TPM or keyring. It defends against other OS users, not against root, processes with the
//!   same UID, or a copy of the powered-off disk. Without a marker, absence of a legacy identity is
//!   only provable for what the Secret Service and the on-disk GNOME/KWallet files expose; a secret
//!   kept by a different, unreachable backend cannot be detected.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
    thread::JoinHandle,
    time::{Duration, Instant},
};

const APPLICATION: &str = "com.activeclassroom.desktop";
const CREDENTIAL: &str = "device-v1";
const SECRETS_PATH: &str = "/org/freedesktop/secrets";
const COLLECTION_PREFIX: &str = "/org/freedesktop/secrets/collection/";
const GDBUS: &str = "/usr/bin/gdbus";
const SECRET_TOOL: &str = "/usr/bin/secret-tool";
const GDBUS_TIMEOUT: Duration = Duration::from_secs(6); // gdbus itself gets --timeout 5
const SECRET_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const LOCK_TIMEOUT: Duration = Duration::from_secs(60);
const OUTPUT_LIMIT: usize = 64 * 1024;
const MARKER_LIMIT: u64 = 4096;
const MARKER_DIR: &str = "active-classroom-identity";
/// GNOME's in-memory collection: it vanishes with the session, so it can never hold the identity.
const SESSION_COLLECTION: &str = "/org/freedesktop/secrets/collection/session";
/// Private sentinel (outside the real Secret Service namespace) marking the native vault as the origin.
const NATIVE_COLLECTION: &str = "/org/activeclassroom/identity/vault";

#[path = "device_identity/vault.rs"]
mod vault;
use vault::Vault;

#[derive(Default)]
pub struct DeviceGate(pub Arc<Mutex<()>>);
/// Process-wide serialization of every identity operation (including `authorized_owner`).
static SERIAL: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind { Locked, Conflict, Corrupt, Unavailable, Unsupported, Storage, Invalid }
impl Kind {
    /// Fixed Spanish messages; the `device:<kind>` prefix is the contract with the frontend.
    fn message(self) -> String {
        match self {
            Kind::Locked => "device:locked: El almacén seguro del equipo está bloqueado. Desbloquéalo y reintenta; la identidad se conserva.",
            Kind::Conflict => "device:conflict: La identidad del equipo no coincide o está duplicada. Solicita asistencia técnica antes de continuar.",
            Kind::Corrupt => "device:corrupt: La identidad local no es legible o no pudo verificarse. Solicita asistencia técnica antes de continuar.",
            Kind::Unavailable => "device:unavailable: El almacén seguro no responde por ahora. Reintenta; la identidad se conserva.",
            Kind::Unsupported => "device:unsupported: Este sistema no ofrece un almacén seguro compatible. Solicita asistencia técnica.",
            Kind::Storage => "device:storage: No se pudo verificar el almacén de identidad del equipo. Reintenta la recuperación; si persiste, solicita asistencia técnica.",
            Kind::Invalid => "device: Operación inválida.",
        }.into()
    }
}
type Res<T> = Result<T, Kind>;

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Identity {
    device_id: String,
    credential: String,
    name: String,
    activated: bool,
    revoked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cache_device_id: Option<String>,
}
impl std::fmt::Debug for Identity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Identity({}, activated={}, revoked={})", self.device_id, self.activated, self.revoked)
    }
}
fn valid_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn decode(value: &str) -> Res<Identity> {
    let identity: Identity = serde_json::from_str(value).map_err(|_| Kind::Corrupt)?;
    if !valid_hex(&identity.device_id, 32) || !valid_hex(&identity.credential, 64) || identity.cache_device_id.as_ref().is_some_and(|id| !valid_hex(id, 32)) || identity.name.is_empty() || identity.name.len() > 200 {
        return Err(Kind::Corrupt);
    }
    Ok(identity)
}
fn random_hex(length: usize) -> Res<String> {
    let mut bytes = vec![0u8; length];
    getrandom::fill(&mut bytes).map_err(|_| Kind::Unavailable)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

// ---------------------------------------------------------------- strict GVariant text parsing

fn object_segment(segment: &str) -> bool {
    !segment.is_empty() && segment.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
}
fn valid_collection(path: &str) -> bool {
    path.strip_prefix(COLLECTION_PREFIX).is_some_and(object_segment)
}
fn valid_item(path: &str) -> bool {
    path.strip_prefix(COLLECTION_PREFIX).and_then(|rest| rest.split_once('/')).is_some_and(|(collection, item)| object_segment(collection) && object_segment(item))
}
fn collection_of(item: &str) -> &str {
    item.rsplit_once('/').map_or(item, |(collection, _)| collection)
}
struct Cursor<'a> { text: &'a [u8], at: usize }
impl<'a> Cursor<'a> {
    fn new(text: &'a str) -> Self { Cursor { text: text.as_bytes(), at: 0 } }
    fn space(&mut self) -> bool {
        let start = self.at;
        while self.text.get(self.at).is_some_and(u8::is_ascii_whitespace) { self.at += 1; }
        self.at > start
    }
    fn eat(&mut self, literal: &str) -> bool {
        if self.text[self.at..].starts_with(literal.as_bytes()) { self.at += literal.len(); true } else { false }
    }
    fn expect(&mut self, literal: &str) -> Res<()> {
        self.space();
        if self.eat(literal) { Ok(()) } else { Err(Kind::Storage) }
    }
    fn finish(&mut self) -> Res<()> {
        self.space();
        if self.at == self.text.len() { Ok(()) } else { Err(Kind::Storage) }
    }
    fn quoted(&mut self) -> Res<String> {
        self.expect("'")?;
        let start = self.at;
        while self.text.get(self.at).is_some_and(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'/') { self.at += 1; }
        let value = std::str::from_utf8(&self.text[start..self.at]).map_err(|_| Kind::Storage)?.to_owned();
        if !self.eat("'") { return Err(Kind::Storage); }
        Ok(value)
    }
    fn object_path(&mut self) -> Res<String> {
        self.space();
        if self.eat("objectpath") && !self.space() { return Err(Kind::Storage); }
        self.quoted()
    }
    /// `@ao []` or `[objectpath '/a', '/b']`. A bare `[]` is ambiguous and rejected.
    fn object_path_array(&mut self) -> Res<Vec<String>> {
        self.space();
        if self.eat("@ao") { self.expect("[")?; self.expect("]")?; return Ok(Vec::new()); }
        self.expect("[")?;
        let mut paths = Vec::new();
        loop {
            paths.push(self.object_path()?);
            self.space();
            if self.eat(",") { continue; }
            self.expect("]")?;
            return Ok(paths);
        }
    }
}
fn all_unique(paths: &[&String]) -> bool {
    paths.iter().enumerate().all(|(i, a)| paths[i + 1..].iter().all(|b| a != b))
}
#[derive(Debug, Default, PartialEq)]
struct Search { unlocked: Vec<String>, locked: Vec<String> }
/// Output of `SearchItems`: `([objectpath '/..'], @ao [])`.
fn parse_search_items(text: &str) -> Res<Search> {
    let mut cursor = Cursor::new(text);
    cursor.expect("(")?;
    let unlocked = cursor.object_path_array()?;
    cursor.expect(",")?;
    let locked = cursor.object_path_array()?;
    cursor.expect(")")?;
    cursor.finish()?;
    let every: Vec<&String> = unlocked.iter().chain(locked.iter()).collect();
    if !every.iter().all(|path| valid_item(path)) || !all_unique(&every) { return Err(Kind::Storage); }
    Ok(Search { unlocked, locked })
}
/// Output of `Properties.Get Collections`: `(<[objectpath '/..'] >,)`.
fn parse_collections(text: &str) -> Res<Vec<String>> {
    let mut cursor = Cursor::new(text);
    cursor.expect("(")?; cursor.expect("<")?;
    let paths = cursor.object_path_array()?;
    cursor.expect(">")?; cursor.expect(",")?; cursor.expect(")")?; cursor.finish()?;
    let every: Vec<&String> = paths.iter().collect();
    if !paths.iter().all(|path| valid_collection(path)) || !all_unique(&every) { return Err(Kind::Storage); }
    Ok(paths)
}
fn parse_locked(text: &str) -> Res<bool> {
    match text.chars().filter(|c| !c.is_whitespace()).collect::<String>().as_str() {
        "(<true>,)" => Ok(true),
        "(<false>,)" => Ok(false),
        _ => Err(Kind::Storage),
    }
}
/// Output of `ReadAlias`: `(objectpath '/..',)`. `/` means "no such alias". Test fixtures only.
#[cfg(test)]
fn parse_alias(text: &str) -> Res<String> {
    let mut cursor = Cursor::new(text);
    cursor.expect("(")?;
    let path = cursor.object_path()?;
    cursor.expect(",")?; cursor.expect(")")?; cursor.finish()?;
    if path == "/" { return Err(Kind::Unavailable); }
    if valid_collection(&path) { Ok(path) } else { Err(Kind::Storage) }
}
/// libsecret 0.20 prints only the last path segment (`[/1]`); other versions may print the full path.
fn header_matches(header: &str, item: &str) -> bool {
    header == item || item.rsplit_once('/').is_some_and(|(_, last)| header.strip_prefix('/') == Some(last))
}
/// `secret-tool search --all` output restricted to exactly the discovered item (the caller proved
/// through `SearchItems` that it is the only match, so a single block is the only acceptable shape).
fn parse_secret_search(text: &str, item: &str) -> Res<String> {
    let mut blocks: Vec<(&str, Vec<&str>)> = Vec::new();
    for line in text.lines() {
        if let Some(path) = line.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')) { blocks.push((path, Vec::new())); }
        else if let Some(block) = blocks.last_mut() { block.1.push(line); }
        else if !line.trim().is_empty() { return Err(Kind::Storage); }
    }
    match blocks.as_slice() {
        [] => Err(Kind::Unavailable),
        [(path, lines)] if header_matches(path, item) => {
            let mut secrets = lines.iter().filter_map(|line| line.strip_prefix("secret = "));
            match (secrets.next(), secrets.next()) { (Some(secret), None) => Ok(secret.to_owned()), _ => Err(Kind::Storage) }
        }
        _ => Err(Kind::Conflict),
    }
}

// ---------------------------------------------------------------- subprocesses

struct Output { success: bool, stdout: Vec<u8> }
fn drain<R: Read + Send + 'static>(mut pipe: R) -> JoinHandle<(Vec<u8>, bool)> {
    std::thread::spawn(move || {
        let (mut kept, mut overflow, mut buffer) = (Vec::new(), false, [0u8; 4096]);
        while let Ok(count) = pipe.read(&mut buffer) {
            if count == 0 { break; }
            if kept.len() + count > OUTPUT_LIMIT { overflow = true; } else { kept.extend_from_slice(&buffer[..count]); }
        }
        (kept, overflow)
    })
}
/// Absolute program, `LC_ALL=C.UTF-8`, hard timeout, pipes drained concurrently and capped.
/// Never logs or returns raw output beyond what the caller parses.
fn run(program: &str, args: &[&str], input: Option<&str>, timeout: Duration) -> Res<Output> {
    // GLib converts argv from the locale charset: C would reject the Spanish label before storing.
    let mut child = Command::new(program).args(args).env("LC_ALL", "C.UTF-8").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|error| if error.kind() == std::io::ErrorKind::NotFound { Kind::Unsupported } else { Kind::Unavailable })?;
    let stdout = drain(child.stdout.take().ok_or(Kind::Unavailable)?);
    let stderr = drain(child.stderr.take().ok_or(Kind::Unavailable)?);
    let mut stdin = child.stdin.take();
    let payload = input.map(|value| value.as_bytes().to_vec());
    let failed = Arc::new(AtomicBool::new(false));
    let flag = failed.clone();
    let writer = std::thread::spawn(move || {
        let result = match (stdin.as_mut(), payload) { (Some(pipe), Some(bytes)) => pipe.write_all(&bytes).and_then(|()| pipe.flush()), _ => Ok(()) };
        if result.is_err() { flag.store(true, Ordering::SeqCst); }
        drop(stdin);
        result.is_ok()
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if failed.load(Ordering::SeqCst) => { let _ = child.kill(); let _ = child.wait(); break None; }
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(20)),
            _ => { let _ = child.kill(); let _ = child.wait(); break None; }
        }
    };
    let wrote = writer.join().unwrap_or(false);
    let (out, out_overflow) = stdout.join().map_err(|_| Kind::Unavailable)?;
    let (_, err_overflow) = stderr.join().map_err(|_| Kind::Unavailable)?;
    // A payload that did not reach the child is never a successful store.
    if !wrote { return Err(Kind::Unavailable); }
    let status = status.ok_or(Kind::Unavailable)?;
    if out_overflow || err_overflow { return Err(Kind::Storage); }
    Ok(Output { success: status.success(), stdout: out })
}
fn text(output: Output) -> Res<String> {
    if !output.success { return Err(Kind::Unavailable); }
    String::from_utf8(output.stdout).map_err(|_| Kind::Storage)
}

// ---------------------------------------------------------------- Secret Service backend

/// Read-only probe of the legacy store. Nothing in production ever writes to it any more.
trait Backend: Sync {
    fn search(&self) -> Res<Search>;
    fn read(&self, item: &str) -> Res<String>;
    fn collections(&self) -> Res<Vec<(String, bool)>>;
    fn keyring_files(&self) -> Res<Vec<String>>;
    fn collection_locked(&self, collection: &str) -> Res<bool>;
    /// On-disk traces of a persistent secret backend. Only consulted when the service itself is gone.
    fn legacy_evidence(&self) -> Res<bool> { Ok(!self.keyring_files()?.is_empty()) }
    /// Seeding legacy fixtures in tests; production never creates legacy items.
    #[cfg(test)]
    fn default_collection(&self) -> Res<String>;
    #[cfg(test)]
    fn store(&self, collection: &str, secret: &str) -> Res<()>;
    /// Fault injection around the vault write (tests only).
    #[cfg(test)]
    fn before_vault_save(&self) -> Res<()> { Ok(()) }
    #[cfg(test)]
    fn after_vault_save(&self) {}
}
struct Linux;
impl Linux {
    fn gdbus(&self, object: &str, method: &str, extra: &[&str]) -> Res<String> {
        let mut args = vec!["call", "--session", "--timeout", "5", "--dest", "org.freedesktop.secrets", "--object-path", object, "--method", method];
        args.extend_from_slice(extra);
        text(run(GDBUS, &args, None, GDBUS_TIMEOUT)?)
    }
    fn property(&self, object: &str, interface: &str, name: &str) -> Res<String> {
        self.gdbus(object, "org.freedesktop.DBus.Properties.Get", &[interface, name])
    }
}
impl Backend for Linux {
    fn search(&self) -> Res<Search> {
        let attributes = format!("{{'application': '{APPLICATION}', 'credential': '{CREDENTIAL}'}}");
        parse_search_items(&self.gdbus(SECRETS_PATH, "org.freedesktop.Secret.Service.SearchItems", &[attributes.as_str()])?)
    }
    fn read(&self, item: &str) -> Res<String> {
        // `secret-tool` cannot address one item, so it must be the only match before and after reading.
        let sole = |search: Search| if !search.locked.is_empty() { Err(Kind::Locked) } else if search.unlocked == [item] { Ok(()) } else { Err(Kind::Conflict) };
        sole(self.search()?)?;
        let output = text(run(SECRET_TOOL, &["search", "--all", "application", APPLICATION, "credential", CREDENTIAL], None, SECRET_TIMEOUT)?)?;
        sole(self.search()?)?;
        parse_secret_search(&output, item)
    }
    fn collections(&self) -> Res<Vec<(String, bool)>> {
        let paths = parse_collections(&self.property(SECRETS_PATH, "org.freedesktop.Secret.Service", "Collections")?)?;
        paths.into_iter().map(|path| { let locked = self.collection_locked(&path)?; Ok((path, locked)) }).collect()
    }
    fn keyring_files(&self) -> Res<Vec<String>> {
        let Some(home) = base_dir("XDG_DATA_HOME", ".local/share") else { return Err(Kind::Storage) };
        match fs::read_dir(home.join("keyrings")) {
            Ok(entries) => {
                let mut stems = Vec::new();
                for entry in entries {
                    let name = entry.map_err(|_| Kind::Storage)?.file_name();
                    if let Some(stem) = name.to_str().and_then(|n| n.strip_suffix(".keyring")) { stems.push(stem.to_owned()); }
                    else if name.to_str().is_none() { return Err(Kind::Storage); }
                }
                Ok(stems)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(_) => Err(Kind::Storage),
        }
    }
    fn legacy_evidence(&self) -> Res<bool> {
        if !self.keyring_files()?.is_empty() { return Ok(true); }
        let Some(data) = base_dir("XDG_DATA_HOME", ".local/share") else { return Err(Kind::Storage) };
        match fs::read_dir(data.join("kwalletd")) {
            Ok(entries) => {
                for entry in entries {
                    let name = entry.map_err(|_| Kind::Storage)?.file_name();
                    if name.to_str().map_or(true, |n| n.ends_with(".kwl")) { return Ok(true); }
                }
                Ok(false)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err(Kind::Storage),
        }
    }
    fn collection_locked(&self, collection: &str) -> Res<bool> {
        if !valid_collection(collection) { return Err(Kind::Storage); }
        parse_locked(&self.property(collection, "org.freedesktop.Secret.Collection", "Locked")?)
    }
    #[cfg(test)]
    fn default_collection(&self) -> Res<String> {
        parse_alias(&self.gdbus(SECRETS_PATH, "org.freedesktop.Secret.Service.ReadAlias", &["default"])?)
    }
    #[cfg(test)]
    fn store(&self, collection: &str, secret: &str) -> Res<()> {
        if !valid_collection(collection) { return Err(Kind::Storage); }
        // The secret travels only through stdin, never argv.
        let output = run(SECRET_TOOL, &["store", "--label", "Active Classroom · identidad del salón", "--collection", collection, "application", APPLICATION, "credential", CREDENTIAL], Some(secret), SECRET_TIMEOUT)?;
        if output.success { Ok(()) } else { Err(Kind::Unavailable) }
    }
}

// ---------------------------------------------------------------- public marker (no secrets)

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ids {
    device_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cache_device_id: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Marker {
    version: u32,
    device_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cache_device_id: Option<String>,
    collection: String,
    /// Journal: public ids the secret is about to take (written before the secret).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending: Option<Ids>,
}
impl Marker {
    fn of(identity: &Identity, collection: &str) -> Marker {
        let version = if collection == NATIVE_COLLECTION { 2 } else { 1 };
        Marker { version, device_id: identity.device_id.clone(), cache_device_id: identity.cache_device_id.clone(), collection: collection.to_owned(), pending: None }
    }
    fn ids(&self) -> Ids { Ids { device_id: self.device_id.clone(), cache_device_id: self.cache_device_id.clone() } }
    /// v2 = the native vault is the only origin; v1 = legacy Secret Service collection.
    fn native(&self) -> bool { self.version == 2 }
    fn valid(&self) -> bool {
        let ids_ok = |ids: &Ids| valid_hex(&ids.device_id, 32) && ids.cache_device_id.as_ref().map_or(true, |id| valid_hex(id, 32));
        let origin_ok = match self.version { 1 => valid_collection(&self.collection), 2 => self.collection == NATIVE_COLLECTION, _ => false };
        origin_ok && ids_ok(&self.ids()) && self.pending.as_ref().map_or(true, |p| ids_ok(p) && *p != self.ids())
    }
}
fn identity_ids(identity: &Identity) -> Ids { Ids { device_id: identity.device_id.clone(), cache_device_id: identity.cache_device_id.clone() } }

fn base_dir(variable: &str, fallback: &str) -> Option<PathBuf> {
    let absolute = |value: std::ffi::OsString| Some(PathBuf::from(value)).filter(|path| path.is_absolute());
    std::env::var_os(variable).and_then(absolute)
        .or_else(|| std::env::var_os("HOME").and_then(absolute).map(|home| home.join(fallback)))
}

/// `dir`: private state dir (marker, lock, vault cipher). `key_dir`: a different private dir for the
/// vault key. `appdata`: the WebView asset scope (`$APPDATA`), which must never contain either dir.
#[derive(Clone)]
struct Files { dir: PathBuf, key_dir: PathBuf, appdata: PathBuf }
struct FileLock(#[allow(dead_code)] File);
impl Files {
    fn from_env() -> Res<Files> {
        let state = base_dir("XDG_STATE_HOME", ".local/state").ok_or(Kind::Storage)?;
        let config = base_dir("XDG_CONFIG_HOME", ".config").ok_or(Kind::Storage)?;
        let data = base_dir("XDG_DATA_HOME", ".local/share").ok_or(Kind::Storage)?;
        Ok(Files { dir: state.join(MARKER_DIR), key_dir: config.join(MARKER_DIR), appdata: data.join(APPLICATION) })
    }
    fn marker(&self) -> PathBuf { self.dir.join("identity.json") }
    fn prepare(&self) -> Res<()> { Self::prepare_dir(&self.dir) }
    fn prepare_dir(dir: &Path) -> Res<()> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
            fs::DirBuilder::new().recursive(true).mode(0o700).create(dir).map_err(|_| Kind::Storage)?;
            let meta = fs::symlink_metadata(dir).map_err(|_| Kind::Storage)?;
            if !meta.is_dir() { return Err(Kind::Storage); }
            if meta.permissions().mode() & 0o777 != 0o700 { fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|_| Kind::Storage)?; }
        }
        #[cfg(not(unix))]
        fs::create_dir_all(dir).map_err(|_| Kind::Storage)?;
        Ok(())
    }
    /// Creates both private dirs (no secret yet), proves through canonical paths that neither is, or
    /// lies inside, `$APPDATA` (nor one inside the other), and only then hands out the vault. The dirs
    /// are prepared first on purpose: if they were placed under a missing `$APPDATA`, it exists now.
    fn vault(&self) -> Res<Vault> {
        self.prepare()?;
        Self::prepare_dir(&self.key_dir)?;
        let state = fs::canonicalize(&self.dir).map_err(|_| Kind::Storage)?;
        let key = fs::canonicalize(&self.key_dir).map_err(|_| Kind::Storage)?;
        if state.starts_with(&key) || key.starts_with(&state) { return Err(Kind::Storage); }
        let mut forbidden = vec![self.appdata.clone()];
        match fs::canonicalize(&self.appdata) {
            Ok(real) => forbidden.push(real),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(Kind::Storage),
        }
        if forbidden.iter().any(|root| state.starts_with(root) || key.starts_with(root) || self.dir.starts_with(root) || self.key_dir.starts_with(root)) { return Err(Kind::Storage); }
        Ok(Vault::new(state, key))
    }
    fn open_private(&self, path: &Path, create_new: bool) -> std::io::Result<File> {
        let mut options = OpenOptions::new();
        options.write(true);
        if create_new { options.create_new(true); } else { options.create(true).truncate(false); }
        #[cfg(unix)]
        { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        options.open(path)
    }
    /// Cross-process lock (flock on a 0600 file, released by the kernel if the process dies).
    fn lock(&self) -> Res<FileLock> {
        self.prepare()?;
        let file = self.open_private(&self.dir.join("identity.lock"), false).map_err(|_| Kind::Storage)?;
        #[cfg(target_os = "linux")]
        {
            use std::os::fd::AsRawFd;
            extern "C" { fn flock(fd: i32, operation: i32) -> i32; }
            const LOCK_EX_NB: i32 = 2 | 4;
            let start = Instant::now();
            loop {
                // SAFETY: plain libc call on a descriptor owned by `file`, which outlives it.
                if unsafe { flock(file.as_raw_fd(), LOCK_EX_NB) } == 0 { break; }
                match std::io::Error::last_os_error().kind() {
                    std::io::ErrorKind::Interrupted => {}
                    std::io::ErrorKind::WouldBlock if start.elapsed() < LOCK_TIMEOUT => std::thread::sleep(Duration::from_millis(25)),
                    std::io::ErrorKind::WouldBlock => return Err(Kind::Unavailable),
                    _ => return Err(Kind::Storage),
                }
            }
        }
        Ok(FileLock(file))
    }
    /// `Ok(None)` only when no entry exists at all. Symlinks (even dangling), directories, FIFOs and
    /// anything unreadable fail closed *before* opening, so a lost marker never allows a new identity.
    fn read(&self) -> Res<Option<Marker>> {
        let path = self.marker();
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(Kind::Storage),
        };
        if !meta.file_type().is_file() { return Err(Kind::Storage); }
        let file = File::open(&path).map_err(|_| Kind::Storage)?;
        let opened = file.metadata().map_err(|_| Kind::Storage)?;
        if !opened.is_file() { return Err(Kind::Storage); }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if (opened.dev(), opened.ino()) != (meta.dev(), meta.ino()) { return Err(Kind::Storage); }
        }
        let mut content = String::new();
        file.take(MARKER_LIMIT + 1).read_to_string(&mut content).map_err(|error| if error.kind() == std::io::ErrorKind::InvalidData { Kind::Corrupt } else { Kind::Storage })?;
        if content.len() as u64 > MARKER_LIMIT { return Err(Kind::Corrupt); }
        let marker: Marker = serde_json::from_str(&content).map_err(|_| Kind::Corrupt)?;
        if marker.valid() { Ok(Some(marker)) } else { Err(Kind::Corrupt) }
    }
    /// temp (create_new) -> fsync -> rename -> fsync(dir). The previous marker is never truncated.
    fn write(&self, marker: &Marker) -> Res<()> {
        self.prepare()?;
        let temp = self.dir.join("identity.json.tmp");
        match fs::remove_file(&temp) { Ok(()) => {}, Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}, Err(_) => return Err(Kind::Storage) }
        let body = serde_json::to_vec(marker).map_err(|_| Kind::Storage)?;
        let written = (|| -> std::io::Result<()> {
            let mut file = self.open_private(&temp, true)?;
            file.write_all(&body)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temp, self.marker())?;
            File::open(&self.dir)?.sync_all()
        })();
        if written.is_err() { let _ = fs::remove_file(&temp); return Err(Kind::Storage); }
        Ok(())
    }
}

// ---------------------------------------------------------------- decisions

enum Action { Keep, Write(Marker) }
/// Compares the single accessible secret with the public marker. Never guesses.
fn reconcile(marker: Option<&Marker>, identity: &Identity, collection: &str) -> Res<Action> {
    let Some(marker) = marker else { return Ok(Action::Write(Marker::of(identity, collection))) };
    if marker.collection != collection { return Err(Kind::Conflict); }
    let current = identity_ids(identity);
    if current == marker.ids() {
        // A journal whose next state never reached the secret is aborted; the secret is the previous state.
        return Ok(if marker.pending.is_some() { Action::Write(Marker { pending: None, ..marker.clone() }) } else { Action::Keep });
    }
    match &marker.pending {
        Some(next) if current == *next => Ok(Action::Write(Marker::of(identity, collection))),
        _ => Err(Kind::Conflict),
    }
}
/// Without a marker, "empty search" is only trusted when no collection is locked and every
/// on-disk keyring is represented by a collection the service lists.
fn prove_absence(backend: &dyn Backend) -> Res<()> {
    if backend.collections()?.iter().any(|(_, locked)| *locked) { return Err(Kind::Locked); }
    represented_files(backend)
}
/// Every on-disk keyring must be represented by a collection the service lists (locked or not).
fn represented_files(backend: &dyn Backend) -> Res<()> {
    let collections = backend.collections()?;
    let sanitized = |name: &str| name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect::<String>();
    let represented = |stem: &str| collections.iter().any(|(path, _)| path.rsplit('/').next() == Some(sanitized(stem).as_str()));
    if backend.keyring_files()?.iter().all(|stem| represented(stem)) { Ok(()) } else { Err(Kind::Locked) }
}

/// What the read-only legacy probe concluded.
enum Probe {
    /// Exactly one accessible legacy identity, coherent with the marker (if any).
    Found(Identity),
    /// Search confirmed empty, nothing locked, every on-disk keyring represented, no marker.
    Absent,
    /// The Secret Service (or its tools) could not be reached at all.
    Down(Kind),
}
struct Resolved { identity: Identity, vault: Vault, marker: Marker }
struct Service<'a> { backend: &'a dyn Backend, files: &'a Files }
impl Service<'_> {
    /// Single entry point: process mutex + file lock, then the (lock-free) closure.
    fn locked<T>(&self, work: impl FnOnce() -> Res<T>) -> Res<T> {
        let _process = SERIAL.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let _file = self.files.lock()?;
        work()
    }
    /// The vault decides first. Only without any vault (and without a v2 marker) is the legacy
    /// store consulted, and then only to probe it. A vault problem never falls back to legacy.
    fn resolve(&self) -> Res<Resolved> {
        let marker = self.files.read()?;
        let vault = self.files.vault()?;
        match vault.load()? {
            Some(identity) => self.adopt(marker, identity, vault),
            None if marker.as_ref().is_some_and(Marker::native) => Err(Kind::Storage), // recorded vault vanished
            None => match self.probe(marker.as_ref())? {
                Probe::Found(identity) => self.persist_first(identity, vault),
                Probe::Absent => self.persist_first(self.new_identity()?, vault),
                Probe::Down(kind) => {
                    // No service: a brand-new machine may proceed, but only with no marker and no trace of
                    // a persistent backend that could still hold an identity.
                    if marker.is_some() || self.backend.legacy_evidence()? { return Err(kind); }
                    self.persist_first(self.new_identity()?, vault)
                }
            },
        }
    }
    /// A valid vault exists: reuse its identity and settle the marker (crash between vault and marker).
    fn adopt(&self, marker: Option<Marker>, identity: Identity, vault: Vault) -> Res<Resolved> {
        let marker = match marker {
            None => self.write_native(&identity)?,
            Some(marker) if marker.native() => match reconcile(Some(&marker), &identity, NATIVE_COLLECTION)? {
                Action::Keep => marker,
                Action::Write(next) => { self.files.write(&next)?; next }
            },
            // Legacy marker left by an interrupted migration: only the same public ids may finalize it.
            Some(marker) => {
                let current = identity_ids(&identity);
                if current != marker.ids() && marker.pending.as_ref() != Some(&current) { return Err(Kind::Conflict); }
                self.write_native(&identity)?
            }
        };
        Ok(Resolved { identity, vault, marker })
    }
    fn write_native(&self, identity: &Identity) -> Res<Marker> {
        let marker = Marker::of(identity, NATIVE_COLLECTION);
        self.files.write(&marker)?;
        Ok(marker)
    }
    /// Read-only look at the legacy Secret Service. Never writes, never creates.
    fn probe(&self, marker: Option<&Marker>) -> Res<Probe> {
        let down = |kind: Kind| matches!(kind, Kind::Unsupported | Kind::Unavailable);
        let search = match self.backend.search() { Ok(search) => search, Err(kind) if down(kind) => return Ok(Probe::Down(kind)), Err(kind) => return Err(kind) };
        if !search.locked.is_empty() { return Err(Kind::Locked); }
        match search.unlocked.as_slice() {
            [] => {
                match prove_absence(self.backend) { Ok(()) => {}, Err(kind) if down(kind) => return Ok(Probe::Down(kind)), Err(kind) => return Err(kind) }
                // A recorded identity that vanished is an error, never a reason to create another.
                if marker.is_some() { return Err(Kind::Storage); }
                Ok(Probe::Absent)
            }
            [item] => {
                let collection = collection_of(item);
                if collection == SESSION_COLLECTION { return Err(Kind::Unsupported); }
                if marker.is_none() {
                    // First adoption: never ignore a hidden on-disk keyring.
                    represented_files(self.backend)?;
                }
                let identity = decode(&self.backend.read(item)?)?;
                // Only coherence is needed here; the legacy marker is superseded by the v2 one.
                reconcile(marker, &identity, collection)?;
                Ok(Probe::Found(identity))
            }
            _ => Err(Kind::Conflict),
        }
    }
    fn new_identity(&self) -> Res<Identity> {
        let name = fs::read_to_string("/etc/hostname").unwrap_or_else(|_| "Equipo del salón".into()).trim().chars().take(50).collect::<String>();
        let name = if name.is_empty() { "Equipo del salón".to_owned() } else { name };
        Ok(Identity { device_id: random_hex(16)?, credential: random_hex(32)?, name, activated: false, revoked: false, cache_device_id: None })
    }
    /// Wrapped copy (migration) or brand-new identity: vault first, verified in full, marker last.
    /// If the marker write fails the next load adopts the verified vault as is.
    fn persist_first(&self, identity: Identity, vault: Vault) -> Res<Resolved> {
        self.save_native(&vault, &identity)?;
        let marker = self.write_native(&identity)?;
        Ok(Resolved { identity, vault, marker })
    }
    /// Save in the vault, then prove the very same identity reads back (AEAD-verified).
    fn save_native(&self, vault: &Vault, identity: &Identity) -> Res<()> {
        #[cfg(test)]
        self.backend.before_vault_save()?;
        vault.save(identity)?;
        if vault.load()? != Some(identity.clone()) { return Err(Kind::Storage); }
        #[cfg(test)]
        self.backend.after_vault_save();
        Ok(())
    }
    fn execute(&self, action: &str) -> Res<Value> {
        let resolved = self.resolve()?;
        let (identity, public) = operate(resolved.identity.clone(), action)?;
        if identity.device_id != resolved.identity.device_id {
            // Journal the public next ids first so a crash around the secret write is recoverable.
            let mut journal = resolved.marker.clone();
            journal.pending = Some(identity_ids(&identity));
            self.files.write(&journal)?;
            self.save_native(&resolved.vault, &identity)?;
            self.files.write(&Marker::of(&identity, NATIVE_COLLECTION))?;
        } else if identity.activated != resolved.identity.activated || identity.revoked != resolved.identity.revoked {
            self.save_native(&resolved.vault, &identity)?;
        }
        Ok(public)
    }
    fn authorized(&self, owner: &str) -> Res<bool> {
        let identity = self.resolve()?.identity;
        Ok(identity.activated && !identity.revoked && owner == format!("ac-device-{}", identity.cache_device_id.as_ref().unwrap_or(&identity.device_id)))
    }
}
fn with_service<T>(work: impl FnOnce(&Service) -> Res<T>) -> Result<T, String> {
    (|| {
        if !cfg!(target_os = "linux") { return Err(Kind::Unsupported); }
        let files = Files::from_env()?;
        let service = Service { backend: &Linux, files: &files };
        service.locked(|| work(&service))
    })().map_err(Kind::message)
}

pub fn authorized_owner(owner: &str) -> Result<bool, String> {
    with_service(|service| service.authorized(owner))
}
fn operate(mut identity: Identity, action: &str) -> Res<(Identity, Value)> {
    match action {
        "load" => {},
        "proof" => return Ok((identity.clone(), json!({ "deviceId": identity.device_id, "credential": identity.credential, "name": identity.name, "registered": identity.activated || identity.revoked }))),
        "reset-binding" => {
            // Rotate only pairing secrets. The original namespace remains in the
            // secure store; no files, preferences or cache aliases supplied by JS.
            identity.cache_device_id = Some(identity.cache_device_id.unwrap_or_else(|| identity.device_id.clone()));
            identity.device_id = random_hex(16)?; identity.credential = random_hex(32)?;
            identity.activated = false; identity.revoked = false;
        },
        "activated" => { identity.activated = true; identity.revoked = false; },
        "revoked" => { identity.activated = false; identity.revoked = true; },
        _ => return Err(Kind::Invalid),
    }
    let public = json!({ "deviceId": identity.device_id, "cacheDeviceId": identity.cache_device_id, "name": identity.name, "activated": identity.activated, "revoked": identity.revoked });
    Ok((identity, public))
}
#[tauri::command]
pub async fn classroom_device(window: tauri::WebviewWindow, gate: tauri::State<'_, DeviceGate>, action: String) -> Result<Value, String> {
    if window.label() != "teacher" { return Err("device: Ventana no autorizada.".into()); }
    let mutex = gate.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = mutex.lock().map_err(|_| "device: Identidad ocupada.")?;
        with_service(|service| service.execute(&action))
    }).await.map_err(|_| "device: No se pudo acceder al llavero.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Identity { Identity { device_id: "a".repeat(32), credential: "b".repeat(64), name: "Salón 1".into(), activated: false, revoked: false, cache_device_id: None } }
    fn secret(identity: &Identity) -> String { serde_json::to_string(identity).unwrap() }

    // ---- in-memory Secret Service (legacy probe only: nothing in production writes to it)
    const LOGIN: &str = "/org/freedesktop/secrets/collection/login";
    const OTHER: &str = "/org/freedesktop/secrets/collection/otro";
    #[derive(Default)]
    struct State {
        items: Vec<(String, String)>,
        locked: Vec<String>,
        collections: Vec<String>,
        files: Vec<String>,
        default: Option<String>,
        fail_search: Option<Kind>,
        fail_vault_save: bool,
        sabotage_after_vault_save: Option<PathBuf>,
        stores: Vec<String>,
        /// Every probe/read call, to prove the steady state never consults the Secret Service.
        calls: usize,
        next: usize,
    }
    struct Mock(Mutex<State>);
    impl Mock {
        fn new() -> Mock {
            Mock(Mutex::new(State { collections: vec![LOGIN.into(), OTHER.into()], files: vec!["login".into()], default: Some(LOGIN.into()), ..State::default() }))
        }
        fn put(&self, collection: &str, value: &str) {
            let mut st = self.0.lock().unwrap(); st.next += 1; let path = format!("{collection}/{}", st.next); st.items.push((path, value.to_owned()));
        }
        fn with<T>(&self, f: impl FnOnce(&mut State) -> T) -> T { f(&mut self.0.lock().unwrap()) }
        fn snapshot(&self) -> Vec<(String, String)> { self.with(|st| st.items.clone()) }
        fn calls(&self) -> usize { self.with(|st| st.calls) }
        /// The Secret Service is gone: no daemon answers and no keyring trace is left on disk.
        fn gone(&self, kind: Kind) { self.with(|st| { st.fail_search = Some(kind); st.files.clear(); }) }
        /// Nothing may be answered (or written) by the legacy store any more.
        fn hostile(&self) { self.with(|st| { st.fail_search = Some(Kind::Unavailable); st.locked = st.collections.clone(); st.files = vec!["Default_keyring".into()]; st.default = None; }) }
    }
    impl Backend for Mock {
        fn search(&self) -> Res<Search> {
            let mut st = self.0.lock().unwrap(); st.calls += 1;
            if let Some(kind) = st.fail_search { return Err(kind); }
            let mut search = Search::default();
            for (path, _) in &st.items { if st.locked.iter().any(|c| c == collection_of(path)) { search.locked.push(path.clone()) } else { search.unlocked.push(path.clone()) } }
            Ok(search)
        }
        fn read(&self, item: &str) -> Res<String> { let mut st = self.0.lock().unwrap(); st.calls += 1; st.items.iter().find(|(p, _)| p == item).map(|(_, s)| s.clone()).ok_or(Kind::Unavailable) }
        fn collections(&self) -> Res<Vec<(String, bool)>> { let mut st = self.0.lock().unwrap(); st.calls += 1; Ok(st.collections.iter().map(|c| (c.clone(), st.locked.contains(c))).collect()) }
        fn keyring_files(&self) -> Res<Vec<String>> { let mut st = self.0.lock().unwrap(); st.calls += 1; Ok(st.files.clone()) }
        fn default_collection(&self) -> Res<String> { self.0.lock().unwrap().default.clone().ok_or(Kind::Unavailable) }
        fn collection_locked(&self, collection: &str) -> Res<bool> { let mut st = self.0.lock().unwrap(); st.calls += 1; Ok(st.locked.iter().any(|c| c == collection)) }
        fn store(&self, collection: &str, value: &str) -> Res<()> {
            let mut st = self.0.lock().unwrap();
            st.stores.push(collection.to_owned());
            match st.items.iter_mut().find(|(p, _)| collection_of(p) == collection) {
                Some(item) => item.1 = value.to_owned(),
                None => { st.next += 1; let path = format!("{collection}/{}", st.next); st.items.push((path, value.to_owned())); }
            }
            Ok(())
        }
        fn before_vault_save(&self) -> Res<()> { if self.0.lock().unwrap().fail_vault_save { Err(Kind::Unavailable) } else { Ok(()) } }
        fn after_vault_save(&self) { if let Some(path) = self.0.lock().unwrap().sabotage_after_vault_save.take() { fs::create_dir_all(path).unwrap(); } }
    }

    // ---- temp state/key dirs (test-owned, freshly created)
    /// Owns an exclusive root (`create_dir` + CSPRNG suffix); only that root is ever removed.
    struct Sandbox { root: PathBuf, files: Files }
    const SANDBOX_PREFIX: &str = "ac-identity-test-";
    impl Sandbox {
        fn new() -> Sandbox {
            let temp = std::env::temp_dir();
            assert!(temp.is_absolute());
            for _ in 0..16 {
                let root = temp.join(format!("{SANDBOX_PREFIX}{}", random_hex(8).unwrap()));
                match fs::create_dir(&root) {
                    Ok(()) => {
                        let files = Files { dir: root.join("state").join(MARKER_DIR), key_dir: root.join("config").join(MARKER_DIR), appdata: root.join("data").join(APPLICATION) };
                        return Sandbox { files, root };
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("cannot create test sandbox: {error}"),
                }
            }
            panic!("cannot find an unused test sandbox name");
        }
        fn marker_text(&self) -> Option<String> { fs::read_to_string(self.files.marker()).ok() }
        fn vault(&self) -> Vault { self.files.vault().unwrap() }
        /// What the vault holds right now (`None` when neither key nor cipher exist).
        fn stored(&self) -> Option<Identity> { self.vault().load().unwrap() }
        fn cipher(&self) -> PathBuf { self.files.dir.join("vault-v1.enc") }
        fn key(&self) -> PathBuf { self.files.key_dir.join("vault-v1.key") }
        fn no_vault_files(&self) -> bool { !self.cipher().exists() && !self.key().exists() }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let temp = std::env::temp_dir();
            let named = self.root.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with(SANDBOX_PREFIX));
            let real_dir = fs::symlink_metadata(&self.root).is_ok_and(|meta| meta.is_dir());
            if self.root.is_absolute() && self.root.parent() == Some(temp.as_path()) && named && real_dir { let _ = fs::remove_dir_all(&self.root); }
        }
    }
    fn run_action(mock: &Mock, sandbox: &Sandbox, action: &str) -> Res<Value> {
        let service = Service { backend: mock, files: &sandbox.files };
        service.locked(|| service.execute(action))
    }

    // ---- pure helpers kept from the previous suite
    #[test]
    fn public_identity_never_contains_secret() {
        let (_, value) = operate(fixture(), "load").unwrap();
        assert!(value.get("credential").is_none());
        assert_eq!(value["activated"], false);
    }
    #[test]
    fn activation_survives_secure_store_serialization() {
        let (identity, _) = operate(fixture(), "activated").unwrap();
        let restored = decode(&secret(&identity)).unwrap();
        assert!(restored.activated); assert_eq!(restored.device_id, fixture().device_id);
    }
    #[test]
    fn revocation_blocks_offline_authorization() {
        let (identity, _) = operate(fixture(), "activated").unwrap();
        let (revoked, _) = operate(identity, "revoked").unwrap();
        assert!(!revoked.activated); assert!(revoked.revoked);
    }
    #[test]
    fn rebinding_rotates_secrets_and_preserves_only_the_owned_cache_namespace() {
        let (old, _) = operate(fixture(), "revoked").unwrap();
        let (next, public) = operate(old.clone(), "reset-binding").unwrap();
        assert_ne!(next.device_id, old.device_id); assert_ne!(next.credential, old.credential);
        assert_eq!(next.cache_device_id.as_deref(), Some(old.device_id.as_str()));
        assert!(!next.activated); assert!(!next.revoked); assert!(public.get("credential").is_none());
        let (again, _) = operate(next, "reset-binding").unwrap();
        assert_eq!(again.cache_device_id.as_deref(), Some(old.device_id.as_str()));
        assert_eq!(decode(&secret(&again)).unwrap().cache_device_id, again.cache_device_id);
    }
    #[test]
    fn rejects_corrupt_identity_and_unknown_actions() {
        assert_eq!(decode("{}"), Err(Kind::Corrupt));
        let mut identity = fixture(); identity.credential = "x".repeat(64);
        assert_eq!(decode(&secret(&identity)), Err(Kind::Corrupt));
        assert_eq!(operate(fixture(), "reset").unwrap_err(), Kind::Invalid);
    }
    #[test]
    fn messages_carry_the_agreed_prefix_and_no_secret() {
        for (kind, prefix) in [(Kind::Locked, "device:locked"), (Kind::Conflict, "device:conflict"), (Kind::Corrupt, "device:corrupt"), (Kind::Unavailable, "device:unavailable"), (Kind::Unsupported, "device:unsupported"), (Kind::Storage, "device:storage")] {
            let message = kind.message();
            assert!(message.starts_with(&format!("{prefix}: ")), "{message}");
            assert!(!message.contains('/') && !message.contains(&"a".repeat(8)));
        }
        assert!(Kind::Invalid.message().starts_with("device: "));
        // These kinds can also surface after a secret was written, so they never promise "nothing changed".
        for kind in [Kind::Storage, Kind::Conflict, Kind::Corrupt] {
            let message = kind.message().to_lowercase();
            assert!(!message.contains("no se modificó") && !message.contains("no se creó") && !message.contains("ninguna"), "{message}");
        }
    }

    // ---- parsers
    #[test]
    fn search_items_parser_accepts_only_the_exact_structure() {
        let one = "/org/freedesktop/secrets/collection/login/1";
        let two = "/org/freedesktop/secrets/collection/otro/7";
        assert_eq!(parse_search_items("(@ao [], @ao [])\n").unwrap(), Search::default());
        assert_eq!(parse_search_items(&format!("([objectpath '{one}'], @ao [])")).unwrap(), Search { unlocked: vec![one.into()], locked: vec![] });
        assert_eq!(parse_search_items(&format!("(@ao [], [objectpath '{one}', '{two}'])")).unwrap().locked.len(), 2);
        assert_eq!(parse_search_items(&format!("([objectpath '{one}', objectpath '{two}'], @ao [])")).unwrap().unlocked.len(), 2);
        for bad in [
            "", "()", "(@ao [])", "([], [])", "(@ao [], @ao [], @ao [])", "(@ao [], @ao []) x", "@ao [], @ao []",
            "([objectpath '/other/path/1'], @ao [])", "([objectpath '/org/freedesktop/secrets/collection/login'], @ao [])",
            "([objectpath '/org/freedesktop/secrets/collection/login/1/2'], @ao [])", "([objectpath '/org/freedesktop/secrets/collection//1'], @ao [])",
            "([objectpath '/org/freedesktop/secrets/collection/login/1\\''], @ao [])", "([objectpath 'x'y'], @ao [])", "([objectpathx '/a'], @ao [])",
            "([objectpath '/org/freedesktop/secrets/collection/login/1', '/org/freedesktop/secrets/collection/login/1'], @ao [])",
            "([objectpath '/org/freedesktop/secrets/collection/login/1'], [objectpath '/org/freedesktop/secrets/collection/login/1'])",
            "([objectpath '/org/freedesktop/secrets/collection/login/1',], @ao [])", "Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown",
        ] { assert!(parse_search_items(bad).is_err(), "must reject: {bad}"); }
    }
    #[test]
    fn property_and_alias_parsers_are_strict() {
        assert_eq!(parse_locked("(<false>,)\n").unwrap(), false);
        assert_eq!(parse_locked("( <true> , )").unwrap(), true);
        assert!(parse_locked("(<'false'>,)").is_err() && parse_locked("").is_err() && parse_locked("(<false>)").is_err());
        assert_eq!(parse_collections("(<[objectpath '/org/freedesktop/secrets/collection/login', '/org/freedesktop/secrets/collection/session']>,)").unwrap().len(), 2);
        assert!(parse_collections("(<@ao []>,)").unwrap().is_empty());
        assert!(parse_collections("(<[objectpath '/org/freedesktop/secrets/collection/login/1']>,)").is_err());
        assert!(parse_collections("([objectpath '/org/freedesktop/secrets/collection/login'],)").is_err());
        assert_eq!(parse_alias("(objectpath '/org/freedesktop/secrets/collection/login',)").unwrap(), LOGIN);
        assert_eq!(parse_alias("(objectpath '/',)"), Err(Kind::Unavailable));
        assert!(parse_alias("('/org/freedesktop/secrets/collection/login')").is_err());
    }
    #[test]
    fn secret_search_parser_requires_exactly_the_discovered_item() {
        let item = "/org/freedesktop/secrets/collection/login/1";
        let ok = format!("[{item}]\nlabel = x\nsecret = {{\"a\":1}}\ncreated = 1\nattribute.application = y\n");
        assert_eq!(parse_secret_search(&ok, item).unwrap(), "{\"a\":1}");
        assert_eq!(parse_secret_search("", item), Err(Kind::Unavailable));
        assert_eq!(parse_secret_search(&ok.replace("/1]", "/2]"), item), Err(Kind::Conflict));
        assert_eq!(parse_secret_search(&format!("{ok}[{item}2]\nsecret = z\n"), item), Err(Kind::Conflict));
        assert_eq!(parse_secret_search(&format!("[{item}]\nlabel = x\n"), item), Err(Kind::Storage));
        assert_eq!(parse_secret_search(&format!("[{item}]\nsecret = a\nsecret = b\n"), item), Err(Kind::Storage));
        assert_eq!(parse_secret_search(&format!("junk\n[{item}]\nsecret = a\n"), item), Err(Kind::Storage));
    }
    #[test]
    fn secret_search_parser_accepts_the_abbreviated_ubuntu_22_header() {
        let item = "/org/freedesktop/secrets/collection/login/1";
        // libsecret 0.20.5 `secret-tool search --all` prints only the last segment of the object path.
        let real = "[/1]\nlabel = Active Classroom · identidad del salón\nsecret = {\"deviceId\":\"x\"}\ncreated = 2026-10-30 10:00:00\nmodified = 2026-10-30 10:00:00\nschema = org.freedesktop.Secret.Generic\nattribute.application = com.activeclassroom.desktop\nattribute.credential = device-v1\n";
        assert_eq!(parse_secret_search(real, item).unwrap(), "{\"deviceId\":\"x\"}");
        assert_eq!(parse_secret_search(&real.replace("[/1]", &format!("[{item}]")), item).unwrap(), "{\"deviceId\":\"x\"}");
        assert_eq!(parse_secret_search(&real.replace("[/1]", "[/2]"), item), Err(Kind::Conflict));
        assert_eq!(parse_secret_search(&real.replace("[/1]", "[1]"), item), Err(Kind::Conflict));
        assert_eq!(parse_secret_search(&real.replace("[/1]", "[/login/1]"), item), Err(Kind::Conflict));
        assert_eq!(parse_secret_search(&format!("{real}{real}"), item), Err(Kind::Conflict));
        assert_eq!(parse_secret_search(&format!("{real}[/2]\nsecret = z\n"), item), Err(Kind::Conflict));
        assert_eq!(parse_secret_search("[/1]\nlabel = x\n", item), Err(Kind::Storage));
    }
    #[cfg(unix)]
    #[test]
    fn subprocess_stderr_is_not_a_failure_and_a_failed_stdin_write_is() {
        // libsecret prints the attributes on stderr; that alone must not fail the call.
        let ok = run("/bin/sh", &["-c", "echo 'attribute.application = x' >&2; echo '[/1]'"], None, Duration::from_secs(10)).ok().unwrap();
        assert!(ok.success && ok.stdout == b"[/1]\n");
        assert!(run("/bin/sh", &["-c", "cat >/dev/null"], Some("secret"), Duration::from_secs(10)).is_ok());
        // The child exits without reading a payload larger than the pipe buffer: never a successful store.
        let big = "x".repeat(512 * 1024);
        assert_eq!(run("/bin/sh", &["-c", "exit 0"], Some(&big), Duration::from_secs(10)).err(), Some(Kind::Unavailable));
        // A child that stays alive without reading is killed as soon as its stdin breaks or the timeout hits.
        assert_eq!(run("/bin/sh", &["-c", "exec 0<&-; exec sleep 30"], Some(&big), Duration::from_secs(10)).err(), Some(Kind::Unavailable));
    }

    // ---- decisions: nothing is ever created on doubt
    fn assert_untouched(mock: &Mock, before: &[(String, String)]) {
        assert_eq!(mock.snapshot(), before); assert!(mock.with(|st| st.stores.is_empty()));
    }
    fn contains_bytes(haystack: &[u8], needle: &str) -> bool {
        haystack.windows(needle.len()).any(|window| window == needle.as_bytes())
    }
    #[test]
    fn clean_first_install_creates_exactly_one_identity_in_the_vault_and_a_native_marker() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        let public = run_action(&mock, &sandbox, "load").unwrap();
        assert!(mock.snapshot().is_empty() && mock.with(|st| st.stores.is_empty()), "the legacy store is never written");
        let stored = sandbox.stored().unwrap();
        let marker = sandbox.marker_text().unwrap();
        assert!(marker.contains(&stored.device_id) && marker.contains(NATIVE_COLLECTION) && marker.contains("\"version\":2"));
        assert!(!marker.contains(&stored.credential) && !marker.contains("credential") && !marker.contains("pending"));
        assert_eq!(public["deviceId"], stored.device_id.as_str()); assert!(public.get("credential").is_none());
        // Neither file holds the identity in the clear, and the key lives outside the state dir.
        for file in [sandbox.cipher(), sandbox.key()] {
            let raw = fs::read(&file).unwrap();
            assert!(!contains_bytes(&raw, &stored.credential) && !contains_bytes(&raw, &stored.device_id), "{file:?}");
        }
        assert_ne!(sandbox.cipher().parent(), sandbox.key().parent());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in [&sandbox.files.dir, &sandbox.files.key_dir] { assert_eq!(fs::metadata(dir).unwrap().permissions().mode() & 0o777, 0o700); }
            for file in [sandbox.files.marker(), sandbox.cipher(), sandbox.key()] { assert_eq!(fs::metadata(file).unwrap().permissions().mode() & 0o777, 0o600); }
        }
        // Steady state: even a dead, locked, hostile Secret Service is never consulted again.
        let calls = mock.calls(); mock.hostile();
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap()["deviceId"], stored.device_id.as_str());
        assert_eq!(run_action(&mock, &sandbox, "proof").unwrap()["credential"], stored.credential.as_str());
        assert_eq!(mock.calls(), calls); assert_eq!(sandbox.stored(), Some(stored));
    }
    #[test]
    fn failures_never_create_any_identity() {
        let ids = |m: &Mock| m.snapshot();
        let cases: Vec<(&str, Box<dyn Fn(&Mock)>, Kind)> = vec![
            ("search unavailable with a keyring on disk", Box::new(|m: &Mock|m.with(|s| s.fail_search = Some(Kind::Unavailable))), Kind::Unavailable),
            ("tools missing with a keyring on disk", Box::new(|m: &Mock|m.with(|s| s.fail_search = Some(Kind::Unsupported))), Kind::Unsupported),
            ("search garbled", Box::new(|m: &Mock|m.with(|s| s.fail_search = Some(Kind::Storage))), Kind::Storage),
            ("locked match", Box::new(|m: &Mock|{ m.put(OTHER, &secret(&fixture())); m.with(|s| s.locked.push(OTHER.into())) }), Kind::Locked),
            ("locked empty collection", Box::new(|m: &Mock|m.with(|s| s.locked.push(OTHER.into()))), Kind::Locked),
            ("keyring file not represented", Box::new(|m: &Mock|m.with(|s| s.files.push("Default_keyring".into()))), Kind::Locked),
            ("two matches", Box::new(|m: &Mock|{ m.put(LOGIN, &secret(&fixture())); m.put(OTHER, &secret(&fixture())) }), Kind::Conflict),
            ("corrupt legacy credential", Box::new(|m: &Mock|m.put(LOGIN, &"c".repeat(64))), Kind::Corrupt),
        ];
        for (label, setup, expected) in cases {
            let (mock, sandbox) = (Mock::new(), Sandbox::new());
            setup(&mock); let before = ids(&mock);
            assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), expected, "{label}");
            assert_eq!(ids(&mock), before, "{label}"); assert!(sandbox.marker_text().is_none(), "{label}"); assert!(sandbox.no_vault_files(), "{label}");
        }
    }
    #[test]
    fn a_machine_without_secret_service_or_keyring_traces_gets_a_vault_identity() {
        // Fresh account with no login keyring: neither the service nor the tools exist, nothing is on disk.
        for kind in [Kind::Unsupported, Kind::Unavailable] {
            let (mock, sandbox) = (Mock::new(), Sandbox::new());
            mock.gone(kind);
            let public = run_action(&mock, &sandbox, "load").unwrap();
            let stored = sandbox.stored().unwrap();
            assert_eq!(public["deviceId"], stored.device_id.as_str());
            assert!(sandbox.files.read().unwrap().unwrap().native());
            assert!(mock.snapshot().is_empty() && mock.with(|s| s.stores.is_empty()));
            // The next load decides from the vault alone.
            let calls = mock.calls();
            assert_eq!(run_action(&mock, &sandbox, "load").unwrap()["deviceId"], stored.device_id.as_str());
            assert_eq!(mock.calls(), calls);
        }
    }
    #[test]
    fn a_fresh_account_without_login_collection_or_default_alias_still_gets_a_vault_identity() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        mock.with(|s| { s.collections.clear(); s.files.clear(); s.default = None; });
        run_action(&mock, &sandbox, "load").unwrap();
        assert!(sandbox.stored().is_some() && mock.snapshot().is_empty());
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        mock.with(|s| { s.collections = vec![SESSION.into()]; s.files.clear(); s.default = Some(SESSION.into()); });
        run_action(&mock, &sandbox, "load").unwrap();
        assert!(sandbox.stored().is_some() && mock.snapshot().is_empty());
    }
    #[test]
    fn without_a_service_any_trace_of_a_previous_identity_blocks_creation() {
        // A keyring file may hold an identity we cannot see.
        for kind in [Kind::Unsupported, Kind::Unavailable] {
            let (mock, sandbox) = (Mock::new(), Sandbox::new());
            mock.gone(kind); mock.with(|s| s.files = vec!["login".into()]);
            assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), kind);
            assert!(sandbox.no_vault_files() && sandbox.marker_text().is_none());
        }
        // A legacy marker proves an identity existed.
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        mock.gone(Kind::Unavailable);
        sandbox.files.write(&Marker::of(&fixture(), LOGIN)).unwrap();
        let marker = sandbox.marker_text();
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Unavailable);
        assert!(sandbox.no_vault_files()); assert_eq!(sandbox.marker_text(), marker);
        // A native marker without its vault is an error, with or without a service.
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        mock.gone(Kind::Unavailable);
        sandbox.files.write(&Marker::of(&fixture(), NATIVE_COLLECTION)).unwrap();
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Storage);
        assert!(sandbox.no_vault_files());
    }
    #[test]
    fn represented_keyring_files_do_not_block_a_configured_empty_install() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        mock.with(|s| s.files = vec!["login".into(), "otro".into()]);
        run_action(&mock, &sandbox, "load").unwrap();
        assert!(mock.snapshot().is_empty()); assert!(sandbox.stored().is_some());
    }
    const SESSION: &str = "/org/freedesktop/secrets/collection/session";
    #[test]
    fn the_ephemeral_session_collection_is_never_adopted_and_never_hosts_the_identity() {
        // Default alias pointing at `session` with an empty store: the identity goes to the vault only.
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        mock.with(|s| { s.collections.push(SESSION.into()); s.default = Some(SESSION.into()); });
        run_action(&mock, &sandbox, "load").unwrap();
        assert!(mock.snapshot().is_empty() && mock.with(|s| s.stores.is_empty())); assert!(sandbox.stored().is_some());
        // A single legacy identity that only lives in `session` is not adopted, moved or deleted.
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        mock.with(|s| s.collections.push(SESSION.into()));
        mock.put(SESSION, &secret(&fixture())); let before = mock.snapshot();
        for action in ["load", "activated", "reset-binding"] { assert_eq!(run_action(&mock, &sandbox, action).unwrap_err(), Kind::Unsupported, "{action}"); }
        assert_untouched(&mock, &before); assert!(sandbox.marker_text().is_none() && sandbox.no_vault_files());
        sandbox.files.write(&Marker::of(&fixture(), SESSION)).unwrap();
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Unsupported);
        assert_untouched(&mock, &before); assert!(sandbox.no_vault_files());
    }
    #[test]
    fn a_hidden_keyring_file_blocks_the_first_migration_but_not_an_already_migrated_install() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        mock.put(LOGIN, &secret(&fixture())); let before = mock.snapshot();
        mock.with(|s| s.files.push("Default_keyring".into()));
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Locked);
        assert_untouched(&mock, &before); assert!(sandbox.marker_text().is_none() && sandbox.no_vault_files());
        // Once the legacy identity is wrapped into the vault, unrelated keyrings no longer matter.
        mock.with(|s| s.files.pop());
        run_action(&mock, &sandbox, "load").unwrap();
        mock.with(|s| { s.files.push("Default_keyring".into()); s.locked.push(OTHER.into()); });
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap()["deviceId"], fixture().device_id.as_str());
        assert_untouched(&mock, &before);
    }
    #[cfg(unix)]
    #[test]
    fn a_dangling_marker_symlink_is_an_error_and_never_a_new_identity() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        sandbox.files.prepare().unwrap();
        std::os::unix::fs::symlink(sandbox.files.dir.join("gone"), sandbox.files.marker()).unwrap();
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Storage);
        assert!(mock.snapshot().is_empty() && mock.with(|s| s.stores.is_empty()) && sandbox.no_vault_files());
        assert!(fs::symlink_metadata(sandbox.files.marker()).unwrap().file_type().is_symlink());
        assert!(fs::symlink_metadata(sandbox.files.dir.join("gone")).is_err());
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn a_fifo_marker_is_rejected_from_metadata_without_opening_it() {
        use std::os::unix::ffi::OsStrExt;
        extern "C" { fn mkfifo(path: *const std::ffi::c_char, mode: u32) -> i32; }
        let sandbox = Sandbox::new();
        sandbox.files.prepare().unwrap();
        let path = std::ffi::CString::new(sandbox.files.marker().as_os_str().as_bytes()).unwrap();
        // SAFETY: `path` is a valid NUL-terminated string that outlives the call.
        assert_eq!(unsafe { mkfifo(path.as_ptr(), 0o600) }, 0);
        let (sender, receiver) = std::sync::mpsc::channel();
        let files = sandbox.files.clone();
        std::thread::spawn(move || { let _ = sender.send(files.read().err()); });
        // Opening a FIFO without a writer would block forever; a timeout here means the marker was opened.
        assert_eq!(receiver.recv_timeout(Duration::from_secs(10)), Ok(Some(Kind::Storage)));
    }
    #[test]
    fn a_lost_vault_is_an_error_not_a_new_identity() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        run_action(&mock, &sandbox, "load").unwrap();
        let marker = sandbox.marker_text();
        fs::remove_file(sandbox.cipher()).unwrap(); // ready key, cipher missing
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Storage);
        assert!(!sandbox.cipher().exists() && sandbox.key().exists());
        fs::remove_file(sandbox.key()).unwrap(); // nothing left, but the v2 marker proves it existed
        for action in ["load", "activated", "reset-binding"] { assert_eq!(run_action(&mock, &sandbox, action).unwrap_err(), Kind::Storage, "{action}"); }
        assert!(sandbox.no_vault_files()); assert_eq!(sandbox.marker_text(), marker);
        assert!(mock.snapshot().is_empty() && mock.with(|s| s.stores.is_empty()));
    }
    #[test]
    fn a_corrupt_vault_never_falls_back_to_the_legacy_secret() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        mock.put(LOGIN, &secret(&fixture())); let before = mock.snapshot();
        run_action(&mock, &sandbox, "load").unwrap();
        let (marker, calls) = (sandbox.marker_text(), mock.calls());
        let mut raw = fs::read(sandbox.cipher()).unwrap();
        let last = raw.len() - 1; raw[last] ^= 1; // the legacy secret is still healthy and unlocked
        fs::write(sandbox.cipher(), &raw).unwrap();
        for action in ["load", "proof", "activated", "reset-binding"] { assert_eq!(run_action(&mock, &sandbox, action).unwrap_err(), Kind::Corrupt, "{action}"); }
        let service = Service { backend: &mock, files: &sandbox.files };
        assert_eq!(service.locked(|| service.authorized("ac-device-x")), Err(Kind::Corrupt));
        // A cipher without its key is just as unreadable.
        fs::remove_file(sandbox.key()).unwrap();
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Corrupt);
        assert_eq!(mock.calls(), calls); assert_untouched(&mock, &before); assert_eq!(sandbox.marker_text(), marker);
    }
    #[test]
    fn migration_wraps_the_legacy_identity_exactly_and_leaves_the_legacy_item_untouched() {
        let mut activated = fixture(); activated.activated = true; activated.cache_device_id = Some("c".repeat(32)); activated.name = "Salón de música".into();
        let mut revoked = fixture(); revoked.revoked = true; revoked.credential = "e".repeat(64);
        for legacy in [activated, revoked, fixture()] {
            let (mock, sandbox) = (Mock::new(), Sandbox::new());
            mock.put(OTHER, &secret(&legacy)); let before = mock.snapshot();
            let public = run_action(&mock, &sandbox, "load").unwrap();
            assert_untouched(&mock, &before);
            assert_eq!(sandbox.stored(), Some(legacy.clone()), "every field survives the wrap");
            assert_eq!(public["deviceId"], legacy.device_id.as_str()); assert_eq!(public["activated"], legacy.activated);
            assert_eq!(public["revoked"], legacy.revoked); assert_eq!(public["name"], legacy.name.as_str());
            assert_eq!(public["cacheDeviceId"], legacy.cache_device_id.clone().map_or(Value::Null, Value::from));
            let proof = run_action(&mock, &sandbox, "proof").unwrap();
            assert_eq!(proof["credential"], legacy.credential.as_str()); assert_eq!(proof["registered"], legacy.activated || legacy.revoked);
            let marker = sandbox.marker_text().unwrap();
            assert!(marker.contains(NATIVE_COLLECTION) && marker.contains(&legacy.device_id));
            assert!(!marker.contains(&legacy.credential) && !marker.contains(OTHER));
            assert!(!contains_bytes(&fs::read(sandbox.cipher()).unwrap(), &legacy.credential));
            let owner = format!("ac-device-{}", legacy.cache_device_id.as_ref().unwrap_or(&legacy.device_id));
            let service = Service { backend: &mock, files: &sandbox.files };
            assert_eq!(service.locked(|| service.authorized(&owner)).unwrap(), legacy.activated && !legacy.revoked);
            // From now on the legacy store may vanish or turn hostile without any effect.
            let calls = mock.calls(); mock.hostile();
            assert_eq!(run_action(&mock, &sandbox, "proof").unwrap()["credential"], legacy.credential.as_str());
            assert_eq!(mock.calls(), calls);
        }
    }
    #[test]
    fn after_migration_every_write_goes_to_the_vault_and_the_legacy_item_is_never_modified() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        mock.put(OTHER, &secret(&fixture())); let before = mock.snapshot();
        run_action(&mock, &sandbox, "load").unwrap();
        mock.with(|s| s.default = Some(LOGIN.into()));
        run_action(&mock, &sandbox, "activated").unwrap();
        run_action(&mock, &sandbox, "revoked").unwrap();
        let stored = sandbox.stored().unwrap();
        assert!(stored.revoked && !stored.activated && stored.credential == fixture().credential);
        run_action(&mock, &sandbox, "reset-binding").unwrap();
        assert_ne!(sandbox.stored().unwrap().device_id, fixture().device_id);
        assert_untouched(&mock, &before);
    }
    #[test]
    fn a_locked_legacy_store_blocks_the_first_migration_but_never_the_steady_state() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        mock.put(OTHER, &secret(&fixture())); let before = mock.snapshot();
        mock.with(|s| s.locked.push(OTHER.into()));
        for action in ["load", "activated", "reset-binding"] { assert_eq!(run_action(&mock, &sandbox, action).unwrap_err(), Kind::Locked, "{action}"); }
        assert_untouched(&mock, &before); assert!(sandbox.marker_text().is_none() && sandbox.no_vault_files());
        mock.with(|s| s.locked.clear());
        run_action(&mock, &sandbox, "load").unwrap();
        let calls = mock.calls(); mock.hostile();
        run_action(&mock, &sandbox, "activated").unwrap(); run_action(&mock, &sandbox, "reset-binding").unwrap();
        assert_eq!(mock.calls(), calls); assert_untouched(&mock, &before);
    }
    #[test]
    fn divergent_or_damaged_marker_fails_closed_without_overwriting() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        run_action(&mock, &sandbox, "load").unwrap();
        let identity = sandbox.stored().unwrap();
        let write = |marker: &Marker| sandbox.files.write(marker).unwrap();
        let mut native_other_id = Marker::of(&identity, NATIVE_COLLECTION); native_other_id.device_id = "d".repeat(32);
        let mut legacy_other_id = Marker::of(&identity, LOGIN); legacy_other_id.device_id = "d".repeat(32);
        for (label, marker) in [("native id", native_other_id), ("legacy id", legacy_other_id)] {
            write(&marker); let text = sandbox.marker_text();
            assert_eq!(run_action(&mock, &sandbox, "activated").unwrap_err(), Kind::Conflict, "{label}");
            assert_eq!(sandbox.marker_text(), text, "{label}"); assert_eq!(sandbox.stored().as_ref(), Some(&identity), "{label}");
        }
        let leaked_field = format!("{{\"version\":1,\"deviceId\":\"{}\",\"collection\":\"{LOGIN}\",\"credential\":\"x\"}}", identity.device_id);
        let native_with_legacy_origin = format!("{{\"version\":2,\"deviceId\":\"{}\",\"collection\":\"{LOGIN}\"}}", identity.device_id);
        let legacy_with_native_origin = format!("{{\"version\":1,\"deviceId\":\"{}\",\"collection\":\"{NATIVE_COLLECTION}\"}}", identity.device_id);
        for broken in ["", "{", "[]", "{\"version\":2,\"deviceId\":\"x\"}", "{\"version\":3}", leaked_field.as_str(), native_with_legacy_origin.as_str(), legacy_with_native_origin.as_str()] {
            fs::write(sandbox.files.marker(), broken).unwrap();
            assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Corrupt, "{broken}");
            assert_eq!(fs::read_to_string(sandbox.files.marker()).unwrap(), broken); assert_eq!(sandbox.stored().as_ref(), Some(&identity));
        }
        let same = Marker { pending: Some(Ids { device_id: identity.device_id.clone(), cache_device_id: None }), ..Marker::of(&identity, NATIVE_COLLECTION) };
        fs::write(sandbox.files.marker(), serde_json::to_string(&same).unwrap()).unwrap();
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Corrupt);
        fs::write(sandbox.files.marker(), "x".repeat(5000)).unwrap();
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Corrupt);
        fs::remove_file(sandbox.files.marker()).unwrap(); fs::create_dir(sandbox.files.marker()).unwrap();
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Storage);
        assert_eq!(sandbox.stored().as_ref(), Some(&identity)); assert!(mock.snapshot().is_empty());
    }
    #[test]
    fn an_interruption_after_the_vault_but_before_the_marker_recovers_the_same_identity() {
        let mut id = fixture(); id.activated = true; id.cache_device_id = Some("c".repeat(32));
        let mut previous = fixture(); previous.device_id = "7".repeat(32);
        let journal = Marker { pending: Some(identity_ids(&id)), ..Marker::of(&previous, LOGIN) };
        for (label, marker) in [("no marker", None), ("legacy marker", Some(Marker::of(&id, LOGIN))), ("legacy journal", Some(journal))] {
            let (mock, sandbox) = (Mock::new(), Sandbox::new());
            sandbox.vault().save(&id).unwrap(); // the crash: vault durable, marker never finalized
            if let Some(marker) = &marker { sandbox.files.write(marker).unwrap(); }
            mock.hostile(); // and the legacy store is unusable (locked, no tools, other default)
            let public = run_action(&mock, &sandbox, "load").unwrap();
            assert_eq!(public["deviceId"], id.device_id.as_str(), "{label}"); assert_eq!(public["activated"], true, "{label}");
            assert_eq!(mock.calls(), 0, "{label}: recovery must not touch the legacy store");
            assert_eq!(sandbox.stored(), Some(id.clone()), "{label}");
            let recorded = sandbox.files.read().unwrap().unwrap();
            assert!(recorded.native() && recorded.ids() == identity_ids(&id) && recorded.pending.is_none(), "{label}");
            assert_eq!(run_action(&mock, &sandbox, "proof").unwrap()["credential"], id.credential.as_str(), "{label}");
        }
    }
    #[test]
    fn a_legacy_marker_that_disagrees_with_the_vault_is_a_conflict() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        let mut other = fixture(); other.device_id = "7".repeat(32);
        sandbox.vault().save(&fixture()).unwrap();
        sandbox.files.write(&Marker::of(&other, LOGIN)).unwrap();
        let marker = sandbox.marker_text();
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Conflict);
        assert_eq!(sandbox.marker_text(), marker); assert_eq!(sandbox.stored(), Some(fixture())); assert_eq!(mock.calls(), 0);
    }
    #[test]
    fn marker_write_is_atomic_and_never_truncates_the_previous_one() {
        let sandbox = Sandbox::new();
        let first = Marker::of(&fixture(), LOGIN);
        sandbox.files.write(&first).unwrap();
        let before = sandbox.marker_text().unwrap();
        fs::create_dir(sandbox.files.dir.join("identity.json.tmp")).unwrap(); // makes the temp step fail
        let mut second = first.clone(); second.collection = OTHER.into();
        assert_eq!(sandbox.files.write(&second), Err(Kind::Storage));
        assert_eq!(sandbox.marker_text().unwrap(), before);
        fs::remove_dir(sandbox.files.dir.join("identity.json.tmp")).unwrap();
        sandbox.files.write(&second).unwrap();
        assert_eq!(sandbox.files.read().unwrap(), Some(second));
        assert!(!sandbox.files.dir.join("identity.json.tmp").exists());
    }
    #[test]
    fn vault_dirs_are_refused_inside_the_webview_asset_scope_or_inside_each_other() {
        let sandbox = Sandbox::new();
        let (dir, key, app) = (sandbox.files.dir.clone(), sandbox.files.key_dir.clone(), sandbox.files.appdata.clone());
        let with = |dir: PathBuf, key_dir: PathBuf| Files { dir, key_dir, appdata: app.clone() };
        // $APPDATA does not exist yet: preparing a private dir beneath it creates it, so it is still caught.
        assert!(!app.exists());
        assert_eq!(with(app.join("state"), key.clone()).vault().err(), Some(Kind::Storage));
        assert_eq!(with(dir.clone(), app.join("keys")).vault().err(), Some(Kind::Storage));
        assert_eq!(with(dir.clone(), app.clone()).vault().err(), Some(Kind::Storage));
        // `..` segments cannot hide the location.
        fs::create_dir_all(app.join("sub")).unwrap();
        assert_eq!(with(app.join("sub").join("..").join("state"), key.clone()).vault().err(), Some(Kind::Storage));
        assert_eq!(with(dir.clone(), app.join("..").join(APPLICATION).join("k")).vault().err(), Some(Kind::Storage));
        // The two vault dirs must be disjoint.
        assert_eq!(with(dir.clone(), dir.clone()).vault().err(), Some(Kind::Storage));
        assert_eq!(with(dir.clone(), dir.join("keys")).vault().err(), Some(Kind::Storage));
        assert_eq!(with(key.join("state"), key.clone()).vault().err(), Some(Kind::Storage));
        #[cfg(unix)]
        {
            let link = sandbox.root.join("link");
            std::os::unix::fs::symlink(&app, &link).unwrap();
            assert_eq!(with(link.join("state2"), key.clone()).vault().err(), Some(Kind::Storage));
            assert_eq!(with(dir.clone(), link.join("keys2")).vault().err(), Some(Kind::Storage));
            // A symlinked private dir itself is never followed.
            let alias = sandbox.root.join("alias");
            std::os::unix::fs::symlink(&dir, &alias).unwrap();
            assert_eq!(with(alias, key.clone()).vault().err(), Some(Kind::Storage));
        }
        // Nothing secret was written anywhere, and the real layout is accepted.
        for candidate in [&dir, &key, &app] { assert!(!candidate.join("vault-v1.enc").exists() && !candidate.join("vault-v1.key").exists()); }
        assert!(sandbox.files.vault().is_ok());
        // Through the service the same refusal happens before any identity is generated.
        let mock = Mock::new();
        let forbidden = with(app.join("state3"), key.clone());
        let service = Service { backend: &mock, files: &forbidden };
        assert_eq!(service.locked(|| service.execute("load")).unwrap_err(), Kind::Storage);
        assert!(!forbidden.marker().exists() && !forbidden.dir.join("vault-v1.enc").exists() && mock.calls() == 0);
    }

    // ---- reset-binding journal and crash recovery
    fn activated_install() -> (Mock, Sandbox, Identity) {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        run_action(&mock, &sandbox, "load").unwrap(); run_action(&mock, &sandbox, "activated").unwrap();
        let identity = sandbox.stored().unwrap();
        (mock, sandbox, identity)
    }
    #[test]
    fn reset_binding_commits_marker_only_after_the_new_secret_is_verified() {
        let (mock, sandbox, old) = activated_install();
        let public = run_action(&mock, &sandbox, "reset-binding").unwrap();
        let fresh = sandbox.stored().unwrap();
        assert_ne!(fresh.device_id, old.device_id); assert_ne!(fresh.credential, old.credential);
        assert_eq!(fresh.cache_device_id.as_deref(), Some(old.device_id.as_str()));
        assert!(!fresh.activated && !fresh.revoked); assert_eq!(public["cacheDeviceId"], old.device_id.as_str());
        let marker = sandbox.files.read().unwrap().unwrap();
        assert_eq!((marker.device_id.as_str(), marker.pending.is_none(), marker.native()), (fresh.device_id.as_str(), true, true));
        assert!(!sandbox.marker_text().unwrap().contains(&fresh.credential) && !sandbox.marker_text().unwrap().contains(&old.credential));
        assert!(mock.snapshot().is_empty());
    }
    #[test]
    fn failed_secret_write_leaves_a_journal_that_the_next_load_aborts_safely() {
        let (mock, sandbox, old) = activated_install();
        mock.with(|s| s.fail_vault_save = true);
        assert_eq!(run_action(&mock, &sandbox, "reset-binding").unwrap_err(), Kind::Unavailable);
        assert!(sandbox.files.read().unwrap().unwrap().pending.is_some());
        mock.with(|s| s.fail_vault_save = false);
        let public = run_action(&mock, &sandbox, "load").unwrap();
        assert_eq!(public["deviceId"], old.device_id.as_str());
        assert!(sandbox.files.read().unwrap().unwrap().pending.is_none());
        assert_eq!(sandbox.stored(), Some(old.clone()));
        run_action(&mock, &sandbox, "reset-binding").unwrap(); // idempotent retry
        assert_ne!(sandbox.stored().unwrap().device_id, old.device_id);
    }
    #[test]
    fn crash_after_secret_but_before_marker_is_finalized_automatically() {
        let (mock, sandbox, old) = activated_install();
        // Marker rename gets blocked right after the secret is stored, like a crash before the final write.
        mock.with(|s| s.sabotage_after_vault_save = Some(sandbox.files.dir.join("identity.json.tmp")));
        assert_eq!(run_action(&mock, &sandbox, "reset-binding").unwrap_err(), Kind::Storage);
        let stored = sandbox.stored().unwrap();
        assert_ne!(stored.device_id, old.device_id);
        assert_eq!(sandbox.files.read().unwrap().unwrap().device_id, old.device_id);
        fs::remove_dir(sandbox.files.dir.join("identity.json.tmp")).unwrap();
        mock.hostile();
        let public = run_action(&mock, &sandbox, "load").unwrap();
        assert_eq!(public["deviceId"], stored.device_id.as_str()); assert_eq!(public["cacheDeviceId"], old.device_id.as_str());
        let marker = sandbox.files.read().unwrap().unwrap();
        assert_eq!(marker.device_id, stored.device_id); assert!(marker.pending.is_none());
        assert_eq!(sandbox.stored(), Some(stored));
    }
    #[test]
    fn incoherent_journal_blocks_instead_of_guessing() {
        let (mock, sandbox, old) = activated_install();
        let mut journal = Marker::of(&old, NATIVE_COLLECTION);
        journal.pending = Some(Ids { device_id: "9".repeat(32), cache_device_id: Some(old.device_id.clone()) });
        sandbox.files.write(&journal).unwrap();
        let mut moved = old.clone(); moved.device_id = "8".repeat(32);
        sandbox.vault().save(&moved).unwrap();
        assert_eq!(run_action(&mock, &sandbox, "load").unwrap_err(), Kind::Conflict);
        assert_eq!(sandbox.files.read().unwrap(), Some(journal)); assert_eq!(sandbox.stored(), Some(moved));
    }
    #[test]
    fn cache_namespace_survives_repeated_rebinding_and_owner_checks_follow_it() {
        let (mock, sandbox, first) = activated_install();
        let owner = format!("ac-device-{}", first.device_id);
        let service = Service { backend: &mock, files: &sandbox.files };
        assert!(service.locked(|| service.authorized(&owner)).unwrap());
        mock.hostile(); // reset/revoke/authorize never depend on the legacy store
        run_action(&mock, &sandbox, "reset-binding").unwrap();
        assert!(!service.locked(|| service.authorized(&owner)).unwrap()); // not activated yet
        run_action(&mock, &sandbox, "activated").unwrap();
        assert!(service.locked(|| service.authorized(&owner)).unwrap());
        run_action(&mock, &sandbox, "reset-binding").unwrap();
        assert_eq!(sandbox.stored().unwrap().cache_device_id.as_deref(), Some(first.device_id.as_str()));
        run_action(&mock, &sandbox, "activated").unwrap(); run_action(&mock, &sandbox, "revoked").unwrap();
        assert!(!service.locked(|| service.authorized(&owner)).unwrap());
        // Revocation and the rotated ids persist in the native vault and marker.
        assert!(sandbox.stored().unwrap().revoked);
        let marker = sandbox.files.read().unwrap().unwrap();
        assert!(marker.native() && marker.ids() == identity_ids(&sandbox.stored().unwrap()));
    }
    #[test]
    fn concurrent_operations_are_serialized_and_create_a_single_identity() {
        let (mock, sandbox) = (Mock::new(), Sandbox::new());
        let (mock, sandbox) = (&mock, &sandbox);
        let ids: Vec<String> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..12).map(|n| { scope.spawn(move || {
                let public = run_action(mock, sandbox, if n % 3 == 0 { "load" } else if n % 3 == 1 { "proof" } else { "activated" }).unwrap();
                public["deviceId"].as_str().unwrap().to_owned()
            }) }).collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        assert!(ids.windows(2).all(|pair| pair[0] == pair[1]));
        assert!(mock.snapshot().is_empty());
        let stored = sandbox.stored().unwrap();
        assert_eq!(stored.device_id, ids[0]);
        assert!(stored.activated); assert_eq!(sandbox.files.read().unwrap().unwrap().device_id, stored.device_id);
        let before_rebind = stored.device_id.clone();
        std::thread::scope(|scope| { for _ in 0..4 { scope.spawn(|| { let _ = run_action(&mock, &sandbox, "reset-binding"); }); } });
        let after = sandbox.stored().unwrap();
        assert_ne!(after.device_id, before_rebind); assert_eq!(after.cache_device_id.as_deref(), Some(before_rebind.as_str()));
        assert_eq!(sandbox.files.read().unwrap().unwrap().ids(), identity_ids(&after));
    }

    // ---- real Linux Secret Service (CI only: isolated dbus-run-session + temporary XDG dirs)
    #[cfg(target_os = "linux")]
    mod linux {
        use super::secret;
        use crate::device_identity::*;
        pub(super) fn isolated() -> (Linux, Files) {
            assert_eq!(std::env::var("ACTIVE_CLASSROOM_TEST_KEYRING").as_deref(), Ok("1"));
            let temp = std::env::temp_dir();
            for variable in ["XDG_DATA_HOME", "XDG_STATE_HOME"] {
                let value = PathBuf::from(std::env::var_os(variable).unwrap_or_else(|| panic!("{variable} must point to a temporary directory")));
                assert!(value.is_absolute() && (value.starts_with(&temp) || value.starts_with("/tmp")), "{variable} is not temporary: refusing to touch real data");
            }
            let files = Files::from_env().unwrap();
            // The vault key lives under XDG_CONFIG_HOME; it must be temporary too (set it in the CI step).
            assert!(files.key_dir.starts_with(&temp) || files.key_dir.starts_with("/tmp"), "XDG_CONFIG_HOME is not temporary: refusing to touch real data");
            (Linux, files)
        }
        fn clear_fixture_items() {
            // Only ever reached after `isolated()` and after this test created its own items.
            let cleared = run(SECRET_TOOL, &["clear", "application", APPLICATION, "credential", CREDENTIAL], None, SECRET_TIMEOUT).unwrap();
            assert!(cleared.success);
        }
        fn set_default(path: &str) {
            let collection = format!("objectpath '{path}'");
            Linux.gdbus(SECRETS_PATH, "org.freedesktop.Secret.Service.SetAlias", &["default", collection.as_str()]).unwrap();
        }
        #[test]
        #[ignore = "requires an isolated unlocked Secret Service that already holds the invalid CI fixture"]
        fn linux_invalid_legacy_credential_is_preserved() {
            let (backend, files) = isolated();
            let before = backend.search().unwrap();
            assert_eq!(before.unlocked.len(), 1, "expected the invalid CI fixture and nothing else");
            let service = Service { backend: &backend, files: &files };
            for action in ["load", "activated", "reset-binding"] { assert_eq!(service.locked(|| service.execute(action)).unwrap_err(), Kind::Corrupt); }
            assert_eq!(backend.search().unwrap(), before);
            assert!(files.read().unwrap().is_none(), "no marker may be recorded for an unreadable identity");
            assert!(!files.dir.join("vault-v1.enc").exists() && !files.key_dir.join("vault-v1.key").exists(), "no vault may be created over an unreadable identity");
        }
        #[test]
        #[ignore = "requires an isolated unlocked Secret Service with no matching item"]
        fn linux_legacy_migration_round_trip() {
            let (backend, files) = isolated();
            assert_eq!(backend.search().unwrap(), Search::default(), "refusing to run over existing matching items");
            assert!(files.read().unwrap().is_none());
            let act = |action: &str| { let service = Service { backend: &Linux, files: &files }; service.locked(|| service.execute(action)) };
            let login = backend.default_collection().unwrap();
            assert!(valid_collection(&login) && !backend.collection_locked(&login).unwrap());
            // 1. a real legacy identity is wrapped into the vault; the keyring item is left exactly as it was
            let mut legacy = super::fixture(); legacy.activated = true; legacy.cache_device_id = Some("c".repeat(32));
            backend.store(&login, &secret(&legacy)).unwrap();
            let before = backend.search().unwrap();
            assert_eq!(before.unlocked.len(), 1);
            assert_eq!(act("load").unwrap()["deviceId"], legacy.device_id.as_str());
            assert_eq!(backend.search().unwrap(), before);
            assert_eq!(decode(&backend.read(&before.unlocked[0]).unwrap()).unwrap(), legacy);
            let vault = files.vault().unwrap();
            assert_eq!(vault.load().unwrap(), Some(legacy.clone()));
            assert!(files.read().unwrap().unwrap().native());
            // 2. later writes only touch the vault
            act("revoked").unwrap();
            assert!(decode(&backend.read(&before.unlocked[0]).unwrap()).unwrap().activated);
            assert!(vault.load().unwrap().unwrap().revoked);
            // 3. the keyring item may disappear without any effect
            clear_fixture_items();
            assert_eq!(backend.search().unwrap(), Search::default());
            assert_eq!(act("proof").unwrap()["credential"], legacy.credential.as_str());
            // 4. neither does a locked keyring (last: it stays locked)
            let targets = format!("[objectpath '{login}']");
            Linux.gdbus(SECRETS_PATH, "org.freedesktop.Secret.Service.Lock", &[targets.as_str()]).unwrap();
            assert_eq!(act("load").unwrap()["deviceId"], legacy.device_id.as_str());
        }
    }

    // ---- native vault across two PROCESSES (not an OS reboot): run 1 inside an isolated
    // dbus-run-session without any keyring daemon, run 2 with no session bus at all.
    #[cfg(target_os = "linux")]
    mod linux2 {
        use super::linux::isolated;
        use crate::device_identity::*;
        use sha2::{Digest, Sha256};
        const ACCEPTANCE: &str = "native-acceptance.json";
        fn sha(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
        /// Public digests only (credential, ciphertext, key file): no secret is stored or printed.
        fn digests(files: &Files, credential: &str) -> (String, String, String) {
            let read = |path: PathBuf| fs::read(&path).unwrap_or_else(|_| panic!("cannot read {}", path.display()));
            (sha(credential.as_bytes()), sha(&read(files.dir.join("vault-v1.enc"))), sha(&read(files.key_dir.join("vault-v1.key"))))
        }
        #[test]
        #[ignore = "process 1 of 2: isolated session bus WITHOUT a keyring daemon, empty temporary XDG dirs"]
        fn linux_fresh_without_keyring() {
            let (backend, files) = isolated();
            assert!(backend.keyring_files().unwrap().is_empty(), "no keyring file may exist");
            assert!(files.read().unwrap().is_none());
            assert!(!files.dir.join("vault-v1.enc").exists() && !files.key_dir.join("vault-v1.key").exists());
            assert!(!files.dir.join(ACCEPTANCE).exists(), "refusing to overwrite an existing acceptance fixture");
            let loaded = with_service(|service| service.execute("load")).unwrap();
            let activated = with_service(|service| service.execute("activated")).unwrap();
            assert_eq!(activated["deviceId"], loaded["deviceId"]);
            assert_eq!(activated["activated"], true);
            let proof = with_service(|service| service.execute("proof")).unwrap();
            let credential = proof["credential"].as_str().unwrap();
            let device_id = proof["deviceId"].as_str().unwrap();
            assert_eq!(device_id, loaded["deviceId"].as_str().unwrap());
            // Native vault + marker are valid; the app never created a persistent keyring.
            let marker = files.read().unwrap().unwrap();
            assert!(marker.native() && marker.device_id == device_id);
            let stored = files.vault().unwrap().load().unwrap().unwrap();
            assert!(stored.device_id == device_id && stored.activated && stored.credential == credential);
            assert!(backend.keyring_files().unwrap().is_empty(), "the app must not create a persistent keyring");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                for path in [files.dir.join("vault-v1.enc"), files.key_dir.join("vault-v1.key")] {
                    assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
                }
            }
            let (credential_sha, cipher_sha, key_sha) = digests(&files, credential);
            let fixture = json!({ "deviceId": device_id, "cacheDeviceId": stored.cache_device_id, "credentialSha256": credential_sha, "cipherSha256": cipher_sha, "keySha256": key_sha });
            let mut file = files.open_private(&files.dir.join(ACCEPTANCE), true).unwrap();
            file.write_all(&serde_json::to_vec(&fixture).unwrap()).unwrap();
            file.sync_all().unwrap();
        }
        #[test]
        #[ignore = "process 2 of 2: same XDG dirs as linux_fresh_without_keyring, without session bus or display"]
        fn linux_native_vault_reopens_without_service() {
            assert!(std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none(), "this process must have no session bus");
            let (backend, files) = isolated();
            let raw = fs::read(files.dir.join(ACCEPTANCE)).expect("run linux_fresh_without_keyring first");
            let fixture: Value = serde_json::from_slice(&raw).unwrap();
            assert!(backend.keyring_files().unwrap().is_empty());
            assert!(files.read().unwrap().unwrap().native());
            let loaded = with_service(|service| service.execute("load")).unwrap();
            assert_eq!(loaded["deviceId"], fixture["deviceId"], "a new process must not create another identity");
            assert_eq!(loaded["cacheDeviceId"], fixture["cacheDeviceId"]);
            assert_eq!(loaded["activated"], true);
            assert_eq!(loaded["revoked"], false);
            let proof = with_service(|service| service.execute("proof")).unwrap();
            assert_eq!(proof["deviceId"], fixture["deviceId"]);
            let (credential_sha, cipher_sha, key_sha) = digests(&files, proof["credential"].as_str().unwrap());
            assert_eq!(credential_sha, fixture["credentialSha256"].as_str().unwrap(), "credential changed");
            assert_eq!(cipher_sha, fixture["cipherSha256"].as_str().unwrap(), "vault ciphertext was rewritten");
            assert_eq!(key_sha, fixture["keySha256"].as_str().unwrap(), "vault key changed");
            let namespace = fixture["cacheDeviceId"].as_str().unwrap_or_else(|| fixture["deviceId"].as_str().unwrap());
            assert!(authorized_owner(&format!("ac-device-{namespace}")).unwrap());
            assert!(backend.keyring_files().unwrap().is_empty(), "no keyring may be created");
            assert_eq!(fs::read(files.dir.join(ACCEPTANCE)).unwrap(), raw, "the expected fixture is never rewritten");
        }
    }
}
