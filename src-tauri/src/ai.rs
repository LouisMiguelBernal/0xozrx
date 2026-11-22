//! Local Ollama client: model discovery, warm-up, introspection, chat.
//! Requests go ONLY to the user-configured endpoint (default localhost).
//!
//! The workstation is tuned for `gemma4:e4b` (8B MoE, Q4_K_M, ~9 GB) which is
//! the verified local model on this machine. Discovery still degrades
//! gracefully to any other Gemma, then to whatever is installed.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Map, Value};

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(timeout).build()
}

fn valid_endpoint(endpoint: &str) -> bool {
    endpoint.starts_with("http://") || endpoint.starts_with("https://")
}

/// Exact tags tried first, in order. Anything below falls back to substring
/// matching so a `gemma4:e4b-instruct-q5` style local retag still wins.
pub const PREFERRED_MODELS: &[&str] = &["gemma4:e4b", "gemma3n:e4b", "gemma3:4b"];

/// Substring rules applied after exact-tag matching, most specific first.
const PREFERRED_FRAGMENTS: &[&str] = &["gemma4", "e4b", "gemma3n", "gemma"];

/// How long Ollama keeps the model resident after a request. Loading
/// gemma4:e4b costs ~9 GB of VRAM traffic, so we hold it for a while.
const DEFAULT_KEEP_ALIVE: &str = "30m";

fn list_models(endpoint: &str, timeout: Duration) -> Vec<String> {
    let url = format!("{}/api/tags", endpoint.trim_end_matches('/'));
    match agent(timeout).get(&url).call() {
        Ok(resp) => resp
            .into_json::<Value>()
            .ok()
            .and_then(|v| v["models"].as_array().cloned())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["name"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        Err(_) => vec![],
    }
}

/// Rank an installed model list against the preference order.
fn choose(models: &[String]) -> (Option<String>, &'static str) {
    for want in PREFERRED_MODELS {
        if let Some(m) = models.iter().find(|m| m.eq_ignore_ascii_case(want)) {
            return (Some(m.clone()), "preferred tag");
        }
    }
    for frag in PREFERRED_FRAGMENTS {
        if let Some(m) = models.iter().find(|m| m.to_lowercase().contains(frag)) {
            return (Some(m.clone()), "preferred family");
        }
    }
    (models.first().cloned(), "first installed")
}

#[derive(Serialize)]
pub struct ModelPick {
    model: Option<String>,
    reason: String,
    models: Vec<String>,
    /// True when the selection is the tag this workstation is tuned for.
    preferred: bool,
    /// The tag to `ollama pull` when nothing suitable is installed.
    recommended: &'static str,
}

/// Pick the preferred local model: gemma4:e4b > gemma family > first available.
#[tauri::command]
pub fn pick_model(endpoint: String) -> ModelPick {
    let recommended = PREFERRED_MODELS[0];
    if !valid_endpoint(&endpoint) {
        return ModelPick {
            model: None,
            reason: "invalid endpoint".into(),
            models: vec![],
            preferred: false,
            recommended,
        };
    }
    let models = list_models(&endpoint, Duration::from_secs(3));
    if models.is_empty() {
        return ModelPick {
            model: None,
            reason: format!("offline or no models - pull {recommended}"),
            models,
            preferred: false,
            recommended,
        };
    }
    let (pick, reason) = choose(&models);
    let preferred = pick
        .as_deref()
        .map(|m| m.eq_ignore_ascii_case(recommended))
        .unwrap_or(false);
    ModelPick {
        model: pick,
        reason: reason.into(),
        models,
        preferred,
        recommended,
    }
}

#[derive(Serialize)]
pub struct ModelInfo {
    model: String,
    family: Option<String>,
    parameter_size: Option<String>,
    quantization: Option<String>,
    context_length: Option<u64>,
    capabilities: Vec<String>,
    /// True when the model advertises Ollama's reasoning mode.
    thinking: bool,
}

/// Introspect one local model via /api/show (no generation, no load).
#[tauri::command]
pub fn model_info(endpoint: String, model: String) -> Result<ModelInfo, String> {
    if !valid_endpoint(&endpoint) {
        return Err("endpoint must be http(s)".into());
    }
    if model.trim().is_empty() || model.len() > 120 {
        return Err("model tag 1..120 chars".into());
    }
    let url = format!("{}/api/show", endpoint.trim_end_matches('/'));
    let resp = agent(Duration::from_secs(10))
        .post(&url)
        .set("Content-Type", "application/json")
        .send_string(&json!({ "model": model }).to_string())
        .map_err(|e| format!("ollama /api/show failed: {e}"))?;
    let v: Value = resp.into_json().map_err(|e| format!("bad response: {e}"))?;

    let capabilities: Vec<String> = v["capabilities"]
        .as_array()
        .map(|a| a.iter().filter_map(|c| c.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    // context length lives under model_info as "<family>.context_length"
    let context_length = v["model_info"]
        .as_object()
        .and_then(|m| {
            m.iter()
                .find(|(k, _)| k.ends_with(".context_length"))
                .and_then(|(_, v)| v.as_u64())
        });

    Ok(ModelInfo {
        thinking: capabilities.iter().any(|c| c == "thinking"),
        model,
        family: v["details"]["family"].as_str().map(str::to_string),
        parameter_size: v["details"]["parameter_size"].as_str().map(str::to_string),
        quantization: v["details"]["quantization_level"].as_str().map(str::to_string),
        context_length,
        capabilities,
    })
}

#[derive(Serialize)]
pub struct WarmResult {
    model: String,
    loaded: bool,
    load_ms: u64,
    error: Option<String>,
}

/// Preload a model into VRAM so the first real question is not a cold start.
/// Sends an empty prompt, which Ollama treats as "load only".
#[tauri::command]
pub fn warm_model(
    endpoint: String,
    model: String,
    keep_alive: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<WarmResult, String> {
    if !valid_endpoint(&endpoint) {
        return Err("endpoint must be http(s)".into());
    }
    if model.trim().is_empty() || model.len() > 120 {
        return Err("model tag 1..120 chars".into());
    }
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(600).clamp(5, 900));
    let url = format!("{}/api/generate", endpoint.trim_end_matches('/'));
    let body = json!({
        "model": model,
        "prompt": "",
        "stream": false,
        "keep_alive": keep_alive.as_deref().unwrap_or(DEFAULT_KEEP_ALIVE),
    });
    let started = std::time::Instant::now();
    match agent(timeout)
        .post(&url)
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
    {
        Ok(_) => Ok(WarmResult {
            model,
            loaded: true,
            load_ms: started.elapsed().as_millis() as u64,
            error: None,
        }),
        Err(e) => Ok(WarmResult {
            model,
            loaded: false,
            load_ms: started.elapsed().as_millis() as u64,
            error: Some(e.to_string()),
        }),
    }
}

#[derive(Serialize)]
pub struct AiReply {
    content: String,
    /// Reasoning trace, present only when the caller asked for thinking mode.
    thinking: Option<String>,
    model: String,
    latency_ms: u64,
    prompt_tokens: Option<u64>,
    response_tokens: Option<u64>,
    /// Nanoseconds Ollama spent loading the model (large => cold start).
    load_ms: Option<u64>,
    done_reason: Option<String>,
}

/// Sampling knobs forwarded to Ollama. Only a vetted subset is accepted so an
/// arbitrary object can never be injected into the request body.
fn sanitize_options(raw: Option<Value>) -> Map<String, Value> {
    let mut out = Map::new();
    // Deterministic-ish defaults: security analysis should not free-associate.
    out.insert("temperature".into(), json!(0.4));
    out.insert("top_p".into(), json!(0.9));
    out.insert("num_ctx".into(), json!(8192));

    let Some(Value::Object(src)) = raw else { return out };
    for key in ["temperature", "top_p", "top_k", "num_ctx", "num_predict", "repeat_penalty", "seed"] {
        if let Some(v) = src.get(key) {
            if v.is_number() {
                out.insert(key.to_string(), v.clone());
            }
        }
    }
    out
}

#[tauri::command]
pub fn ai_chat(
    endpoint: String,
    model: String,
    messages: Vec<Value>,
    timeout_secs: Option<u64>,
    options: Option<Value>,
    keep_alive: Option<String>,
    think: Option<bool>,
) -> Result<AiReply, String> {
    if !valid_endpoint(&endpoint) {
        return Err("endpoint must be http(s)".into());
    }
    if messages.is_empty() || messages.len() > 40 {
        return Err("messages count 1..40".into());
    }
    let total_chars: usize = messages.iter().map(|m| m.to_string().len()).sum();
    if total_chars > 256_000 {
        return Err("context too large (redact/trim first)".into());
    }
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(180).clamp(5, 900));
    let url = format!("{}/api/chat", endpoint.trim_end_matches('/'));
    let started = std::time::Instant::now();

    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": false,
        "options": Value::Object(sanitize_options(options)),
        "keep_alive": keep_alive.as_deref().unwrap_or(DEFAULT_KEEP_ALIVE),
    });
    // Only sent when the caller opted in: older Ollama builds reject the key.
    if let Some(t) = think {
        body["think"] = json!(t);
    }

    let resp = agent(timeout)
        .post(&url)
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(|e| format!("ollama request failed: {e}"))?;
    let v: Value = resp.into_json().map_err(|e| format!("bad ollama response: {e}"))?;

    let thinking = v["message"]["thinking"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string);

    Ok(AiReply {
        content: v["message"]["content"].as_str().unwrap_or("").to_string(),
        thinking,
        model,
        latency_ms: started.elapsed().as_millis() as u64,
        prompt_tokens: v["prompt_eval_count"].as_u64(),
        response_tokens: v["eval_count"].as_u64(),
        load_ms: v["load_duration"].as_u64().map(|ns| ns / 1_000_000),
        done_reason: v["done_reason"].as_str().map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn exact_preferred_tag_wins() {
        let (pick, reason) = choose(&v(&["llama3:8b", "gemma3:4b", "gemma4:e4b"]));
        assert_eq!(pick.as_deref(), Some("gemma4:e4b"));
        assert_eq!(reason, "preferred tag");
    }

    #[test]
    fn retagged_gemma4_wins_by_fragment() {
        let (pick, _) = choose(&v(&["llama3:8b", "gemma4:e4b-q5_k_m"]));
        assert_eq!(pick.as_deref(), Some("gemma4:e4b-q5_k_m"));
    }

    #[test]
    fn falls_back_to_first_when_no_gemma() {
        let (pick, reason) = choose(&v(&["llama3:8b", "qwen2:7b"]));
        assert_eq!(pick.as_deref(), Some("llama3:8b"));
        assert_eq!(reason, "first installed");
    }

    #[test]
    fn empty_list_picks_nothing() {
        assert!(choose(&[]).0.is_none());
    }

    #[test]
    fn options_are_allowlisted_and_defaulted() {
        let opts = sanitize_options(Some(json!({
            "temperature": 0.1,
            "num_ctx": 4096,
            "evil": "rm -rf",
            "top_p": "not-a-number"
        })));
        assert_eq!(opts["temperature"], json!(0.1));
        assert_eq!(opts["num_ctx"], json!(4096));
        assert_eq!(opts["top_p"], json!(0.9), "non-numeric override ignored");
        assert!(!opts.contains_key("evil"));
    }

    #[test]
    fn options_default_when_absent() {
        let opts = sanitize_options(None);
        assert_eq!(opts["temperature"], json!(0.4));
        assert_eq!(opts["num_ctx"], json!(8192));
    }
}
