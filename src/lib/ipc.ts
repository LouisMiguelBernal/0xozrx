import { invoke } from "@tauri-apps/api/core";
import type {
  AdminResult,
  AdminStatus,
  AiOptions,
  AiReply,
  CleanReport,
  CleanResult,
  ModelInfo,
  ModelPick,
  OllamaStatus,
  ProcRow,
  ResourceTick,
  ScanMeta,
  ScanRecord,
  ShellResult,
  SystemInfo,
  TcpScanReport,
  WarmResult,
} from "../types/system";

/**
 * True only inside the Tauri webview. `npm run dev` opens the UI in a plain
 * browser where no IPC exists, so window controls and probes must no-op
 * instead of throwing during render.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getSystemInfo(): Promise<SystemInfo> {
  return invoke<SystemInfo>("get_system_info");
}

export async function getResources(): Promise<ResourceTick> {
  return invoke<ResourceTick>("get_resources");
}

export async function getTopProcesses(limit: number): Promise<ProcRow[]> {
  return invoke<ProcRow[]>("top_processes", { limit });
}

export async function checkOllama(endpoint: string): Promise<OllamaStatus> {
  return invoke<OllamaStatus>("check_ollama", { endpoint });
}

export async function execShell(line: string, timeoutSecs = 30): Promise<ShellResult> {
  return invoke<ShellResult>("exec_shell", { line, timeoutSecs });
}

/** Allowlisted PowerShell module runner (compile-time scripts, backend-side). */
export async function runModule<T = unknown>(module: string, timeoutSecs?: number): Promise<T> {
  const raw = await invoke<string>("run_module", { module, timeoutSecs });
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null") return {} as T;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // arp etc. may emit text
    return trimmed as unknown as T;
  }
}

export async function procDetail(pid: number): Promise<{
  pid: number;
  name: string;
  path: string | null;
  parent: number;
  sig: string;
}> {
  return invoke("proc_detail", { pid });
}

export async function isElevated(): Promise<boolean> {
  return invoke<boolean>("is_elevated");
}

/** Relaunch elevated via UAC; current instance exits on success. */
export async function elevateRelaunch(): Promise<boolean> {
  return invoke<boolean>("elevate_relaunch");
}

export async function tcpScan(
  target: string,
  ports: number[],
  timeoutMs?: number,
  concurrency?: number
): Promise<TcpScanReport> {
  return invoke<TcpScanReport>("tcp_scan", { target, ports, timeoutMs, concurrency });
}

export async function localTargets(): Promise<string[]> {
  return invoke<string[]>("local_targets");
}

export async function pickModel(endpoint: string): Promise<ModelPick> {
  return invoke<ModelPick>("pick_model", { endpoint });
}

export async function aiChat(
  endpoint: string,
  model: string,
  messages: { role: string; content: string }[],
  timeoutSecs?: number,
  opts: { options?: AiOptions; keepAlive?: string; think?: boolean } = {}
): Promise<AiReply> {
  return invoke<AiReply>("ai_chat", {
    endpoint,
    model,
    messages,
    timeoutSecs,
    options: opts.options ?? null,
    keepAlive: opts.keepAlive ?? null,
    think: opts.think ?? null,
  });
}

/** Introspect a local model (family, quant, context window, capabilities). */
export async function modelInfo(endpoint: string, model: string): Promise<ModelInfo> {
  return invoke<ModelInfo>("model_info", { endpoint, model });
}

/** Preload a model into VRAM so the first real question is not a cold start. */
export async function warmModel(
  endpoint: string,
  model: string,
  keepAlive?: string,
  timeoutSecs?: number
): Promise<WarmResult> {
  return invoke<WarmResult>("warm_model", { endpoint, model, keepAlive, timeoutSecs });
}

/* ------------------------------- admin ------------------------------- */

/** Elevation state + the allowlisted hardening action catalog. */
export async function adminStatus(): Promise<AdminStatus> {
  return invoke<AdminStatus>("admin_status");
}

/**
 * Apply one allowlisted hardening action. `confirm` must equal `id`; the
 * backend refuses otherwise, so this can only run behind a real confirmation.
 */
export async function adminApply(
  id: string,
  confirm: string,
  timeoutSecs?: number
): Promise<AdminResult> {
  return invoke<AdminResult>("admin_apply", { id, confirm, timeoutSecs });
}

/* ------------------------------ cleanup ------------------------------ */

/** Dry-run: measure everything `cleanApply` would remove. Read-only. */
export async function cleanScan(minAgeMins?: number): Promise<CleanReport> {
  return invoke<CleanReport>("clean_scan", { minAgeMins });
}

/** Delete the contents of the named allowlisted targets. `confirm` = "CLEAN". */
export async function cleanApply(
  targets: string[],
  confirm: string,
  minAgeMins?: number
): Promise<CleanResult> {
  return invoke<CleanResult>("clean_apply", { targets, confirm, minAgeMins });
}

/** Empty the Recycle Bin. `confirm` = "EMPTY-RECYCLE-BIN". Unrecoverable. */
export async function emptyRecycleBin(confirm: string): Promise<string> {
  return invoke<string>("empty_recycle_bin", { confirm });
}

export async function saveScan(record: Partial<ScanRecord>): Promise<ScanRecord> {
  return invoke<ScanRecord>("save_scan", { record });
}

export async function listScans(): Promise<ScanMeta[]> {
  return invoke<ScanMeta[]>("list_scans");
}

export async function getScan(id: string): Promise<ScanRecord> {
  return invoke<ScanRecord>("get_scan", { id });
}

export async function saveBaseline(snapshot: unknown): Promise<void> {
  await invoke("save_baseline", { snapshot });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getBaseline(): Promise<any | null> {
  return invoke("get_baseline");
}

export async function auditAppend(action: string, detail?: unknown): Promise<void> {
  await invoke("audit_append", { action, detail });
}

export async function auditTail(n = 30): Promise<{ ts: string; action: string; detail?: unknown }[]> {
  return invoke("audit_tail", { n });
}

export async function writeReport(filename: string, content: string): Promise<string> {
  return invoke<string>("write_report", { filename, content });
}

export async function sha256Hex(content: string): Promise<string> {
  return invoke<string>("sha256_hex", { content });
}

export async function openReportsDir(): Promise<void> {
  await invoke("open_reports_dir");
}
