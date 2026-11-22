# Security Model

## Threat model for 0xOZrx!! itself

| Threat | Mitigation |
|---|---|
| Command injection into internal logic | Scanners run ONLY compile-time PowerShell constants selected by exact-match key (`run_module` allowlist). User input never becomes a command string. `shell` passthrough is explicitly user-driven, like any terminal. |
| Escape-sequence injection from external output | External stdout/stderr ANSI-stripped before terminal render. |
| XSS in WebView / reports | Strict CSP (`script-src 'self'`); report HTML entity-escapes every interpolated value; no remote origins. |
| Arbitrary file read/write via IPC | Asset protocol scope limited to user-content dirs; report writes restricted to app-data `reports/` with filename charset + extension + size validation; persistence IDs charset-validated. |
| Over-broad Tauri capabilities | Only window controls + dialog open + core defaults exposed. No fs/shell/http plugins in the webview. |
| Runaway processes | Every spawned process: hard timeout, process-tree kill (integer-only args), 6 MiB module / 512 KiB shell output caps, `CREATE_NO_WINDOW`. |
| SSRF via Ollama probe/chat | Endpoint must be http(s), default localhost only; context payload capped; bounded timeouts. |
| Unauthorized network testing | Backend refuses scan targets outside loopback/RFC1918/ULA regardless of UI state; LAN additionally requires typed per-session authorization (audit-logged). Ports <=1024, concurrency <=128, timeout <=3s. |
| Secret leakage into AI/reports | Redaction pipeline (API keys, PEM blocks, bearers, password assignments) applied before model context and exports. |
| Log/terminal injection | Tagged writer prefixes all lines; audit trail append-only JSONL. |
| Unintended system mutation via IPC | `admin_apply` runs only compile-time-constant scripts chosen by exact-match id, refuses unless `confirm == id`, re-checks elevation backend-side, and audit-logs start+done. The UI adds a 6s armed-confirm step showing the change and its revert. |
| Destructive deletion via the cleanup engine | Targets are an allowlist of `(env var, sub-path, guard segment)` triples - the webview passes ids, never paths. Roots must clear a protected-path denylist (drive roots, Windows/System32/Program Files/ProgramData/Users, profile Desktop/Documents/Downloads/Pictures). Only entries *inside* a root are removed; reparse points are skipped, not traversed; entries newer than `--age` (default 60 min) are left alone; `confirm == "CLEAN"` required. Recycle Bin is a separate command with its own token. |
| Prompt-context bloat / unbounded model options | `ai_chat` allowlists sampling keys (numeric only) and applies safe defaults; unknown keys are dropped. |

## Privilege model

- Default: `asInvoker` — silent start, no UAC. Least privilege by design.
- Opt-in elevation: the `elevate` command relaunches via ShellExecute runas
  (one UAC prompt); the unelevated instance exits. Elevation state is shown
  at boot, in `status`, in the status bar, and audit-logged as
  `session.start`.
- Admin-gated data (Secure Boot, TPM, Security log) is reported as
  REQUIRES-ADMIN when unelevated; real values when elevated.
- Mutating admin actions and admin-only cleanup targets are refused backend-
  side when unelevated - the UI disabling a button is presentation, not the
  control. See `docs/ADMIN-AND-CLEANUP.md` for the full gate chain.
- Guardrails independent of privilege level:
  - module runner stays exact-match allowlisted, capped, timed
  - TCP scanner still refuses non-private targets at the backend
  - WebView capabilities unchanged (no fs/shell/http plugins)
  - report/persistence paths remain inside the app-data sandbox
- Elevated-context risk: the user-driven `shell` passthrough then runs with
  admin rights (inherent to an elevated terminal); caps and tree-kill still
  apply.

## Honest-output policy

Unavailable modules are marked UNKNOWN and skipped with a visible WARN - scans
continue. The app never fabricates results; mock mode is opt-in and permanently
labeled `MOCK DATA`. Scores always ship with per-category loss breakdowns.

## Persistence

Human-readable JSON under the OS app-data dir for `com.ozrx.workstation`:
`store/scans/*.json + index.json`, `store/baseline.json`, `store/audit.jsonl`.
Deliberately diffable and inspectable; a SQLite backend can replace
`src-tauri/src/persist.rs` without touching callers.

## Known limitations

- `shell` passthrough executes whatever the user types (by design, capped).
  Internal modules never route through it.
- LEVEL 2/3 pentest features are intentionally not implemented yet.
