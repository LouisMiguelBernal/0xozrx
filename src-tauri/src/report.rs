//! Report writing (restricted to the app's reports dir) + integrity hash.

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const MAX_REPORT: usize = 8 * 1024 * 1024;

pub fn reports_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| format!("data dir: {e}"))?;
    let dir = base.join("reports");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn write_report(app: AppHandle, filename: String, content: String) -> Result<String, String> {
    let ok_name = !filename.is_empty()
        && filename.len() <= 120
        && filename
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        && ["html", "json", "md", "csv", "txt", "xml"]
            .iter()
            .any(|ext| filename.ends_with(&format!(".{ext}")));
    if !ok_name {
        return Err("invalid report filename".into());
    }
    if content.len() > MAX_REPORT {
        return Err("report too large".into());
    }
    let path = reports_dir(&app)?.join(&filename);
    std::fs::write(&path, content).map_err(|e| format!("write: {e}"))?;
    path.to_string_lossy()
        .into_owned()
        .pipe(Ok)
}

trait Pipe: Sized {
    fn pipe<F, T>(self, f: F) -> T where F: FnOnce(Self) -> T { f(self) }
}
impl<T> Pipe for T {}

#[tauri::command]
pub fn sha256_hex(content: String) -> String {
    let mut h = Sha256::new();
    h.update(content.as_bytes());
    hex(&h.finalize())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Open the reports folder in Explorer (path is generated internally only).
#[tauri::command]
pub fn open_reports_dir(app: AppHandle) -> Result<(), String> {
    let dir = reports_dir(&app)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(dir.as_os_str())
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
