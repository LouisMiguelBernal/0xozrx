# Architecture

## Overview

0xOZrx!! is a Tauri 2 desktop app: a hardened WebView2 frontend (React +
TypeScript) backed by a Rust core that owns every privileged or sensitive
integration. The frontend never talks to Windows directly — all system access
flows through explicit, validated Tauri IPC commands.

```
┌─────────────────────────── WebView ───────────────────────────┐
│  TopBar (live monitor chips)                                  │
│  Workbench (resizable split-tree presets)                     │
│   ├ TerminalPane  → ConsoleEngine → command registry          │
│   ├ SystemPanel / DashboardCards / ProcessMonitorPanel        │
│  StatusBar · CommandPalette · SettingsModal                   │
├─ engine layer ────────────────────────────────────────────────┤
│  parser · tagged output · scoring · redaction                 │
│  scan orchestrator + analyzers (findings → score)             │
│  ai client (context builder, REPL) · baseline diff            │
│  report exporters (HTML/JSON/MD)                              │
└──────────────┬────────────────────────────────────────────────┘
               │ invoke() — validated, least-privilege capabilities
┌──────────────▼───────────── Rust core (src-tauri) ────────────┐
│ lib.rs        telemetry (sysinfo), exec_shell passthrough     │
│ modules.rs    ALLOWLISTED PowerShell/CIM module runner        │
│ net_scan.rs   private-range-only TCP connect scanner          │
│ ai.rs         Ollama /api/tags + /api/chat client             │
│ persist.rs    file store: scans/, baseline.json, audit.jsonl  │
│ report.rs     sandboxed report writer + sha256                │
└───────────────────────────────────────────────────────────────┘
```

## Frontend modules

| Path | Responsibility |
|---|---|
| `src/engine/parser.ts` | quote-aware tokenizer + flag parser (pure, unit-tested) |
| `src/engine/output.ts` | tagged ANSI line formatter (`[HH:MM:SS] [TAG] msg`) |
| `src/engine/commands.ts` | command registry; pending modules declared explicitly |
| `src/engine/console.ts` | `ConsoleEngine` singleton: history + IO binding + dispatch |
| `src/terminal/TerminalPane.tsx` | xterm.js view: input state machine, completion, paste guard |
| `src/ui/Workbench.tsx` | recursive resizable split tree + layout presets |
| `src/store/settings.ts` | zustand stores: persisted settings, live telemetry |

### Command flow

1. xterm emits a line → parser tokenizes (quotes, `--flags`, `--k=v`).
2. `dispatch()` resolves aliases (`?`, `cls`, `!`, `quit`) then:
   - implemented command → handler runs (IPC calls are typed wrappers),
   - known future module → honest PHASE notice, **no fake output**,
   - unknown → error with nearest-match suggestions.
3. All output re-enters the terminal through the single tag writer, so every
   action is visible and auditable in one place.

## Backend conventions (enforced from Phase 2 onward)

- Scanner = separate Rust module exposing narrow `#[tauri::command]`s.
- Read-only by default; mutations require a confirmed, logged command.
- Every command: input validation, timeout, output cap, structured errors.
- PowerShell is only used where no native API exists, via allowlisted
  templates with argument validation — **never** string concatenation of
  untrusted input. The interactive `shell` passthrough is user-driven by
  design and documented as such.

## Data flow rules

- Telemetry polls live in the frontend (2 s) against read-only commands.
- Ollama probes originate in Rust (avoids WebView CORS entirely).
- Wallpapers render through Tauri's asset protocol with a scope-limited
  allowlist (`$HOME`, `$PICTURE`, `$DOWNLOAD`, `$DOCUMENT`, `$DESKTOP`).

## Planned layers (see ROADMAP)

SQLite persistence, scan job queue, scoring engine, report generator,
event-log collector, baseline differ, pentest workspace with authorization
records, AI assistant context builder with redaction pipeline.
