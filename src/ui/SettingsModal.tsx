import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ACCENTS,
  BACKDROPS,
  applyAccent,
  useLive,
  useSettings,
  type AccentName,
  type BackdropKind,
} from "../store/settings";
import { PREFERRED_MODEL } from "../ai/client";
import { engine } from "../engine/console";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--color-mute)", margin: "0 0 8px" }}>
        {title}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
      <span style={{ width: 110, flex: "none", color: "var(--color-mute)" }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{children}</span>
    </label>
  );
}

const btnBase: CSSProperties = {
  border: "1px solid var(--color-edge)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "3px 10px",
  cursor: "pointer",
};

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const installed = useLive((l) => l.ollamaModels);
  const activeModel = useLive((l) => l.aiModel);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(2,5,6,0.6)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "94vw",
          maxHeight: "84vh",
          overflowY: "auto",
          border: "1px solid var(--color-edge-strong)",
          background: "rgba(7,12,14,0.98)",
          padding: "16px 20px",
          borderRadius: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <b style={{ letterSpacing: "0.08em" }}>SETTINGS</b>
          <button className="winbtn close" style={{ marginLeft: "auto", width: 26, height: 22 }} onClick={onClose}>
            ✕
          </button>
        </div>

        <Section title="APPEARANCE">
          <Row label="Accent">
            {(Object.keys(ACCENTS) as AccentName[]).map((a) => (
              <button
                key={a}
                style={{
                  ...btnBase,
                  borderColor: s.accent === a ? ACCENTS[a] : undefined,
                  color: s.accent === a ? ACCENTS[a] : undefined,
                }}
                onClick={() => {
                  s.setAccent(a);
                  applyAccent(a);
                }}
              >
                {a}
              </button>
            ))}
          </Row>
          <Row label="Backdrop">
            {(Object.keys(BACKDROPS) as BackdropKind[]).map((b) => (
              <button
                key={b}
                title={BACKDROPS[b]}
                style={{
                  ...btnBase,
                  borderColor: s.backdrop === b ? "var(--accent)" : undefined,
                  color: s.backdrop === b ? "var(--accent)" : undefined,
                }}
                onClick={() => s.setBackdrop(b)}
              >
                {b}
              </button>
            ))}
          </Row>
          <Row label="Wallpaper">
            <input
              type="checkbox"
              checked={s.wallpaper.enabled && !!s.wallpaper.path}
              onChange={(e) => s.setWallpaper({ enabled: e.target.checked })}
            />
            <button style={btnBase} onClick={() => void open({
              multiple: false,
              directory: false,
              filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
            }).then((p) => {
              if (typeof p === "string") s.setWallpaper({ path: p, enabled: true });
            })}>
              choose image...
            </button>
            <span style={{ color: "var(--color-mute)", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.wallpaper.path ?? "(none)"}
            </span>
          </Row>
          <Row label={`Blur ${s.wallpaper.blurPx}px`}>
            <input
              type="range"
              min={0}
              max={24}
              value={s.wallpaper.blurPx}
              onChange={(e) => s.setWallpaper({ blurPx: parseInt(e.target.value, 10) })}
              style={{ width: 220 }}
            />
          </Row>
          <Row label={`Darkness ${s.wallpaper.darkness}%`}>
            <input
              type="range"
              min={0}
              max={95}
              value={s.wallpaper.darkness}
              onChange={(e) => s.setWallpaper({ darkness: parseInt(e.target.value, 10) })}
              style={{ width: 220 }}
            />
          </Row>
        </Section>

        <Section title="LOCAL AI">
          <Row label="Model">
            <button
              style={{
                ...btnBase,
                borderColor: s.preferredModel === null ? "var(--accent)" : undefined,
                color: s.preferredModel === null ? "var(--accent)" : undefined,
              }}
              title="Auto-detect on boot (prefers the tuned tag)"
              onClick={() => {
                s.setPreferredModel(null);
                void engine.run(engine.parse("model auto"));
              }}
            >
              auto
            </button>
            {installed.map((m) => (
              <button
                key={m}
                style={{
                  ...btnBase,
                  borderColor: s.preferredModel === m ? "var(--accent)" : undefined,
                  color: s.preferredModel === m ? "var(--accent)" : undefined,
                }}
                onClick={() => void engine.run(engine.parse(`model use ${m}`))}
              >
                {m}
              </button>
            ))}
            {!installed.length && (
              <span style={{ color: "var(--color-mute)", fontSize: 11 }}>
                no models detected - run `ollama` in the terminal
              </span>
            )}
          </Row>
          <Row label="Reasoning">
            <input
              type="checkbox"
              checked={s.aiThinking}
              onChange={(e) => s.setAiThinking(e.target.checked)}
            />
            <span style={{ color: "var(--color-mute)", fontSize: 11 }}>
              show {PREFERRED_MODEL}&apos;s thinking trace before each answer (slower)
            </span>
          </Row>
          <Row label="Warm up">
            <button style={btnBase} onClick={() => void engine.run(engine.parse("model warm"))}>
              preload into VRAM
            </button>
            <span style={{ color: "var(--color-mute)", fontSize: 11 }}>
              active: {activeModel ?? "none"}
            </span>
          </Row>
        </Section>

        <Section title="MAINTENANCE">
          <Row label="Temp / cache">
            <button style={btnBase} onClick={() => { onClose(); void engine.run(engine.parse("clean")); }}>
              measure reclaimable
            </button>
            <span style={{ color: "var(--color-mute)", fontSize: 11 }}>
              dry run - deletion always needs a second confirmation
            </span>
          </Row>
          <Row label="Admin">
            <button style={btnBase} onClick={() => { onClose(); void engine.run(engine.parse("admin status")); }}>
              privilege + hardening
            </button>
            <span style={{ color: "var(--color-mute)", fontSize: 11 }}>
              every action is audit-logged locally
            </span>
          </Row>
        </Section>

        <Section title="GENERAL">
          <Row label="Mock mode">
            <input type="checkbox" checked={s.mockMode} onChange={() => s.toggleMock()} />
            <span style={{ color: "var(--color-med)", fontSize: 11 }}>
              synthetic data for UI dev - always labeled MOCK DATA
            </span>
          </Row>
          <Row label="Alert sounds">
            <input
              type="checkbox"
              checked={s.soundEnabled}
              onChange={() =>
                // Phase 42 wires the alert system; keep the toggle honest for now.
                s.soundEnabled
                  ? s.toggleSound()
                  : undefined
              }
              disabled
            />
            <span style={{ color: "var(--color-mute)", fontSize: 11 }}>arrives with alert system</span>
          </Row>
        </Section>

        <Section title="ABOUT">
          <div style={{ fontSize: 12, color: "var(--color-mute)", lineHeight: 1.7 }}>
            0xOZrx!! v0.2.0 - local-first Windows security workstation
            <br />
            Offline AI via Ollama ({PREFERRED_MODEL}) · no telemetry · every mutating
            action is confirm-gated and written to the local audit trail.
          </div>
        </Section>
      </div>
    </div>
  );
}
