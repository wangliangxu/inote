use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderSettings {
    pub provider_name: String,
    pub api_base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmRequestPreview {
    pub url: String,
    pub redacted_authorization: String,
    pub body: Value,
}

pub fn build_chat_request_preview(
    settings: &LlmProviderSettings,
    prompt: &str,
    context: &str,
) -> Result<LlmRequestPreview, String> {
    if settings.api_key.trim().is_empty() {
        return Err("LLM API key is required".to_string());
    }
    if settings.model.trim().is_empty() {
        return Err("LLM model is required".to_string());
    }

    let base = settings.api_base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("LLM API base URL is required".to_string());
    }

    Ok(LlmRequestPreview {
        url: format!("{base}/chat/completions"),
        redacted_authorization: "Bearer ****".to_string(),
        body: json!({
            "model": settings.model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are iNote's local-first writing assistant. Use only the provided context."
                },
                {
                    "role": "user",
                    "content": format!("Context:\n{context}\n\nTask:\n{prompt}")
                }
            ]
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> LlmProviderSettings {
        LlmProviderSettings {
            provider_name: "OpenAI compatible".to_string(),
            api_base_url: "https://api.example.com/v1/".to_string(),
            api_key: "secret".to_string(),
            model: "model-a".to_string(),
        }
    }

    #[test]
    fn builds_openai_compatible_chat_request() {
        let preview = build_chat_request_preview(&settings(), "Summarize", "Note body").unwrap();

        assert_eq!(preview.url, "https://api.example.com/v1/chat/completions");
        assert_eq!(preview.redacted_authorization, "Bearer ****");
        assert_eq!(preview.body["model"], "model-a");
        assert!(preview.body["messages"][1]["content"].as_str().unwrap().contains("Note body"));
    }

    #[test]
    fn requires_api_key() {
        let mut settings = settings();
        settings.api_key.clear();

        assert_eq!(
            build_chat_request_preview(&settings, "Summarize", "Note").unwrap_err(),
            "LLM API key is required"
        );
    }
}
