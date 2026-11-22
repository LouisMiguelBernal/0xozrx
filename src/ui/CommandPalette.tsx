import { useEffect, useMemo, useRef, useState } from "react";
import { engine } from "../engine/console";
import { ACCENTS, useSettings, type AccentName } from "../store/settings";
import { PRESETS } from "./Workbench";

interface Action {
  id: string;
  label: string;
  hint: string;
  exec: () => void;
}

export default function CommandPalette({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const runLine = (line: string) => {
    onClose();
    // Output lands in the terminal pane - visible and auditable.
    void engine.run(engine.parse(line));
  };

  const actions = useMemo<Action[]>(() => {
    const cmds: Action[] = [
      { id: "c.scan", label: "Run Quick Security Scan", hint: "real modules + score", exec: () => runLine("scan --quick") },
      { id: "c.full", label: "Run FULL Security Scan", hint: "all modules incl. bitlocker/tpm/patches", exec: () => runLine("scan --full") },
      { id: "c.res", label: "Resource Readout", hint: "live system vitals", exec: () => runLine("res") },
      { id: "c.sysinfo", label: "System Information", hint: "detected hardware/OS", exec: () => runLine("sysinfo") },
      { id: "c.health", label: "Health Overview", hint: "uptime/cpu/ram/battery/gpu", exec: () => runLine("health") },
      { id: "c.ps", label: "Top Processes", hint: "top CPU consumers", exec: () => runLine("ps") },
      { id: "c.net", label: "Network Connections", hint: "listeners + exposure", exec: () => runLine("network --connections") },
      { id: "c.opsec", label: "OPSEC / Privacy Check", hint: "telemetry, RDP, SMBv1...", exec: () => runLine("opsec --check") },
      { id: "c.events", label: "Event Timeline", hint: "recent system errors", exec: () => runLine("scan --events") },
      { id: "c.base.cmp", label: "Compare Baseline (drift)", hint: "NEW/REMOVED/CHANGED", exec: () => runLine("baseline compare") },
      { id: "c.base.mk", label: "Create Baseline", hint: "snapshot for drift detection", exec: () => runLine("baseline create") },
      { id: "c.report", label: "Export HTML Report", hint: "latest scan, redacted, hashed", exec: () => runLine("report --html") },
      { id: "c.ai", label: "Analyze Latest Findings with AI", hint: "local Gemma via Ollama", exec: () => runLine("ai explain latest scan and prioritize remediation") },
      { id: "c.airepl", label: "Open AI Console (ai>)", hint: "chat with local model", exec: () => runLine("ai") },
      { id: "c.ollama", label: "Check Ollama / Models", hint: "probe local AI", exec: () => runLine("ollama") },
      { id: "c.pentest", label: "Open Pentest Workspace", hint: "LEVEL 1 observe-only", exec: () => runLine("pentest discover") },
      { id: "c.fetch", label: "System Summary (neofetch)", hint: "Arch-style fetch readout", exec: () => runLine("neofetch") },
      { id: "c.admin", label: "Admin / Privilege Status", hint: "UAC posture + hardening catalog", exec: () => runLine("admin status") },
      { id: "c.adminlist", label: "List Hardening Actions", hint: "confirm-gated, audited", exec: () => runLine("admin list") },
      { id: "c.elevate", label: "Elevate to Administrator", hint: "single UAC prompt, relaunches", exec: () => runLine("elevate") },
      { id: "c.clean", label: "Measure Temp / Cache Junk", hint: "dry run, nothing deleted", exec: () => runLine("clean") },
      { id: "c.cleango", label: "Reclaim Temp / Cache Junk", hint: "deletes after this confirmation", exec: () => runLine("clean --apply --yes") },
      { id: "c.model", label: "Local AI Model Control", hint: "list / pin / warm gemma4:e4b", exec: () => runLine("model") },
      { id: "c.warm", label: "Warm Up Local Model", hint: "preload into VRAM", exec: () => runLine("model warm") },
      { id: "c.wp", label: "Pick Wallpaper...", hint: "choose background image", exec: () => runLine("wallpaper pick") },
      { id: "c.wpoff", label: "Disable Wallpaper", hint: "", exec: () => runLine("wallpaper off") },
      { id: "c.bgarch", label: "Backdrop: Arch", hint: "built-in ridge + peak watermark", exec: () => runLine("backdrop arch") },
      { id: "c.bggrid", label: "Backdrop: Grid", hint: "flat terminal grid", exec: () => runLine("backdrop grid") },
    ];
    for (const p of PRESETS) {
      cmds.push({
        id: `p.${p.key}`,
        label: `Layout: ${p.label}`,
        hint: "workbench preset",
        exec: () => useSettings.getState().setPreset(p.key),
      });
    }
    for (const [name, hex] of Object.entries(ACCENTS) as [AccentName, string][]) {
      cmds.push({
        id: `t.${name}`,
        label: `Theme: ${name.toUpperCase()}`,
        hint: hex,
        exec: () => {
          useSettings.getState().setAccent(name);
          import("../store/settings").then((m) => m.applyAccent(name));
        },
      });
    }
    cmds.push({ id: "app.settings", label: "Open Settings", hint: "Ctrl+,", exec: onOpenSettings });
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, onOpenSettings]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(needle));
  }, [actions, q]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setSel(0);
  }, [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[sel]?.exec();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(2,5,6,0.55)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        style={{
          width: 520,
          maxWidth: "92vw",
          border: "1px solid var(--color-edge-strong)",
          background: "rgba(8,13,15,0.97)",
          boxShadow: "0 12px 48px rgba(0,0,0,0.7)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="type a command..."
          spellCheck={false}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--color-ink)",
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            padding: "10px 12px",
            borderBottom: "1px solid var(--color-edge)",
          }}
        />
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {filtered.map((a, i) => (
            <div
              key={a.id}
              onMouseEnter={() => setSel(i)}
              onClick={() => a.exec()}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "7px 12px",
                cursor: "pointer",
                background: i === sel ? "rgba(0,255,156,0.08)" : "transparent",
                borderLeft: i === sel ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              <span style={{ whiteSpace: "nowrap" }}>{a.label}</span>
              <span style={{ color: "var(--color-mute)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}>
                {a.hint}
              </span>
            </div>
          ))}
          {!filtered.length && (
            <div style={{ padding: 12, color: "var(--color-mute)", fontSize: 12 }}>no matching command</div>
          )}
        </div>
      </div>
    </div>
  );
}
