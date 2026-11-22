# Roadmap

- [x] **PHASE 1 — Workstation shell** (v0.1.0)
  Tauri 2 + React + TS; xterm sentinel console (parser/registry/history/
  completion/paste guard); resizable preset workbench; live telemetry;
  Ollama probe; wallpaper system; strict CSP + least-privilege capabilities.

- [x] **PHASE 2 — System information & health**
  Real `health` command: uptime/CPU/RAM vitals, disks, GPU enumeration,
  battery, pagefile, driver-level data via CIM modules.

- [x] **PHASE 3 — Security scanners**
  Defender status/signatures, firewall profiles, UAC, BitLocker, Secure Boot,
  TPM, patch age. All unelevated-first with graceful REQUIRES-ADMIN marking.

- [x] **PHASE 4 — Process/service/startup/task analysis**
  Services w/ path heuristics (user-writable dirs), Run/RunOnce keys,
  startup folders, scheduled tasks, per-process Authenticode inspection
  (`inspect <pid>`).

- [x] **PHASE 5 — Network security module**
  Listeners ↔ PID/process mapping, interfaces/DNS/routes, exposure rating
  (LOW/MODERATE/ELEVATED), loopback vs LAN binding distinction.

- [x] **PHASE 6 — Event log analysis**
  Recent critical/error timeline, 24h logon success/failure stats
  (admin-gated), integrated into scans.

- [x] **PHASE 7 — Security scoring engine**
  Transparent severity×category-cap scoring with breakdowns; unit-tested.

- [x] **PHASE 8 — Persistence layer**
  File-backed JSON store under app-data: scan records + index, baseline,
  append-only audit trail (`audit` command). SQLite upgrade path documented.

- [x] **PHASE 9 — Reporting**
  HTML/JSON/MD export with automatic secret redaction and SHA-256 integrity
  hash; opens reports folder.

- [x] **PHASE 10 — AI assistant**
  Local-only Ollama chat; model auto-pick preferring `gemma*e4b*`;
  structured scan context injection; OBSERVED/INFERRED/UNKNOWN discipline;
  redaction before any model I/O; `ai>` REPL mode.

- [x] **PHASE 11 — OPSEC module**
  Network classification, RDP, SMBv1, telemetry level, local address
  exposure — framed as privacy + attack-surface reduction.

- [x] **PHASE 12 — Authorized pentest workspace (LEVEL 1)**
  Backend-enforced private-range TCP connect scanner, typed authorization
  gate for LAN targets (audit-logged), conservative defaults, observe-only.
  LEVEL 2/3 lab features intentionally deferred pending hardening pass.

- [x] **PHASE 13 — Baseline/drift detection**
  Snapshot processes/services/ports/startup/tasks; NEW/REMOVED diff report.

- [ ] **PHASE 14 — Installer/portable release build** (NSIS configured;
       release signing + portable variant pending)
- [x] **PHASE 15 — Admin control surface, cleanup engine, Arch theming**
  Allowlisted reversible hardening actions (`admin`) behind an exact-match
  catalog + confirmation token + backend elevation check + audit trail;
  path-guarded temp/cache reclaim engine (`clean`) with dry-run default,
  age filter and protected-path denylist; `gemma4:e4b` pinned as the tuned
  model with warm-up, introspection and reasoning-mode control (`model`);
  Arch-flavoured backdrop/palette driven entirely by the live accent.
  Still open from the original phase scope: SFC/DISM gated repairs,
  firewall rule viewer, fuzzed parser tests.
- [ ] **PHASE 16 — Docs/testing completion** (integration test matrix,
       example reports in repo)
