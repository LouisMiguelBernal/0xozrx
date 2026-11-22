# Admin control surface & cleanup engine

Two mutating subsystems live behind the same gate design: an **allowlisted
catalog**, a **confirmation token the backend verifies**, and an **audit entry
written before and after** every run. Neither can be driven by a free-form
string from the UI.

---

## Admin control surface

`src-tauri/src/admin.rs` · frontend: `admin` command + ADMIN CONTROL panel.

### Gate chain

Every mutation passes all four checks or it does not run:

1. **Allowlist** — `id` must exact-match an entry in `ACTIONS`. There is no
   path from user text to a command string; the id only *selects* a
   compile-time-constant script.
2. **Confirmation token** — `admin_apply` refuses unless `confirm == id`.
   A stray or replayed IPC call with a missing token changes nothing.
3. **Elevation** — actions marked `requires_admin` are refused when the
   process token is not elevated, regardless of what the UI believes.
4. **Audit** — `admin.apply.start` and `admin.apply.done` (with ok/error) are
   appended to the local JSONL trail. `audit` shows them.

The UI adds a fifth, human-facing gate: clicking APPLY only *arms* the row,
revealing what changes and how to revert it. The armed state expires after
6 seconds. `admin apply <id>` in the terminal behaves the same way — it
previews until you add `--yes`.

### Catalog

| id | impact | admin | changes | revert |
|---|---|---|---|---|
| `restore_point` | LOW | yes | System Restore checkpoint `0xOZrx pre-hardening` | delete it in System Protection |
| `firewall_on` | MED | yes | Domain/Private/Public profiles → Enabled | `Set-NetFirewallProfile -Enabled False` |
| `defender_rt_on` | MED | yes | clears `DisableRealtimeMonitoring` | `Set-MpPreference -DisableRealtimeMonitoring $true` |
| `defender_sigs` | LOW | yes | `Update-MpSignature` | n/a (definitions only move forward) |
| `defender_quick_scan` | LOW | yes | starts a QuickScan | n/a (read-only scan) |
| `uac_max` | MED | yes | `EnableLUA=1`, `ConsentPromptBehaviorAdmin=2`, `PromptOnSecureDesktop=1` | restore values shown by `admin status` |
| `smb1_off` | HIGH | yes | disables the SMB1Protocol feature (`-NoRestart`) | `Enable-WindowsOptionalFeature -FeatureName SMB1Protocol` |
| `rdp_off` | HIGH | yes | `fDenyTSConnections=1` + disables the RDP rule group | set back to `0`, re-enable the group |
| `telemetry_min` | MED | yes | `AllowTelemetry=0` under HKLM policy | remove the value |
| `dns_flush` | LOW | no | `Clear-DnsClientCache` | repopulates on its own |

Every action is reversible and the revert is documented in the catalog itself,
so the UI can show it *before* you confirm. Nothing here installs software,
deletes user data, or touches the network beyond Windows Update definitions.

**Run `restore_point` first** if you are about to apply several policy changes.

### Usage

```
admin                    privilege + UAC posture + catalog
admin list               catalog only
admin apply rdp_off      preview: what changes, what reverts it
admin apply rdp_off --yes execute (elevation enforced backend-side)
elevate                  relaunch elevated (single UAC prompt)
```

`sudo` is an alias for `admin`.

---

## Cleanup engine

`src-tauri/src/cleanup.rs` · frontend: `clean` command + TEMP / CACHE section.

### Path safety

The frontend can only pass target **ids** — never a path. Each id maps to a
compile-time `(env var, sub-path, guard segment)` triple, and the resolved
root must clear every one of these before the deleter sees it:

- absolute and currently a directory
- contains the target's `guard` segment (`temp`, `prefetch`, `wer`, …)
- not on the protected denylist: any drive root, `C:\Windows`, `System32`,
  `SysWOW64`, `Program Files`, `ProgramData`, `C:\Users`, `%USERPROFILE%`,
  or the profile's Desktop/Documents/Downloads/Pictures/Videos/Music
- `\\?\` verbatim prefixes are stripped first, so `canonicalize` cannot slip a
  protected path past the string comparisons

Then, during deletion:

- only *entries inside* a root are removed — never the root itself
- reparse points (junctions/symlinks) are skipped, never traversed
- entries modified within `--age` minutes (default **60**) are left alone, so
  files in active use are not yanked from under a running process
- locked / access-denied entries are counted as `skipped`, not fatal
- `clean_apply` refuses unless `confirm == "CLEAN"`, and writes
  `clean.apply.start` / `clean.apply.done` to the audit trail

### Targets

| id | admin | what it is |
|---|---|---|
| `user_temp` | no | `%TEMP%` — installer leftovers, extracted archives, app scratch |
| `windows_temp` | yes | machine-wide scratch used by services and installers |
| `crash_dumps` | no | `%LOCALAPPDATA%\CrashDumps` — often the biggest single win |
| `wer_user` / `wer_machine` | no / yes | Windows Error Reporting queues |
| `inet_cache` | no | legacy WinINet cache used by many desktop apps |
| `d3d_cache` | no | Direct3D shader cache; rebuilt on demand |
| `prefetch` | yes | boot/app traces; Windows rebuilds them (first launch slower) |
| `update_cache` | yes | already-installed Windows Update payloads |
| `delivery_opt` | yes | peer-to-peer update chunks |
| `cbs_logs` | yes | component servicing logs; unbounded on some machines |

Admin-only targets are reported as `needs elevation` rather than silently
dropped, so the dry-run total is always honest about what it did not measure.

### Usage

```
clean                          dry run - measure only, nothing deleted
clean --age 240                only consider entries older than 4h
clean --apply --yes            reclaim everything measured
clean --apply --targets user_temp,crash_dumps --yes
clean recycle --yes            empty the Recycle Bin (NOT recoverable)
```

`cleanup` and `tmp` are aliases for `clean`. The Recycle Bin is deliberately a
separate command with its own token (`EMPTY-RECYCLE-BIN`) because it is the
one genuinely unrecoverable operation in the app.

The boot sequence runs a **dry run only** and surfaces the total; it never
deletes anything on startup.
