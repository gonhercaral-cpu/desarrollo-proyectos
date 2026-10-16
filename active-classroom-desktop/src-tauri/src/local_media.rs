//! Loopback HTTP for immutable, verified cache objects. Never accepts filesystem paths.
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs::{self, File, Metadata}, io::{Read, Seek, SeekFrom, Write}, net::{TcpListener, TcpStream}, path::{Path, PathBuf}, sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}}, time::{Duration, SystemTime}};
use tauri::Manager;

const BLOCK_BYTES: usize = 65536;
const MAX_HEADERS: usize = 16384;
const MAX_CONNECTIONS: usize = 8;
#[derive(Clone)]
pub(crate) struct MediaServer { pub port: u16, grants: Arc<Mutex<HashMap<String, Grant>>> }
#[derive(Clone)]
struct Grant { path: PathBuf, mime: String, size: u64, signature: Signature }
#[derive(Clone, PartialEq, Eq)]
struct Signature { size: u64, modified: Option<SystemTime>, #[cfg(unix)] inode: (u64, u64) }
impl Signature {
    fn new(metadata: &Metadata) -> Self {
        Self { size: metadata.len(), modified: metadata.modified().ok(), #[cfg(unix)] inode: { use std::os::unix::fs::MetadataExt; (metadata.dev(), metadata.ino()) } }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Inspection {
    pub url: Option<String>, pub local_path: String, pub exists: bool,
    pub expected_size: u64, pub actual_size: Option<u64>, pub sha256_valid: Option<bool>,
    pub mime: String, pub codec_mime: Option<String>, pub error_code: Option<String>, pub error: Option<String>,
}
impl Inspection {
    fn fail(mut self, code: &str, message: &str) -> Self { self.error_code = Some(code.into()); self.error = Some(message.into()); self }
}
fn safe_hash(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
fn supported_mime(mime: &str) -> bool {
    matches!(mime, "video/mp4" | "video/webm" | "audio/mp4" | "audio/m4a" | "audio/x-m4a" | "audio/mpeg" | "audio/mp3" | "audio/aac" | "audio/wav" | "audio/wave" | "audio/x-wav" | "audio/ogg" | "audio/webm" | "audio/flac")
}
fn signature_matches(mime: &str, head: &[u8]) -> bool {
    match mime {
        "video/mp4" | "audio/mp4" | "audio/m4a" | "audio/x-m4a" => {
            let mut offset = 0;
            while offset + 12 <= head.len() {
                if &head[offset + 4..offset + 8] == b"ftyp" { return true; }
                let size = u32::from_be_bytes(head[offset..offset + 4].try_into().unwrap()) as usize;
                if size < 8 { break; } offset = match offset.checked_add(size) { Some(value) => value, None => break };
            }
            false
        }
        "video/webm" | "audio/webm" => head.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]),
        "audio/wav" | "audio/wave" | "audio/x-wav" => head.starts_with(b"RIFF") && head.get(8..12) == Some(b"WAVE"),
        "audio/ogg" => head.starts_with(b"OggS"),
        "audio/flac" => head.starts_with(b"fLaC"),
        "audio/mpeg" | "audio/mp3" | "audio/aac" => head.starts_with(b"ID3") || head.windows(2).any(|b| b[0] == 0xff && b[1] & 0xe0 == 0xe0),
        _ => false,
    }
}
impl MediaServer {
    pub fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let server = Self { port: listener.local_addr()?.port(), grants: Arc::default() };
        let state = server.clone(); let active = Arc::new(AtomicUsize::new(0));
        std::thread::spawn(move || {
            for connection in listener.incoming() {
                let Ok(mut socket) = connection else { continue; };
                if active.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
                    active.fetch_sub(1, Ordering::SeqCst); let _ = reply(&mut socket, 503, "", 0, None, "busy"); continue;
                }
                let state = state.clone(); let active = active.clone();
                std::thread::spawn(move || { let _ = state.serve(&mut socket); active.fetch_sub(1, Ordering::SeqCst); });
            }
        });
        Ok(server)
    }
    pub(crate) fn allows_url(&self, url: &str) -> bool {
        let prefix = format!("http://127.0.0.1:{}/media/", self.port);
        url.strip_prefix(&prefix).filter(|id| safe_hash(id)).map(|id| self.grants.lock().map(|map| map.contains_key(id)).unwrap_or(false)).unwrap_or(false)
    }
    fn register(&self, path: PathBuf, mime: String, size: u64, signature: Signature) -> Result<String, String> {
        let mut random = [0u8; 32]; getrandom::fill(&mut random).map_err(|_| "read")?;
        let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let mut grants = self.grants.lock().map_err(|_| "read")?;
        // Reuse a verified object; bound the capability registry to the manifest limit.
        if let Some((id, _)) = grants.iter().find(|(_, grant)| grant.path == path && grant.signature == signature && grant.mime == mime) { return Ok(format!("http://127.0.0.1:{}/media/{id}", self.port)); }
        if grants.len() >= 200 { grants.clear(); }
        grants.insert(token.clone(), Grant { path, mime, size, signature });
        Ok(format!("http://127.0.0.1:{}/media/{token}", self.port))
    }
    pub(crate) fn inspect(&self, root: &Path, unit: &str, version: u64, resource_id: &str) -> Result<Inspection, String> {
        let directory = crate::offline_cache::version_dir(root, unit, version)?;
        let manifest = crate::offline_cache::load(&directory.join("manifest.json"))?;
        let resource = manifest["resources"].as_array().and_then(|resources| resources.iter().find(|r| r["resourceId"] == resource_id)).ok_or("media: Recurso ausente del manifest local")?;
        let hash = resource["download"]["checksums"]["sha256"].as_str().filter(|hash| safe_hash(hash)).ok_or("media: SHA-256 inválido")?;
        let mime = resource["download"]["mimeType"].as_str().unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        let size = resource["download"]["sizeBytes"].as_u64().ok_or("media: Tamaño inválido")?;
        let diagnostic = Inspection { url: None, local_path: format!("$APPDATA/offline-v1/users/[local-owner]/objects/{hash}"), exists: false, expected_size: size, actual_size: None, sha256_valid: None, mime: mime.clone(), codec_mime: None, error_code: None, error: None };
        Ok(self.inspect_object(root, hash, size, mime, diagnostic))
    }
    fn inspect_object(&self, root: &Path, hash: &str, size: u64, mime: String, mut diagnostic: Inspection) -> Inspection {
        let path = root.join("objects").join(hash);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => return diagnostic.fail(if error.kind() == std::io::ErrorKind::NotFound { "missing" } else { "read" }, if error.kind() == std::io::ErrorKind::NotFound { "El archivo no está disponible localmente" } else { "No se pudo leer el video local" }),
        };
        diagnostic.exists = true; diagnostic.actual_size = Some(metadata.len());
        let canonical_root = match root.canonicalize() { Ok(path) => path, Err(_) => return diagnostic.fail("read", "No se pudo leer el video local") };
        let canonical = path.canonicalize().ok();
        if !metadata.is_file() || canonical.as_ref().and_then(|p| p.parent()) != Some(canonical_root.join("objects").as_path()) { return diagnostic.fail("path", "No se pudo leer el video local"); }
        if size != metadata.len() { diagnostic.sha256_valid = Some(false); return diagnostic.fail("damaged", "El archivo descargado está dañado"); }
        let mut file = match File::open(&path) { Ok(file) => file, Err(_) => return diagnostic.fail("read", "No se pudo leer el video local") };
        let before = Signature::new(&metadata); let mut digest = Sha256::new(); let mut block = [0u8; BLOCK_BYTES]; let mut head = Vec::new();
        loop {
            let count = match file.read(&mut block) { Ok(count) => count, Err(_) => return diagnostic.fail("read", "No se pudo leer el video local") };
            if count == 0 { break; }
            if head.is_empty() { head.extend_from_slice(&block[..count]); }
            digest.update(&block[..count]);
        }
        let valid = format!("{:x}", digest.finalize()) == hash && file.metadata().map(|metadata| before == Signature::new(&metadata)).unwrap_or(false);
        diagnostic.sha256_valid = Some(valid);
        if !valid { return diagnostic.fail("damaged", "El archivo descargado está dañado"); }
        if !supported_mime(&mime) || !signature_matches(&mime, &head) { return diagnostic.fail("format", "El formato de video no es compatible"); }
        if mime == "video/mp4" || matches!(mime.as_str(), "audio/mp4" | "audio/m4a" | "audio/x-m4a") { diagnostic.codec_mime = mp4_codec_mime(&mut file, size, &mime); }
        match self.register(path, mime, size, before) {
            Ok(url) => { diagnostic.url = Some(url); diagnostic },
            Err(_) => diagnostic.fail("read", "No se pudo leer el video local"),
        }
    }
    fn serve(&self, socket: &mut TcpStream) -> std::io::Result<()> {
        socket.set_read_timeout(Some(Duration::from_secs(10)))?; socket.set_write_timeout(Some(Duration::from_secs(30)))?;
        let mut header = Vec::new(); let mut byte = [0u8; 1];
        while header.len() < MAX_HEADERS && !header.ends_with(b"\r\n\r\n") { if socket.read(&mut byte)? == 0 { return Ok(()); } header.push(byte[0]); }
        if !header.ends_with(b"\r\n\r\n") { return reply(socket, 431, "", 0, None, "headers"); }
        let Ok(header) = std::str::from_utf8(&header) else { return reply(socket, 400, "", 0, None, "request"); };
        let mut lines = header.split("\r\n"); let parts: Vec<_> = lines.next().unwrap_or("").split_whitespace().collect();
        if parts.len() != 3 || !["GET", "HEAD", "OPTIONS"].contains(&parts[0]) { return reply(socket, 405, "", 0, None, "method"); }
        let token = parts[1].strip_prefix("/media/").unwrap_or("");
        if !safe_hash(token) { return reply(socket, 404, "", 0, None, "path"); }
        let grant = self.grants.lock().ok().and_then(|map| map.get(token).cloned());
        let Some(grant) = grant else { return reply(socket, 404, "", 0, None, "missing"); };
        let headers: Vec<_> = lines.filter_map(|line| line.split_once(':')).collect();
        let expected_host = format!("127.0.0.1:{}", self.port);
        if headers.iter().filter(|(key, _)| key.eq_ignore_ascii_case("host")).count() != 1 || !headers.iter().any(|(key, value)| key.eq_ignore_ascii_case("host") && value.trim() == expected_host) { return reply(socket, 403, "", 0, None, "host"); }
        // Older WebKit releases preflight Range even for a single byte range.
        if parts[0] == "OPTIONS" { return reply(socket, 204, "", 0, None, ""); }
        let mut file = match File::open(&grant.path) { Ok(file) => file, Err(_) => return reply(socket, 404, "", 0, None, "missing") };
        if fs::symlink_metadata(&grant.path).map(|metadata| !metadata.is_file()).unwrap_or(true) || file.metadata().map(|metadata| grant.signature != Signature::new(&metadata)).unwrap_or(true) { return reply(socket, 409, "", 0, None, "damaged"); }
        let ranges: Vec<_> = headers.iter().filter(|(key, _)| key.eq_ignore_ascii_case("range")).collect();
        if ranges.len() > 1 { return reply(socket, 416, &grant.mime, 0, Some(format!("bytes */{}", grant.size)), "range"); }
        let range = ranges.first().map(|(_, value)| value.trim());
        let (status, start, count, content_range) = match byte_range(range, grant.size) {
            Ok((start, count)) => (if range.is_some() { 206 } else { 200 }, start, count, range.map(|_| format!("bytes {start}-{}/{}", start + count - 1, grant.size))),
            Err(_) => return reply(socket, 416, &grant.mime, 0, Some(format!("bytes */{}", grant.size)), "range"),
        };
        eprintln!("[Active Classroom Media] range={} status={status} start={start} bytes={count} mime={}", range.unwrap_or("none"), grant.mime);
        reply(socket, status, &grant.mime, count, content_range, "")?;
        if parts[0] == "HEAD" { return Ok(()); }
        file.seek(SeekFrom::Start(start))?;
        let mut remaining = count; let mut block = [0u8; BLOCK_BYTES];
        while remaining > 0 {
            let limit = remaining.min(BLOCK_BYTES as u64) as usize;
            let read = file.read(&mut block[..limit])?;
            if read == 0 { return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "cache object changed")); }
            socket.write_all(&block[..read])?; remaining -= read as u64;
        }
        Ok(())
    }
}
// Read only MP4 box headers and small codec descriptors; skip mdat with seek.
fn mp4_codec_mime(file: &mut File, size: u64, mime: &str) -> Option<String> {
    let mut codecs = Vec::new(); let mut budget = 16384;
    scan_mp4(file, 0, size, 0, &mut budget, &mut codecs).ok()?;
    codecs.sort(); codecs.dedup();
    if codecs.is_empty() { None } else { Some(format!("{}; codecs=\"{}\"", if mime.starts_with("audio/") { "audio/mp4" } else { mime }, codecs.join(", "))) }
}
fn scan_mp4(file: &mut File, mut offset: u64, end: u64, depth: u8, budget: &mut usize, codecs: &mut Vec<String>) -> std::io::Result<()> {
    if depth > 12 { return Ok(()); }
    while offset.saturating_add(8) <= end && *budget > 0 {
        *budget -= 1; file.seek(SeekFrom::Start(offset))?;
        let mut header = [0u8; 16]; file.read_exact(&mut header[..8])?;
        let mut length = u32::from_be_bytes(header[..4].try_into().unwrap()) as u64; let mut header_size = 8;
        if length == 1 { file.read_exact(&mut header[8..])?; length = u64::from_be_bytes(header[8..].try_into().unwrap()); header_size = 16; }
        if length == 0 { length = end - offset; }
        let Some(box_end) = offset.checked_add(length).filter(|box_end| *box_end <= end && length >= header_size) else { break; };
        let payload = offset + header_size;
        match &header[4..8] {
            b"moov" | b"trak" | b"mdia" | b"minf" | b"stbl" | b"wave" => scan_mp4(file, payload, box_end, depth + 1, budget, codecs)?,
            b"stsd" => scan_mp4(file, payload.saturating_add(8), box_end, depth + 1, budget, codecs)?,
            b"avc1" | b"avc3" => scan_mp4(file, payload.saturating_add(78), box_end, depth + 1, budget, codecs)?,
            b"mp4a" => {
                if payload + 10 <= box_end {
                    file.seek(SeekFrom::Start(payload + 8))?; let mut version = [0u8; 2]; file.read_exact(&mut version)?;
                    let extra = match u16::from_be_bytes(version) { 1 => 16, 2 => 36, _ => 0 };
                    scan_mp4(file, payload.saturating_add(28 + extra), box_end, depth + 1, budget, codecs)?;
                }
            }
            b"avcC" if payload + 4 <= box_end => {
                file.seek(SeekFrom::Start(payload))?; let mut avc = [0u8; 4]; file.read_exact(&mut avc)?;
                if avc[0] == 1 { codecs.push(format!("avc1.{:02X}{:02X}{:02X}", avc[1], avc[2], avc[3])); }
            }
            b"esds" if box_end - payload <= 4096 => {
                file.seek(SeekFrom::Start(payload))?; let mut descriptor = vec![0u8; (box_end - payload) as usize]; file.read_exact(&mut descriptor)?;
                if let Some(profile) = aac_profile(&descriptor) { codecs.push(format!("mp4a.40.{profile}")); }
            }
            _ => {}
        }
        offset = box_end;
    }
    Ok(())
}
fn descriptor(data: &[u8]) -> Option<(u8, &[u8])> {
    let tag = *data.first()?; let mut length = 0usize;
    for index in 1..=4 {
        let byte = *data.get(index)?; length = length.checked_mul(128)?.checked_add((byte & 127) as usize)?;
        if byte & 128 == 0 { return Some((tag, data.get(index + 1..index + 1 + length)?)); }
    }
    None
}
fn aac_profile(esds: &[u8]) -> Option<u8> {
    let (tag, es) = descriptor(esds.get(4..)?)?; if tag != 3 { return None; }
    let flags = *es.get(2)?; let mut position = 3;
    if flags & 0x80 != 0 { position += 2; }
    if flags & 0x40 != 0 { position += 1 + *es.get(position)? as usize; }
    if flags & 0x20 != 0 { position += 2; }
    let (tag, config) = descriptor(es.get(position..)?)?; if tag != 4 || *config.first()? != 0x40 { return None; }
    let (tag, specific) = descriptor(config.get(13..)?)?; if tag != 5 { return None; }
    let profile = specific.first()? >> 3;
    if profile == 31 { Some(32 + ((specific.first()? & 7) << 3) + (specific.get(1)? >> 5)) } else if profile > 0 { Some(profile) } else { None }
}
fn byte_range(range: Option<&str>, size: u64) -> Result<(u64, u64), ()> {
    let Some(range) = range else { return Ok((0, size)); };
    let (first, last) = range.strip_prefix("bytes=").ok_or(())?.split_once('-').ok_or(())?;
    if size == 0 || range.contains(',') { return Err(()); }
    let number = |value: &str| if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) { value.parse::<u64>().map_err(|_| ()) } else { Err(()) };
    if first.is_empty() { let suffix = number(last)?; if suffix == 0 { return Err(()); } let count = suffix.min(size); return Ok((size - count, count)); }
    let start = number(first)?; if start >= size { return Err(()); }
    let end = if last.is_empty() { size - 1 } else { number(last)?.min(size - 1) };
    if end < start { return Err(()); } Ok((start, end - start + 1))
}
fn reply(socket: &mut TcpStream, status: u16, mime: &str, length: u64, range: Option<String>, error: &str) -> std::io::Result<()> {
    let reason = match status { 200 => "OK", 204 => "No Content", 206 => "Partial Content", 416 => "Range Not Satisfiable", 404 => "Not Found", 403 => "Forbidden", 409 => "Conflict", 405 => "Method Not Allowed", 431 => "Request Header Fields Too Large", 503 => "Service Unavailable", _ => "Bad Request" };
    write!(socket, "HTTP/1.1 {status} {reason}\r\nContent-Type: {}\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nAccess-Control-Expose-Headers: Accept-Ranges, Content-Range, Content-Length, X-Active-Media-Error\r\nCache-Control: private, no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n", if mime.is_empty() { "text/plain" } else { mime })?;
    if let Some(range) = range { write!(socket, "Content-Range: {range}\r\n")?; }
    if !error.is_empty() { write!(socket, "X-Active-Media-Error: {error}\r\n")?; }
    socket.write_all(b"\r\n")
}
#[tauri::command]
pub(crate) async fn classroom_media(app: tauri::AppHandle, window: tauri::WebviewWindow, server: tauri::State<'_, MediaServer>, owner: String, unit_id: String, version: u64, resource_id: String) -> Result<Inspection, String> {
    if window.label() != "teacher" || owner.is_empty() || owner.len() > 200 { return Err("media: Sesión local inválida".into()); }
    let root = app.path().app_data_dir().map_err(|_| "media: Caché no disponible")?.join("offline-v1").join("users").join(format!("{:x}", Sha256::digest(owner.as_bytes())));
    let server = server.inner().clone();
    tauri::async_runtime::spawn_blocking(move || server.inspect(&root, &unit_id, version, &resource_id)).await.map_err(|_| "media: No se pudo leer el video local")?
}
#[tauri::command]
pub(crate) fn classroom_media_diagnostic(window: tauri::WebviewWindow, data: Value) -> Result<(), String> {
    if !["teacher", "audience"].contains(&window.label()) { return Err("media: Ventana inválida".into()); }
    // Client sends only this whitelist, with capability URLs and browser messages redacted.
    let keys = ["event", "kind", "mime", "codecMime", "localPath", "exists", "expectedSize", "actualSize", "sha256Valid", "url", "mediaErrorCode", "mediaErrorMessage", "networkState", "readyState", "canPlayMime", "canPlayCodec", "canPlayH264Aac", "httpStatus", "contentType", "acceptRanges", "contentRange", "contentLength"];
    let mut safe = serde_json::Map::new();
    for key in keys {
        if let Some(value) = data.get(key).filter(|value| value.to_string().len() <= 512) {
            let value = if key == "url" || key == "mediaErrorMessage" {
                let text = value.as_str().unwrap_or("");
                let text = regex::Regex::new(r"/media/[a-f0-9]{64}").unwrap().replace_all(text, "/media/[local-grant]").to_string();
                Value::String(if key == "mediaErrorMessage" { regex::Regex::new(r"(?i)(?:https?|asset)://\S+").unwrap().replace_all(&text, "[local URL]").to_string() } else { text })
            } else { value.clone() };
            safe.insert(key.into(), value);
        }
    }
    eprintln!("[Active Classroom Media] {}", Value::Object(safe)); Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(bytes: &[u8], mime: &str) -> (PathBuf, MediaServer, String, Inspection) {
        let root = std::env::temp_dir().join(format!("ac-media-{}-{}", std::process::id(), SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(root.join("objects")).unwrap();
        let hash = format!("{:x}", Sha256::digest(bytes)); fs::write(root.join("objects").join(&hash), bytes).unwrap();
        let diagnostic = Inspection { url: None, local_path: "[cache]".into(), exists: false, expected_size: bytes.len() as u64, actual_size: None, sha256_valid: None, mime: mime.into(), codec_mime: None, error_code: None, error: None };
        (root, MediaServer::start().unwrap(), hash, diagnostic)
    }
    fn request(server: &MediaServer, target: &str, range: Option<&str>, method: &str) -> Vec<u8> {
        let mut socket = TcpStream::connect(("127.0.0.1", server.port)).unwrap();
        write!(socket, "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n{}\r\n", server.port, range.map(|range| format!("Range: {range}\r\n")).unwrap_or_default()).unwrap();
        let mut response = Vec::new(); socket.read_to_end(&mut response).unwrap(); response
    }
    #[test]
    fn valid_and_invalid_ranges() {
        for (value, expected) in [(None, Ok((0, 10))), (Some("bytes=0-3"), Ok((0, 4))), (Some("bytes=7-"), Ok((7, 3))), (Some("bytes=-4"), Ok((6, 4))), (Some("bytes=8-99"), Ok((8, 2)))] { assert_eq!(byte_range(value, 10), expected); }
        for value in ["bytes=10-", "bytes=4-2", "bytes=-0", "bytes=+1-2", "bytes=0-2,4-6", "items=0-1", "bytes=18446744073709551616-"] { assert!(byte_range(Some(value), 10).is_err()); }
    }
    #[test]
    fn actual_h264_aac_codec_descriptors_are_read_without_media_body() {
        fn atom(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> { let mut bytes = ((payload.len() + 8) as u32).to_be_bytes().to_vec(); bytes.extend_from_slice(kind); bytes.extend_from_slice(payload); bytes }
        let mut video = vec![0; 78]; video.extend(atom(b"avcC", &[1, 66, 224, 30]));
        let mut audio = vec![0; 28]; audio.extend(atom(b"esds", &[0,0,0,0, 3,22,0,1,0, 4,17,0x40,0x15,0,0,0,0,0,0,0,0,0,0,0, 5,2,0x12,0x10]));
        let mut entries = vec![0; 8]; entries.extend(atom(b"avc1", &video)); entries.extend(atom(b"mp4a", &audio));
        let mut boxes = atom(b"stsd", &entries); for kind in [b"stbl", b"minf", b"mdia", b"trak", b"moov"] { boxes = atom(kind, &boxes); }
        let mut bytes = atom(b"ftyp", b"isom0000"); bytes.extend(boxes);
        let (root, server, hash, diagnostic) = fixture(&bytes, "video/mp4");
        let checked = server.inspect_object(&root, &hash, bytes.len() as u64, "video/mp4".into(), diagnostic);
        assert_eq!(checked.codec_mime.as_deref(), Some("video/mp4; codecs=\"avc1.42E01E, mp4a.40.2\"")); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn missing_hash_and_mime_fail_before_grant() {
        let bytes = b"\0\0\0\x18ftypisom0123456789ABCDEF";
        let (root, server, hash, diagnostic) = fixture(bytes, "video/mp4");
        let good = server.inspect_object(&root, &hash, bytes.len() as u64, "video/mp4".into(), diagnostic);
        assert_eq!(good.sha256_valid, Some(true)); assert!(good.url.is_some());
        let diagnostic = || Inspection { url: None, local_path: "[cache]".into(), exists: false, expected_size: bytes.len() as u64, actual_size: None, sha256_valid: None, mime: "video/mp4".into(), codec_mime: None, error_code: None, error: None };
        assert_eq!(server.inspect_object(&root, &hash, bytes.len() as u64, "video/webm".into(), diagnostic()).error_code.as_deref(), Some("format"));
        fs::write(root.join("objects").join(&hash), vec![1; bytes.len()]).unwrap();
        assert_eq!(server.inspect_object(&root, &hash, bytes.len() as u64, "video/mp4".into(), diagnostic()).error_code.as_deref(), Some("damaged"));
        fs::remove_file(root.join("objects").join(&hash)).unwrap();
        assert_eq!(server.inspect_object(&root, &hash, bytes.len() as u64, "video/mp4".into(), diagnostic()).error_code.as_deref(), Some("missing")); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn http_partial_seek_head_and_416() {
        let bytes = b"\0\0\0\x18ftypisom0123456789ABCDEF";
        let (root, server, hash, diagnostic) = fixture(bytes, "video/mp4");
        let result = server.inspect_object(&root, &hash, bytes.len() as u64, "video/mp4".into(), diagnostic);
        let url = result.url.unwrap(); let target = url.strip_prefix(&format!("http://127.0.0.1:{}", server.port)).unwrap();
        for range in ["bytes=0-3", "bytes=18-22", "bytes=4-7"] {
            let response = request(&server, target, Some(range), "GET"); let header_end = response.windows(4).position(|part| part == b"\r\n\r\n").unwrap() + 4;
            let header = std::str::from_utf8(&response[..header_end]).unwrap(); assert!(header.starts_with("HTTP/1.1 206")); assert!(header.contains("Content-Type: video/mp4")); assert!(header.contains("Accept-Ranges: bytes"));
            let (start, count) = byte_range(Some(range), bytes.len() as u64).unwrap(); assert_eq!(&response[header_end..], &bytes[start as usize..(start + count) as usize]); assert!(header.contains(&format!("Content-Length: {count}"))); assert!(header.contains(&format!("Content-Range: bytes {start}-{}/{}", start + count - 1, bytes.len())));
        }
        let invalid = request(&server, target, Some("bytes=999-"), "GET"); assert!(String::from_utf8(invalid).unwrap().contains(&format!("Content-Range: bytes */{}", bytes.len())));
        assert!(String::from_utf8(request(&server, target, Some("bytes=999-"), "GET")).unwrap().starts_with("HTTP/1.1 416"));
        let head = request(&server, target, None, "HEAD"); assert!(head.ends_with(b"\r\n\r\n"));
        assert!(request(&server, "/../../etc/passwd", None, "GET").starts_with(b"HTTP/1.1 404"));
        assert!(request(&server, &format!("/media/{}", "0".repeat(64)), None, "GET").starts_with(b"HTTP/1.1 404"));
        assert!(request(&server, target, None, "OPTIONS").starts_with(b"HTTP/1.1 204"));
        assert!(server.allows_url(&url)); assert!(!server.allows_url(&format!("http://127.0.0.1:1{target}")));
        fs::write(root.join("objects").join(&hash), b"changed").unwrap(); assert!(request(&server, target, None, "HEAD").starts_with(b"HTTP/1.1 409"));
        fs::remove_file(root.join("objects").join(&hash)).unwrap(); assert!(request(&server, target, None, "HEAD").starts_with(b"HTTP/1.1 404"));
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn symlink_outside_cache_blocked() {
        let bytes = b"\0\0\0\x18ftypisom0123456789ABCDEF"; let (root, server, hash, diagnostic) = fixture(bytes, "video/mp4");
        let outside = root.join("outside.mp4"); fs::write(&outside, bytes).unwrap(); fs::remove_file(root.join("objects").join(&hash)).unwrap();
        std::os::unix::fs::symlink(outside, root.join("objects").join(&hash)).unwrap();
        assert_eq!(server.inspect_object(&root, &hash, bytes.len() as u64, "video/mp4".into(), diagnostic).error_code.as_deref(), Some("path")); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn large_object_is_streamed_and_range_is_bounded() {
        let bytes = b"\0\0\0\x18ftypisom0123456789ABCDEF"; let (root, server, hash, mut diagnostic) = fixture(bytes, "video/mp4");
        let path = root.join("objects").join(&hash); let file = File::options().write(true).open(&path).unwrap(); let size = 600 * 1024 * 1024; file.set_len(size).unwrap(); drop(file);
        let mut file = File::open(&path).unwrap(); let mut sha = Sha256::new(); let mut block = [0u8; BLOCK_BYTES];
        loop { let read = file.read(&mut block).unwrap(); if read == 0 { break; } sha.update(&block[..read]); }
        let hash = format!("{:x}", sha.finalize()); drop(file); let target_path = root.join("objects").join(&hash); fs::rename(path, target_path).unwrap();
        diagnostic.expected_size = size;
        let checked = server.inspect_object(&root, &hash, size, "video/mp4".into(), diagnostic); assert_eq!(checked.sha256_valid, Some(true));
        let url = checked.url.unwrap(); let target = url.strip_prefix(&format!("http://127.0.0.1:{}", server.port)).unwrap();
        let response = request(&server, target, Some("bytes=500000000-500000063"), "GET"); assert!(response.len() < 1024); assert!(response.starts_with(b"HTTP/1.1 206")); assert!(String::from_utf8_lossy(&response).contains("Content-Length: 64"));
        // Consume the full no-Range response incrementally, including SHA-256.
        let mut socket = TcpStream::connect(("127.0.0.1", server.port)).unwrap(); write!(socket, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n", server.port).unwrap();
        let mut header = Vec::new(); let mut byte = [0u8; 1]; while !header.ends_with(b"\r\n\r\n") { socket.read_exact(&mut byte).unwrap(); header.push(byte[0]); }
        assert!(header.starts_with(b"HTTP/1.1 200")); let mut sha = Sha256::new(); let mut received = 0; let baseline = resident_bytes(); let mut peak = baseline;
        loop { let read = socket.read(&mut block).unwrap(); if read == 0 { break; } received += read as u64; sha.update(&block[..read]); if received % (16 * 1024 * 1024) < BLOCK_BYTES as u64 { peak = peak.max(resident_bytes()); } }
        assert_eq!(received, size); assert_eq!(format!("{:x}", sha.finalize()), hash);
        eprintln!("LARGE_MEDIA_TEST size={size} RSS_growth={}", peak.saturating_sub(baseline)); assert!(peak.saturating_sub(baseline) < 32 * 1024 * 1024);
        fs::remove_dir_all(root).unwrap();
    }
    fn resident_bytes() -> u64 {
        #[cfg(target_os = "linux")]
        { return fs::read_to_string("/proc/self/status").unwrap().lines().find(|line| line.starts_with("VmRSS:")).unwrap().split_whitespace().nth(1).unwrap().parse::<u64>().unwrap() * 1024; }
        #[cfg(not(target_os = "linux"))]
        { 0 }
    }
}
