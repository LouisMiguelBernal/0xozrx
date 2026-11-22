import { useLive } from "../store/settings";
import { fmtUptime } from "../lib/format";

export default function DashboardCards() {
  const res = useLive((s) => s.resources);
  const ollamaOnline = useLive((s) => s.ollamaOnline);
  const aiModel = useLive((s) => s.aiModel);
  const latestScore = useLive((s) => s.latestScore);

  // Honest derived health signal from vitals only (deep health checks arrive Phase 2).
  let healthTone = "var(--color-info)";
  let healthLabel = "--";
  if (res) {
    const totDisk = res.disks.reduce((a, d) => a + d.total, 0);
    const freeDisk = res.disks.reduce((a, d) => a + d.free, 0);
    const diskPct = totDisk ? (freeDisk / totDisk) * 100 : 100;
    healthLabel = res.memPct > 90 || diskPct < 10 ? "WATCH" : "OK";
    healthTone = healthLabel === "WATCH" ? "var(--color-med)" : "var(--accent)";
  }

  const scoreTone =
    latestScore === null ? "var(--color-info)" : latestScore >= 80 ? "var(--accent)" : latestScore >= 55 ? "var(--color-med)" : "var(--color-crit)";

  return (
    <div style={{ padding: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 9 }}>
      <div className="hud-card">
        <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--color-mute)" }}>SECURITY SCORE</div>
        <div className="hud-value" style={{ color: scoreTone }}>
          {latestScore === null ? "--" : latestScore}
        </div>
        <div style={{ fontSize: 10, color: "var(--color-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {latestScore === null ? "run: scan --quick" : "of 100 · category-capped"}
        </div>
      </div>
      <div className="hud-card">
        <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--color-mute)" }}>HEALTH · VITALS</div>
        <div className="hud-value" style={{ color: healthTone }}>{healthLabel}</div>
        <div style={{ fontSize: 10, color: "var(--color-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {res ? `up ${fmtUptime(res.uptimeSecs)}` : "..."}
        </div>
      </div>
      <div className="hud-card">
        <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--color-mute)" }}>NETWORK EXPOSURE</div>
        <div className="hud-value" style={{ color: "var(--color-info)" }}>--</div>
        <div style={{ fontSize: 10, color: "var(--color-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          network --connections
        </div>
      </div>
      <div className="hud-card">
        <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--color-mute)" }}>OLLAMA</div>
        <div className="hud-value" style={{ color: ollamaOnline ? "var(--accent)" : "var(--color-info)" }}>
          {ollamaOnline === null ? "..." : ollamaOnline ? "ONLINE" : "OFFLINE"}
        </div>
        <div style={{ fontSize: 10, color: "var(--color-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {aiModel ?? "local AI - optional"}
        </div>
      </div>
    </div>
  );
}
