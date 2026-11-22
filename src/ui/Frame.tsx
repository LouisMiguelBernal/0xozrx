import type { CSSProperties, ReactNode } from "react";

export function Frame({
  title,
  hint,
  children,
  style,
  bodyStyle,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
}) {
  return (
    <div className="panel" style={{ height: "100%", ...style }}>
      <div className="panel-header">
        <span style={{ color: "var(--accent)" }}>▮</span>
        <span>{title}</span>
        {hint && (
          <span style={{ marginLeft: "auto", color: "var(--color-mute)", textTransform: "none" }}>{hint}</span>
        )}
      </div>
      <div className="panel-body" style={bodyStyle}>
        {children}
      </div>
    </div>
  );
}

export function Bar({ pct, tone }: { pct: number; tone?: string }) {
  const p = Math.min(Math.max(pct, 0), 100);
  const color =
    tone ?? (p >= 85 ? "var(--color-crit)" : p >= 60 ? "var(--color-med)" : "var(--accent)");
  return (
    <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${p}%`, height: "100%", background: color, transition: "width .3s" }} />
    </div>
  );
}
