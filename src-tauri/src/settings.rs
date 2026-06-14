use crate::llm::LlmProviderSettings;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const ENCRYPTED_SECRET_PREFIX: &str = "enc:v1:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    pub vault_root: String,
    pub active_path: String,
    pub active_view: String,
    pub active_category: String,
    pub llm_settings: LlmProviderSettings,
    pub default_category: String,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            vault_root: String::new(),
            active_path: String::new(),
            active_view: "today".to_string(),
            active_category: "journal".to_string(),
            llm_settings: LlmProviderSettings {
                provider_name: "OpenAI compatible".to_string(),
                api_base_url: "https://api.openai.com/v1".to_string(),
                api_key: String::new(),
                model: "gpt-4.1-mini".to_string(),
            },
            default_category: "knowledge".to_string(),
        }
    }
}

pub struct UserSettingsStore {
    conn: Connection,
    secret_key: [u8; 32],
}

impl UserSettingsStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create settings folder: {error}"))?;
        }
        let conn =
            Connection::open(path).map_err(|error| format!("failed to open settings: {error}"))?;
        let secret_key = load_or_create_secret_key(secret_key_path(path)?)?;
        let store = Self { conn, secret_key };
        store.create_schema()?;
        Ok(store)
    }

    pub fn load(&self) -> Result<UserSettings, String> {
        let mut settings = UserSettings::default();

        if let Some(vault_root) = self.get_value("vault_root")? {
            settings.vault_root = vault_root;
        }
        if let Some(active_path) = self.get_value("active_path")? {
            settings.active_path = active_path;
        }
        if let Some(active_view) = self.get_value("active_view")? {
            settings.active_view = active_view;
        }
        if let Some(active_category) = self.get_value("active_category")? {
            settings.active_category = active_category;
        }
        if let Some(default_category) = self.get_value("default_category")? {
            settings.default_category = default_category;
        }

        if let Some(llm_settings) = self.get_value("llm_settings")? {
            let mut llm_settings: LlmProviderSettings = serde_json::from_str(&llm_settings)
                .map_err(|error| format!("failed to parse LLM settings: {error}"))?;
            llm_settings.api_key = self.decrypt_api_key_if_needed(&llm_settings.api_key)?;
            settings.llm_settings = llm_settings;
        }

        Ok(settings)
    }

    pub fn save(&self, settings: &UserSettings) -> Result<(), String> {
        self.set_value("vault_root", &settings.vault_root)?;
        self.set_value("active_path", &settings.active_path)?;
        self.set_value("active_view", &settings.active_view)?;
        self.set_value("active_category", &settings.active_category)?;
        self.set_value("default_category", &settings.default_category)?;
        let mut llm_settings = settings.llm_settings.clone();
        llm_settings.api_key = self.encrypt_api_key(&llm_settings.api_key)?;
        let llm_settings = serde_json::to_string(&llm_settings)
            .map_err(|error| format!("failed to serialize LLM settings: {error}"))?;
        self.set_value("llm_settings", &llm_settings)?;
        Ok(())
    }

    fn create_schema(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS user_settings (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                ",
            )
            .map_err(|error| format!("failed to create settings schema: {error}"))
    }

    fn get_value(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT value FROM user_settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("failed to read setting {key}: {error}"))
    }

    fn set_value(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "
                INSERT INTO user_settings (key, value, updated_at)
                VALUES (?1, ?2, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET
                  value = excluded.value,
                  updated_at = excluded.updated_at
                ",
                params![key, value],
            )
            .map_err(|error| format!("failed to write setting {key}: {error}"))?;
        Ok(())
    }

    fn encrypt_api_key(&self, api_key: &str) -> Result<String, String> {
        if api_key.is_empty() {
            return Ok(String::new());
        }
        encrypt_secret(&self.secret_key, api_key)
    }

    fn decrypt_api_key_if_needed(&self, api_key: &str) -> Result<String, String> {
        if !api_key.starts_with(ENCRYPTED_SECRET_PREFIX) {
            return Ok(api_key.to_string());
        }
        decrypt_secret(&self.secret_key, api_key)
    }
}

fn secret_key_path(db_path: &Path) -> Result<PathBuf, String> {
    let parent = db_path
        .parent()
        .ok_or_else(|| "settings database path has no parent folder".to_string())?;
    Ok(parent.join("settings.key"))
}

fn load_or_create_secret_key(path: PathBuf) -> Result<[u8; 32], String> {
    if path.exists() {
        let encoded = std::fs::read_to_string(&path)
            .map_err(|error| format!("failed to read settings encryption key: {error}"))?;
        let decoded = BASE64
            .decode(encoded.trim())
            .map_err(|error| format!("failed to decode settings encryption key: {error}"))?;
        return decoded
            .try_into()
            .map_err(|_| "settings encryption key has invalid length".to_string());
    }

    let rng = SystemRandom::new();
    let mut key = [0u8; 32];
    rng.fill(&mut key)
        .map_err(|_| "failed to generate settings encryption key".to_string())?;
    std::fs::write(&path, BASE64.encode(key))
        .map_err(|error| format!("failed to write settings encryption key: {error}"))?;
    restrict_secret_key_permissions(&path)?;
    Ok(key)
}

#[cfg(unix)]
fn restrict_secret_key_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = std::fs::Permissions::from_mode(0o600);
    std::fs::set_permissions(path, permissions)
        .map_err(|error| format!("failed to restrict settings encryption key permissions: {error}"))
}

#[cfg(not(unix))]
fn restrict_secret_key_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn encrypt_secret(key: &[u8; 32], plaintext: &str) -> Result<String, String> {
    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| "failed to generate settings encryption nonce".to_string())?;

    let mut in_out = plaintext.as_bytes().to_vec();
    aead_key(key)?
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::empty(),
            &mut in_out,
        )
        .map_err(|_| "failed to encrypt API key".to_string())?;

    Ok(format!(
        "{ENCRYPTED_SECRET_PREFIX}{}:{}",
        BASE64.encode(nonce_bytes),
        BASE64.encode(in_out)
    ))
}

fn decrypt_secret(key: &[u8; 32], encrypted: &str) -> Result<String, String> {
    let payload = encrypted
        .strip_prefix(ENCRYPTED_SECRET_PREFIX)
        .ok_or_else(|| "API key is not encrypted".to_string())?;
    let (nonce, ciphertext) = payload
        .split_once(':')
        .ok_or_else(|| "encrypted API key has invalid format".to_string())?;
    let nonce: [u8; 12] = BASE64
        .decode(nonce)
        .map_err(|error| format!("failed to decode API key nonce: {error}"))?
        .try_into()
        .map_err(|_| "API key nonce has invalid length".to_string())?;
    let mut ciphertext = BASE64
        .decode(ciphertext)
        .map_err(|error| format!("failed to decode encrypted API key: {error}"))?;

    let plaintext = aead_key(key)?
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::empty(),
            &mut ciphertext,
        )
        .map_err(|_| "failed to decrypt API key".to_string())?;

    String::from_utf8(plaintext.to_vec())
        .map_err(|error| format!("decrypted API key is not valid UTF-8: {error}"))
}

fn aead_key(key: &[u8; 32]) -> Result<LessSafeKey, String> {
    let unbound = UnboundKey::new(&AES_256_GCM, key)
        .map_err(|_| "failed to initialize API key cipher".to_string())?;
    Ok(LessSafeKey::new(unbound))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn empty_store_returns_default_user_settings() {
        let dir = tempdir().unwrap();
        let store = UserSettingsStore::open(dir.path().join("settings.sqlite3")).unwrap();

        let settings = store.load().unwrap();

        assert_eq!(settings, UserSettings::default());
    }

    #[test]
    fn store_round_trips_user_settings() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.sqlite3");
        let store = UserSettingsStore::open(&path).unwrap();

        let settings = UserSettings {
            vault_root: "/Users/example/Notes".to_string(),
            active_path: "knowledge/current.md".to_string(),
            active_view: "category".to_string(),
            active_category: "knowledge".to_string(),
            llm_settings: LlmProviderSettings {
                provider_name: "Local".to_string(),
                api_base_url: "http://localhost:11434/v1".to_string(),
                api_key: "secret".to_string(),
                model: "llama3.1".to_string(),
            },
            default_category: "journal".to_string(),
        };

        store.save(&settings).unwrap();
        let reloaded = UserSettingsStore::open(path).unwrap().load().unwrap();

        assert_eq!(reloaded, settings);
    }

    #[test]
    fn store_does_not_write_api_key_in_plaintext() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.sqlite3");
        let store = UserSettingsStore::open(&path).unwrap();

        let settings = UserSettings {
            vault_root: "/Users/example/Notes".to_string(),
            active_path: "knowledge/current.md".to_string(),
            active_view: "today".to_string(),
            active_category: "journal".to_string(),
            llm_settings: LlmProviderSettings {
                provider_name: "OpenAI compatible".to_string(),
                api_base_url: "https://api.example.com/v1".to_string(),
                api_key: "sk-plain-secret".to_string(),
                model: "model-a".to_string(),
            },
            default_category: "knowledge".to_string(),
        };

        store.save(&settings).unwrap();

        let conn = Connection::open(&path).unwrap();
        let raw_json: String = conn
            .query_row(
                "SELECT value FROM user_settings WHERE key = 'llm_settings'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert!(!raw_json.contains("sk-plain-secret"));
        assert_eq!(
            store.load().unwrap().llm_settings.api_key,
            "sk-plain-secret"
        );
    }
}
