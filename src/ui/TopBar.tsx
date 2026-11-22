import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLive } from "../store/settings";
import { elevateRelaunch, isTauri } from "../lib/ipc";
import { engine } from "../engine/console";
import { fmtBytes, fmtRate } from "../lib/format";

function Chip({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "crit" }) {
  const c =
    tone === "crit" ? "var(--color-crit)" : tone === "warn" ? "var(--color-med)" : "var(--accent)";
  return (
    <span className="chip">
      <span className="sev-dot live-dot" style={{ background: c, color: c }} />
      {label}&nbsp;<b>{value}</b>
    </span>
  );
}

function loadTone(pct: number): "ok" | "warn" | "crit" {
  if (pct >= 85) return "crit";
  if (pct >= 60) return "warn";
  return "ok";
}

export default function TopBar() {
  const res = useLive((s) => s.resources);
  const ollamaOnline = useLive((s) => s.ollamaOnline);
  const aiModel = useLive((s) => s.aiModel);
  const elevated = useLive((s) => s.elevated);
  const reclaimable = useLive((s) => s.reclaimableBytes);

  // Resolved lazily: getCurrentWindow() throws outside the Tauri webview.
  const winAction = (fn: "minimize" | "toggleMaximize" | "close") => () => {
    if (!isTauri()) return;
    void getCurrentWindow()[fn]();
  };
  const diskFree = res?.disks?.length
    ? (() => {
        const tot = res.disks.reduce((a, d) => a + d.total, 0) || 1;
        const fr = res.disks.reduce((a, d) => a + d.free, 0);
        return Math.round((fr / tot) * 100);
      })()
    : null;

  return (
    <header
      data-tauri-drag-region
      style={{
        height: 38,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 4px 0 12px",
        background: "linear-gradient(180deg, rgba(9,12,10,0.96), rgba(5,6,5,0.92))",
        boxShadow: "inset 0 -1px 0 rgba(52,227,168,0.18), 0 2px 14px rgba(0,0,0,0.55)",
        zIndex: 10,
      }}
    >
      <img src="/brand/ozrx.svg" alt="" width={22} height={22} style={{ display: "block", flex: "none" }} />
      <span
        className="ca-text"
        style={{ fontWeight: 800, letterSpacing: "0.06em", whiteSpace: "nowrap", color: "var(--accent)", fontSize: 14 }}
      >
        0xOZrx<span style={{ color: "var(--amber)" }}>!!</span>
      </span>
      <span
        style={{
          fontSize: 9,
          letterSpacing: "0.22em",
          color: "var(--color-mute)",
          borderLeft: "1px solid var(--color-edge)",
          paddingLeft: 10,
          whiteSpace: "nowrap",
        }}
      >
        SECURITY WORKSTATION
      </span>

      <div
        data-tauri-drag-region
        style={{ display: "flex", gap: 7, marginLeft: 12, overflow: "hidden", flexGrow: 1 }}
      >
        <Chip label="CPU" value={res ? `${res.cpuPct.toFixed(0)}%` : "--"} tone={res ? loadTone(res.cpuPct) : undefined} />
        <Chip label="RAM" value={res ? `${res.memPct.toFixed(0)}%` : "--"} tone={res ? loadTone(res.memPct) : undefined} />
        <Chip
          label="DISK"
          value={diskFree !== null ? `${diskFree}% FREE` : "--"}
          tone={diskFree !== null && diskFree < 10 ? "crit" : diskFree !== null && diskFree < 20 ? "warn" : "ok"}
        />
        <Chip label="NET" value={res ? `↓${fmtRate(res.rx)} ↑${fmtRate(res.tx)}` : "--"} />
        <Chip
          label="AI"
          value={ollamaOnline === null ? "…" : ollamaOnline ? (aiModel ?? "CONNECTED") : "OFFLINE"}
          tone={ollamaOnline ? "ok" : "warn"}
        />
        {reclaimable !== null && reclaimable > 0 && (
          <button
            className="chip"
            title="Reclaimable temp/cache - click to open the cleanup report"
            style={{ cursor: "pointer", fontFamily: "inherit" }}
            onClick={() => void engine.run(engine.parse("clean"))}
          >
            <span className="sev-dot" style={{ background: "var(--color-med)", color: "var(--color-med)" }} />
            JUNK&nbsp;<b>{fmtBytes(reclaimable)}</b>
          </button>
        )}
      </div>

      <button
        className="chip"
        title={
          elevated
            ? "Administrator token active - every command runs with full machine rights"
            : "Relaunch with Administrator rights (one UAC prompt)"
        }
        style={{
          cursor: elevated ? "default" : "pointer",
          fontFamily: "inherit",
          marginRight: 6,
          borderColor: elevated ? "var(--color-crit)" : "var(--color-edge)",
          color: elevated ? "var(--color-crit)" : "var(--color-mute)",
        }}
        onClick={() => {
          if (!elevated && isTauri()) void elevateRelaunch();
        }}
      >
        {elevated ? "⛨ ADMIN" : "⛨ ELEVATE"}
      </button>

      <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
        <button className="winbtn" title="Minimize" onClick={winAction("minimize")}>
          ▁
        </button>
        <button className="winbtn" title="Maximize" onClick={winAction("toggleMaximize")}>
          ▢
        </button>
        <button className="winbtn close" title="Close" onClick={winAction("close")}>
          ✕
        </button>
      </div>
    </header>
  );
}
