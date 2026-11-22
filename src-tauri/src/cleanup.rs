//! Temp / cache reclaim engine.
//!
//! Threat model:
//! - Targets are a compile-time allowlist. The frontend can only pass target
//!   *ids*; it can never pass a path. There is no user-supplied path anywhere.
//! - Each resolved root must (a) be absolute, (b) exist, (c) contain the
//!   target's `guard` segment, and (d) not match the protected-path denylist
//!   (profile root, Desktop/Documents/Downloads/Pictures, Windows, System32,
//!   Program Files, or any drive root). Failing any check drops the target.
//! - Only *entries inside* a root are removed - never the root itself.
//! - Reparse points (junctions/symlinks) are skipped, never traversed.
//! - Entries modified more recently than `min_age_mins` are left alone so files
//!   in active use are not yanked out from under a running process.
//! - `clean_scan` is read-only. `clean_apply` needs `confirm == "CLEAN"`, and
//!   writes the outcome to the audit trail.

use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;

use crate::admin::token_elevated;
use crate::modules::run_powershell;
use crate::persist::audit_append;

const MAX_DEPTH: usize = 12;
/// Hard stop so a pathological tree can never hang the UI.
const MAX_ENTRIES: usize = 250_000;

struct TargetDef {
    id: &'static str,
    title: &'static str,
    /// Environment variable holding the base directory.
    env: &'static str,
    /// Sub-path appended to the base.
    sub: &'static str,
    /// Case-insensitive segment the resolved path MUST contain.
    guard: &'static str,
    requires_admin: bool,
    note: &'static str,
}

const TARGETS: &[TargetDef] = &[
    TargetDef {
        id: "user_temp",
        title: "User temp",
        env: "TEMP",
        sub: "",
        guard: "temp",
        requires_admin: false,
        note: "%TEMP% - installer leftovers, extracted archives, app scratch files",
    },
    TargetDef {
        id: "windows_temp",
        title: "Windows temp",
        env: "SystemRoot",
        sub: "Temp",
        guard: "temp",
        requires_admin: true,
        note: "machine-wide scratch dir used by services and installers",
    },
    TargetDef {
        id: "crash_dumps",
        title: "Crash dumps",
        env: "LOCALAPPDATA",
        sub: "CrashDumps",
        guard: "crashdumps",
        requires_admin: false,
        note: "per-app .dmp files; can be large",
    },
    TargetDef {
        id: "wer_user",
        title: "Error reports (user)",
        env: "LOCALAPPDATA",
        sub: "Microsoft\\Windows\\WER",
        guard: "wer",
        requires_admin: false,
        note: "Windows Error Reporting queue for this account",
    },
    TargetDef {
        id: "wer_machine",
        title: "Error reports (machine)",
        env: "ProgramData",
        sub: "Microsoft\\Windows\\WER",
        guard: "wer",
        requires_admin: true,
        note: "machine-wide Windows Error Reporting queue",
    },
    TargetDef {
        id: "inet_cache",
        title: "WinINet cache",
        env: "LOCALAPPDATA",
        sub: "Microsoft\\Windows\\INetCache",
        guard: "inetcache",
        requires_admin: false,
        note: "legacy IE/WinINet download cache used by many desktop apps",
    },
    TargetDef {
        id: "d3d_cache",
        title: "Shader cache",
        env: "LOCALAPPDATA",
        sub: "D3DSCache",
        guard: "d3dscache",
        requires_admin: false,
        note: "Direct3D shader cache; rebuilt on demand",
    },
    TargetDef {
        id: "prefetch",
        title: "Prefetch",
        env: "SystemRoot",
        sub: "Prefetch",
        guard: "prefetch",
        requires_admin: true,
        note: "boot/app prefetch traces; Windows rebuilds them (first launch is slower)",
    },
    TargetDef {
        id: "update_cache",
        title: "Windows Update cache",
        env: "SystemRoot",
        sub: "SoftwareDistribution\\Download",
        guard: "softwaredistribution",
        requires_admin: true,
        note: "already-installed update payloads",
    },
    TargetDef {
        id: "delivery_opt",
        title: "Delivery Optimization cache",
        env: "SystemRoot",
        sub: "SoftwareDistribution\\DeliveryOptimization",
        guard: "softwaredistribution",
        requires_admin: true,
        note: "peer-to-peer update chunks",
    },
    TargetDef {
        id: "cbs_logs",
        title: "Servicing logs (CBS)",
        env: "SystemRoot",
        sub: "Logs\\CBS",
        guard: "cbs",
        requires_admin: true,
        note: "component servicing logs; grow unbounded on some machines",
    },
];

/// Drop the `\\?\` verbatim prefix `canonicalize` adds on Windows, so guard
/// comparisons and displayed paths both see a plain `C:\...` form.
fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().into_owned();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.len() > 2 && rest.as_bytes()[1] == b':' => PathBuf::from(rest),
        _ => p,
    }
}

/// Paths that must never be handed to the deleter, whatever the env vars say.
fn is_protected(p: &Path) -> bool {
    let s = p.to_string_lossy().to_lowercase().replace('/', "\\");
    let s = s.trim_end_matches('\\').to_string();

    // drive root ("c:") or empty
    if s.len() <= 3 {
        return true;
    }
    if s.split('\\').filter(|c| !c.is_empty()).count() < 2 {
        return true;
    }

    let deny_exact = [
        "c:\\windows",
        "c:\\windows\\system32",
        "c:\\windows\\syswow64",
        "c:\\program files",
        "c:\\program files (x86)",
        "c:\\programdata",
        "c:\\users",
    ];
    if deny_exact.contains(&s.as_str()) {
        return true;
    }

    for var in ["USERPROFILE", "SystemRoot", "ProgramData", "ProgramFiles"] {
        if let Ok(v) = std::env::var(var) {
            let v = v.to_lowercase().replace('/', "\\");
            let v = v.trim_end_matches('\\');
            if !v.is_empty() && s == v {
                return true;
            }
        }
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        let home = home.to_lowercase().replace('/', "\\");
        let home = home.trim_end_matches('\\');
        for leaf in ["desktop", "documents", "downloads", "pictures", "videos", "music"] {
            if s == format!("{home}\\{leaf}") {
                return true;
            }
        }
    }
    false
}

/// Resolve a target to a validated root, or None when it fails any guard.
fn validated_root(def: &TargetDef) -> Option<PathBuf> {
    let base = std::env::var(def.env).ok()?;
    if base.trim().is_empty() {
        return None;
    }
    let mut p = PathBuf::from(base);
    if !def.sub.is_empty() {
        p.push(def.sub);
    }
    if !p.is_absolute() || !p.is_dir() {
        return None;
    }
    let canon = strip_verbatim(fs::canonicalize(&p).unwrap_or(p));
    let lower = canon.to_string_lossy().to_lowercase();
    if !lower.contains(&def.guard.to_lowercase()) {
        return None;
    }
    if is_protected(&canon) {
        return None;
    }
    Some(canon)
}

fn is_reparse(p: &Path) -> bool {
    fs::symlink_metadata(p)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(true)
}

struct Walk {
    bytes: u64,
    files: u64,
}

/// Recursive size/count of a subtree. Never follows reparse points.
fn walk(path: &Path, depth: usize, budget: &mut usize) -> Walk {
    let mut acc = Walk { bytes: 0, files: 0 };
    if depth > MAX_DEPTH || *budget == 0 {
        return acc;
    }
    let Ok(rd) = fs::read_dir(path) else {
        return acc;
    };
    for entry in rd.flatten() {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let p = entry.path();
        let Ok(md) = entry.metadata() else { continue };
        if md.file_type().is_symlink() {
            acc.files += 1;
            continue;
        }
        if md.is_dir() {
            let sub = walk(&p, depth + 1, budget);
            acc.bytes += sub.bytes;
            acc.files += sub.files;
        } else {
            acc.bytes += md.len();
            acc.files += 1;
        }
    }
    acc
}

fn older_than(p: &Path, min_age: Duration) -> bool {
    if min_age.is_zero() {
        return true;
    }
    let Ok(md) = fs::symlink_metadata(p) else {
        return false;
    };
    match md.modified() {
        Ok(m) => SystemTime::now()
            .duration_since(m)
            .map(|age| age >= min_age)
            .unwrap_or(false),
        Err(_) => false,
    }
}

// ------------------------------------------------------------------ commands

#[derive(Serialize)]
pub struct TargetReport {
    id: &'static str,
    title: &'static str,
    note: &'static str,
    requires_admin: bool,
    /// None when the target is unavailable (missing dir, failed guard, or the
    /// session is not elevated for an admin-only target).
    path: Option<String>,
    available: bool,
    skipped_reason: Option<String>,
    bytes: u64,
    files: u64,
}

#[derive(Serialize)]
pub struct CleanReport {
    elevated: bool,
    min_age_mins: u64,
    total_bytes: u64,
    total_files: u64,
    targets: Vec<TargetReport>,
    elapsed_ms: u64,
}

/// Dry-run: measure everything that `clean_apply` would remove. Read-only.
#[tauri::command]
pub fn clean_scan(min_age_mins: Option<u64>) -> CleanReport {
    let started = std::time::Instant::now();
    let elevated = token_elevated();
    let min_age_mins = min_age_mins.unwrap_or(60).min(60 * 24 * 30);
    let min_age = Duration::from_secs(min_age_mins * 60);
    let mut budget = MAX_ENTRIES;

    let mut targets = Vec::with_capacity(TARGETS.len());
    let mut total_bytes = 0u64;
    let mut total_files = 0u64;

    for def in TARGETS {
        if def.requires_admin && !elevated {
            targets.push(TargetReport {
                id: def.id,
                title: def.title,
                note: def.note,
                requires_admin: true,
                path: None,
                available: false,
                skipped_reason: Some("needs elevation".into()),
                bytes: 0,
                files: 0,
            });
            continue;
        }
        let Some(root) = validated_root(def) else {
            targets.push(TargetReport {
                id: def.id,
                title: def.title,
                note: def.note,
                requires_admin: def.requires_admin,
                path: None,
                available: false,
                skipped_reason: Some("not present on this system".into()),
                bytes: 0,
                files: 0,
            });
            continue;
        };

        let mut bytes = 0u64;
        let mut files = 0u64;
        if let Ok(rd) = fs::read_dir(&root) {
            for entry in rd.flatten() {
                let p = entry.path();
                if is_reparse(&p) || !older_than(&p, min_age) {
                    continue;
                }
                let Ok(md) = entry.metadata() else { continue };
                if md.is_dir() {
                    let w = walk(&p, 1, &mut budget);
                    bytes += w.bytes;
                    files += w.files;
                } else {
                    bytes += md.len();
                    files += 1;
                }
            }
        }
        total_bytes += bytes;
        total_files += files;
        targets.push(TargetReport {
            id: def.id,
            title: def.title,
            note: def.note,
            requires_admin: def.requires_admin,
            path: Some(root.to_string_lossy().into_owned()),
            available: true,
            skipped_reason: None,
            bytes,
            files,
        });
    }

    CleanReport {
        elevated,
        min_age_mins,
        total_bytes,
        total_files,
        targets,
        elapsed_ms: started.elapsed().as_millis() as u64,
    }
}

#[derive(Serialize)]
pub struct TargetResult {
    id: String,
    removed: u64,
    failed: u64,
    bytes_freed: u64,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct CleanResult {
    dry_run: bool,
    bytes_freed: u64,
    removed: u64,
    failed: u64,
    results: Vec<TargetResult>,
    elapsed_ms: u64,
}

/// Delete the contents of the requested allowlisted targets.
///
/// `confirm` MUST be the literal string "CLEAN". `targets` are ids from
/// `clean_scan`; anything unrecognised is ignored rather than guessed at.
#[tauri::command]
pub fn clean_apply(
    app: AppHandle,
    targets: Vec<String>,
    confirm: String,
    min_age_mins: Option<u64>,
) -> Result<CleanResult, String> {
    if confirm != "CLEAN" {
        return Err("confirmation token mismatch - nothing was deleted".into());
    }
    if targets.is_empty() {
        return Err("no targets selected".into());
    }
    let started = std::time::Instant::now();
    let elevated = token_elevated();
    let min_age_mins = min_age_mins.unwrap_or(60).min(60 * 24 * 30);
    let min_age = Duration::from_secs(min_age_mins * 60);

    let _ = audit_append(
        app.clone(),
        "clean.apply.start".into(),
        Some(json!({ "targets": targets, "min_age_mins": min_age_mins, "elevated": elevated })),
    );

    let mut results = Vec::new();
    let mut bytes_freed = 0u64;
    let mut removed = 0u64;
    let mut failed = 0u64;

    for id in &targets {
        let Some(def) = TARGETS.iter().find(|d| d.id == id) else {
            results.push(TargetResult {
                id: id.clone(),
                removed: 0,
                failed: 0,
                bytes_freed: 0,
                error: Some("not allowlisted".into()),
            });
            continue;
        };
        if def.requires_admin && !elevated {
            results.push(TargetResult {
                id: id.clone(),
                removed: 0,
                failed: 0,
                bytes_freed: 0,
                error: Some("needs elevation".into()),
            });
            continue;
        }
        let Some(root) = validated_root(def) else {
            results.push(TargetResult {
                id: id.clone(),
                removed: 0,
                failed: 0,
                bytes_freed: 0,
                error: Some("path guard failed".into()),
            });
            continue;
        };

        let mut t = TargetResult {
            id: id.clone(),
            removed: 0,
            failed: 0,
            bytes_freed: 0,
            error: None,
        };
        let Ok(rd) = fs::read_dir(&root) else {
            t.error = Some("read_dir failed".into());
            results.push(t);
            continue;
        };
        for entry in rd.flatten() {
            let p = entry.path();
            // Belt and braces: the deleter never touches the root itself.
            if p == root || is_reparse(&p) || !older_than(&p, min_age) {
                continue;
            }
            let Ok(md) = entry.metadata() else { continue };
            let size = if md.is_dir() {
                let mut budget = MAX_ENTRIES;
                walk(&p, 1, &mut budget).bytes
            } else {
                md.len()
            };
            let outcome = if md.is_dir() {
                fs::remove_dir_all(&p)
            } else {
                fs::remove_file(&p)
            };
            match outcome {
                Ok(()) => {
                    t.removed += 1;
                    t.bytes_freed += size;
                }
                // Locked / in-use / access-denied entries are expected; skip them.
                Err(_) => t.failed += 1,
            }
        }
        bytes_freed += t.bytes_freed;
        removed += t.removed;
        failed += t.failed;
        results.push(t);
    }

    let out = CleanResult {
        dry_run: false,
        bytes_freed,
        removed,
        failed,
        results,
        elapsed_ms: started.elapsed().as_millis() as u64,
    };
    let _ = audit_append(
        app,
        "clean.apply.done".into(),
        Some(json!({ "bytes_freed": out.bytes_freed, "removed": out.removed, "failed": out.failed })),
    );
    Ok(out)
}

/// Empty the Recycle Bin. Separate command because it is a shell operation, not
/// a directory walk - and because it is the one genuinely unrecoverable action.
#[tauri::command]
pub fn empty_recycle_bin(app: AppHandle, confirm: String) -> Result<String, String> {
    if confirm != "EMPTY-RECYCLE-BIN" {
        return Err("confirmation token mismatch - recycle bin untouched".into());
    }
    let _ = audit_append(app.clone(), "clean.recyclebin".into(), None);
    let script = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;\
                  Clear-RecycleBin -Force -ErrorAction Stop; 'recycle bin emptied'";
    let out = run_powershell(script, Duration::from_secs(120))?;
    let err = out.stderr.trim();
    if !err.is_empty() && out.stdout.trim().is_empty() {
        return Err(err.chars().take(300).collect());
    }
    Ok(out.stdout.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_ids_unique_and_guarded() {
        let mut seen = std::collections::HashSet::new();
        for d in TARGETS {
            assert!(seen.insert(d.id), "duplicate target {}", d.id);
            assert!(!d.guard.is_empty(), "{} has no guard segment", d.id);
            assert!(!d.env.is_empty(), "{} has no base env var", d.id);
        }
    }

    #[test]
    fn protected_paths_are_refused() {
        for p in [
            "C:\\",
            "C:\\Windows",
            "C:\\Windows\\",
            "C:\\Windows\\System32",
            "C:\\Program Files",
            "C:\\Users",
            "C:\\ProgramData",
        ] {
            assert!(is_protected(Path::new(p)), "{p} should be protected");
        }
    }

    #[test]
    fn ordinary_temp_paths_are_allowed() {
        for p in [
            "C:\\Windows\\Temp",
            "C:\\Users\\someone\\AppData\\Local\\Temp",
            "C:\\Windows\\Prefetch",
        ] {
            assert!(!is_protected(Path::new(p)), "{p} should be allowed");
        }
    }

    #[test]
    fn guard_segment_matches_every_target_subpath() {
        for d in TARGETS {
            let joined = format!("{}\\{}", d.env, d.sub).to_lowercase();
            let guard = d.guard.to_lowercase();
            assert!(
                joined.contains(&guard),
                "guard '{}' can never match target {}",
                d.guard,
                d.id
            );
        }
    }
}
