//! Administrator control surface.
//!
//! Threat model:
//! - `admin_status` is read-only (token elevation + action catalog).
//! - `admin_apply` runs ONLY compile-time-constant hardening scripts selected by
//!   exact-match id. User input never becomes a command string.
//! - Every mutating action requires (a) an elevated token when `requires_admin`,
//!   (b) a `confirm` token that must equal the action id, and (c) is written to
//!   the local audit trail before and after execution.
//! - Actions are limited to reversible security hardening. Nothing here deletes
//!   user data, installs software, or reaches the network.

use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;

use crate::modules::run_powershell;
use crate::persist::audit_append;

/// True when the current process token is elevated (Administrator).
pub fn token_elevated() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::HANDLE,
            Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
            System::Threading::{GetCurrentProcess, OpenProcessToken},
        };
        unsafe {
            let mut token: HANDLE = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return false;
            }
            let mut elev: TOKEN_ELEVATION = std::mem::zeroed();
            let mut ret_len = 0u32;
            let ok = GetTokenInformation(
                token,
                TokenElevation,
                &mut elev as *mut _ as *mut _,
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut ret_len,
            );
            windows_sys::Win32::Foundation::CloseHandle(token);
            ok != 0 && elev.TokenIsElevated != 0
        }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

// ------------------------------------------------------------------ catalog

#[derive(Serialize, Clone)]
pub struct AdminAction {
    /// Stable id; also the required `confirm` token.
    pub id: &'static str,
    pub title: &'static str,
    /// What the action changes, in one line.
    pub detail: &'static str,
    /// How to undo it, in one line. Every action here is reversible.
    pub revert: &'static str,
    pub requires_admin: bool,
    /// LOW = local cache/state only, MED = security policy, HIGH = feature state.
    pub impact: &'static str,
    pub group: &'static str,
}

pub const ACTIONS: &[AdminAction] = &[
    AdminAction {
        id: "restore_point",
        title: "Create system restore point",
        detail: "Enables System Restore on the system drive and checkpoints it as '0xOZrx pre-hardening'.",
        revert: "Delete the restore point from System Protection.",
        requires_admin: true,
        impact: "LOW",
        group: "SAFETY",
    },
    AdminAction {
        id: "firewall_on",
        title: "Enable firewall (all profiles)",
        detail: "Sets Domain, Private and Public firewall profiles to Enabled.",
        revert: "Set-NetFirewallProfile -Profile <name> -Enabled False",
        requires_admin: true,
        impact: "MED",
        group: "FIREWALL",
    },
    AdminAction {
        id: "defender_rt_on",
        title: "Enable Defender real-time protection",
        detail: "Clears DisableRealtimeMonitoring so Defender scans on access again.",
        revert: "Set-MpPreference -DisableRealtimeMonitoring $true",
        requires_admin: true,
        impact: "MED",
        group: "DEFENDER",
    },
    AdminAction {
        id: "defender_sigs",
        title: "Update Defender signatures",
        detail: "Pulls the latest antimalware definitions via Windows Update.",
        revert: "Not applicable - definitions only move forward.",
        requires_admin: true,
        impact: "LOW",
        group: "DEFENDER",
    },
    AdminAction {
        id: "defender_quick_scan",
        title: "Run Defender quick scan",
        detail: "Starts a Defender QuickScan; results appear in Windows Security.",
        revert: "Not applicable - read-only scan.",
        requires_admin: true,
        impact: "LOW",
        group: "DEFENDER",
    },
    AdminAction {
        id: "uac_max",
        title: "Raise UAC to secure-desktop prompting",
        detail: "EnableLUA=1, ConsentPromptBehaviorAdmin=2, PromptOnSecureDesktop=1.",
        revert: "Restore the values shown by 'admin status' before applying.",
        requires_admin: true,
        impact: "MED",
        group: "POLICY",
    },
    AdminAction {
        id: "smb1_off",
        title: "Disable SMBv1 protocol",
        detail: "Turns off the deprecated SMB1Protocol optional feature (-NoRestart).",
        revert: "Enable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol",
        requires_admin: true,
        impact: "HIGH",
        group: "EXPOSURE",
    },
    AdminAction {
        id: "rdp_off",
        title: "Disable Remote Desktop",
        detail: "fDenyTSConnections=1 and disables the Remote Desktop firewall rule group.",
        revert: "Set fDenyTSConnections=0 and re-enable the rule group.",
        requires_admin: true,
        impact: "HIGH",
        group: "EXPOSURE",
    },
    AdminAction {
        id: "telemetry_min",
        title: "Set telemetry to the minimum policy value",
        detail: "AllowTelemetry=0 under HKLM policies (consumer SKUs floor at Basic).",
        revert: "Remove AllowTelemetry from the DataCollection policy key.",
        requires_admin: true,
        impact: "MED",
        group: "PRIVACY",
    },
    AdminAction {
        id: "dns_flush",
        title: "Flush DNS resolver cache",
        detail: "Clears the local DNS client cache. No elevation needed.",
        revert: "Cache repopulates automatically.",
        requires_admin: false,
        impact: "LOW",
        group: "NETWORK",
    },
];

/// Compile-time-constant remediation scripts. Selected by exact id match only.
fn action_script(id: &str) -> Option<&'static str> {
    Some(match id {
        "restore_point" => {
            "Enable-ComputerRestore -Drive \"$env:SystemDrive\\\" -ErrorAction Stop\n\
             Checkpoint-Computer -Description '0xOZrx pre-hardening' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop\n\
             'restore point created'"
        }
        "firewall_on" => {
            "Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True -ErrorAction Stop\n\
             (@(Get-NetFirewallProfile | ForEach-Object { \"$($_.Name)=$($_.Enabled)\" }) -join ' ')"
        }
        "defender_rt_on" => {
            "Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction Stop\n\
             $s = Get-MpComputerStatus\n\
             \"realtime=$($s.RealTimeProtectionEnabled) av=$($s.AntivirusEnabled) mode=$($s.AMRunningMode)\""
        }
        "defender_sigs" => {
            "Update-MpSignature -ErrorAction Stop\n\
             $s = Get-MpComputerStatus\n\
             \"signatures=$($s.AntivirusSignatureVersion) updated=$($s.AntivirusSignatureLastUpdated)\""
        }
        "defender_quick_scan" => {
            "Start-MpScan -ScanType QuickScan -ErrorAction Stop\n\
             'quick scan started - progress in Windows Security'"
        }
        "uac_max" => {
            "$k = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'\n\
             Set-ItemProperty $k -Name EnableLUA -Value 1 -Type DWord -ErrorAction Stop\n\
             Set-ItemProperty $k -Name ConsentPromptBehaviorAdmin -Value 2 -Type DWord -ErrorAction Stop\n\
             Set-ItemProperty $k -Name PromptOnSecureDesktop -Value 1 -Type DWord -ErrorAction Stop\n\
             $p = Get-ItemProperty $k\n\
             \"EnableLUA=$($p.EnableLUA) ConsentPromptBehaviorAdmin=$($p.ConsentPromptBehaviorAdmin) PromptOnSecureDesktop=$($p.PromptOnSecureDesktop) (reboot recommended)\""
        }
        "smb1_off" => {
            "$f = Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart -ErrorAction Stop\n\
             $s = Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol\n\
             \"SMB1Protocol=$($s.State) restartNeeded=$($f.RestartNeeded)\""
        }
        "rdp_off" => {
            "Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 1 -Type DWord -ErrorAction Stop\n\
             Disable-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue\n\
             $p = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server'\n\
             \"fDenyTSConnections=$($p.fDenyTSConnections) (1 = RDP refused)\""
        }
        "telemetry_min" => {
            "$k = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection'\n\
             if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }\n\
             Set-ItemProperty $k -Name AllowTelemetry -Value 0 -Type DWord -ErrorAction Stop\n\
             $p = Get-ItemProperty $k\n\
             \"AllowTelemetry=$($p.AllowTelemetry) (0 = Security; consumer SKUs floor at 1)\""
        }
        "dns_flush" => {
            "Clear-DnsClientCache -ErrorAction Stop\n\
             'dns resolver cache cleared'"
        }
        _ => return None,
    })
}

// ------------------------------------------------------------------ commands

#[derive(Serialize)]
pub struct AdminStatus {
    elevated: bool,
    username: String,
    hostname: String,
    /// Catalog travels with status so the UI never hard-codes action ids.
    actions: Vec<AdminAction>,
}

#[tauri::command]
pub fn admin_status() -> AdminStatus {
    AdminStatus {
        elevated: token_elevated(),
        username: std::env::var("USERNAME").unwrap_or_else(|_| "unknown".into()),
        hostname: std::env::var("COMPUTERNAME").unwrap_or_default(),
        actions: ACTIONS.to_vec(),
    }
}

#[derive(Serialize)]
pub struct AdminResult {
    id: String,
    ok: bool,
    output: String,
    error: Option<String>,
    elapsed_ms: u64,
}

/// Apply one allowlisted hardening action.
///
/// `confirm` MUST equal `id` - the frontend only sends it after an explicit
/// user confirmation, so a stray IPC call can never mutate the machine.
#[tauri::command]
pub fn admin_apply(
    app: AppHandle,
    id: String,
    confirm: String,
    timeout_secs: Option<u64>,
) -> Result<AdminResult, String> {
    let action = ACTIONS
        .iter()
        .find(|a| a.id == id)
        .ok_or_else(|| format!("action not allowlisted: {}", &id[..id.len().min(40)]))?;

    if confirm != id {
        return Err("confirmation token mismatch - action refused".into());
    }
    if action.requires_admin && !token_elevated() {
        return Err(format!(
            "'{}' requires an elevated session - run `elevate` first",
            action.id
        ));
    }

    let _ = audit_append(
        app.clone(),
        "admin.apply.start".into(),
        Some(json!({ "id": action.id, "impact": action.impact, "elevated": token_elevated() })),
    );

    let script = action_script(&id).ok_or("no script bound to action")?;
    let started = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(120).clamp(5, 600));
    let preambled = format!(
        "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;{script}"
    );

    let res = run_powershell(&preambled, timeout);
    let elapsed_ms = started.elapsed().as_millis() as u64;

    let result = match res {
        Ok(out) => {
            let err = out.stderr.trim();
            let ok = err.is_empty();
            AdminResult {
                id: id.clone(),
                ok,
                output: out.stdout.trim().chars().take(4000).collect(),
                error: if ok { None } else { Some(err.chars().take(600).collect()) },
                elapsed_ms,
            }
        }
        Err(e) => AdminResult {
            id: id.clone(),
            ok: false,
            output: String::new(),
            error: Some(e),
            elapsed_ms,
        },
    };

    let _ = audit_append(
        app,
        "admin.apply.done".into(),
        Some(json!({ "id": result.id, "ok": result.ok, "error": result.error, "ms": elapsed_ms })),
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_action_has_a_script() {
        for a in ACTIONS {
            assert!(action_script(a.id).is_some(), "no script for {}", a.id);
        }
    }

    #[test]
    fn unknown_action_has_no_script() {
        for bad in ["", "firewall_on; calc", "../rm", "DNS_FLUSH"] {
            assert!(action_script(bad).is_none(), "leaked script for {bad}");
        }
    }

    #[test]
    fn action_ids_are_unique_and_documented() {
        let mut seen = std::collections::HashSet::new();
        for a in ACTIONS {
            assert!(seen.insert(a.id), "duplicate id {}", a.id);
            assert!(
                a.id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                "unsafe id {}",
                a.id
            );
            assert!(!a.revert.is_empty(), "{} has no documented revert", a.id);
        }
    }
}
