use super::{decode, Identity, Kind, Res};
use std::path::{Path, PathBuf};

#[cfg(unix)]
extern "C" {
    fn geteuid() -> u32;
}

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};

const KEY_FILE_NAME: &str = "vault-v1.key";
const ENC_FILE_NAME: &str = "vault-v1.enc";
const KEY_HEADER: &[u8; 8] = b"ACVK0001";
const ENC_HEADER: &[u8; 8] = b"ACIV0001";
const AAD_BYTES: &[u8] = b"com.activeclassroom.desktop/device-vault/v1";
const MAX_ENC_SIZE: u64 = 16384;
const MIN_ENC_SIZE: u64 = 36;
const KEY_TOTAL_SIZE: u64 = 41;

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{:02x}", b);
    }
    s
}

fn verify_dir(dir: &Path) -> Res<()> {
    let meta = match std::fs::symlink_metadata(dir) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(Kind::Storage),
        Err(_) => return Err(Kind::Storage),
    };
    if meta.file_type().is_symlink() || !meta.file_type().is_dir() {
        return Err(Kind::Corrupt);
    }
    #[cfg(unix)]
    {
        if meta.uid() != unsafe { geteuid() } {
            return Err(Kind::Corrupt);
        }
        if meta.mode() & 0o777 != 0o700 {
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
        if meta.nlink() != 1 {
            return Err(Kind::Corrupt);
        }
        if meta.uid() != unsafe { geteuid() } {
            return Err(Kind::Corrupt);
        }
        if meta.mode() & 0o777 != 0o600 {
            return Err(Kind::Corrupt);
        }
    }
    Ok(())
}

fn ensure_dir_exists(dir: &Path) -> Res<()> {
    match std::fs::symlink_metadata(dir) {
        Ok(_) => verify_dir(dir),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            #[cfg(unix)]
            {
                let mut builder = std::fs::DirBuilder::new();
                builder.mode(0o700);
                builder.recursive(true);
                builder.create(dir).map_err(|_| Kind::Storage)?;
            }
            #[cfg(not(unix))]
            {
                std::fs::create_dir_all(dir).map_err(|_| Kind::Storage)?;
            }
            verify_dir(dir)
        }
        Err(_) => Err(Kind::Storage),
    }
}

fn check_dir_if_exists(dir: &Path) -> Res<bool> {
    match std::fs::symlink_metadata(dir) {
        Ok(_) => {
            verify_dir(dir)?;
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(Kind::Storage),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FileCheck {
    Absent,
    Present,
}

fn check_file(path: &Path) -> Res<FileCheck> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) => {
            verify_file_meta(&meta)?;
            Ok(FileCheck::Present)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FileCheck::Absent),
        Err(_) => Err(Kind::Storage),
    }
}

fn atomic_write_file(dir: &Path, filename: &str, data: &[u8], _mode: u32) -> Res<()> {
    ensure_dir_exists(dir)?;

    let mut rand_bytes = [0u8; 8];
    getrandom::fill(&mut rand_bytes).map_err(|_| Kind::Storage)?;
    let temp_name = format!(".{}_{}.tmp", filename, hex_encode(&rand_bytes));
    let temp_path = dir.join(temp_name);

    #[cfg(unix)]
    let mut open_opts = {
        let mut opts = std::fs::OpenOptions::new();
        opts.mode(_mode);
        opts
    };
    #[cfg(not(unix))]
    let mut open_opts = std::fs::OpenOptions::new();

    open_opts.write(true).create_new(true);

    let mut file = match open_opts.open(&temp_path) {
        Ok(f) => f,
        Err(_) => return Err(Kind::Storage),
    };

    use std::io::Write;
    if file.write_all(data).is_err() {
        let _ = std::fs::remove_file(&temp_path);
        return Err(Kind::Storage);
    }
    if file.sync_all().is_err() {
        let _ = std::fs::remove_file(&temp_path);
        return Err(Kind::Storage);
    }
    drop(file);

    let target_path = dir.join(filename);
    if std::fs::rename(&temp_path, &target_path).is_err() {
        let _ = std::fs::remove_file(&temp_path);
        return Err(Kind::Storage);
    }

    if let Ok(dir_file) = std::fs::File::open(dir) {
        let _ = dir_file.sync_all();
    }

    Ok(())
}

fn read_key_file(path: &Path) -> Res<(u8, [u8; 32])> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(Kind::Storage),
        Err(_) => return Err(Kind::Storage),
    };
    verify_file_meta(&meta)?;
    if meta.len() != KEY_TOTAL_SIZE {
        return Err(Kind::Corrupt);
    }
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|_| Kind::Storage)?;
    let mut buf = [0u8; 41];
    file.read_exact(&mut buf).map_err(|_| Kind::Corrupt)?;

    if &buf[0..8] != KEY_HEADER {
        return Err(Kind::Corrupt);
    }
    let ready = buf[8];
    if ready != 0 && ready != 1 {
        return Err(Kind::Corrupt);
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&buf[9..41]);
    Ok((ready, key))
}

fn read_cipher_file(path: &Path) -> Res<Vec<u8>> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(Kind::Storage),
        Err(_) => return Err(Kind::Storage),
    };
    verify_file_meta(&meta)?;
    let len = meta.len();
    if len < MIN_ENC_SIZE || len > MAX_ENC_SIZE {
        return Err(Kind::Corrupt);
    }
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|_| Kind::Storage)?;
    let mut buf = Vec::with_capacity(len as usize);
    file.take(MAX_ENC_SIZE + 1)
        .read_to_end(&mut buf)
        .map_err(|_| Kind::Storage)?;
    if buf.len() != len as usize || buf.len() > MAX_ENC_SIZE as usize || buf.len() < MIN_ENC_SIZE as usize {
        return Err(Kind::Corrupt);
    }
    if &buf[0..8] != ENC_HEADER {
        return Err(Kind::Corrupt);
    }
    Ok(buf)
}

fn decrypt_identity(key_bytes: &[u8; 32], cipher_payload: &[u8]) -> Res<Identity> {
    if cipher_payload.len() < MIN_ENC_SIZE as usize || &cipher_payload[0..8] != ENC_HEADER {
        return Err(Kind::Corrupt);
    }
    let mut nonce_bytes = [0u8; 12];
    nonce_bytes.copy_from_slice(&cipher_payload[8..20]);
    let mut in_out = cipher_payload[20..].to_vec();

    let unbound_key = ring::aead::UnboundKey::new(&ring::aead::AES_256_GCM, key_bytes)
        .map_err(|_| Kind::Corrupt)?;
    let less_safe_key = ring::aead::LessSafeKey::new(unbound_key);
    let nonce = ring::aead::Nonce::assume_unique_for_key(nonce_bytes);
    let aad = ring::aead::Aad::from(AAD_BYTES);

    let decrypted = less_safe_key
        .open_in_place(nonce, aad, &mut in_out)
        .map_err(|_| Kind::Corrupt)?;

    let text = std::str::from_utf8(decrypted).map_err(|_| Kind::Corrupt)?;
    decode(text).map_err(|_| Kind::Corrupt)
}

fn encrypt_identity(key_bytes: &[u8; 32], identity: &Identity) -> Res<Vec<u8>> {
    let json_str = serde_json::to_string(identity).map_err(|_| Kind::Invalid)?;
    let mut nonce_bytes = [0u8; 12];
    getrandom::fill(&mut nonce_bytes).map_err(|_| Kind::Storage)?;

    let unbound_key = ring::aead::UnboundKey::new(&ring::aead::AES_256_GCM, key_bytes)
        .map_err(|_| Kind::Storage)?;
    let less_safe_key = ring::aead::LessSafeKey::new(unbound_key);
    let nonce = ring::aead::Nonce::assume_unique_for_key(nonce_bytes);
    let aad = ring::aead::Aad::from(AAD_BYTES);

    let mut in_out = json_str.into_bytes();
    less_safe_key
        .seal_in_place_append_tag(nonce, aad, &mut in_out)
        .map_err(|_| Kind::Storage)?;

    let mut payload = Vec::with_capacity(8 + 12 + in_out.len());
    payload.extend_from_slice(ENC_HEADER);
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&in_out);
    Ok(payload)
}

pub(super) struct Vault {
    state_dir: PathBuf,
    key_dir: PathBuf,
}

impl Vault {
    pub(super) fn new(state_dir: PathBuf, key_dir: PathBuf) -> Self {
        Self { state_dir, key_dir }
    }

    fn write_key_file(&self, ready: u8, key_bytes: &[u8; 32]) -> Res<()> {
        let mut data = [0u8; 41];
        data[0..8].copy_from_slice(KEY_HEADER);
        data[8] = ready;
        data[9..41].copy_from_slice(key_bytes);
        atomic_write_file(&self.key_dir, KEY_FILE_NAME, &data, 0o600)
    }

    pub(super) fn load(&self) -> Res<Option<Identity>> {
        let key_dir_exists = check_dir_if_exists(&self.key_dir)?;
        let state_dir_exists = check_dir_if_exists(&self.state_dir)?;

        let key_path = self.key_dir.join(KEY_FILE_NAME);
        let cipher_path = self.state_dir.join(ENC_FILE_NAME);

        let key_status = if key_dir_exists {
            check_file(&key_path)?
        } else {
            FileCheck::Absent
        };

        let cipher_status = if state_dir_exists {
            check_file(&cipher_path)?
        } else {
            FileCheck::Absent
        };

        match (key_status, cipher_status) {
            (FileCheck::Absent, FileCheck::Absent) => Ok(None),
            (FileCheck::Absent, FileCheck::Present) => Err(Kind::Corrupt),
            (FileCheck::Present, FileCheck::Absent) => {
                let (ready, _) = read_key_file(&key_path)?;
                if ready == 1 {
                    Err(Kind::Storage)
                } else {
                    Ok(None)
                }
            }
            (FileCheck::Present, FileCheck::Present) => {
                let (ready, key_bytes) = read_key_file(&key_path)?;
                let cipher_data = read_cipher_file(&cipher_path)?;
                let identity = decrypt_identity(&key_bytes, &cipher_data)?;

                if ready == 0 {
                    self.write_key_file(1, &key_bytes)?;
                }
                Ok(Some(identity))
            }
        }
    }

    pub(super) fn save(&self, identity: &Identity) -> Res<()> {
        let encoded = serde_json::to_string(identity).map_err(|_| Kind::Invalid)?;
        let _ = decode(&encoded)?;

        let existing = self.load()?;

        ensure_dir_exists(&self.key_dir)?;
        ensure_dir_exists(&self.state_dir)?;

        let key_path = self.key_dir.join(KEY_FILE_NAME);

        let (key_bytes, is_pending) = match existing {
            Some(_) => {
                let (ready, key) = read_key_file(&key_path)?;
                if ready != 1 {
                    return Err(Kind::Corrupt);
                }
                (key, false)
            }
            None => {
                let key_status = check_file(&key_path)?;
                match key_status {
                    FileCheck::Present => {
                        let (ready, key) = read_key_file(&key_path)?;
                        if ready == 0 {
                            (key, true)
                        } else {
                            return Err(Kind::Storage);
                        }
                    }
                    FileCheck::Absent => {
                        let mut new_key = [0u8; 32];
                        getrandom::fill(&mut new_key).map_err(|_| Kind::Storage)?;
                        self.write_key_file(0, &new_key)?;
                        (new_key, true)
                    }
                }
            }
        };

        let cipher_payload = encrypt_identity(&key_bytes, identity)?;
        atomic_write_file(&self.state_dir, ENC_FILE_NAME, &cipher_payload, 0o600)?;

        if is_pending {
            self.write_key_file(1, &key_bytes)?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TestDirs {
        root: PathBuf,
        state_dir: PathBuf,
        key_dir: PathBuf,
    }

    impl TestDirs {
        fn new(name: &str) -> Self {
            let mut rand_bytes = [0u8; 8];
            getrandom::fill(&mut rand_bytes).expect("rng");
            let temp_base = std::env::temp_dir();
            let root = temp_base.join(format!("ac_vault_test_{}_{}", name, hex_encode(&rand_bytes)));
            let state_dir = root.join("state");
            let key_dir = root.join("keys");

            #[cfg(unix)]
            {
                let mut b = std::fs::DirBuilder::new();
                b.mode(0o700);
                b.recursive(true);
                b.create(&state_dir).expect("state dir");
                b.create(&key_dir).expect("key dir");
            }
            #[cfg(not(unix))]
            {
                std::fs::create_dir_all(&state_dir).expect("state dir");
                std::fs::create_dir_all(&key_dir).expect("key dir");
            }

            Self {
                root,
                state_dir,
                key_dir,
            }
        }

        fn vault(&self) -> Vault {
            Vault::new(self.state_dir.clone(), self.key_dir.clone())
        }
    }

    impl Drop for TestDirs {
        fn drop(&mut self) {
            let temp_base = std::env::temp_dir();
            if self.root.is_absolute()
                && self.root.starts_with(&temp_base)
                && self.root != temp_base
            {
                let _ = std::fs::remove_dir_all(&self.root);
            }
        }
    }

    #[test]
    fn test_roundtrip_and_flags_cache() {
        let fixture = TestDirs::new("roundtrip");
        let vault = fixture.vault();

        assert_eq!(vault.load().unwrap(), None);

        let sample_json = r#"{
            "device_id": "0123456789abcdef0123456789abcdef",
            "credential": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "name": "Test Device With Cache",
            "cache_device_id": "fedcba9876543210fedcba9876543210"
        }"#;
        let identity = decode(sample_json).expect("valid identity");
        vault.save(&identity).expect("save succeeds");

        let loaded = vault.load().expect("load succeeds").expect("some");
        assert_eq!(loaded, identity);
    }

    #[test]
    fn test_ciphertext_no_contiene_credencial_or_key() {
        let fixture = TestDirs::new("ciphertext_no_leak");
        let vault = fixture.vault();

        let sample_json = r#"{
            "device_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "credential": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "name": "Super Secret Name"
        }"#;
        let identity = decode(sample_json).expect("valid");
        vault.save(&identity).expect("save");

        let cipher_bytes = std::fs::read(fixture.state_dir.join(ENC_FILE_NAME)).expect("read cipher");
        let key_bytes = std::fs::read(fixture.key_dir.join(KEY_FILE_NAME)).expect("read key");

        let cred_hex = b"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        assert!(!cipher_bytes.windows(cred_hex.len()).any(|w| w == cred_hex));
        assert!(!key_bytes.windows(cred_hex.len()).any(|w| w == cred_hex));

        let name_bytes = b"Super Secret Name";
        assert!(!cipher_bytes.windows(name_bytes.len()).any(|w| w == name_bytes));

        let raw_key = &key_bytes[9..41];
        assert!(!cipher_bytes.windows(raw_key.len()).any(|w| w == raw_key));
    }

    #[test]
    fn test_same_key_persists_nonces_and_cipher_change() {
        let fixture = TestDirs::new("same_key");
        let vault = fixture.vault();

        let json1 = r#"{
            "device_id": "0123456789abcdef0123456789abcdef",
            "credential": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "name": "Name 1"
        }"#;
        let id1 = decode(json1).expect("id1");
        vault.save(&id1).expect("save 1");

        let key_file_1 = std::fs::read(fixture.key_dir.join(KEY_FILE_NAME)).expect("key 1");
        let cipher_file_1 = std::fs::read(fixture.state_dir.join(ENC_FILE_NAME)).expect("cipher 1");

        let json2 = r#"{
            "device_id": "0123456789abcdef0123456789abcdef",
            "credential": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "name": "Name 2 Updated"
        }"#;
        let id2 = decode(json2).expect("id2");
        vault.save(&id2).expect("save 2");

        let key_file_2 = std::fs::read(fixture.key_dir.join(KEY_FILE_NAME)).expect("key 2");
        let cipher_file_2 = std::fs::read(fixture.state_dir.join(ENC_FILE_NAME)).expect("cipher 2");

        assert_eq!(key_file_1, key_file_2);
        assert_ne!(&cipher_file_1[8..20], &cipher_file_2[8..20]);
        assert_ne!(cipher_file_1, cipher_file_2);

        let loaded = vault.load().expect("load").expect("some");
        assert_eq!(loaded, id2);
    }

    #[test]
    fn test_tamper_and_wrong_key() {
        let fixture = TestDirs::new("tamper");
        let vault = fixture.vault();

        let json = r#"{
            "device_id": "0123456789abcdef0123456789abcdef",
            "credential": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "name": "Tamper Test"
        }"#;
        let id = decode(json).expect("id");
        vault.save(&id).expect("save");

        let cipher_path = fixture.state_dir.join(ENC_FILE_NAME);
        let mut cipher_bytes = std::fs::read(&cipher_path).expect("read");
        let last_idx = cipher_bytes.len() - 1;
        cipher_bytes[last_idx] ^= 0xff;
        std::fs::write(&cipher_path, &cipher_bytes).expect("write tampered");

        assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);

        let new_json = r#"{
            "device_id": "0123456789abcdef0123456789abcdef",
            "credential": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "name": "Should Not Overwrite"
        }"#;
        let new_id = decode(new_json).expect("new_id");
        assert_eq!(vault.save(&new_id).unwrap_err(), Kind::Corrupt);

        let cur_cipher = std::fs::read(&cipher_path).expect("read cur");
        assert_eq!(cur_cipher, cipher_bytes);
    }

    #[test]
    fn test_ready_key_missing_cipher() {
        let fixture = TestDirs::new("missing_cipher");
        let vault = fixture.vault();

        let json = r#"{
            "device_id": "0123456789abcdef0123456789abcdef",
            "credential": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "name": "Test Missing Cipher"
        }"#;
        let id = decode(json).expect("id");
        vault.save(&id).expect("save");

        std::fs::remove_file(fixture.state_dir.join(ENC_FILE_NAME)).expect("remove cipher");

        assert_eq!(vault.load().unwrap_err(), Kind::Storage);
        assert_eq!(vault.save(&id).unwrap_err(), Kind::Storage);
    }

    #[test]
    fn test_key_pending_valid_cipher_finalizes() {
        let fixture = TestDirs::new("pending_valid");
        let vault = fixture.vault();

        let json = r#"{
            "device_id": "0123456789abcdef0123456789abcdef",
            "credential": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "name": "Finalize Test"
        }"#;
        let id = decode(json).expect("id");
        vault.save(&id).expect("save");

        let key_path = fixture.key_dir.join(KEY_FILE_NAME);
        let mut key_bytes = std::fs::read(&key_path).expect("read key");
        assert_eq!(key_bytes[8], 1);
        key_bytes[8] = 0;
        std::fs::write(&key_path, &key_bytes).expect("write key ready 0");

        let loaded = vault.load().expect("load").expect("some");
        assert_eq!(loaded, id);

        let key_bytes_after = std::fs::read(&key_path).expect("read key after");
        assert_eq!(key_bytes_after[8], 1);
    }

    #[test]
    fn test_orphan_pending_recover() {
        let fixture = TestDirs::new("orphan_pending");
        let vault = fixture.vault();

        let key_path = fixture.key_dir.join(KEY_FILE_NAME);
        let mut key_data = vec![0u8; 41];
        key_data[0..8].copy_from_slice(KEY_HEADER);
        key_data[8] = 0;
        getrandom::fill(&mut key_data[9..41]).expect("rng");
        std::fs::write(&key_path, &key_data).expect("write pending key");

        assert_eq!(vault.load().unwrap(), None);

        let json = r#"{
            "device_id": "0123456789abcdef0123456789abcdef",
            "credential": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "name": "Recover Test"
        }"#;
        let id = decode(json).expect("id");
        vault.save(&id).expect("save");

        let final_key = std::fs::read(&key_path).expect("read final");
        assert_eq!(final_key[8], 1);
        assert_eq!(&final_key[9..41], &key_data[9..41]);

        let loaded = vault.load().expect("load").expect("some");
        assert_eq!(loaded, id);
    }

    #[test]
    fn test_permissions_and_no_symlinks() {
        let fixture = TestDirs::new("perms_symlinks");
        let vault = fixture.vault();

        let json = r#"{
            "device_id": "0123456789abcdef0123456789abcdef",
            "credential": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "name": "Perms Test"
        }"#;
        let id = decode(json).expect("id");
        vault.save(&id).expect("save");

        #[cfg(unix)]
        {
            let key_meta = std::fs::symlink_metadata(fixture.key_dir.join(KEY_FILE_NAME)).expect("meta key");
            assert_eq!(key_meta.mode() & 0o777, 0o600);
            assert_eq!(key_meta.nlink(), 1);

            let cipher_meta = std::fs::symlink_metadata(fixture.state_dir.join(ENC_FILE_NAME)).expect("meta cipher");
            assert_eq!(cipher_meta.mode() & 0o777, 0o600);
            assert_eq!(cipher_meta.nlink(), 1);

            let key_dir_meta = std::fs::symlink_metadata(&fixture.key_dir).expect("meta key dir");
            assert_eq!(key_dir_meta.mode() & 0o777, 0o700);

            let state_dir_meta = std::fs::symlink_metadata(&fixture.state_dir).expect("meta state dir");
            assert_eq!(state_dir_meta.mode() & 0o777, 0o700);

            let symlink_key = fixture.key_dir.join(KEY_FILE_NAME);
            let target_key = fixture.key_dir.join("actual.key");
            std::fs::rename(&symlink_key, &target_key).expect("rename");
            std::os::unix::fs::symlink(&target_key, &symlink_key).expect("symlink");

            assert_eq!(vault.load().unwrap_err(), Kind::Corrupt);
        }
    }
}
