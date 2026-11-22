# 0xOZrx!!

**LOCAL-FIRST WINDOWS SECURITY WORKSTATION**

A terminal-centric Windows desktop application for endpoint security auditing,
system health diagnostics, OPSEC review, *authorized* local penetration
testing — with an offline local-AI security assistant (Ollama / Gemma).

**Status: v0.2.0** — real scanners, scoring, AI assistant, reports, baseline
drift detection, gated pentest workspace. See `docs/ROADMAP.md` for what's next.

---

## Security boundary

Built for your **own machine**, systems you own, and authorized labs.
No credential theft, no persistence, no evasion, no destructive automation.
Public/internet targets are hard-refused at the backend layer; LAN targets
require explicit typed authorization (audit-logged). Full model:
`docs/SECURITY-MODEL.md`.

- Local-first · no telemetry · works fully offline
- Read-only by default; nothing is modified without your command + confirmation
- Mutating actions (hardening, cleanup) are allowlisted, confirm-gated,
  elevation-checked backend-side and audit-logged - see
  `docs/ADMIN-AND-CLEANUP.md`
- Evidence text is auto-redacted before it reaches AI prompts or exported reports

## Quick start

Prerequisites: Windows 10/11, Node 20+, Rust MSVC toolchain, WebView2.

```powershell
npm install
npm run tauri -- dev      # run the desktop app
```

| Script | Purpose |
|---|---|
| `npm run dev` | frontend only (browser) |
| `npm run build` | production frontend bundle |
| `npm run typecheck` | strict TS check |
| `npm test` | vitest unit tests |
| `npm run check` | typecheck + tests + cargo check |
| `npm run clean` | remove dist + target |
| `npm run tauri -- build` | release build + NSIS installer |

## Troubleshooting: "localhost refused to connect"

That error means you launched a binary that loads its UI from the Vite dev
server. Rule of thumb:

| Binary | UI source | Direct launch |
|---|---|---|
| `target\debug\...exe` after `npm run tauri -- build --debug` | embedded | ✅ works |
| `target\debug\...exe` after plain `cargo build` / `tauri dev` leftovers | dev server | ❌ needs `npm run tauri -- dev` |
| `target\release\...exe`, portable, installed (from `tauri build`) | embedded | ✅ works |

Self-contained launch points:

- Installed app: `%LocalAppData%\0xOZrx\ozrx-workstation.exe`
  (Start Menu / taskbar / desktop shortcut **0xOZrx!!**)
- Portable copy: `E:\0xOZrx!!\0xOZrx-Portable.exe`

## Privileges: smooth start, admin on demand

The app starts **silently as your normal user** — no UAC prompt, ever
(`asInvoker` manifest). All core scanners work unelevated; admin-only data
(Secure Boot, TPM, Security log) is reported as REQUIRES-ADMIN.

Need full rights? One command:

```
elevate
```

→ single UAC prompt → the app relaunches elevated (`⛨ ADMIN` badge, session
recorded in the audit trail). The `⛨ ELEVATE` chip in the title bar and the
ADMIN CONTROL panel do the same thing. Elevation unlocks the admin-only
hardening actions and cleanup targets; both are still re-checked in Rust, so
the UI state is presentation and not the control. Security posture under
elevation: see `docs/SECURITY-MODEL.md`.

## The sentinel shell

Main pane is a command console (`sentinel>`). Highlights:

```
CORE      help clear banner status history echo exit mock audit elevate
SYSTEM    sysinfo neofetch res ps inspect <pid> health [--disk|--gpu|--memory]
          clean [--apply --yes] [--targets a,b] [--age 60] | clean recycle --yes
          shell | !<cmd>
SECURITY  scan [--quick|--full|--security|--network|--startup|--processes|--events|--privacy]
          score report [--html|--json|--md] baseline create|compare|show opsec --check
          admin [status|list|apply <id> [--yes]|elevate]
NETWORK   network [--connections|--interfaces|--dns|--routes|--firewall]
PENTEST   pentest discover | ports <target> [--ports 80,443] | authorize <target>
AI        ollama  ai <question>  ai explain scan   (or just: ai → ai> REPL)
          model [list|use <tag>|auto|info|warm|think on|off]
LOOKS     theme <arch|green|cyan|amber|magenta|purple>  backdrop <arch|grid|void>
          wallpaper pick|blur N|dark N|off
```

Every scanner runs allowlisted, compile-time PowerShell/CIM modules through the
Rust core (never string-concatenated user input). Findings are scored with a
transparent category-capped engine and saved locally.

Keyboard: `Ctrl+K` palette · `Ctrl+,` settings · `Ctrl+Shift+S` quick scan ·
Tab completion · Up/Down history.

## Security scoring

0-100, deterministic: each finding costs points by severity
(CRIT 25 / HIGH 12 / MED 6 / LOW 2), capped per category (caps sum to exactly
100). Every point lost maps to evidence + recommendation. The app never says
"secure" — it reports "no detected issues within scan scope".

## Admin control & cleanup

Two mutating subsystems, same gate design: allowlisted catalog → confirmation
token the backend verifies → elevation re-checked in Rust → audit entry before
and after. Full detail in `docs/ADMIN-AND-CLEANUP.md`.

```
admin                       privilege state, UAC posture, hardening catalog
admin apply rdp_off         preview: exactly what changes and what reverts it
admin apply rdp_off --yes   execute (refused unless elevated)
elevate                     relaunch elevated - one UAC prompt

clean                       dry run: reclaimable temp/cache, nothing deleted
clean --apply --yes         reclaim it (entries newer than 60 min are skipped)
clean recycle --yes         empty the Recycle Bin (not recoverable)
```

Ten reversible hardening actions ship in the catalog (firewall profiles,
Defender real-time + signatures, UAC level, SMBv1, RDP, telemetry policy, DNS
cache, restore point). Every one documents its own revert, and the UI shows
that revert *before* you confirm. Ten cleanup targets are path-guarded against
a protected-path denylist; the webview passes ids, never paths.

The ADMIN CONTROL panel (layout preset **ADMIN / HARDENING**) exposes the same
surface with a two-step armed confirmation that expires after 6 seconds.

## AI assistant (local Gemma)

1. Install Ollama → `docs/OLLAMA.md`
2. `ollama pull gemma4:e4b`
3. Launch app — boot auto-detects endpoint + model
   (exact `gemma4:e4b` > `gemma3n:e4b` > `gemma3:4b` > any gemma > first)
4. Ask: `ai explain latest scan` or enter chat mode with `ai`

```
model            active tag, reasoning state, installed models
model warm       preload into VRAM - pays the cold start up front
model use <tag>  pin a tag (persists); `model auto` to unpin
model think on   show gemma4:e4b's reasoning trace before each answer
```

Requests carry `keep_alive=30m` so the ~9 GB model stays resident between
questions. Sampling is pinned low-variance (`temperature 0.4`, `num_ctx 8192`)
and the backend allowlists sampling keys. Everything stays on your machine.

## Appearance

The UI is Arch-Linux-flavoured by default: an accent-driven backdrop (ridge
silhouette + peak watermark, pure inline SVG - no image file), a blue-leaning
xterm palette, and panel chrome, grid and glow that all derive from one
`--accent` variable, so switching the accent repaints the whole scene
including the terminal.

```
theme arch|green|cyan|amber|magenta|purple
backdrop arch|grid|void        built-in backgrounds
wallpaper pick                 custom image (overrides the backdrop)
neofetch                       Arch-style fetch readout
```

## Layout

```
src/            React+TS frontend (terminal, panels, scanners UI glue)
src/engine/     parser, tagged output, command registry, scoring, redaction
src/engine/cmds/ admin · clean · model · neofetch · backdrop commands
src/scan/       orchestrator + analyzers, baseline diffing, pentest gating
src/ai/         Ollama client, context builder, ai> REPL
src/reports/    HTML/JSON/MD export (redacted + sha256)
src-tauri/      Rust core: telemetry, module runner, TCP scanner, persistence
src-tauri/src/admin.rs    allowlisted hardening catalog + gated apply
src-tauri/src/cleanup.rs  path-guarded temp/cache reclaim engine
docs/           architecture · security model · roadmap · Ollama · admin+cleanup
```

## Testing

```powershell
npm test                        # 27 frontend tests (parser/output/scoring/redaction/art)
cd src-tauri; cargo test        # 18 backend tests (allowlists, path guards,
                                #   model preference, option sanitising, hashing)
```

## Use

For legitimate defensive security and authorized testing on systems you own
or are explicitly permitted to assess.
