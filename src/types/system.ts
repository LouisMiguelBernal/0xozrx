export interface SystemInfo {
  hostname: string;
  username: string;
  os_name: string;
  os_version: string;
  os_build: string;
  kernel: string;
  arch: string;
  cpu_model: string;
  cpu_cores_logical: number;
  cpu_cores_physical: number;
  total_mem_bytes: number;
  uptime_secs: number;
}

export interface DiskInfo {
  name: string;
  mount: string;
  fs: string;
  total_bytes: number;
  free_bytes: number;
}

export interface NetRate {
  id: string;
  rx_bps: number;
  tx_bps: number;
}

export interface ResourceTick {
  cpu_pct: number;
  mem_used_bytes: number;
  mem_total_bytes: number;
  mem_pct: number;
  disks: DiskInfo[];
  nets: NetRate[];
  uptime_secs: number;
  ts_ms: number;
}

export interface ProcRow {
  pid: number;
  name: string;
  cpu_pct: number;
  mem_bytes: number;
}

export interface OllamaStatus {
  online: boolean;
  endpoint: string;
  models: string[];
  error?: string;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
}

/* ---------------- findings / scans ---------------- */

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type Category =
  | "DEFENDER"
  | "FIREWALL"
  | "UPDATES"
  | "ACCOUNTS"
  | "STARTUP"
  | "SERVICES"
  | "NETWORK"
  | "DISKCRYPT"
  | "PRIVACY"
  | "HEALTH"
  | "APPS"
  | "EXPOSURE";

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  category: Category;
  evidence: string;
  recommendation?: string;
}

export interface ScoreResult {
  total: number;
  breakdown: { category: Category; lost: number; max: number }[];
  counts: Record<Severity, number>;
}

export type ScanKind =
  | "quick"
  | "full"
  | "security"
  | "network"
  | "startup"
  | "processes"
  | "events"
  | "privacy";

export interface ScanRecord {
  id: string;
  kind: ScanKind | "mock";
  startedAt: number;
  durationMs: number;
  host: string;
  os: string;
  mock: boolean;
  findings: Finding[];
  score: ScoreResult;
  exposure?: "LOW" | "MODERATE" | "ELEVATED";
}

export interface ScanMeta {
  id: string;
  kind: unknown;
  startedAt: unknown;
  findings: number;
  score: number | null;
}

export interface TcpPortEntry {
  addr: string;
  port: number;
  pid: number;
  proc: string;
}

export interface TcpScanReport {
  target: string;
  scanned: number;
  open: [number, string][];
  elapsed_ms: number;
  refused_reason: string | null;
}

export interface AiReply {
  content: string;
  /** Reasoning trace; present only when thinking mode was requested. */
  thinking: string | null;
  model: string;
  latency_ms: number;
  prompt_tokens: number | null;
  response_tokens: number | null;
  /** Milliseconds Ollama spent loading the model (large => cold start). */
  load_ms: number | null;
  done_reason: string | null;
}

export interface ModelPick {
  model: string | null;
  reason: string;
  models: string[];
  /** True when the selection is the tag this workstation is tuned for. */
  preferred: boolean;
  /** Tag to `ollama pull` when nothing suitable is installed. */
  recommended: string;
}

export interface ModelInfo {
  model: string;
  family: string | null;
  parameter_size: string | null;
  quantization: string | null;
  context_length: number | null;
  capabilities: string[];
  thinking: boolean;
}

export interface WarmResult {
  model: string;
  loaded: boolean;
  load_ms: number;
  error: string | null;
}

/** Sampling knobs forwarded to Ollama (backend allowlists the keys). */
export interface AiOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_ctx?: number;
  num_predict?: number;
  repeat_penalty?: number;
  seed?: number;
}

/* ---------------- admin control surface ---------------- */

export interface AdminAction {
  id: string;
  title: string;
  detail: string;
  revert: string;
  requires_admin: boolean;
  impact: "LOW" | "MED" | "HIGH";
  group: string;
}

export interface AdminStatus {
  elevated: boolean;
  username: string;
  hostname: string;
  actions: AdminAction[];
}

export interface AdminResult {
  id: string;
  ok: boolean;
  output: string;
  error: string | null;
  elapsed_ms: number;
}

/* ---------------- cleanup ---------------- */

export interface CleanTargetReport {
  id: string;
  title: string;
  note: string;
  requires_admin: boolean;
  path: string | null;
  available: boolean;
  skipped_reason: string | null;
  bytes: number;
  files: number;
}

export interface CleanReport {
  elevated: boolean;
  min_age_mins: number;
  total_bytes: number;
  total_files: number;
  targets: CleanTargetReport[];
  elapsed_ms: number;
}

export interface CleanTargetResult {
  id: string;
  removed: number;
  failed: number;
  bytes_freed: number;
  error: string | null;
}

export interface CleanResult {
  dry_run: boolean;
  bytes_freed: number;
  removed: number;
  failed: number;
  results: CleanTargetResult[];
  elapsed_ms: number;
}
