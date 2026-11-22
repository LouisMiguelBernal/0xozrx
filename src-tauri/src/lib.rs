//! 0xOZrx!! backend
//!
//! Read-only local telemetry + allowlisted PowerShell module runner +
//! authorized private-range TCP scanner + local Ollama client + file-backed
//! persistence. No destructive operations; mutations are frontend-gated and
//! audit-logged.
//!
//! Threat-model notes:
//! - `run_module`: executes ONLY compile-time-constant scripts (exact-match key).
//! - `tcp_scan`: refuses targets outside loopback/RFC1918/ULA, bounded ports,
//!   concurrency and timeouts. Public scanning is out of scope by design.
//! - `exec_shell`: user-driven terminal passthrough with hard caps; internal
//!   modules must never route through it.
//! - `ai_chat`: POSTs only to the configured endpoint; size-capped payloads.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod admin;
mod ai;
mod cleanup;
mod modules;
mod net_scan;
mod persist;
mod report;

use admin::{admin_apply, admin_status};
use ai::{ai_chat, model_info, pick_model, warm_model};
use cleanup::{clean_apply, clean_scan, empty_recycle_bin};
use net_scan::{local_targets, tcp_scan};
use persist::{
    audit_append, audit_tail, get_baseline, get_scan, list_scans, save_baseline, save_scan,
};
use report::{open_reports_dir, sha256_hex, write_report};

use std::{
    io::Read,
    process::{Command, Stdio},
    sync::{Mutex},
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::Serialize;
use sysinfo::{Disks, Networks, ProcessesToUpdate, System};
use tauri::State;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const OUTPUT_CAP: usize = 512 * 1024;

// ---------------------------------------------------------------- telemetry

#[derive(Serialize, Clone)]
pub struct DiskInfo {
    name: String,
    mount: String,
    fs: String,
    total_bytes: u64,
    free_bytes: u64,
}

#[derive(Serialize, Clone)]
pub struct NetRate {
    id: String,
    rx_bps: f64,
    tx_bps: f64,
}

#[derive(Serialize, Clone)]
pub struct ResourceTick {
    cpu_pct: f32,
    mem_used_bytes: u64,
    mem_total_bytes: u64,
    mem_pct: f32,
    disks: Vec<DiskInfo>,
    nets: Vec<NetRate>,
    uptime_secs: u64,
    ts_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct SystemInfo {
    hostname: String,
    username: String,
    os_name: String,
    os_version: String,
    os_build: String,
    kernel: String,
    arch: String,
    cpu_model: String,
    cpu_cores_logical: usize,
    cpu_cores_physical: usize,
    total_mem_bytes: u64,
    uptime_secs: u64,
}

#[derive(Serialize, Clone)]
pub struct ProcRow {
    pid: u32,
    name: String,
    cpu_pct: f32,
    mem_bytes: u64,
}

#[derive(Serialize, Clone)]
pub struct OllamaStatus {
    online: bool,
    endpoint: String,
    models: Vec<String>,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ShellResult {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
    truncated: bool,
}

pub struct SysState {
    sys: Mutex<System>,
    disks: Mutex<Disks>,
    nets: Mutex<Networks>,
    last_net_refresh: Mutex<Instant>,
}

fn os_arch() -> String {
    if cfg!(target_arch = "x86_64") {
        "x86_64".into()
    } else if cfg!(target_arch = "aarch64") {
        "aarch64".into()
    } else {
        std::env::consts::ARCH.into()
    }
}

#[tauri::command]
fn get_system_info(state: State<SysState>) -> Result<SystemInfo, String> {
    let mut sys = state.sys.lock().map_err(|e| e.to_string())?;
    sys.refresh_memory();
    sys.refresh_cpu_all();

    let os_build = System::os_version().unwrap_or_default();
    Ok(SystemInfo {
        hostname: System::host_name().unwrap_or_default(),
        username: std::env::var("USERNAME").unwrap_or_else(|_| "unknown".into()),
        os_name: System::long_os_version().unwrap_or_else(|| System::name().unwrap_or_default()),
        os_version: os_build.clone(),
        os_build,
        kernel: System::kernel_version().unwrap_or_default(),
        arch: os_arch(),
        cpu_model: sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_string())
            .unwrap_or_else(|| "unknown".into()),
        cpu_cores_logical: sys.cpus().len(),
        cpu_cores_physical: sys.physical_core_count().unwrap_or(sys.cpus().len()),
        total_mem_bytes: sys.total_memory(),
        uptime_secs: System::uptime(),
    })
}

#[tauri::command]
fn get_resources(state: State<SysState>) -> Result<ResourceTick, String> {
    let mut sys = state.sys.lock().map_err(|e| e.to_string())?;
    let mut disks = state.disks.lock().map_err(|e| e.to_string())?;
    let mut nets = state.nets.lock().map_err(|e| e.to_string())?;

    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let now = Instant::now();
    let elapsed = now
        .duration_since(*state.last_net_refresh.lock().map_err(|e| e.to_string())?)
        .as_secs_f64()
        .max(0.001);
    nets.refresh(true);
    *state.last_net_refresh.lock().map_err(|e| e.to_string())? = now;

    let nets_out: Vec<NetRate> = nets
        .iter()
        .take(16)
        .map(|(id, d)| NetRate {
            id: id.clone(),
            rx_bps: d.received() as f64 / elapsed,
            tx_bps: d.transmitted() as f64 / elapsed,
        })
        .collect();

    disks.refresh(true);
    let disks_out: Vec<DiskInfo> = disks
        .list()
        .iter()
        .take(24)
        .map(|d| DiskInfo {
            name: d.name().to_string_lossy().to_string(),
            mount: d.mount_point().to_string_lossy().to_string(),
            fs: d.file_system().to_string_lossy().to_string(),
            total_bytes: d.total_space(),
            free_bytes: d.available_space(),
        })
        .collect();

    Ok(ResourceTick {
        cpu_pct: sys.global_cpu_usage(),
        mem_used_bytes: sys.used_memory(),
        mem_total_bytes: sys.total_memory(),
        mem_pct: if sys.total_memory() > 0 {
            (sys.used_memory() as f32 / sys.total_memory() as f32) * 100.0
        } else {
            0.0
        },
        disks: disks_out,
        nets: nets_out,
        uptime_secs: System::uptime(),
        ts_ms: now.elapsed().as_millis() as u64 + chrono_millis(),
    })
}

fn chrono_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| (d.as_millis() % 1000) as u64)
        .unwrap_or(0)
}

#[tauri::command]
fn top_processes(state: State<SysState>, limit: usize) -> Result<Vec<ProcRow>, String> {
    let mut sys = state.sys.lock().map_err(|e| e.to_string())?;
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let limit = limit.clamp(1, 50);
    let mut rows: Vec<ProcRow> = sys
        .processes()
        .values()
        .map(|p| ProcRow {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().to_string(),
            cpu_pct: p.cpu_usage(),
            mem_bytes: p.memory(),
        })
        .collect();
    rows.sort_by(|a, b| b.cpu_pct.partial_cmp(&a.cpu_pct).unwrap_or(std::cmp::Ordering::Equal));
    rows.truncate(limit);
    Ok(rows)
}

// ------------------------------------------------------------ ollama probe

#[tauri::command]
fn check_ollama(endpoint: String) -> OllamaStatus {
    if !(endpoint.starts_with("http://") || endpoint.starts_with("https://")) {
        return OllamaStatus {
            online: false,
            endpoint: endpoint.clone(),
            models: vec![],
            error: Some("endpoint must be http(s)".into()),
        };
    }
    let url = format!("{}/api/tags", endpoint.trim_end_matches('/'));
    let agent: ureq::Agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(3))
        .build();
    match agent.get(&url).call() {
        Ok(resp) => match resp.into_json::<serde_json::Value>() {
            Ok(v) => {
                let models = v["models"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m["name"].as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                OllamaStatus { online: true, endpoint, models, error: None }
            }
            Err(e) => OllamaStatus {
                online: false,
                endpoint,
                models: vec![],
                error: Some(format!("bad response: {e}")),
            },
        },
        Err(e) => OllamaStatus { online: false, endpoint, models: vec![], error: Some(e.to_string()) },
    }
}

// --------------------------------------------------- user shell passthrough

/// Run one USER-TYPED line through PowerShell with hard caps.
/// Internal scanner modules must never use this path - they use run_module.
#[tauri::command]
fn exec_shell(line: String, timeout_secs: Option<u64>) -> Result<ShellResult, String> {
    if line.trim().is_empty() {
        return Err("empty command".into());
    }
    if line.len() > 8192 {
        return Err("command too long".into());
    }
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(30).clamp(1, 120));

    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &line,
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;

    let pid = child.id();
    let mut stdout_pipe = child.stdout.take().ok_or("no stdout")?;
    let mut stderr_pipe = child.stderr.take().ok_or("no stderr")?;

    let out_handle = std::thread::spawn(move || {
        let mut buf = vec![];
        let mut truncated = false;
        let mut chunk = [0u8; 8192];
        loop {
            match stdout_pipe.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let take = n.min(OUTPUT_CAP.saturating_sub(buf.len()));
                    buf.extend_from_slice(&chunk[..take]);
                    if take < n {
                        truncated = true;
                    }
                }
            }
        }
        (buf, truncated)
    });
    let err_handle = std::thread::spawn(move || {
        let mut buf = vec![];
        let mut chunk = [0u8; 8192];
        loop {
            match stderr_pipe.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => buf.extend_from_slice(&chunk[..n.min(OUTPUT_CAP.saturating_sub(buf.len()))]),
            }
        }
        buf
    });

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let mut kill = Command::new("taskkill");
                    kill.args(["/PID", &pid.to_string(), "/T", "/F"]);
                    #[cfg(windows)]
                    kill.creation_flags(CREATE_NO_WINDOW);
                    let _ = kill.output();
                    break child.try_wait().ok().flatten();
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("wait failed: {e}")),
        }
    };

    let (out_buf, out_trunc) = out_handle.join().unwrap_or((vec![], false));
    let err_buf = err_handle.join().unwrap_or_default();

    Ok(ShellResult {
        stdout: String::from_utf8_lossy(&out_buf).into_owned(),
        stderr: String::from_utf8_lossy(&err_buf).into_owned(),
        exit_code: status.and_then(|s| s.code()),
        timed_out,
        truncated: out_trunc,
    })
}

// --------------------------------------------------------- module commands

/// True when the current process token is elevated (Administrator).
#[tauri::command]
fn is_elevated() -> bool {
    admin::token_elevated()
}

/// Relaunch the app with Administrator rights (one UAC prompt, opt-in).
#[tauri::command]
fn elevate_relaunch() -> Result<bool, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut file: Vec<u16> = exe.as_os_str().to_string_lossy().encode_utf16().collect();
        file.push(0);
        let verb: Vec<u16> = "runas\0".encode_utf16().collect();

        let h = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        // Classic ShellExecute success check: returned value > 32.
        if (h as isize) > 32 {
            // flush the IPC reply, then close this unelevated instance
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_millis(400));
                std::process::exit(0);
            });
            Ok(true)
        } else {
            Ok(false)
        }
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

/// Run an allowlisted PowerShell module (compile-time constant scripts).
#[tauri::command]
fn run_module(module: String, timeout_secs: Option<u64>) -> Result<String, String> {
    if !modules::MODULES.contains(&module.as_str()) {
        return Err(format!(
            "module not allowlisted: {}",
            &module[..module.len().min(40)]
        ));
    }
    let out = modules::run_module(&module, timeout_secs.unwrap_or(60))?;
    if out.stdout.trim().is_empty() {
        return Err(if out.stderr.is_empty() {
            "module returned no data".into()
        } else {
            format!("module error: {}", out.stderr.lines().next().unwrap_or(""))
        });
    }
    Ok(out.stdout)
}

/// Inspect a single process (path + Authenticode signature status).
#[tauri::command]
fn proc_detail(pid: u32) -> Result<String, String> {
    let script = modules::proc_detail_script(pid);
    let out = modules::run_powershell(&script, Duration::from_secs(30))?;
    if out.stdout.trim().is_empty() {
        return Err("process not found or no data".into());
    }
    Ok(out.stdout)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = SysState {
        sys: Mutex::new(System::new_all()),
        disks: Mutex::new(Disks::new_with_refreshed_list()),
        nets: Mutex::new(Networks::new_with_refreshed_list()),
        last_net_refresh: Mutex::new(Instant::now()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            get_resources,
            top_processes,
            check_ollama,
            exec_shell,
            run_module,
            proc_detail,
            is_elevated,
            elevate_relaunch,
            tcp_scan,
            local_targets,
            pick_model,
            model_info,
            warm_model,
            ai_chat,
            admin_status,
            admin_apply,
            clean_scan,
            clean_apply,
            empty_recycle_bin,
            save_scan,
            list_scans,
            get_scan,
            save_baseline,
            get_baseline,
            audit_append,
            audit_tail,
            write_report,
            sha256_hex,
            open_reports_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running 0xOZrx!!");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ollama_endpoint_validation_rejects_non_http() {
        let st = check_ollama("ftp://127.0.0.1:11434".into());
        assert!(!st.online);
        assert!(st.error.is_some());
    }

    #[test]
    fn module_allowlist_rejects_injection_keys() {
        for bad in ["x'; Start-Process calc", "", "defender && whoami", "../etc/passwd"] {
            assert!(run_module(bad.to_string(), Some(5)).is_err());
        }
    }

    #[test]
    fn sha256_known_vector() {
        assert_eq!(
            report::sha256_hex("abc".into()),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
