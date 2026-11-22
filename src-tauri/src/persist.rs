//! File-backed persistence: scan records, baseline, audit log.
//!
//! Stored under the OS app-data dir for the app identifier, in human-readable
//! JSON (scans as individual files + index.json, audit as JSONL). Deliberately
//! simple and diffable; a SQLite backend can replace this module without
//! touching callers (same command surface).

use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

static SEQ: AtomicU64 = AtomicU64::new(1);

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn store_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("data dir: {e}"))?;
    Ok(base.join("store"))
}

fn ensure(dir: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("mkdir: {e}"))
}

#[tauri::command]
pub fn save_scan(app: AppHandle, record: Value) -> Result<Value, String> {
    let dir = store_dir(&app)?.join("scans");
    ensure(&dir)?;
    let ts_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let id = format!("scan-{ts_ms:x}-{seq}");
    let mut rec = record;
    if rec.is_null() {
        return Err("empty record".into());
    }
    if serde_json::to_vec(&rec).map_err(|e| e.to_string())?.len() > 4 * 1024 * 1024 {
        return Err("record too large".into());
    }
    rec["id"] = json!(id);
    fs::write(dir.join(format!("{id}.json")), serde_json::to_string_pretty(&rec).map_err(|e| e.to_string())?)
        .map_err(|e| format!("write: {e}"))?;

    // update index
    let idx_path = dir.join("index.json");
    let mut idx: Vec<Value> = fs::read_to_string(&idx_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let findings = rec.get("findings").and_then(|f| f.as_array()).map(|a| a.len()).unwrap_or(0);
    idx.push(json!({
        "id": id,
        "kind": rec.get("kind").cloned().unwrap_or(json!("?")),
        "startedAt": rec.get("startedAt").cloned().unwrap_or(json!(ts_ms)),
        "findings": findings,
        "score": rec.get("score").and_then(|s| s.get("total")).cloned().unwrap_or(json!(null)),
    }));
    if idx.len() > 200 {
        let excess = idx.len() - 200;
        idx.drain(0..excess);
    }
    fs::write(&idx_path, serde_json::to_string(&idx).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(rec)
}

#[tauri::command]
pub fn list_scans(app: AppHandle) -> Result<Vec<Value>, String> {
    let idx_path = store_dir(&app)?.join("scans").join("index.json");
    let raw = fs::read_to_string(idx_path).unwrap_or_else(|_| "[]".into());
    let mut v: Vec<Value> = serde_json::from_str(&raw).unwrap_or_default();
    v.reverse();
    Ok(v.into_iter().take(100).collect())
}

#[tauri::command]
pub fn get_scan(app: AppHandle, id: String) -> Result<Value, String> {
    if !valid_id(&id) {
        return Err("invalid id".into());
    }
    let p = store_dir(&app)?.join("scans").join(format!("{id}.json"));
    let raw = fs::read_to_string(p).map_err(|_| "not found".to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_baseline(app: AppHandle, snapshot: Value) -> Result<(), String> {
    let dir = store_dir(&app)?;
    ensure(&dir)?;
    fs::write(dir.join("baseline.json"), serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_baseline(app: AppHandle) -> Result<Value, String> {
    let p = store_dir(&app)?.join("baseline.json");
    match fs::read_to_string(p) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        Err(_) => Ok(Value::Null),
    }
}

#[tauri::command]
pub fn audit_append(app: AppHandle, action: String, detail: Option<Value>) -> Result<(), String> {
    let dir = store_dir(&app)?;
    ensure(&dir)?;
    let entry = json!({
        "ts": chrono_iso(),
        "action": action,
        "detail": detail.unwrap_or(Value::Null),
    });
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("audit.jsonl"))
        .map_err(|e| e.to_string())?;
    writeln!(f, "{entry}").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audit_tail(app: AppHandle, n: usize) -> Result<Vec<Value>, String> {
    let p = store_dir(&app)?.join("audit.jsonl");
    let raw = fs::read_to_string(p).unwrap_or_default();
    let n = n.clamp(1, 500);
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(n);
    Ok(lines[start..]
        .iter()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect())
}

fn chrono_iso() -> String {
    // RFC3339-ish local timestamp without extra deps.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = now / 86400;
    let secs = now % 86400;
    // civil-from-days algorithm (Howard Hinnant), UTC
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", secs / 3600, (secs % 3600) / 60, secs % 60)
}
