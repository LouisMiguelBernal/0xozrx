import { useEffect, useState } from "react";
import { getTopProcesses } from "../lib/ipc";
import type { ProcRow } from "../types/system";
import { fmtBytes } from "../lib/format";

export default function ProcessMonitorPanel() {
  const [rows, setRows] = useState<ProcRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await getTopProcesses(9);
        if (alive) {
          setRows(r);
          setErr(null);
        }
      } catch (e) {
        if (alive) setErr(String(e));
      }
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div style={{ padding: "8px 12px", fontSize: 11 }}>
      <div style={{ display: "flex", gap: 8, color: "var(--color-mute)", borderBottom: "1px solid var(--color-edge)", paddingBottom: 4 }}>
        <span style={{ width: 56 }}>PID</span>
        <span style={{ width: 48, textAlign: "right" }}>CPU%</span>
        <span style={{ width: 72, textAlign: "right" }}>MEM</span>
        <span>NAME</span>
      </div>
      {err && <div style={{ color: "var(--color-crit)", padding: "6px 0" }}>unavailable: {err}</div>}
      {rows.map((r) => (
        <div key={r.pid} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px dashed rgba(255,255,255,0.04)" }}>
          <span style={{ width: 56, color: "var(--color-mute)" }}>{r.pid}</span>
          <span style={{ width: 48, textAlign: "right", color: r.cpu_pct >= 50 ? "var(--color-crit)" : undefined }}>
            {r.cpu_pct.toFixed(1)}
          </span>
          <span style={{ width: 72, textAlign: "right" }}>{fmtBytes(r.mem_bytes)}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
        </div>
      ))}
      <div style={{ marginTop: 6, color: "var(--color-mute)", fontSize: 10 }}>
        top CPU consumers · risk analysis arrives Phase 4
      </div>
    </div>
  );
}
