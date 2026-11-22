//! Allowlisted PowerShell module runner.
//!
//! Every script below is a compile-time constant. User input NEVER becomes a
//! command string - the only user-controlled value in this file is WHICH
//! constant runs (validated by exact match) and, for `proc_detail`, an integer
//! PID substituted via format into a WQL filter (injection-safe: integer only).

use std::{
    io::Read,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MODULE_OUTPUT_CAP: usize = 6 * 1024 * 1024; // 6 MiB

const PREAMBLE: &str = "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;";

pub const MODULES: &[&str] = &[
    "defender",
    "firewall",
    "uac",
    "bitlocker",
    "secureboot",
    "tpm",
    "updates",
    "services",
    "startup",
    "tasks",
    "tcp_ports",
    "proc_paths",
    "interfaces",
    "net_profile",
    "routes",
    "arp",
    "events_system",
    "events_logon",
    "gpu",
    "battery",
    "pagefile",
    "rdp_reg",
    "telemetry_reg",
    "smb1",
    "disk_space",
];

fn script(module: &str) -> Option<String> {
    let body = match module {
        "defender" => r#"
$s = Get-MpComputerStatus
if ($s) {
  [pscustomobject]@{
    amService=$s.AMServiceEnabled; av=$s.AntivirusEnabled; rt=$s.RealTimeProtectionEnabled;
    behavior=$s.BehaviorMonitorEnabled; ioav=$s.IoavProtectionEnabled; nis=$s.NISEnabled;
    runningMode=$s.AMRunningMode;
    sigLast=$(if($s.AntivirusSignatureLastUpdated){$s.AntivirusSignatureLastUpdated.ToString('yyyy-MM-dd')}else{$null});
    quickScan=$(if($s.QuickScanEndTime){$s.QuickScanEndTime.ToString('yyyy-MM-dd')}else{$null})
  } | ConvertTo-Json -Compress
}"#,
        "firewall" => r#"
@(Get-NetFirewallProfile | ForEach-Object { [pscustomobject]@{ name=$_.Name; enabled=[bool]$_.Enabled; inbound=$_.DefaultInboundAction; outbound=$_.DefaultOutboundAction } }) | ConvertTo-Json -Compress"#,
        "uac" => r#"
$p = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
[pscustomobject]@{ enableLUA=$p.EnableLUA; consentAdmin=$p.ConsentPromptBehaviorAdmin; secureDesktop=$p.PromptOnSecureDesktop } | ConvertTo-Json -Compress"#,
        "bitlocker" => r#"
@(Get-BitLockerVolume | ForEach-Object { [pscustomobject]@{ mount=$_.MountPoint; status=$_.VolumeStatus; protection=[int]$_.ProtectionStatus; pct=$_.EncryptionPercentage } }) | ConvertTo-Json -Compress"#,
        "secureboot" => r#"
try { $sb = Confirm-SecureBootUEFI; [pscustomobject]@{ secureBoot=[bool]$sb } | ConvertTo-Json -Compress }
catch { [pscustomobject]@{ error='ACCESS_DENIED_OR_UNSUPPORTED' } | ConvertTo-Json -Compress }"#,
        "tpm" => r#"
try { $t = Get-Tpm; [pscustomobject]@{ present=[bool]$t.TpmPresent; ready=[bool]$t.TpmReady; enabled=[bool]$t.TpmEnabled } | ConvertTo-Json -Compress }
catch { [pscustomobject]@{ error='ACCESS_DENIED_OR_UNSUPPORTED' } | ConvertTo-Json -Compress }"#,
        "updates" => r#"
$hf = @(Get-HotFix)
$sorted = @($hf | Sort-Object InstalledOn -Descending)
$last = $sorted | Select-Object -First 1
[pscustomobject]@{
  count=$hf.Count
  lastId=$last.HotFixID
  lastDesc=$last.Description
  lastOn=$(if($last.InstalledOn){$last.InstalledOn.ToString('yyyy-MM-dd')}else{$null})
} | ConvertTo-Json -Compress"#,
        "services" => r#"
@(Get-CimInstance Win32_Service | Where-Object { $_.State -eq 'Running' -or $_.StartMode -eq 'Auto' } | Select-Object -First 400 | ForEach-Object {
  [pscustomobject]@{ name=$_.Name; display=$_.DisplayName; state=$_.State; start=$_.StartMode; path=$_.PathName; account=$_.StartName }
}) | ConvertTo-Json -Compress"#,
        "startup" => r#"
$out = @()
$keys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run','HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce')
foreach ($k in $keys) {
  if (Test-Path $k) {
    $p = Get-ItemProperty $k
    foreach ($prop in $p.PSObject.Properties) {
      if ($prop.Name -notlike 'PS*') { $out += [pscustomobject]@{ src=$k.Replace('HKLM:\SOFTWARE\MICROSOFT\WINDOWS\CURRENTVERSION\','HKLM:\').Replace('HKCU:\SOFTWARE\MICROSOFT\WINDOWS\CURRENTVERSION\','HKCU:\'); name=$prop.Name; cmd=[string]$prop.Value } }
    }
  }
}
foreach ($d in @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup")) {
  if (Test-Path $d) { Get-ChildItem $d -File | ForEach-Object { $out += [pscustomobject]@{ src='STARTUP_FOLDER'; name=$_.Name; cmd=$_.FullName } } }
}
$out | ConvertTo-Json -Compress"#,
        "tasks" => r#"
@(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.State -ne 'Disabled' } | Select-Object -First 300 | ForEach-Object {
  $exe = ($_.Actions | ForEach-Object { $_.Execute }) -join ';'
  [pscustomobject]@{ name=$_.TaskName; path=$_.TaskPath; state=$_.State; exe=$exe; args=(($_.Actions | ForEach-Object { $_.Arguments }) -join ' ') }
}) | ConvertTo-Json -Compress"#,
        "tcp_ports" => r#"
$conns = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)
$names = @{}
Get-Process | ForEach-Object { $names[[int]$_.Id] = $_.ProcessName }
@($conns | Sort-Object LocalPort -Unique | Select-Object -First 200 | ForEach-Object {
  [pscustomobject]@{ addr=$_.LocalAddress; port=$_.LocalPort; pid=$_.OwningProcess; proc=$(if($names.ContainsKey([int]$_.OwningProcess)){$names[[int]$_.OwningProcess]}else{'?'}) }
}) | ConvertTo-Json -Compress"#,
        "proc_paths" => r#"
@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object -First 400 | ForEach-Object {
  [pscustomobject]@{ pid=$_.ProcessId; name=$_.Name; path=$_.ExecutablePath }
}) | ConvertTo-Json -Compress"#,
        "interfaces" => r#"
@(Get-NetIPConfiguration | ForEach-Object {
  [pscustomobject]@{
    alias=$_.InterfaceAlias
    addrs=@($_.IPv4Address | ForEach-Object { $_.IPAddress })
    v6=@($_.IPv6Address | ForEach-Object { $_.IPAddress })
    gw=$(if($_.IPv4DefaultGateway){($_.IPv4DefaultGateway|ForEach-Object{$_.NextHop}) -join ','}else{''})
    dns=@($_.DNSServer | ForEach-Object { $_.ServerAddresses })
  }
}) | ConvertTo-Json -Compress -Depth 3"#,
        "net_profile" => r#"
@(Get-NetConnectionProfile | ForEach-Object { [pscustomobject]@{ name=$_.Name; alias=$_.InterfaceAlias; category=$_.NetworkCategory } }) | ConvertTo-Json -Compress"#,
        "routes" => r#"
@(Get-NetRoute -DestinationPrefix '0.0.0.0/0','::/0' -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ dst=$_.DestinationPrefix; gw=$_.NextHop; iface=$_.InterfaceAlias; metric=$_.RouteMetric } }) | ConvertTo-Json -Compress"#,
        "arp" => r#"arp -a"#,
        "events_system" => r#"
@(Get-WinEvent -FilterHashtable @{ LogName='System'; Level=1,2 } -MaxEvents 60 -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{ time=$_.TimeCreated.ToString('MM-dd HH:mm:ss'); id=$_.Id; provider=$_.ProviderName; level=$_.LevelDisplayName }
}) | ConvertTo-Json -Compress"#,
        "events_logon" => r#"
try {
  $f = @{ LogName='Security'; Id=4625,4624; StartTime=(Get-Date).AddHours(-24) }
  $ev = @(Get-WinEvent -FilterHashtable $f -ErrorAction Stop | Select-Object -First 500)
  $fail = @($ev | Where-Object { $_.Id -eq 4625 }).Count
  $ok = @($ev | Where-Object { $_.Id -eq 4624 }).Count
  [pscustomobject]@{ ok=$ok; fail=$fail; windowHours=24 } | ConvertTo-Json -Compress
} catch { [pscustomobject]@{ error='ACCESS_DENIED_OR_EMPTY' } | ConvertTo-Json -Compress }"#,
        "gpu" => r#"
@(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverVersion; status=$_.Status; ramMB=[math]::Round($_.AdapterRAM/1MB) } }) | ConvertTo-Json -Compress"#,
        "battery" => r#"
$b = Get-CimInstance Win32_Battery
if ($b) { [pscustomobject]@{ present=$true; charge=[int]$b.EstimatedChargeRemaining; status=$b.BatteryStatus; voltage=$b.DesignVoltage } | ConvertTo-Json -Compress }
else { [pscustomobject]@{ present=$false } | ConvertTo-Json -Compress }"#,
        "pagefile" => r#"
@(Get-CimInstance Win32_PageFileUsage | ForEach-Object { [pscustomobject]@{ name=$_.Name; sizeMB=$_.AllocatedBaseSize; peakMB=$_.PeakUsage; useMB=$_.CurrentUsage } }) | ConvertTo-Json -Compress"#,
        "rdp_reg" => r#"
$p = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server'
[pscustomobject]@{ denyTS=$p.fDenyTSConnections } | ConvertTo-Json -Compress"#,
        "telemetry_reg" => r#"
$p = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection' -ErrorAction SilentlyContinue
$a = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection' -ErrorAction SilentlyContinue
$v = $null
if ($p) { $v = $p.AllowTelemetry } elseif ($a) { $v = $a.AllowTelemetry }
[pscustomobject]@{ allowTelemetry=$v } | ConvertTo-Json -Compress"#,
        "smb1" => r#"
try { $f = Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -ErrorAction Stop; [pscustomobject]@{ state=$f.State } | ConvertTo-Json -Compress }
catch { [pscustomobject]@{ error='ACCESS_DENIED_OR_UNSUPPORTED' } | ConvertTo-Json -Compress }"#,
        "disk_space" => r#"
@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  [pscustomobject]@{ drive=$_.DeviceID; sizeGB=[math]::Round($_.Size/1GB,1); freeGB=[math]::Round($_.FreeSpace/1GB,1); freePct=$(if($_.Size){[math]::Round(100*$_.FreeSpace/$_.Size,1)}else{0}) }
}) | ConvertTo-Json -Compress"#,
        _ => return None,
    };
    Some(format!("{PREAMBLE}{body}"))
}

pub struct ModuleOutput {
    pub stdout: String,
    pub stderr: String,
}

/// Run an allowlisted module. Returns parsed-ready stdout.
pub fn run_module(module: &str, timeout_secs: u64) -> Result<ModuleOutput, String> {
    let body = script(module).ok_or_else(|| format!("unknown module: {module}"))?;
    run_powershell(&body, Duration::from_secs(timeout_secs.clamp(5, 120)))
}

/// Execute a PowerShell script with output caps and hard timeout.
pub fn run_powershell(script: &str, timeout: Duration) -> Result<ModuleOutput, String> {
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;

    let out_pipe = child.stdout.take().ok_or("no stdout")?;
    let err_pipe = child.stderr.take().ok_or("no stderr")?;

    fn drain(mut p: impl Read + Send + 'static, cap: usize) -> std::thread::JoinHandle<(Vec<u8>, bool)> {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let mut chunk = [0u8; 16384];
            loop {
                match p.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let take = n.min(cap.saturating_sub(buf.len()));
                        buf.extend_from_slice(&chunk[..take]);
                    }
                }
            }
            let len = buf.len();
            (buf, len >= cap)
        })
    }

    let t_out = drain(out_pipe, MODULE_OUTPUT_CAP);
    let t_err = drain(err_pipe, 256 * 1024);

    let deadline = Instant::now() + timeout;
    let timed_out = loop {
        match child.try_wait() {
            Ok(Some(_)) => break false,
            Ok(None) => {
                if Instant::now() >= deadline {
                    if let Some(pid) = child.id().to_string().parse::<u32>().ok() {
                        let mut kill = Command::new("taskkill");
                        kill.args(["/PID", &pid.to_string(), "/T", "/F"]);
                        #[cfg(windows)]
                        kill.creation_flags(CREATE_NO_WINDOW);
                        let _ = kill.output();
                    }
                    break true;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(e) => return Err(format!("wait failed: {e}")),
        }
    };

    let (out_buf, _out_trunc) = t_out.join().unwrap_or_default();
    let (err_buf, _) = t_err.join().unwrap_or_default();

    if timed_out {
        return Err("module timed out".into());
    }
    Ok(ModuleOutput {
        stdout: String::from_utf8_lossy(&out_buf).into_owned(),
        stderr: String::from_utf8_lossy(&err_buf).into_owned(),
    })
}

/// Detail for one PID (integer-only interpolation).
pub fn proc_detail_script(pid: u32) -> String {
    format!(
        "{PREAMBLE}$p = Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\"
if ($p) {{
  $path = $p.ExecutablePath
  $sig = ''
  if ($path -and (Test-Path $path)) {{
    try {{ $s = Get-AuthenticodeSignature $path; $sig = [string]$s.Status }} catch {{}}
  }}
  [pscustomobject]@{{ pid=$p.ProcessId; name=$p.Name; path=$path; parent=$p.ParentProcessId; sig=$sig }} | ConvertTo-Json -Compress
}}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_module_rejected() {
        assert!(run_module("totally-not-a-module; rm -rf", 10).is_err());
        assert!(run_module("defender'; Start-Process calc", 10).is_err());
    }

    #[test]
    fn known_module_lists_complete() {
        for m in ["defender", "firewall", "tcp_ports"] {
            assert!(script(m).is_some(), "missing {m}");
        }
    }
}
