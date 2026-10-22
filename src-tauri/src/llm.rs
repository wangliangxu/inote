use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::OnceLock;
use tokio_util::sync::CancellationToken;

fn http_client() -> Result<reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(60))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|error| error.to_string())?;
    Ok(CLIENT.get_or_init(|| client).clone())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LlmProviderKind {
    OpenAiCompatible,
    Anthropic,
}

#[derive(Default)]
pub struct LlmRequestState {
    requests: Mutex<HashMap<String, CancellationToken>>,
}

impl LlmRequestState {
    pub fn register(&self, request_id: &str) -> Result<CancellationToken, String> {
        let token = CancellationToken::new();
        self.requests
            .lock()
            .map_err(|_| "failed to lock LLM request state".to_string())?
            .insert(request_id.to_string(), token.clone());
        Ok(token)
    }

    pub fn finish(&self, request_id: &str) {
        if let Ok(mut requests) = self.requests.lock() {
            requests.remove(request_id);
        }
    }

    pub fn cancel(&self, request_id: &str) -> Result<bool, String> {
        let requests = self
            .requests
            .lock()
            .map_err(|_| "failed to lock LLM request state".to_string())?;
        if let Some(token) = requests.get(request_id) {
            token.cancel();
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LlmStreamSummary {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub finish_reason: Option<String>,
    pub structured_output_mode: String,
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

    let provider = provider_kind(settings);
    let user_content = format!("Context:\n{context}\n\nTask:\n{prompt}");
    let (url, redacted_authorization, body) = match provider {
        LlmProviderKind::OpenAiCompatible => (
            format!("{base}/chat/completions"),
            "Bearer ****".to_string(),
            json!({
                "model": settings.model,
                "messages": [
                    { "role": "system", "content": "You are iNote's local-first writing assistant. Use only the provided context." },
                    { "role": "user", "content": user_content }
                ]
            }),
        ),
        LlmProviderKind::Anthropic => (
            if base.ends_with("/v1") {
                format!("{base}/messages")
            } else {
                format!("{base}/v1/messages")
            },
            "x-api-key: ****".to_string(),
            json!({
                "model": settings.model,
                "max_tokens": 8192,
                "system": "You are iNote's local-first writing assistant. Use only the provided context.",
                "messages": [{ "role": "user", "content": user_content }]
            }),
        ),
    };
    Ok(LlmRequestPreview {
        url,
        redacted_authorization,
        body,
    })
}

pub async fn send_chat_request(
    settings: &LlmProviderSettings,
    prompt: &str,
    context: &str,
) -> Result<LlmChatResponse, String> {
    let preview = build_chat_request_preview(settings, prompt, context)?;
    let client = http_client()?;
    let response = provider_request(&client, settings, &preview.url, &preview.body)
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

    extract_chat_content(&body, provider_kind(settings)).map(|content| LlmChatResponse { content })
}

pub async fn send_chat_request_stream(
    settings: &LlmProviderSettings,
    prompt: &str,
    context: &str,
    mut on_chunk: impl FnMut(String) + Send + 'static,
    cancellation: CancellationToken,
    structured_output: bool,
) -> Result<LlmStreamSummary, String> {
    let mut preview = build_chat_request_preview(settings, prompt, context)?;
    let provider = provider_kind(settings);
    if let Some(body) = preview.body.as_object_mut() {
        body.insert("stream".to_string(), json!(true));
        if structured_output && provider == LlmProviderKind::OpenAiCompatible {
            body.insert("response_format".to_string(), agent_response_format());
            body.insert(
                "stream_options".to_string(),
                json!({ "include_usage": true }),
            );
        }
    }

    let mut structured_output_mode =
        if structured_output && provider == LlmProviderKind::OpenAiCompatible {
            "json_schema"
        } else {
            "prompt"
        }
        .to_string();

    let client = http_client()?;
    let request = provider_request(&client, settings, &preview.url, &preview.body).send();
    let mut response = tokio::select! {
        _ = cancellation.cancelled() => return Err("LLM request cancelled".to_string()),
        response = request => response.map_err(|error| format!("failed to call LLM API: {error}"))?,
    };

    if provider == LlmProviderKind::OpenAiCompatible
        && structured_output
        && matches!(response.status().as_u16(), 400 | 422)
    {
        if let Some(body) = preview.body.as_object_mut() {
            body.insert(
                "response_format".to_string(),
                json!({ "type": "json_object" }),
            );
        }
        structured_output_mode = "json_object".to_string();
        let fallback = provider_request(&client, settings, &preview.url, &preview.body).send();
        response = tokio::select! {
            _ = cancellation.cancelled() => return Err("LLM request cancelled".to_string()),
            response = fallback => response.map_err(|error| format!("failed to call LLM API: {error}"))?,
        };
    }

    if provider == LlmProviderKind::OpenAiCompatible
        && structured_output
        && matches!(response.status().as_u16(), 400 | 422)
    {
        if let Some(body) = preview.body.as_object_mut() {
            body.remove("response_format");
            body.remove("stream_options");
        }
        structured_output_mode = "prompt".to_string();
        let fallback = provider_request(&client, settings, &preview.url, &preview.body).send();
        response = tokio::select! {
            _ = cancellation.cancelled() => return Err("LLM request cancelled".to_string()),
            response = fallback => response.map_err(|error| format!("failed to call LLM API: {error}"))?,
        };
    }

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

    let mut decoder = crate::sse::SseDecoder::default();
    let mut summary = LlmStreamSummary {
        structured_output_mode,
        ..LlmStreamSummary::default()
    };
    loop {
        let chunk = tokio::select! {
            _ = cancellation.cancelled() => return Err("LLM request cancelled".to_string()),
            chunk = response.chunk() => chunk.map_err(|error| format!("failed to read LLM stream: {error}"))?,
        };
        let Some(chunk) = chunk else { break };
        for data in decoder.feed(&chunk)? {
            if data == "[DONE]" {
                continue;
            }
            let value = serde_json::from_str::<Value>(&data)
                .map_err(|error| format!("invalid LLM stream event: {error}"))?;
            if let Some(content) = parse_stream_event(&value, provider, &mut summary) {
                on_chunk(content);
            }
        }
    }

    for data in decoder.finish()? {
        if data == "[DONE]" {
            continue;
        }
        let value = serde_json::from_str::<Value>(&data)
            .map_err(|error| format!("invalid final LLM stream event: {error}"))?;
        if let Some(content) = parse_stream_event(&value, provider, &mut summary) {
            on_chunk(content);
        }
    }

    Ok(summary)
}

fn agent_response_format() -> Value {
    json!({
        "type": "json_schema",
        "json_schema": {
            "name": "inote_agent_step_v1",
            "strict": true,
            "schema": {
                "type": "object",
                "properties": {
                    "version": { "type": "integer", "const": 1 },
                    "message": { "type": "string" },
                    "operations": {
                        "anyOf": [{
                            "type": "array",
                            "maxItems": 12,
                            "items": {
                            "anyOf": [
                                {
                                    "type": "object",
                                    "properties": {
                                        "type": { "type": "string", "const": "update_current_note" },
                                        "patch": {
                                            "type": "object",
                                            "properties": {
                                                "title": { "type": ["string", "null"] },
                                                "category": { "type": ["string", "null"] },
                                                "tags": { "anyOf": [{ "type": "array", "items": { "type": "string" } }, { "type": "null" }] },
                                                "summary": { "type": ["string", "null"] },
                                                "due": { "type": ["string", "null"] },
                                                "status": { "anyOf": [{ "type": "string", "enum": ["todo", "in_progress", "done", "cancelled"] }, { "type": "null" }] },
                                                "priority": { "anyOf": [{ "type": "string", "enum": ["none", "low", "medium", "high"] }, { "type": "null" }] },
                                                "project": { "type": ["string", "null"] }
                                            },
                                            "required": ["title", "category", "tags", "summary", "due", "status", "priority", "project"],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": ["type", "patch"],
                                    "additionalProperties": false
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "type": { "type": "string", "enum": ["append_to_current_note", "replace_current_note_body", "suggest_only"] },
                                        "markdown": { "type": "string", "maxLength": 50000 }
                                    },
                                    "required": ["type", "markdown"],
                                    "additionalProperties": false
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "type": { "type": "string", "const": "create_note" },
                                        "note": {
                                            "type": "object",
                                            "properties": {
                                                "title": { "type": "string", "maxLength": 200 },
                                                "category": { "type": "string", "maxLength": 500 },
                                                "tags": { "anyOf": [{ "type": "array", "maxItems": 30, "items": { "type": "string" } }, { "type": "null" }] },
                                                "summary": { "type": ["string", "null"] },
                                                "body": { "type": "string", "maxLength": 50000 },
                                                "linkBackToCurrent": { "type": ["boolean", "null"] }
                                            },
                                            "required": ["title", "category", "tags", "summary", "body", "linkBackToCurrent"],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": ["type", "note"],
                                    "additionalProperties": false
                                }
                            ]
                            }
                        }, { "type": "null" }]
                    },
                    "toolCalls": {
                        "anyOf": [{
                            "type": "array",
                            "maxItems": 8,
                            "items": {
                                "anyOf": [
                                    {
                                        "type": "object",
                                        "properties": {
                                            "id": { "type": "string" },
                                            "name": { "type": "string", "const": "search_notes" },
                                            "arguments": {
                                                "type": "object",
                                                "properties": {
                                                    "query": { "type": "string" },
                                                    "limit": { "type": ["integer", "null"], "minimum": 1, "maximum": 5 }
                                                },
                                                "required": ["query", "limit"],
                                                "additionalProperties": false
                                            }
                                        },
                                        "required": ["id", "name", "arguments"],
                                        "additionalProperties": false
                                    },
                                    {
                                        "type": "object",
                                        "properties": {
                                            "id": { "type": "string" },
                                            "name": { "type": "string", "enum": ["read_note", "list_backlinks"] },
                                            "arguments": {
                                                "type": "object",
                                                "properties": { "path": { "type": "string" } },
                                                "required": ["path"],
                                                "additionalProperties": false
                                            }
                                        },
                                        "required": ["id", "name", "arguments"],
                                        "additionalProperties": false
                                    }
                                ]
                            }
                        }, { "type": "null" }]
                    }
                },
                "required": ["version", "message", "operations", "toolCalls"],
                "additionalProperties": false
            }
        }
    })
}

fn extract_chat_content(body: &str, provider: LlmProviderKind) -> Result<String, String> {
    let value = serde_json::from_str::<Value>(body)
        .map_err(|error| format!("failed to parse LLM API response: {error}"))?;
    let content = match provider {
        LlmProviderKind::OpenAiCompatible => value["choices"][0]["message"]["content"].as_str(),
        LlmProviderKind::Anthropic => value["content"][0]["text"].as_str(),
    };
    content
        .map(ToOwned::to_owned)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "LLM API response did not include message content".to_string())
}

fn provider_kind(settings: &LlmProviderSettings) -> LlmProviderKind {
    let name = settings.provider_name.to_ascii_lowercase();
    let base = settings.api_base_url.to_ascii_lowercase();
    if name.contains("anthropic") || base.contains("api.anthropic.com") {
        LlmProviderKind::Anthropic
    } else {
        LlmProviderKind::OpenAiCompatible
    }
}

fn provider_request(
    client: &reqwest::Client,
    settings: &LlmProviderSettings,
    url: &str,
    body: &Value,
) -> reqwest::RequestBuilder {
    let request = client.post(url).json(body);
    match provider_kind(settings) {
        LlmProviderKind::OpenAiCompatible => request.bearer_auth(settings.api_key.trim()),
        LlmProviderKind::Anthropic => request
            .header("x-api-key", settings.api_key.trim())
            .header("anthropic-version", "2023-06-01"),
    }
}

fn parse_stream_event(
    value: &Value,
    provider: LlmProviderKind,
    summary: &mut LlmStreamSummary,
) -> Option<String> {
    match provider {
        LlmProviderKind::OpenAiCompatible => {
            if let Some(reason) = value["choices"][0]["finish_reason"].as_str() {
                summary.finish_reason = Some(reason.to_string());
            }
            if let Some(usage) = value.get("usage") {
                summary.input_tokens = usage
                    .get("prompt_tokens")
                    .or_else(|| usage.get("input_tokens"))
                    .and_then(Value::as_u64);
                summary.output_tokens = usage
                    .get("completion_tokens")
                    .or_else(|| usage.get("output_tokens"))
                    .and_then(Value::as_u64);
            }
            value["choices"][0]["delta"]["content"]
                .as_str()
                .map(ToOwned::to_owned)
        }
        LlmProviderKind::Anthropic => {
            if value["type"] == "message_start" {
                summary.input_tokens = value["message"]["usage"]["input_tokens"].as_u64();
            }
            if value["type"] == "message_delta" {
                summary.finish_reason = value["delta"]["stop_reason"].as_str().map(|reason| {
                    if reason == "max_tokens" {
                        "length".to_string()
                    } else {
                        reason.to_string()
                    }
                });
                summary.output_tokens = value["usage"]["output_tokens"].as_u64();
            }
            if value["type"] == "content_block_delta" && value["delta"]["type"] == "text_delta" {
                return value["delta"]["text"].as_str().map(ToOwned::to_owned);
            }
            None
        }
    }
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
            LlmProviderKind::OpenAiCompatible,
        )
        .unwrap();

        assert_eq!(content, "Summary text");
    }

    #[test]
    fn rejects_response_without_message_content() {
        assert_eq!(
            extract_chat_content(
                r#"{"choices":[{"message":{}}]}"#,
                LlmProviderKind::OpenAiCompatible
            )
            .unwrap_err(),
            "LLM API response did not include message content"
        );
    }

    #[test]
    fn request_state_registers_cancels_and_finishes_requests() {
        let state = LlmRequestState::default();
        let token = state.register("turn-1").unwrap();
        assert!(!token.is_cancelled());
        assert!(state.cancel("turn-1").unwrap());
        assert!(token.is_cancelled());
        state.finish("turn-1");
        assert!(!state.cancel("turn-1").unwrap());
    }

    #[test]
    fn agent_response_format_uses_strict_versioned_json_schema() {
        let format = agent_response_format();
        assert_eq!(format["type"], "json_schema");
        assert_eq!(format["json_schema"]["strict"], true);
        assert_eq!(
            format["json_schema"]["schema"]["properties"]["version"]["const"],
            1
        );
        assert_eq!(
            format["json_schema"]["schema"]["properties"]["operations"]["anyOf"][0]["maxItems"],
            12
        );
    }

    #[test]
    fn builds_and_parses_anthropic_messages_requests() {
        let mut settings = settings();
        settings.provider_name = "Anthropic".to_string();
        settings.api_base_url = "https://api.anthropic.com/v1".to_string();
        settings.model = "claude-sonnet-4-5".to_string();
        let preview = build_chat_request_preview(&settings, "Summarize", "Note body").unwrap();
        assert_eq!(preview.url, "https://api.anthropic.com/v1/messages");
        assert_eq!(preview.body["max_tokens"], 8192);
        assert_eq!(
            extract_chat_content(
                r#"{"content":[{"type":"text","text":"Summary"}]}"#,
                LlmProviderKind::Anthropic,
            )
            .unwrap(),
            "Summary"
        );
    }

    #[test]
    fn parses_anthropic_stream_events_and_usage() {
        let mut summary = LlmStreamSummary::default();
        parse_stream_event(
            &json!({"type":"message_start","message":{"usage":{"input_tokens":12}}}),
            LlmProviderKind::Anthropic,
            &mut summary,
        );
        let text = parse_stream_event(
            &json!({"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}),
            LlmProviderKind::Anthropic,
            &mut summary,
        );
        parse_stream_event(
            &json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}),
            LlmProviderKind::Anthropic,
            &mut summary,
        );
        assert_eq!(text.as_deref(), Some("hello"));
        assert_eq!(summary.input_tokens, Some(12));
        assert_eq!(summary.output_tokens, Some(4));
        assert_eq!(summary.finish_reason.as_deref(), Some("end_turn"));
    }
}
