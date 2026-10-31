use super::{decode, Identity, Kind, Res};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[cfg(unix)]
extern "C" {
    fn geteuid() -> u32;
}

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};

const KEY_FILE_NAME: &str = "vault-v1.key";
const ENC_FILE_NAME: &str = "vault-v1.enc";
const KEY_HEADER: &[u8; 8] = b"ACVK0001";
const ENC_HEADER: &[u8; 8] = b"ACIV0001";
const AAD_BYTES: &[u8] = b"com.activeclassroom.desktop/device-vault/v1";
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const MAX_ENC_SIZE: usize = 16384;
const MIN_ENC_SIZE: usize = 8 + NONCE_LEN + TAG_LEN;
const KEY_TOTAL_SIZE: usize = 41;

type Key = [u8; 32];

fn hex_encode(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        let _ = write!(s, "{:02x}", b);
    }
    s
}

fn verify_dir_meta(meta: &std::fs::Metadata) -> Res<()> {
    if meta.file_type().is_symlink() || !meta.file_type().is_dir() {
        return Err(Kind::Corrupt);
    }
    #[cfg(unix)]
    {
        if meta.uid() != unsafe { geteuid() } || meta.mode() & 0o777 != 0o700 {
            return Err(Kind::Corrupt);
        }
    }
    Ok(())
}

fn verify_file_meta(meta: &std::fs::Metadata) -> Res<()> {
    if meta.file_type().is_symlink() || !meta.file_type().is_file() {
        return Err(Kind::Corrupt);
    }
    #[cfg(unix)]
    {
        if meta.nlink() != 1 || meta.uid() != unsafe { geteuid() } || meta.mode() & 0o777 != 0o600 {
            return Err(Kind::Corrupt);
        }
    }
    Ok(())
}

/// Ok(false) when the directory does not exist; any existing directory must be private and ours.
fn check_dir_if_exists(dir: &Path) -> Res<bool> {
    match std::fs::symlink_metadata(dir) {
        Ok(meta) => verify_dir_meta(&meta).map(|_| true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(Kind::Storage),
    }
}

fn ensure_dir_exists(dir: &Path) -> Res<()> {
    if check_dir_if_exists(dir)? {
        return Ok(());
    }
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).map_err(|_| Kind::Storage)?;
    }
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    builder.mode(0o700);
    match builder.create(dir) {
        Ok(()) => {
            #[cfg(unix)]
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| Kind::Storage)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(Kind::Storage),
    }
    if check_dir_if_exists(dir)? {
        Ok(())
    } else {
        Err(Kind::Storage)
    }
}

fn sync_dir(dir: &Path) -> Res<()> {
    #[cfg(unix)]
    {
        std::fs::File::open(dir)
            .and_then(|d| d.sync_all())
            .map_err(|_| Kind::Storage)
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
        Ok(())
    }
}

fn write_and_sync(file: &mut std::fs::File, data: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    file.write_all(data)?;
    file.sync_all()
}

/// Temp file + fsync + rename + directory fsync. `Ok` means the new content is durable;
/// any failure leaves either the previous file or the new complete file, never a partial one.
fn atomic_write_file(dir: &Path, filename: &str, data: &[u8]) -> Res<()> {
    ensure_dir_exists(dir)?;

    let mut rand_bytes = [0u8; 8];
    getrandom::fill(&mut rand_bytes).map_err(|_| Kind::Storage)?;
    let temp_path = dir.join(format!(".{}_{}.tmp", filename, hex_encode(&rand_bytes)));

    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut file = opts.open(&temp_path).map_err(|_| Kind::Storage)?;

    let written = write_and_sync(&mut file, data);
    drop(file);
    if written.is_err() || std::fs::rename(&temp_path, dir.join(filename)).is_err() {
        let _ = std::fs::remove_file(&temp_path);
        return Err(Kind::Storage);
    }
    sync_dir(dir)
}

/// Reads a private regular file whose size must be within `min..=max`.
/// The metadata is verified before opening and again on the opened descriptor,
/// which must be the same dev/ino. `Ok(None)` means the file is absent.
fn read_bounded(path: &Path, min: usize, max: usize) -> Res<Option<Vec<u8>>> {
    let before = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Kind::Storage),
    };
    verify_file_meta(&before)?;

    let file = std::fs::File::open(path).map_err(|_| Kind::Storage)?;
    let opened = file.metadata().map_err(|_| Kind::Storage)?;
    verify_file_meta(&opened)?;
    #[cfg(unix)]
    if (opened.dev(), opened.ino()) != (before.dev(), before.ino()) {
        return Err(Kind::Corrupt);
    }

    let len = opened.len();
    if len < min as u64 || len > max as u64 {
        return Err(Kind::Corrupt);
    }
    let mut buf = Vec::with_capacity(len as usize);
    file.take(max as u64 + 1)
        .read_to_end(&mut buf)
        .map_err(|_| Kind::Storage)?;
    if buf.len() as u64 != len {
        return Err(Kind::Corrupt);
    }
    Ok(Some(buf))
}

fn parse_key_file(buf: &[u8]) -> Res<(u8, Key)> {
    if buf.len() != KEY_TOTAL_SIZE || &buf[0..8] != KEY_HEADER || buf[8] > 1 {
        return Err(Kind::Corrupt);
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&buf[9..41]);
    Ok((buf[8], key))
}

fn decrypt_identity(key_bytes: &Key, payload: &[u8]) -> Res<Identity> {
    if payload.len() < MIN_ENC_SIZE || payload.len() > MAX_ENC_SIZE || &payload[0..8] != ENC_HEADER {
        return Err(Kind::Corrupt);
    }
    let mut nonce_bytes = [0u8; NONCE_LEN];
    nonce_bytes.copy_from_slice(&payload[8..8 + NONCE_LEN]);
    let mut in_out = payload[8 + NONCE_LEN..].to_vec();

    let unbound = ring::aead::UnboundKey::new(&ring::aead::AES_256_GCM, key_bytes)
        .map_err(|_| Kind::Corrupt)?;
    let key = ring::aead::LessSafeKey::new(unbound);
    let nonce = ring::aead::Nonce::assume_unique_for_key(nonce_bytes);
    let plain = key
        .open_in_place(nonce, ring::aead::Aad::from(AAD_BYTES), &mut in_out)
        .map_err(|_| Kind::Corrupt)?;

    let text = std::str::from_utf8(plain).map_err(|_| Kind::Corrupt)?;
    decode(text).map_err(|_| Kind::Corrupt)
}

fn encrypt_identity(key_bytes: &Key, identity: &Identity) -> Res<Vec<u8>> {
    let mut in_out = serde_json::to_vec(identity).map_err(|_| Kind::Invalid)?;
    if 8 + NONCE_LEN + in_out.len() + TAG_LEN > MAX_ENC_SIZE {
        return Err(Kind::Invalid);
    }
    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce_bytes).map_err(|_| Kind::Storage)?;

    let unbound = ring::aead::UnboundKey::new(&ring::aead::AES_256_GCM, key_bytes)
        .map_err(|_| Kind::Storage)?;
    let key = ring::aead::LessSafeKey::new(unbound);
    let nonce = ring::aead::Nonce::assume_unique_for_key(nonce_bytes);
    key.seal_in_place_append_tag(nonce, ring::aead::Aad::from(AAD_BYTES), &mut in_out)
        .map_err(|_| Kind::Storage)?;

    let mut payload = Vec::with_capacity(8 + NONCE_LEN + in_out.len());
    payload.extend_from_slice(ENC_HEADER);
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&in_out);
    Ok(payload)
}

enum State {
    /// No key and no ciphertext.
    Empty,
    /// Key generated but no ciphertext yet (interrupted first save).
    Pending(Key),
    /// Key marked ready and a ciphertext that decrypts with it.
    Ready(Key, Identity),
}

pub(super) struct Vault {
    state_dir: PathBuf,
    key_dir: PathBuf,
}

impl Vault {
    pub(super) fn new(state_dir: PathBuf, key_dir: PathBuf) -> Self {
        Self { state_dir, key_dir }
    }

    fn write_key_file(&self, ready: u8, key_bytes: &Key) -> Res<()> {
        let mut data = [0u8; KEY_TOTAL_SIZE];
        data[0..8].copy_from_slice(KEY_HEADER);
        data[8] = ready;
        data[9..].copy_from_slice(key_bytes);
        atomic_write_file(&self.key_dir, KEY_FILE_NAME, &data)
    }

    /// Never creates or rotates the key. A pending key with a valid ciphertext is finalized
    /// (flag 0 -> 1) before the identity is exposed.
    fn state(&self) -> Res<State> {
        let key_dir_exists = check_dir_if_exists(&self.key_dir)?;
        let state_dir_exists = check_dir_if_exists(&self.state_dir)?;

        let key_raw = if key_dir_exists {
            read_bounded(&self.key_dir.join(KEY_FILE_NAME), KEY_TOTAL_SIZE, KEY_TOTAL_SIZE)?
        } else {
            None
        };
        let cipher_raw = if state_dir_exists {
            read_bounded(&self.state_dir.join(ENC_FILE_NAME), MIN_ENC_SIZE, MAX_ENC_SIZE)?
        } else {
            None
        };

        match (key_raw, cipher_raw) {
            (None, None) => Ok(State::Empty),
            (None, Some(_)) => Err(Kind::Corrupt),
            (Some(key_raw), None) => match parse_key_file(&key_raw)? {
                (0, key) => Ok(State::Pending(key)),
                _ => Err(Kind::Storage),
            },
            (Some(key_raw), Some(cipher_raw)) => {
                let (ready, key) = parse_key_file(&key_raw)?;
                let identity = decrypt_identity(&key, &cipher_raw)?;
                if ready == 0 {
                    self.write_key_file(1, &key)?;
                }
                Ok(State::Ready(key, identity))
            }
        }
    }

    pub(super) fn load(&self) -> Res<Option<Identity>> {
        match self.state()? {
            State::Ready(_, identity) => Ok(Some(identity)),
            State::Empty | State::Pending(_) => Ok(None),
        }
    }

    pub(super) fn save(&self, identity: &Identity) -> Res<()> {
        let encoded = serde_json::to_string(identity).map_err(|_| Kind::Invalid)?;
        decode(&encoded)?;

        let (key, finalize) = match self.state()? {
            State::Ready(key, _) => (key, false),
            State::Pending(key) => (key, true),
            State::Empty => {
                let mut key = [0u8; 32];
                getrandom::fill(&mut key).map_err(|_| Kind::Storage)?;
                self.write_key_file(0, &key)?;
                (key, true)
            }
        };

        let payload = encrypt_identity(&key, identity)?;
        atomic_write_file(&self.state_dir, ENC_FILE_NAME, &payload)?;
        if finalize {
            self.write_key_file(1, &key)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirs {
        root: PathBuf,
        state_dir: PathBuf,
        key_dir: PathBuf,
    }

    fn create_private_dir(path: &Path) -> std::io::Result<()> {
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        builder.mode(0o700);
        builder.create(path)
    }

    impl TestDirs {
        fn new(name: &str) -> Self {
            let temp_base = std::env::temp_dir();
            assert!(temp_base.is_absolute());
            for _ in 0..16 {
                let mut rand_bytes = [0u8; 16];
                getrandom::fill(&mut rand_bytes).expect("rng");
                let root = temp_base.join(format!("ac_vault_test_{}_{}", name, hex_encode(&rand_bytes)));
                match create_private_dir(&root) {
                    Ok(()) => {
                        let state_dir = root.join("state");
                        let key_dir = root.join("keys");
                        create_private_dir(&state_dir).expect("state dir");
                        create_private_dir(&key_dir).expect("key dir");
                        return Self { root, state_dir, key_dir };
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(e) => panic!("no se pudo crear el directorio de prueba: {:?}", e.kind()),
                }
            }
            panic!("colisión repetida al crear el directorio de prueba");
        }

        fn vault(&self) -> Vault {
            Vault::new(self.state_dir.clone(), self.key_dir.clone())
        }

        fn key_path(&self) -> PathBuf {
            self.key_dir.join(KEY_FILE_NAME)
        }

        fn cipher_path(&self) -> PathBuf {
            self.state_dir.join(ENC_FILE_NAME)
        }
    }

    impl Drop for TestDirs {
        fn drop(&mut self) {
            // Only the root this fixture created: direct child of the temp dir, a real directory.
            let temp_base = std::env::temp_dir();
            let is_ours = self.root.parent() == Some(temp_base.as_path())
                && std::fs::symlink_metadata(&self.root)
                    .map(|m| m.file_type().is_dir() && !m.file_type().is_symlink())
                    .unwrap_or(false);
            if is_ours {
                let _ = std::fs::remove_dir_all(&self.root);
            }
        }
    }

    fn identity(name: &str) -> Identity {
        Identity {
            device_id: "0123456789abcdef".repeat(2),
            credential: "7f3a9c01d4e85b62".repeat(4),
            name: name.into(),
            activated: false,
            revoked: false,
            cache_device_id: None,
        }
    }

    fn read(path: &Path) -> Vec<u8> {
        std::fs::read(path).expect("read")
    }

    /// Overwrites an existing file in place, keeping its mode.
    fn rewrite(path: &Path, data: &[u8]) {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(path)
            .expect("open existing");
        file.write_all(data).expect("rewrite");
    }

    fn write_new_private(path: &Path, data: &[u8]) {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        opts.mode(0o600);
        let mut file = opts.open(path).expect("create private file");
        file.write_all(data).expect("write private file");
    }

    fn key_file_bytes(ready: u8, key: &Key) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(KEY_HEADER);
        data.push(ready);
        data.extend_from_slice(key);
        data
    }

    fn random_key() -> Key {
        let mut key = [0u8; 32];
        getrandom::fill(&mut key).expect("rng");
        key
    }

    #[test]
    fn guarda_y_carga_identidad_con_flags_y_cache() {
        let fixture = TestDirs::new("roundtrip");
        let vault = fixture.vault();
        assert_eq!(vault.load().unwrap(), None);

        let mut full = identity("Aula con caché");
        full.activated = true;
        full.revoked = true;
        full.cache_device_id = Some("fedcba9876543210".repeat(2));
        vault.save(&full).expect("save");

        let loaded = vault.load().expect("load").expect("some");
        assert!(loaded == full);
        assert!(loaded.activated && loaded.revoked);
        assert_eq!(loaded.cache_device_id, full.cache_device_id);

        let plain = identity("Aula sin caché");
        vault.save(&plain).expect("save plain");
        let loaded = vault.load().expect("load").expect("some");
        assert!(loaded == plain);
        assert!(loaded.cache_device_id.is_none() && !loaded.activated && !loaded.revoked);
    }

    #[test]
    fn load_sin_datos_no_crea_clave_ni_archivos() {
        let fixture = TestDirs::new("load_empty");
        let vault = fixture.vault();
        assert_eq!(vault.load().unwrap(), None);
        assert!(!fixture.key_path().exists());
        assert!(!fixture.cipher_path().exists());
        assert_eq!(std::fs::read_dir(&fixture.key_dir).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(&fixture.state_dir).unwrap().count(), 0);
    }

    #[test]
    fn crea_directorios_privados_ausentes() {
        let fixture = TestDirs::new("lazy_dirs");
        let vault = Vault::new(fixture.root.join("s2"), fixture.root.join("k2"));
        assert_eq!(vault.load().unwrap(), None);
        let id = identity("Directorios nuevos");
        vault.save(&id).expect("save");
        assert!(vault.load().unwrap().unwrap() == id);
        #[cfg(unix)]
        for dir in ["s2", "k2"] {
            let meta = std::fs::symlink_metadata(fixture.root.join(dir)).unwrap();
            assert_eq!(meta.mode() & 0o777, 0o700);
        }
    }

    #[test]
    fn el_cifrado_no_contiene_credencial_nombre_ni_clave() {
        let fixture = TestDirs::new("no_leak");
        let vault = fixture.vault();
        let id = identity("Nombre Reservado");
        vault.save(&id).expect("save");

        let cipher = read(&fixture.cipher_path());
        let key_file = read(&fixture.key_path());
        assert_eq!(key_file.len(), KEY_TOTAL_SIZE);
        assert_eq!(&cipher[0..8], ENC_HEADER);
        let plain_len = serde_json::to_vec(&id).unwrap().len();
        assert_eq!(cipher.len(), 8 + NONCE_LEN + plain_len + TAG_LEN);

        for needle in [id.credential.as_bytes(), id.name.as_bytes(), id.device_id.as_bytes(), &key_file[9..41]] {
            assert!(!cipher.windows(needle.len()).any(|w| w == needle));
        }
        assert!(!key_file.windows(id.credential.len()).any(|w| w == id.credential.as_bytes()));
    }

    #[test]
    fn misma_clave_en_actualizaciones_y_nonce_nuevo() {
        let fixture = TestDirs::new("same_key");
        let vault = fixture.vault();
        vault.save(&identity("Nombre 1")).expect("save 1");
        let key_1 = read(&fixture.key_path());
        let cipher_1 = read(&fixture.cipher_path());

        let second = identity("Nombre 2");
        vault.save(&second).expect("save 2");
        let key_2 = read(&fixture.key_path());
        let cipher_2 = read(&fixture.cipher_path());

        assert!(key_1 == key_2);
        assert_eq!(key_2[8], 1);
        assert!(cipher_1[8..20] != cipher_2[8..20]);
        assert!(cipher_1 != cipher_2);
        assert!(vault.load().unwrap().unwrap() == second);
    }

    #[test]
    fn cifrado_alterado_falla_cerrado_y_no_se_sobrescribe() {
        let fixture = TestDirs::new("tamper");
        let vault = fixture.vault();
        vault.save(&identity("Original")).expect("save");

        let mut cipher = read(&fixture.cipher_path());
        let last = cipher.len() - 1;
        cipher[last] ^= 0xff;
        rewrite(&fixture.cipher_path(), &cipher);
        let key_before = read(&fixture.key_path());

        assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
        assert_eq!(vault.save(&identity("No sobrescribir")).unwrap_err(), Kind::Corrupt);
        assert!(read(&fixture.cipher_path()) == cipher);
        assert!(read(&fixture.key_path()) == key_before);
    }

    #[test]
    fn clave_incorrecta_falla_cerrado_y_no_rota_la_clave() {
        let fixture = TestDirs::new("wrong_key");
        let vault = fixture.vault();
        vault.save(&identity("Original")).expect("save");

        let wrong = key_file_bytes(1, &random_key());
        rewrite(&fixture.key_path(), &wrong);
        let cipher_before = read(&fixture.cipher_path());

        assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
        assert_eq!(vault.save(&identity("No sobrescribir")).unwrap_err(), Kind::Corrupt);
        assert!(read(&fixture.cipher_path()) == cipher_before);
        assert!(read(&fixture.key_path()) == wrong);
    }

    #[test]
    fn clave_ausente_con_cifrado_falla_cerrado_sin_regenerar() {
        let fixture = TestDirs::new("missing_key");
        let vault = fixture.vault();
        vault.save(&identity("Original")).expect("save");
        std::fs::remove_file(fixture.key_path()).expect("remove key");
        let cipher_before = read(&fixture.cipher_path());

        assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
        assert_eq!(vault.save(&identity("No sobrescribir")).unwrap_err(), Kind::Corrupt);
        assert!(!fixture.key_path().exists());
        assert!(read(&fixture.cipher_path()) == cipher_before);
    }

    #[test]
    fn clave_lista_sin_cifrado_falla_cerrado() {
        let fixture = TestDirs::new("missing_cipher");
        let vault = fixture.vault();
        vault.save(&identity("Original")).expect("save");
        std::fs::remove_file(fixture.cipher_path()).expect("remove cipher");
        let key_before = read(&fixture.key_path());

        assert_eq!(vault.load().unwrap_err(), Kind::Storage);
        assert_eq!(vault.save(&identity("Otra")).unwrap_err(), Kind::Storage);
        assert!(!fixture.cipher_path().exists());
        assert!(read(&fixture.key_path()) == key_before);
    }

    #[test]
    fn clave_pendiente_con_cifrado_valido_finaliza_la_misma_identidad() {
        let fixture = TestDirs::new("pending_valid");
        let vault = fixture.vault();
        let id = identity("Finalizar");
        vault.save(&id).expect("save");

        let mut key_file = read(&fixture.key_path());
        key_file[8] = 0;
        rewrite(&fixture.key_path(), &key_file);

        assert!(vault.load().unwrap().unwrap() == id);
        let after = read(&fixture.key_path());
        assert_eq!(after[8], 1);
        assert!(after[9..] == key_file[9..]);
    }

    #[test]
    fn clave_pendiente_con_cifrado_corrupto_no_finaliza() {
        let fixture = TestDirs::new("pending_corrupt");
        let vault = fixture.vault();
        vault.save(&identity("Original")).expect("save");

        let mut key_file = read(&fixture.key_path());
        key_file[8] = 0;
        rewrite(&fixture.key_path(), &key_file);
        let mut cipher = read(&fixture.cipher_path());
        cipher[25] ^= 0xff;
        rewrite(&fixture.cipher_path(), &cipher);

        assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
        assert!(read(&fixture.key_path()) == key_file);
        assert!(read(&fixture.cipher_path()) == cipher);
    }

    #[test]
    fn clave_pendiente_sin_cifrado_conserva_la_misma_clave() {
        let fixture = TestDirs::new("orphan_pending");
        let vault = fixture.vault();
        let key = random_key();
        let pending = key_file_bytes(0, &key);
        write_new_private(&fixture.key_path(), &pending);

        assert_eq!(vault.load().unwrap(), None);
        assert!(read(&fixture.key_path()) == pending);
        assert!(!fixture.cipher_path().exists());

        let id = identity("Recuperar");
        vault.save(&id).expect("save");
        let final_key = read(&fixture.key_path());
        assert_eq!(final_key[8], 1);
        assert!(final_key[9..] == key[..]);
        assert!(vault.load().unwrap().unwrap() == id);
    }

    #[test]
    fn rechaza_formatos_y_tamanos_invalidos() {
        let fixture = TestDirs::new("bad_format");
        let vault = fixture.vault();
        vault.save(&identity("Original")).expect("save");
        let key_good = read(&fixture.key_path());
        let cipher_good = read(&fixture.cipher_path());

        let mut bad_flag = key_good.clone();
        bad_flag[8] = 2;
        let mut bad_header = key_good.clone();
        bad_header[0] ^= 0xff;
        let mut long_key = key_good.clone();
        long_key.push(0);
        for bad in [bad_flag, bad_header, long_key, key_good[..40].to_vec()] {
            rewrite(&fixture.key_path(), &bad);
            assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
        }
        rewrite(&fixture.key_path(), &key_good);

        let mut bad_cipher_header = cipher_good.clone();
        bad_cipher_header[0] ^= 0xff;
        let oversized = vec![0u8; MAX_ENC_SIZE + 1];
        for bad in [bad_cipher_header, oversized, cipher_good[..MIN_ENC_SIZE - 1].to_vec()] {
            rewrite(&fixture.cipher_path(), &bad);
            assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
        }
        rewrite(&fixture.cipher_path(), &cipher_good);
        assert!(vault.load().unwrap().is_some());
    }

    #[test]
    fn escritura_atomica_falla_si_el_directorio_no_es_valido() {
        let fixture = TestDirs::new("atomic_fail");
        let blocker = fixture.root.join("archivo");
        write_new_private(&blocker, b"x");
        assert!(atomic_write_file(&blocker, "x", b"data").is_err());
        assert!(read(&blocker) == b"x");
    }

    #[cfg(unix)]
    #[test]
    fn archivos_y_directorios_exigen_modo_propietario_y_enlaces() {
        use std::os::unix::fs::symlink;

        let fixture = TestDirs::new("perms");
        let vault = fixture.vault();
        vault.save(&identity("Permisos")).expect("save");

        for path in [fixture.key_path(), fixture.cipher_path()] {
            let meta = std::fs::symlink_metadata(&path).unwrap();
            assert_eq!(meta.mode() & 0o777, 0o600);
            assert_eq!(meta.nlink(), 1);
            assert_eq!(meta.uid(), unsafe { geteuid() });
        }
        for dir in [&fixture.key_dir, &fixture.state_dir] {
            assert_eq!(std::fs::symlink_metadata(dir).unwrap().mode() & 0o777, 0o700);
        }

        for path in [fixture.key_path(), fixture.cipher_path()] {
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
            assert!(vault.load().unwrap().is_some());
        }

        for dir in [&fixture.key_dir, &fixture.state_dir] {
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).unwrap();
            assert!(vault.load().unwrap().is_some());
        }

        let link = fixture.state_dir.join("hardlink");
        std::fs::hard_link(fixture.cipher_path(), &link).unwrap();
        assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
        std::fs::remove_file(&link).unwrap();
        assert!(vault.load().unwrap().is_some());

        for path in [fixture.key_path(), fixture.cipher_path()] {
            let moved = path.with_extension("real");
            std::fs::rename(&path, &moved).unwrap();
            symlink(&moved, &path).unwrap();
            assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
            std::fs::remove_file(&path).unwrap();
            std::fs::rename(&moved, &path).unwrap();
            assert!(vault.load().unwrap().is_some());
        }

        std::fs::remove_file(fixture.key_path()).unwrap();
        create_private_dir(&fixture.key_path()).unwrap();
        assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
    }

    /// Runs `sudo -n -u nobody /usr/bin/head -c1 <path>` and asserts the read is denied.
    /// Output is captured and never printed.
    #[cfg(target_os = "linux")]
    fn assert_nobody_cannot_read(path: &Path) {
        let output = std::process::Command::new("sudo")
            .args(["-n", "-u", "nobody", "/usr/bin/head", "-c1"])
            .arg(path)
            .output()
            .unwrap_or_else(|e| panic!("no se pudo ejecutar sudo: {:?}", e.kind()));
        assert!(!output.status.success(), "otro usuario pudo leer un archivo del vault");
        assert!(output.stdout.is_empty(), "otro usuario obtuvo bytes de un archivo del vault");
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires isolated Linux CI with passwordless sudo"]
    fn otro_usuario_no_puede_leer_vault() {
        // Explicit invocation must never skip silently: a missing guard or preflight fails.
        assert_eq!(
            std::env::var("ACTIVE_CLASSROOM_TEST_VAULT_UID").as_deref(),
            Ok("1"),
            "falta ACTIVE_CLASSROOM_TEST_VAULT_UID=1 (CI aislado con sudo sin contraseña)"
        );

        // Preflight: sudo must really run as a different, unprivileged user.
        let id_output = std::process::Command::new("sudo")
            .args(["-n", "-u", "nobody", "/usr/bin/id", "-u"])
            .output()
            .unwrap_or_else(|e| panic!("no se pudo ejecutar sudo: {:?}", e.kind()));
        assert!(id_output.status.success(), "sudo -n -u nobody no se pudo ejecutar");
        let other_uid: u32 = String::from_utf8(id_output.stdout)
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .expect("sudo no devolvió un UID válido");
        assert_ne!(other_uid, 0, "el usuario auxiliar no debe ser root");
        assert_ne!(other_uid, unsafe { geteuid() }, "sudo no cambió de usuario");

        let fixture = TestDirs::new("other_user");
        let vault = fixture.vault();
        let expected = identity("Aislamiento");
        vault.save(&expected).expect("save");
        assert!(vault.load().expect("load").expect("some") == expected);

        // Dirs 0700: the other user is stopped at the directories and at the files.
        for path in [fixture.key_path(), fixture.cipher_path()] {
            assert_nobody_cannot_read(&path);
        }

        // Temporarily open the fixture dirs so only the 0600 file mode protects the files.
        let dirs = [&fixture.root, &fixture.key_dir, &fixture.state_dir];
        for dir in dirs {
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let results: Vec<_> = [fixture.key_path(), fixture.cipher_path()]
            .iter()
            .map(|path| {
                std::panic::catch_unwind(|| assert_nobody_cannot_read(path)).is_ok()
            })
            .collect();
        for dir in dirs {
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        assert!(results.iter().all(|ok| *ok), "archivo 0600 legible por otro usuario");

        assert!(vault.load().expect("load").expect("some") == expected);
    }
}
