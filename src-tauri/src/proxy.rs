//! HTTP client for the Headroom proxy's `/stats` and `/health` endpoints.
//!
//! Hardening: loopback hosts only, no redirects, no system proxy, bounded
//! timeouts, bounded response size, and every string from the proxy is
//! sanitised before it reaches the UI.

use std::net::IpAddr;
use std::time::Duration;

use chrono::{DateTime, Utc};
use reqwest::header::ACCEPT;
use serde::Serialize;
use serde_json::Value;

pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(4);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_TEXT_CHARS: usize = 200;
const MAX_MODELS: usize = 8;

#[derive(Debug, thiserror::Error)]
pub enum ProxyError {
    #[error("{0:?} is not a loopback address; only local proxies are allowed")]
    NotLoopback(String),
    #[error("could not set up the HTTP client: {0}")]
    Client(String),
    #[error("proxy is not reachable: {0}")]
    Unreachable(String),
    #[error("proxy answered with HTTP {0}")]
    Status(u16),
    #[error("proxy response is larger than {} MB", MAX_BODY_BYTES / (1024 * 1024))]
    TooLarge,
    #[error("proxy response is not valid JSON: {0}")]
    InvalidJson(String),
}

pub fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

pub fn base_url(host: &str, port: u16) -> Result<String, ProxyError> {
    if !is_loopback_host(host) {
        return Err(ProxyError::NotLoopback(host.to_owned()));
    }
    Ok(if host.contains(':') { format!("http://[{host}]:{port}") } else { format!("http://{host}:{port}") })
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Savings {
    pub requests: u64,
    pub tokens_saved: u64,
    pub compression_usd: f64,
    pub cache_usd: f64,
    pub total_usd: f64,
    pub input_cost_usd: f64,
    pub savings_percent: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCount {
    pub name: String,
    pub requests: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub session: Savings,
    pub lifetime: Savings,
    pub session_started: Option<DateTime<Utc>>,
    pub session_last_activity: Option<DateTime<Utc>>,
    pub all_layers_saved: u64,
    pub all_layers_percent: Option<f64>,
    pub compression_saved: u64,
    pub tool_search_saved: u64,
    pub requests_total: u64,
    pub requests_cached: u64,
    pub requests_failed: u64,
    pub requests_rate_limited: u64,
    pub avg_latency_ms: Option<f64>,
    pub mode: Option<String>,
    pub primary_model: Option<String>,
    pub tip: Option<String>,
    pub version: Option<String>,
    pub healthy: bool,
    pub uptime_seconds: Option<f64>,
    pub models: Vec<ModelCount>,
}

// ---- tolerant JSON accessors ------------------------------------------------

fn dig<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter().try_fold(value, |v, key| v.get(key)).filter(|v| !v.is_null())
}

fn num(value: &Value, path: &[&str]) -> Option<f64> {
    dig(value, path).and_then(Value::as_f64).filter(|n| n.is_finite())
}

fn count(value: &Value, path: &[&str]) -> u64 {
    match dig(value, path) {
        Some(v) => {
            v.as_u64().or_else(|| v.as_f64().filter(|n| n.is_finite() && *n >= 0.0).map(|n| n as u64)).unwrap_or(0)
        }
        None => 0,
    }
}

fn money(value: &Value, path: &[&str]) -> f64 {
    num(value, path).filter(|n| *n >= 0.0).unwrap_or(0.0)
}

/// Bidi overrides/isolates and zero-width marks can make text render
/// differently from what it contains, so they are dropped with the controls.
fn is_invisible_format(c: char) -> bool {
    matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}

/// Strips control and bidi characters, collapses whitespace and caps the length.
pub fn sanitize_text(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !c.is_control() && !is_invisible_format(*c))
        .take(MAX_TEXT_CHARS)
        .collect();
    (!cleaned.is_empty()).then_some(cleaned)
}

fn text(value: &Value, path: &[&str]) -> Option<String> {
    dig(value, path).and_then(Value::as_str).and_then(sanitize_text)
}

fn timestamp(value: &Value, path: &[&str]) -> Option<DateTime<Utc>> {
    dig(value, path)
        .and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
}

fn savings(block: &Value) -> Savings {
    let compression_usd = money(block, &["compression_savings_usd"]);
    let cache_usd = money(block, &["cache_savings_usd"]);
    Savings {
        requests: count(block, &["requests"]),
        tokens_saved: count(block, &["tokens_saved"]),
        compression_usd,
        cache_usd,
        total_usd: compression_usd + cache_usd,
        input_cost_usd: money(block, &["total_input_cost_usd"]),
        savings_percent: num(block, &["savings_percent"]),
    }
}

/// Converts raw `/stats` (and optional `/health`) JSON into a [`Snapshot`].
/// Missing or malformed fields become zero / `None`; this never fails.
pub fn parse(stats: &Value, health: Option<&Value>) -> Snapshot {
    let empty = Value::Null;
    let session = dig(stats, &["display_session"])
        .or_else(|| dig(stats, &["persistent_savings", "display_session"]))
        .unwrap_or(&empty);
    let lifetime = dig(stats, &["persistent_savings", "lifetime"]).unwrap_or(&empty);
    let health = health.unwrap_or(&empty);

    let all_layers_saved = match count(stats, &["tokens", "all_layers_saved"]) {
        0 => count(stats, &["tokens", "saved"]),
        n => n,
    };

    let mut models: Vec<ModelCount> = dig(stats, &["requests", "by_model"])
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter(|(name, _)| !name.starts_with("passthrough:"))
                .filter_map(|(name, n)| Some(ModelCount { name: sanitize_text(name)?, requests: n.as_u64()? }))
                .collect()
        })
        .unwrap_or_default();
    models.sort_by(|a, b| b.requests.cmp(&a.requests).then_with(|| a.name.cmp(&b.name)));
    models.truncate(MAX_MODELS);

    Snapshot {
        session: savings(session),
        lifetime: savings(lifetime),
        session_started: timestamp(session, &["started_at"]),
        session_last_activity: timestamp(session, &["last_activity_at"]),
        all_layers_saved,
        all_layers_percent: num(stats, &["tokens", "all_layers_savings_percent"]),
        compression_saved: count(stats, &["tokens", "proxy_compression_saved"]),
        tool_search_saved: count(stats, &["savings", "by_layer", "tool_search", "tokens"]),
        requests_total: count(stats, &["requests", "total"]),
        requests_cached: count(stats, &["requests", "cached"]),
        requests_failed: count(stats, &["requests", "failed"]),
        requests_rate_limited: count(stats, &["requests", "rate_limited"]),
        avg_latency_ms: num(stats, &["latency", "average_ms"]).filter(|n| *n >= 0.0),
        mode: text(stats, &["summary", "mode"]),
        primary_model: text(stats, &["summary", "primary_model"]),
        tip: text(stats, &["summary", "tip"]),
        version: text(health, &["version"]),
        healthy: dig(health, &["status"]).and_then(Value::as_str).is_none_or(|s| s == "healthy"),
        uptime_seconds: num(health, &["uptime_seconds"]).filter(|n| *n >= 0.0),
        models,
    }
}

// ---- client ------------------------------------------------------------------

pub struct Client {
    http: reqwest::Client,
}

impl Client {
    pub fn new() -> Result<Self, ProxyError> {
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .user_agent(concat!("Trimbit/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| ProxyError::Client(e.to_string()))?;
        Ok(Self { http })
    }

    async fn get_json(&self, url: &str) -> Result<Value, ProxyError> {
        let mut response = self
            .http
            .get(url)
            .header(ACCEPT, "application/json")
            .send()
            .await
            .map_err(|e| ProxyError::Unreachable(e.without_url().to_string()))?;
        if !response.status().is_success() {
            return Err(ProxyError::Status(response.status().as_u16()));
        }
        if response.content_length().is_some_and(|n| n > MAX_BODY_BYTES as u64) {
            return Err(ProxyError::TooLarge);
        }
        let mut body = Vec::new();
        while let Some(chunk) =
            response.chunk().await.map_err(|e| ProxyError::Unreachable(e.without_url().to_string()))?
        {
            if body.len() + chunk.len() > MAX_BODY_BYTES {
                return Err(ProxyError::TooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body).map_err(|e| ProxyError::InvalidJson(e.to_string()))
    }

    /// Fetches `/stats` (required) and `/health` (best effort) from a loopback proxy.
    pub async fn fetch(&self, host: &str, port: u16) -> Result<Snapshot, ProxyError> {
        let base = base_url(host, port)?;
        let stats = self.get_json(&format!("{base}/stats")).await?;
        if !stats.is_object() {
            return Err(ProxyError::InvalidJson("expected a JSON object".into()));
        }
        let health = self.get_json(&format!("{base}/health")).await.ok();
        Ok(parse(&stats, health.as_ref()))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn stats_fixture() -> Value {
        json!({
            "summary": {"mode": "cache", "primary_model": "claude-fable-5-1", "tip": "Set HEADROOM_MODE=token"},
            "requests": {"total": 167, "cached": 149, "failed": 1, "rate_limited": 0,
                         "by_model": {"claude-fable-5-1": 72, "claude-sonnet-5": 55, "passthrough:count_tokens": 2}},
            "tokens": {"saved": 10_112_582, "all_layers_saved": 10_112_582, "all_layers_savings_percent": 9.61,
                       "proxy_compression_saved": 2_324_390},
            "savings": {"by_layer": {"tool_search": {"tokens": 7_788_192}}},
            "latency": {"average_ms": 15594.34},
            "display_session": {"requests": 52, "tokens_saved": 1_032_860, "compression_savings_usd": 11.34,
                                "cache_savings_usd": 84.13, "total_input_cost_usd": 91.8, "savings_percent": 3.59,
                                "started_at": "2026-09-23T16:56:49Z"},
            "persistent_savings": {"lifetime": {"requests": 178, "tokens_saved": 2_352_186,
                                                "compression_savings_usd": 32.2, "cache_savings_usd": 245.4}},
            "subscription_window": {"latest": {"token_prefix": "sk-ant-o"}}
        })
    }

    #[test]
    fn loopback_only() {
        for ok in ["127.0.0.1", "localhost", "LOCALHOST", "::1", "127.1.2.3"] {
            assert!(is_loopback_host(ok), "{ok}");
        }
        for bad in ["0.0.0.0", "192.168.1.10", "example.com", "localhost.evil.com", "", "[::1]", "127.0.0.1/x"] {
            assert!(!is_loopback_host(bad), "{bad}");
        }
        assert_eq!(base_url("::1", 8787).unwrap(), "http://[::1]:8787");
        assert!(matches!(base_url("10.0.0.1", 80), Err(ProxyError::NotLoopback(_))));
    }

    #[test]
    fn parses_full_payload() {
        let health = json!({"status": "healthy", "version": "0.37.0", "uptime_seconds": 270991.5});
        let s = parse(&stats_fixture(), Some(&health));
        assert_eq!(s.session.tokens_saved, 1_032_860);
        assert!((s.session.total_usd - 95.47).abs() < 1e-9);
        assert_eq!(s.session.savings_percent, Some(3.59));
        assert!(s.session_started.is_some());
        assert_eq!(s.lifetime.requests, 178);
        assert_eq!(s.all_layers_saved, 10_112_582);
        assert_eq!(s.tool_search_saved, 7_788_192);
        assert_eq!((s.requests_total, s.requests_cached, s.requests_failed), (167, 149, 1));
        assert_eq!(s.primary_model.as_deref(), Some("claude-fable-5-1"));
        assert_eq!(s.models.len(), 2);
        assert_eq!(s.models[0].name, "claude-fable-5-1");
        assert_eq!(s.version.as_deref(), Some("0.37.0"));
        assert!(s.healthy);
    }

    #[test]
    fn never_exposes_credentials() {
        let serialized = serde_json::to_string(&parse(&stats_fixture(), None)).unwrap();
        assert!(!serialized.contains("sk-ant"));
    }

    #[test]
    fn tolerates_garbage() {
        let s = parse(
            &json!({"tokens": null, "requests": "oops", "latency": {"average_ms": -5},
                    "display_session": {"started_at": "bad", "tokens_saved": -10, "cache_savings_usd": "x"}}),
            Some(&json!({"status": "degraded"})),
        );
        assert_eq!(s.session.tokens_saved, 0);
        assert_eq!(s.session.cache_usd, 0.0);
        assert_eq!(s.session_started, None);
        assert_eq!(s.avg_latency_ms, None);
        assert!(!s.healthy);
        assert_eq!(parse(&json!([]), None), Snapshot { healthy: true, ..Snapshot::default() });
    }

    #[test]
    fn falls_back_to_legacy_saved_key() {
        assert_eq!(parse(&json!({"tokens": {"saved": 42}}), None).all_layers_saved, 42);
    }

    #[test]
    fn sanitizes_text() {
        assert_eq!(sanitize_text("  a\u{0007}b \n\t c  ").as_deref(), Some("ab c"));
        assert_eq!(sanitize_text("\u{0000}\u{001b}"), None);
        assert_eq!(sanitize_text(&"x".repeat(1000)).map(|s| s.chars().count()), Some(MAX_TEXT_CHARS));
        let s = parse(&json!({"summary": {"mode": "<img src=x onerror=alert(1)>\u{202e}"}}), None);
        // Markup is kept as inert text (the UI only ever uses textContent); control chars are stripped.
        assert_eq!(s.mode.as_deref(), Some("<img src=x onerror=alert(1)>"));
    }

    /// Serves one canned HTTP response per connection.
    async fn serve(responses: Vec<(&'static str, String)>) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let mut buf = [0u8; 2048];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let body = responses
                    .iter()
                    .find(|(path, _)| request.starts_with(&format!("GET {path} ")))
                    .map(|(_, r)| r.clone())
                    .unwrap_or_else(|| "HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n".into());
                let _ = sock.write_all(body.as_bytes()).await;
            }
        });
        port
    }

    fn ok(body: &str) -> String {
        format!("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}", body.len())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn fetch_roundtrip_and_optional_health() {
        let port = serve(vec![("/stats", ok(&stats_fixture().to_string()))]).await;
        let s = Client::new().unwrap().fetch("127.0.0.1", port).await.unwrap();
        assert_eq!(s.session.requests, 52);
        assert_eq!(s.version, None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn does_not_follow_redirects() {
        let redirect = "HTTP/1.1 302 Found\r\nlocation: http://example.com/stats\r\ncontent-length: 0\r\n\r\n";
        let port = serve(vec![("/stats", redirect.to_string())]).await;
        let err = Client::new().unwrap().fetch("127.0.0.1", port).await.unwrap_err();
        assert!(matches!(err, ProxyError::Status(302)), "{err}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn rejects_oversized_and_invalid_bodies() {
        let big = format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n", MAX_BODY_BYTES + 1);
        let port = serve(vec![("/stats", big)]).await;
        let err = Client::new().unwrap().fetch("127.0.0.1", port).await.unwrap_err();
        assert!(matches!(err, ProxyError::TooLarge), "{err}");

        let port = serve(vec![("/stats", ok("not json"))]).await;
        let err = Client::new().unwrap().fetch("127.0.0.1", port).await.unwrap_err();
        assert!(matches!(err, ProxyError::InvalidJson(_)), "{err}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn refuses_non_loopback_without_connecting() {
        let err = Client::new().unwrap().fetch("93.184.216.34", 80).await.unwrap_err();
        assert!(matches!(err, ProxyError::NotLoopback(_)));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unreachable_port() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let err = Client::new().unwrap().fetch("127.0.0.1", port).await.unwrap_err();
        assert!(matches!(err, ProxyError::Unreachable(_)), "{err}");
    }
}
