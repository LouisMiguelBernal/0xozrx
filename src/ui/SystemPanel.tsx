import { useLive } from "../store/settings";
import { fmtBytes, fmtUptime } from "../lib/format";
import { Bar } from "./Frame";

export default function SystemPanel() {
  const info = useLive((s) => s.sysInfo);
  const res = useLive((s) => s.resources);

  if (!info) return <div style={{ padding: 12, color: "var(--color-mute)" }}>detecting system...</div>;

  const diskPct = (d: { total: number; free: number }) =>
    d.total > 0 ? ((d.total - d.free) / d.total) * 100 : 0;

  return (
    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <Row k="OS" v={`${info.os_name} ${info.os_version}`} />
      <Row k="BUILD" v={info.os_build} />
      <Row k="HOST" v={`${info.hostname} / ${info.username}`} />
      <Row k="CPU" v={info.cpu_model} />
      <Row k="CORES" v={`${info.cpu_cores_physical}P / ${info.cpu_cores_logical}L`} />
      <Row k="ARCH" v={info.arch} />
      <Row k="UPTIME" v={fmtUptime(res?.uptimeSecs ?? info.uptime_secs)} />

      <div style={{ marginTop: 6 }}>
        <Line label="CPU" value={`${res ? res.cpuPct.toFixed(0) : "--"}%`} />
        <Bar pct={res?.cpuPct ?? 0} />
      </div>
      <div>
        <Line
          label="RAM"
          value={res ? `${fmtBytes(res.memUsed)} / ${fmtBytes(res.memTotal)}` : "--"}
        />
        <Bar pct={res?.memPct ?? 0} />
      </div>
      {(res?.disks ?? []).map((d) => (
        <div key={d.mount}>
          <Line label={`DISK ${d.mount}`} value={`${fmtBytes(d.free)} free`} />
          <Bar pct={diskPct(d)} tone={diskPct(d) > 90 ? "var(--color-crit)" : undefined} />
        </div>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
      <span style={{ color: "var(--color-mute)", width: 64, flex: "none" }}>{k}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, margin: "2px 0" }}>
      <span style={{ color: "var(--color-mute)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
