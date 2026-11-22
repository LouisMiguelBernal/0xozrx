import { useEffect, useState } from "react";
import { useSettings, useLive } from "../store/settings";

export default function StatusBar() {
  const mock = useSettings((s) => s.mockMode);
  const score = useLive((s) => s.latestScore);
  const model = useLive((s) => s.aiModel);
  const elevated = useLive((s) => s.elevated);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <footer
      style={{
        height: 24,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 12px",
        background: "linear-gradient(0deg, rgba(8,14,15,0.95), rgba(5,9,10,0.9))",
        boxShadow: "inset 0 1px 0 rgba(140,255,210,0.14)",
        fontSize: 11,
        color: "var(--color-mute)",
        zIndex: 10,
        whiteSpace: "nowrap",
      }}
    >
      <span>
        <span className="live-dot statusbar-live">●</span>{" "}
        <span className="statusbar-live">LOCAL-FIRST</span> · NO TELEMETRY · ALL ACTIONS LOGGED LOCALLY
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        SCORE {score === null ? "--" : `${score}/100`}
        {model ? ` · ${model}` : ""}
      </span>
      {elevated && (
        <span
          title="Administrator token active - commands run with full rights"
          style={{
            color: "var(--color-crit)",
            border: "1px solid var(--color-crit)",
            padding: "0 6px",
            letterSpacing: "0.12em",
          }}
        >
          ⛨ ADMIN
        </span>
      )}
      {mock && (
        <span
          style={{
            color: "var(--color-med)",
            border: "1px solid var(--color-med)",
            padding: "0 6px",
            letterSpacing: "0.1em",
          }}
        >
          MOCK DATA
        </span>
      )}
      <span style={{ marginLeft: "auto", letterSpacing: "0.08em" }}>v0.2.0</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{clock.toLocaleTimeString()}</span>
    </footer>
  );
}
