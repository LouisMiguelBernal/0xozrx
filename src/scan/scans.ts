import type { Category, Finding, ScanKind, ScanRecord, Severity } from "../types/system";
import { computeScore } from "../engine/scoring";
import { auditAppend, listScans, localTargets, pickModel, runModule, saveScan } from "../lib/ipc";
import { useLive, useSettings } from "../store/settings";
import type { ConsoleEngine } from "../engine/console";

/* ---------------- module data shapes (subset we consume) ---------------- */

export interface DefenderRaw {
  av?: boolean; rt?: boolean; amService?: boolean; runningMode?: string;
  sigLast?: string | null; quickScan?: string | null; error?: string;
}
export interface FirewallRaw { name: string; enabled: boolean; inbound: string; outbound: string }
export interface UacRaw { enableLUA: number; consentAdmin: number; secureDesktop: number }
export interface BitlockerRaw { mount: string; status: string; protection: number; pct: number }
export interface SecureBootRaw { secureBoot?: boolean; error?: string }
export interface TpmRaw { present?: boolean; ready?: boolean; enabled?: boolean; error?: string }
export interface UpdatesRaw { count: number; lastId: string; lastDesc: string; lastOn: string | null }
export interface ServiceRow { name: string; display: string; state: string; start: string; path: string; account: string }
export interface StartupRow { src: string; name: string; cmd: string }
export interface TaskRow { name: string; path: string; state: string; exe: string; args: string }
export interface TcpPortRow { addr: string; port: number; pid: number; proc: string }
export interface ProcPathRow { pid: number; name: string; path: string }
export interface IfaceRow { alias: string; addrs: string[]; v6: string[]; gw: string; dns: string[] }
export interface ProfileRow { name: string; alias: string; category: string }
export interface RouteRow { dst: string; gw: string; iface: string; metric: number }
export interface EventRow { time: string; id: number; provider: string; level: string }
export interface LogonRaw { ok?: number; fail?: number; windowHours?: number; error?: string }
export interface GpuRaw { name: string; driver: string; status: string; ramMB: number }
export interface BatteryRaw { present: boolean; charge?: number; status?: number }
export interface PagefileRaw { name: string; sizeMB: number; peakMB: number; useMB: number }
export interface RdpRaw { denyTS: number }
export interface TelemetryRaw { allowTelemetry: number | null }
export interface Smb1Raw { state?: string; error?: string }
export interface DiskSpaceRow { drive: string; sizeGB: number; freeGB: number; freePct: number }

/* ---------------- fetchers ---------------- */

async function mod<T>(eng: ConsoleEngine, module: string): Promise<T | null> {
  try {
    return await runModule<T>(module);
  } catch (e) {
    eng.tag("WARN", `module ${module} unavailable: ${short(String(e))} - marked UNKNOWN`);
    return null;
  }
}
const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 90);

/* ---------------- analyzer context ---------------- */

class Collector {
  findings: Finding[] = [];
  private n = 0;
  constructor(readonly kind: ScanKind | "mock") {}
  add(sev: Severity, category: Category, title: string, evidence: string, recommendation?: string, confidence: "HIGH" | "MEDIUM" | "LOW" = "HIGH"): void {
    this.n += 1;
    this.findings.push({
      id: `${this.kind.slice(0, 3).toUpperCase()}-${String(this.n).padStart(4, "0")}`,
      title,
      severity: sev,
      confidence,
      category,
      evidence,
      recommendation,
    });
  }
}

/* ---------------- analyzers ---------------- */

export function analyzeDefender(d: DefenderRaw | null, c: Collector): void {
  if (!d || d.error) return;
  if (d.av === false) c.add("CRITICAL", "DEFENDER", "Microsoft Defender antivirus disabled", "AntivirusEnabled=false", "Re-enable antivirus protection immediately.");
  if (d.rt === false) c.add("HIGH", "DEFENDER", "Real-time protection disabled", "RealTimeProtectionEnabled=false", "Turn real-time protection back on in Windows Security.");
  if ((d.runningMode ?? "").toLowerCase().includes("passive")) c.add("HIGH", "DEFENDER", "Defender in passive mode", `AMRunningMode=${d.runningMode}`, "Another AV may be active; verify intentional.");
  if (d.sigLast && daysSince(d.sigLast) > 14) c.add("MEDIUM", "DEFENDER", "Signature updates stale", `last update ${d.sigLast}`, "Run a definition update.");
}
function daysSince(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : 9999;
}

export function analyzeFirewall(list: FirewallRaw[] | null, c: Collector): void {
  if (!Array.isArray(list)) return;
  for (const p of list) {
    if (!p.enabled) c.add(p.name === "Public" ? "CRITICAL" : "HIGH", "FIREWALL", `${p.name} firewall profile disabled`, `${p.name}: Enabled=False`, "Enable this profile in Windows Security > Firewall.");
    if ((p.inbound ?? "").toLowerCase() === "allow")
      c.add("HIGH", "FIREWALL", `${p.name} profile allows inbound by default`, `${p.name}: DefaultInboundAction=Allow`, "Set default inbound to Block unless explicitly allowed.");
  }
}

export function analyzeUac(u: UacRaw | null, c: Collector): void {
  if (!u) return;
  if (u.enableLUA === 0) c.add("CRITICAL", "ACCOUNTS", "UAC disabled", "EnableLUA=0", "Re-enable User Account Control.");
  else if (u.consentAdmin === 0) c.add("MEDIUM", "ACCOUNTS", "Elevations silently approved", "ConsentPromptBehaviorAdmin=0", "Require prompting for admin approvals.");
  if (u.secureDesktop === 0 && u.enableLUA !== 0) c.add("LOW", "ACCOUNTS", "UAC secure desktop off", "PromptOnSecureDesktop=0", "Enable secure desktop for prompts.");
}

export function analyzeBitLocker(vols: BitlockerRaw[] | null, c: Collector): void {
  if (!Array.isArray(vols) || vols.length === 0) return;
  for (const v of vols) {
    if (/^[A-Z]:\\?$/i.test(v.mount) && v.protection !== 1)
      c.add(/C:/i.test(v.mount) ? "HIGH" : "LOW", "DISKCRYPT", `BitLocker not protecting ${v.mount}`, `${v.mount} status=${v.status} protection=${v.protection}`, "Enable device encryption for fixed drives.", /C:/i.test(v.mount) ? "HIGH" : "MEDIUM");
  }
}

export function analyzeSecureBoot(s: SecureBootRaw | null, c: Collector): void {
  if (!s) return;
  if (s.error) c.add("INFO", "ACCOUNTS", "Secure Boot requires admin to verify", s.error, undefined, "HIGH");
  else if (s.secureBoot === false) c.add("MEDIUM", "ACCOUNTS", "Secure Boot disabled", "Confirm-SecureBootUEFI=False", "Enable Secure Boot in firmware settings.");
}

export function analyzeTpm(t: TpmRaw | null, c: Collector): void {
  if (!t) return;
  if (t.error) c.add("INFO", "ACCOUNTS", "TPM state requires admin to verify", t.error, undefined, "HIGH");
  else if (t.present === false) c.add("MEDIUM", "ACCOUNTS", "No TPM present/visible", "TpmPresent=false", "Check firmware TPM (PTT/fTPM) settings.");
}

export function analyzeUpdates(u: UpdatesRaw | null, c: Collector): void {
  if (!u) return;
  const age = u.lastOn ? daysSince(u.lastOn) : null;
  if (age === null) {
    c.add("MEDIUM", "UPDATES", "Update history unreadable or empty", "Get-HotFix returned nothing", "Verify Windows Update service.", "MEDIUM");
    return;
  }
  if (age > 120) c.add("HIGH", "UPDATES", `Last cumulative hotfix is ${age} days old`, `last=${u.lastOn} (${u.lastId})`, "Check Windows Update and install pending fixes.");
  else if (age > 60) c.add("MEDIUM", "UPDATES", `Patches may be pending (${age}d since ${u.lastId})`, `last=${u.lastOn}`, "Review Windows Update queue.");
  else if (age > 21) c.add("LOW", "UPDATES", `Routine patch cadence (${age}d)`, `last=${u.lastOn}`);
}

const WRITABLE = /(\\Temp\\|\\Downloads\\|AppData\\Local\\Temp)/i;

export function analyzeServices(list: ServiceRow[] | null, c: Collector): void {
  if (!Array.isArray(list)) return;
  let flagged = 0;
  for (const s of list) {
    if (flagged >= 5) break;
    if (WRITABLE.test(s.path)) {
      flagged++;
      c.add("HIGH", "SERVICES", `Service runs from user-writable path: ${s.name}`, `${s.display} -> ${s.path}`, "Verify publisher; relocate binary to a protected directory.");
    }
  }
  const missing = Array.isArray(list) ? list.filter((s) => !s.path || s.path.trim().length < 4) : [];
  if (missing.length) c.add("MEDIUM", "SERVICES", `${missing.length} service(s) report empty/unreadable paths`, missing.slice(0, 3).map((m) => m.name).join(", "), "Inspect these services manually.", "MEDIUM");
}

export function analyzeStartup(rows: StartupRow[] | null, c: Collector): void {
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    if (WRITABLE.test(r.cmd)) c.add("HIGH", "STARTUP", `Startup item executes from user-writable path: ${r.name}`, `${r.src} :: ${r.cmd}`, "Remove or investigate this autorun entry.", "HIGH");
    else if (/RunOnce/i.test(r.src)) c.add("MEDIUM", "STARTUP", `RunOnce entry: ${r.name}`, r.cmd, "Confirm legitimacy; RunOnce items vanish after next logon.", "MEDIUM");
  }
}

export function analyzeTasks(rows: TaskRow[] | null, c: Collector): void {
  if (!Array.isArray(rows)) return;
  let flagged = 0;
  for (const t of rows) {
    if (flagged >= 5) break;
    if (t.exe && WRITABLE.test(t.exe)) {
      flagged++;
      c.add("HIGH", "STARTUP", `Scheduled task executes from user-writable dir: ${t.name}`, `${t.path}${t.name} -> ${t.exe} ${t.args}`.trim(), "Inspect task action and remove if unknown.");
    }
  }
}

export function analyzePorts(rows: TcpPortRow[] | null, c: Collector): "LOW" | "MODERATE" | "ELEVATED" {
  if (!Array.isArray(rows)) return "MODERATE";
  const external = rows.filter((r) => !isLoopbackAddr(r.addr));
  if (external.some((r) => r.port === 3389)) c.add("HIGH", "EXPOSURE", "RDP listening on non-loopback address", rows.filter((r) => r.port === 3389).map(fmtPort).join(", "), "Restrict RDP or require VPN/NLA if unintended.");
  if (external.some((r) => r.port === 445 || r.port === 139)) c.add("MEDIUM", "EXPOSURE", "SMB listening on non-loopback address", fmtPort(external.find((r) => r.port >= 139 && r.port <= 445)), "Expected on LAN shares; ensure profiles are firewalled.");
  if (external.length > 10) c.add("MEDIUM", "NETWORK", `${external.length} services listen beyond localhost`, external.slice(0, 8).map(fmtPort).join(", "), "Disable unneeded services or bind them to loopback.", "MEDIUM");
  else if (external.length > 0) c.add("INFO", "EXPOSURE", `${external.length} LAN-bound listener(s)`, external.slice(0, 6).map(fmtPort).join(", "));
  return external.length > 10 ? "ELEVATED" : external.length > 0 ? "MODERATE" : "LOW";
}
const isLoopbackAddr = (a: string) => a === "127.0.0.1" || a === "::1";
const fmtPort = (r: TcpPortRow | undefined): string => (r ? `${r.addr}:${r.port} (${r.proc})` : "");

export function analyzeProcPaths(rows: ProcPathRow[] | null, c: Collector): void {
  if (!Array.isArray(rows)) return;
  let flagged = 0;
  for (const p of rows) {
    if (flagged >= 6) break;
    if (WRITABLE.test(p.path)) {
      flagged++;
      c.add("HIGH", "APPS", `Process running from user temp/downloads: ${p.name}`, `pid=${p.pid} ${p.path}`, "If unexpected, terminate and investigate origin.");
    }
  }
}

export function analyzeLogon(l: LogonRaw | null, c: Collector): void {
  if (!l) return;
  if (l.error) { c.add("INFO", "ACCOUNTS", "Security log requires admin (logon stats skipped)", l.error); return; }
  if ((l.fail ?? 0) >= 50) c.add("HIGH", "ACCOUNTS", `${l.fail} failed logons in ${l.windowHours}h`, "EventID=4625 burst", "Investigate sources; consider lockout policy review.");
  else if ((l.fail ?? 0) >= 10) c.add("MEDIUM", "ACCOUNTS", `${l.fail} failed logons in ${l.windowHours}h`, "EventID=4625", "Check whether these are your own typos vs attacks.", "MEDIUM");
}

export function analyzeDisks(rows: DiskSpaceRow[] | null, c: Collector): void {
  if (!Array.isArray(rows)) return;
  for (const d of rows) {
    if (d.freePct < 5) c.add("HIGH", "HEALTH", `Drive ${d.drive} nearly full (${d.freePct}% free)`, `${d.freeGB} GB free of ${d.sizeGB} GB`, "Free space - low disk harms update/install reliability.");
    else if (d.freePct < 12) c.add("MEDIUM", "HEALTH", `Drive ${d.drive} low on space (${d.freePct}% free)`, `${d.freeGB} GB free`);
  }
}

export function analyzePrivacy(prof: ProfileRow[] | null, rdp: RdpRaw | null, tel: TelemetryRaw | null, smb: Smb1Raw | null, c: Collector): void {
  if (Array.isArray(prof))
    for (const p of prof)
      if (p.category === "Public") c.add("MEDIUM", "PRIVACY", `Network '${p.name}' classified Public`, `${p.alias}: NetworkCategory=Public`, "Public classification is conservative-safe; confirm it matches reality.");
  if (rdp?.denyTS === 0) c.add("MEDIUM", "PRIVACY", "Remote Desktop enabled", "fDenyTSConnections=0", "Disable if not required; otherwise restrict access.");
  if (tel?.allowTelemetry != null && tel.allowTelemetry > 0) c.add("LOW", "PRIVACY", `Telemetry level ${tel.allowTelemetry}`, "AllowTelemetry registry value", "Consider reducing diagnostic data level.", "MEDIUM");
  if (smb?.state === "Enabled") c.add("HIGH", "PRIVACY", "Legacy SMBv1 enabled", "Optional feature SMB1Protocol=Enabled", "Disable SMBv1 (worm-era protocol).");
}

/* ---------------- orchestrator ---------------- */

let latestRecord: ScanRecord | null = null;
export function getLatestScan(): ScanRecord | null {
  return latestRecord;
}
export function setLatestScan(r: ScanRecord | null): void {
  latestRecord = r;
}

export async function loadLatestMeta(): Promise<void> {
  try {
    const metas = await listScans();
    const top = metas[0];
    useLive.getState().setLatestScore(top && typeof top.score === "number" ? top.score : null);
  } catch {
    /* first run */
  }
}

export async function runScan(eng: ConsoleEngine, kind: ScanKind): Promise<ScanRecord> {
  const startedAt = Date.now();
  eng.tag("SCAN", `starting ${kind.toUpperCase()} endpoint scan...`);
  void auditAppend("scan.start", { kind });

  const c = new Collector(kind);
  const sys = useLive.getState().sysInfo;
  let exposure: "LOW" | "MODERATE" | "ELEVATED" | undefined;

  /* quick/full/security */
  if (kind === "quick" || kind === "full" || kind === "security") {
    eng.tag("DIM", "[1] defender"); analyzeDefender(await mod<DefenderRaw>(eng, "defender"), c);
    eng.tag("DIM", "[2] firewall"); analyzeFirewall(await mod<FirewallRaw[]>(eng, "firewall"), c);
    eng.tag("DIM", "[3] uac"); analyzeUac(await mod<UacRaw>(eng, "uac"), c);
    eng.tag("DIM", "[4] startup+tasks");
    analyzeStartup(await mod<StartupRow[]>(eng, "startup"), c);
    analyzeTasks(await mod<TaskRow[]>(eng, "tasks"), c);
  }
  if (kind === "full" || kind === "security") {
    eng.tag("DIM", "[5] disk encryption"); analyzeBitLocker(await mod<BitlockerRaw[]>(eng, "bitlocker"), c);
    eng.tag("DIM", "[6] secure boot + tpm");
    analyzeSecureBoot(await mod<SecureBootRaw>(eng, "secureboot"), c);
    analyzeTpm(await mod<TpmRaw>(eng, "tpm"), c);
    eng.tag("DIM", "[7] patches"); analyzeUpdates(await mod<UpdatesRaw>(eng, "updates"), c);
    eng.tag("DIM", "[8] services"); analyzeServices(await mod<ServiceRow[]>(eng, "services"), c);
    eng.tag("DIM", "[9] processes"); analyzeProcPaths(await mod<ProcPathRow[]>(eng, "proc_paths"), c);
    eng.tag("DIM", "[10] disks"); analyzeDisks(await mod<DiskSpaceRow[]>(eng, "disk_space"), c);
  }

  /* network exposure slice included in full/security */
  if (kind === "full" || kind === "security") {
    eng.tag("DIM", "[11] listeners");
    exposure = analyzePorts(await mod<TcpPortRow[]>(eng, "tcp_ports"), c);
  }

  if (kind === "network") {
    const portsN = await mod<TcpPortRow[]>(eng, "tcp_ports");
    exposure = analyzePorts(portsN, c);
    printTable(eng, ["ADDR", "PORT", "PID", "PROC"], (portsN ?? []).slice(0, 40).map((r) => [r.addr, String(r.port), String(r.pid), r.proc]));
  }
  if (kind === "startup") {
    analyzeStartup(await mod<StartupRow[]>(eng, "startup"), c);
    analyzeTasks(await mod<TaskRow[]>(eng, "tasks"), c);
    analyzeServices(await mod<ServiceRow[]>(eng, "services"), c);
  }
  if (kind === "processes") {
    analyzeProcPaths(await mod<ProcPathRow[]>(eng, "proc_paths"), c);
  }
  if (kind === "events") {
    const ev = await mod<EventRow[]>(eng, "events_system");
    if (Array.isArray(ev) && ev.length) {
      c.add("INFO", "HEALTH", `${ev.length} critical/error system events (recent window)`, ev.slice(0, 3).map((e) => `${e.time} ${e.provider}`).join("; "));
      printTable(eng, ["TIME", "ID", "PROVIDER"], ev.slice(0, 15).map((e) => [e.time, String(e.id), e.provider]));
    }
    analyzeLogon(await mod<LogonRaw>(eng, "events_logon"), c);
  }
  if (kind === "privacy") {
    analyzePrivacy(
      await mod<ProfileRow[]>(eng, "net_profile"),
      await mod<RdpRaw>(eng, "rdp_reg"),
      await mod<TelemetryRaw>(eng, "telemetry_reg"),
      await mod<Smb1Raw>(eng, "smb1"),
      c
    );
    analyzeLogon(await mod<LogonRaw>(eng, "events_logon"), c);
    const tgts = await localTargets();
    c.add("INFO", "EXPOSURE", "Local addresses visible on this host", tgts.join(", "));
  }

  const score = computeScore(c.findings);
  const record: ScanRecord = {
    id: "",
    kind,
    startedAt,
    durationMs: Date.now() - startedAt,
    host: sys?.hostname ?? "?",
    os: sys ? `${sys.os_name} ${sys.os_version}` : "?",
    mock: false,
    findings: c.findings.sort(bySeverity),
    score,
    ...(exposure ? { exposure } : {}),
  };
  try {
    const saved = await saveScan(record);
    record.id = saved.id;
    useLive.getState().setLatestScore(score.total);
    void auditAppend("scan.done", { id: record.id, kind, score: score.total, findings: c.findings.length });
  } catch (e) {
    eng.tag("WARN", `could not persist scan: ${String(e)}`);
  }
  setLatestScan(record);
  return record;
}

const bySeverity = (a: Finding, b: Finding): number =>
  ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 }[a.severity] -
   ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 }[b.severity]));

/* ---------------- shared table printer ---------------- */

export function printTable(eng: ConsoleEngine, header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").slice(0, 42).length)));
  const line = (cells: string[]) => cells.map((cell, i) => (cell ?? "").slice(0, 42).padEnd(widths[i])).join("  ");
  eng.raw(line(header) + "\r\n");
  eng.raw("\x1b[2m" + widths.map((w) => "-".repeat(w)).join("  ") + "\x1b[0m\r\n");
  for (const r of rows) eng.raw(line(r) + "\r\n");
}

export async function refreshOllamaModel(): Promise<void> {
  const pick = await pickModel("http://127.0.0.1:11434");
  useLive.getState().setAiModel(pick.model);
}

export function mockBanner(eng: ConsoleEngine): boolean {
  if (useSettings.getState().mockMode) {
    eng.tag("WARN", "MOCK MODE ACTIVE - results below are SYNTHETIC and labeled MOCK DATA.");
    return true;
  }
  return false;
}
