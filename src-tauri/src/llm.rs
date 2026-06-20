use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderSettings {
    pub provider_name: String,
    pub api_base_url: String,
    pub api_key: String,
    pub model: String,
    pub max_context_length: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmRequestPreview {
    pub url: String,
    pub redacted_authorization: String,
    pub body: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatResponse {
    pub content: String,
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

pub async fn send_chat_request(
    settings: &LlmProviderSettings,
    prompt: &str,
    context: &str,
) -> Result<LlmChatResponse, String> {
    let preview = build_chat_request_preview(settings, prompt, context)?;
    let response = reqwest::Client::new()
        .post(&preview.url)
        .bearer_auth(settings.api_key.trim())
        .json(&preview.body)
        .send()
        .await
        .map_err(|error| format!("failed to call LLM API: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("failed to read LLM API response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "LLM API returned {status}: {}",
            compact_error_body(&body)
        ));
    }

    extract_chat_content(&body).map(|content| LlmChatResponse { content })
}

pub async fn send_chat_request_stream(
    settings: &LlmProviderSettings,
    prompt: &str,
    context: &str,
    mut on_chunk: impl FnMut(String) + Send + 'static,
) -> Result<(), String> {
    let mut preview = build_chat_request_preview(settings, prompt, context)?;
    if let Some(body) = preview.body.as_object_mut() {
        body.insert("stream".to_string(), json!(true));
    }

    let mut response = reqwest::Client::new()
        .post(&preview.url)
        .bearer_auth(settings.api_key.trim())
        .json(&preview.body)
        .send()
        .await
        .map_err(|error| format!("failed to call LLM API: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        return Err(format!(
            "LLM API returned {status}: {}",
            compact_error_body(&body)
        ));
    }

    let mut buffer = String::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].to_string();
            buffer = buffer[pos + 1..].to_string();

            let line = line.trim();
            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" {
                    continue;
                }
                if let Ok(value) = serde_json::from_str::<Value>(data) {
                    if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
                        on_chunk(content.to_string());
                    }
                }
            }
        }
    }

    Ok(())
}

fn extract_chat_content(body: &str) -> Result<String, String> {
    let value = serde_json::from_str::<Value>(body)
        .map_err(|error| format!("failed to parse LLM API response: {error}"))?;
    value["choices"][0]["message"]["content"]
        .as_str()
        .map(ToOwned::to_owned)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "LLM API response did not include message content".to_string())
}

fn compact_error_body(body: &str) -> String {
    body.trim().chars().take(500).collect()
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
            max_context_length: Some(10000),
        }
    }

    #[test]
    fn builds_openai_compatible_chat_request() {
        let preview = build_chat_request_preview(&settings(), "Summarize", "Note body").unwrap();

        assert_eq!(preview.url, "https://api.example.com/v1/chat/completions");
        assert_eq!(preview.redacted_authorization, "Bearer ****");
        assert_eq!(preview.body["model"], "model-a");
        assert!(preview.body["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("Note body"));
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

    #[test]
    fn extracts_chat_content_from_openai_compatible_response() {
        let content = extract_chat_content(
            r#"{"choices":[{"message":{"role":"assistant","content":"Summary text"}}]}"#,
        )
        .unwrap();

        assert_eq!(content, "Summary text");
    }

    #[test]
    fn rejects_response_without_message_content() {
        assert_eq!(
            extract_chat_content(r#"{"choices":[{"message":{}}]}"#).unwrap_err(),
            "LLM API response did not include message content"
        );
    }
}
