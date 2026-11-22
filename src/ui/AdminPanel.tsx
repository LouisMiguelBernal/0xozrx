import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  adminApply,
  adminStatus,
  auditAppend,
  cleanApply,
  cleanScan,
  elevateRelaunch,
} from "../lib/ipc";
import { fmtBytes } from "../lib/format";
import { useLive } from "../store/settings";
import type { AdminAction, AdminStatus, CleanReport } from "../types/system";

/** Two-step confirmation window: an armed control disarms itself after this. */
const ARM_MS = 6000;

const impactColor = (i: string): string =>
  i === "HIGH" ? "var(--color-crit)" : i === "MED" ? "var(--color-med)" : "var(--accent)";

const btn: CSSProperties = {
  border: "1px solid var(--color-edge)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--color-ink)",
  fontFamily: "inherit",
  fontSize: 10,
  letterSpacing: "0.08em",
  padding: "2px 8px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const dangerBtn: CSSProperties = {
  ...btn,
  borderColor: "var(--color-crit)",
  color: "var(--color-crit)",
  background: "rgba(255,85,102,0.08)",
};

function Header({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 10,
        letterSpacing: "0.16em",
        color: "var(--color-mute)",
        borderBottom: "1px solid var(--color-edge)",
        paddingBottom: 4,
        marginBottom: 6,
      }}
    >
      <span>{label}</span>
      <span style={{ marginLeft: "auto" }}>{right}</span>
    </div>
  );
}

export default function AdminPanel() {
  const elevated = useLive((s) => s.elevated);
  const setElevated = useLive((s) => s.setElevated);
  const setReclaimable = useLive((s) => s.setReclaimable);

  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const [report, setReport] = useState<CleanReport | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cleanBusy, setCleanBusy] = useState(false);

  const armTimer = useRef<number | null>(null);

  const arm = useCallback((id: string | null) => {
    setArmed(id);
    if (armTimer.current) window.clearTimeout(armTimer.current);
    if (id) armTimer.current = window.setTimeout(() => setArmed(null), ARM_MS);
  }, []);

  useEffect(() => {
    let alive = true;
    void adminStatus()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        setElevated(s.elevated);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (armTimer.current) window.clearTimeout(armTimer.current);
    };
  }, [setElevated]);

  const runAction = async (a: AdminAction) => {
    arm(null);
    setBusy(a.id);
    void auditAppend("admin.cmd", { id: a.id, via: "panel" });
    try {
      const res = await adminApply(a.id, a.id, 180);
      setResults((r) => ({
        ...r,
        [a.id]: {
          ok: res.ok,
          text: res.ok ? res.output.split(/\r?\n/)[0] || "applied" : res.error ?? "failed",
        },
      }));
    } catch (e) {
      setResults((r) => ({ ...r, [a.id]: { ok: false, text: String(e).slice(0, 160) } }));
    } finally {
      setBusy(null);
    }
  };

  const measure = async () => {
    setCleanBusy(true);
    try {
      const rep = await cleanScan(60);
      setReport(rep);
      setElevated(rep.elevated);
      setReclaimable(rep.total_bytes);
      setPicked(new Set(rep.targets.filter((t) => t.available && t.bytes > 0).map((t) => t.id)));
    } catch {
      /* leave the previous report visible */
    } finally {
      setCleanBusy(false);
    }
  };

  const reclaim = async () => {
    arm(null);
    setCleanBusy(true);
    const targets = [...picked];
    void auditAppend("clean.cmd", { targets, via: "panel" });
    try {
      const res = await cleanApply(targets, "CLEAN", 60);
      setResults((r) => ({
        ...r,
        __clean: {
          ok: true,
          text: `reclaimed ${fmtBytes(res.bytes_freed)} · ${res.removed} removed · ${res.failed} in use`,
        },
      }));
      setReclaimable(null);
      await measure();
    } catch (e) {
      setResults((r) => ({ ...r, __clean: { ok: false, text: String(e).slice(0, 160) } }));
    } finally {
      setCleanBusy(false);
    }
  };

  const pickedBytes =
    report?.targets.filter((t) => picked.has(t.id)).reduce((a, t) => a + t.bytes, 0) ?? 0;

  return (
    <div style={{ padding: "9px 11px", display: "flex", flexDirection: "column", gap: 14, fontSize: 11 }}>
      {/* ------------------------------ privilege ------------------------- */}
      <section>
        <Header
          label="PRIVILEGE"
          right={
            <span style={{ color: elevated ? "var(--color-crit)" : "var(--color-mute)", letterSpacing: "0.1em" }}>
              {elevated === null ? "…" : elevated ? "⛨ ADMINISTRATOR" : "STANDARD USER"}
            </span>
          }
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--color-mute)" }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {status ? `${status.username}@${status.hostname || "local"}` : "reading token…"}
          </span>
          {!elevated && (
            <button
              style={{ ...btn, marginLeft: "auto", borderColor: "var(--accent)", color: "var(--accent)" }}
              title="Relaunch with Administrator rights (one UAC prompt)"
              onClick={() => void elevateRelaunch()}
            >
              ⛨ ELEVATE
            </button>
          )}
        </div>
      </section>

      {/* ------------------------------ hardening ------------------------- */}
      <section>
        <Header
          label="HARDENING"
          right={
            <span>
              {status ? `${status.actions.filter((a) => !a.requires_admin || elevated).length}/${status.actions.length} available` : ""}
            </span>
          }
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {(status?.actions ?? []).map((a) => {
            const locked = a.requires_admin && !elevated;
            const isArmed = armed === a.id;
            const res = results[a.id];
            return (
              <div key={a.id} style={{ opacity: locked ? 0.45 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    className="sev-dot"
                    style={{ background: impactColor(a.impact), color: impactColor(a.impact) }}
                  />
                  <span
                    title={`${a.detail}\n\nRevert: ${a.revert}`}
                    style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {a.title}
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    {busy === a.id ? (
                      <span style={{ color: "var(--accent)" }}>running…</span>
                    ) : isArmed ? (
                      <>
                        <button style={dangerBtn} onClick={() => void runAction(a)}>
                          CONFIRM
                        </button>
                        <button style={btn} onClick={() => arm(null)}>
                          ✕
                        </button>
                      </>
                    ) : (
                      <button style={btn} disabled={locked} onClick={() => arm(a.id)}>
                        {locked ? "ADMIN" : "APPLY"}
                      </button>
                    )}
                  </span>
                </div>
                {isArmed && (
                  <div style={{ color: "var(--color-med)", fontSize: 10, paddingLeft: 13, lineHeight: 1.5 }}>
                    {a.detail}
                    <br />
                    <span style={{ color: "var(--color-mute)" }}>revert: {a.revert}</span>
                  </div>
                )}
                {res && (
                  <div
                    style={{
                      paddingLeft: 13,
                      fontSize: 10,
                      color: res.ok ? "var(--accent)" : "var(--color-crit)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {res.ok ? "✓ " : "✕ "}
                    {res.text}
                  </div>
                )}
              </div>
            );
          })}
          {!status && <span style={{ color: "var(--color-mute)" }}>loading action catalog…</span>}
        </div>
      </section>

      {/* ------------------------------- cleanup -------------------------- */}
      <section>
        <Header
          label="TEMP / CACHE"
          right={
            <button style={btn} disabled={cleanBusy} onClick={() => void measure()}>
              {cleanBusy ? "…" : report ? "RE-MEASURE" : "MEASURE"}
            </button>
          }
        />
        {!report && (
          <div style={{ color: "var(--color-mute)" }}>
            measure first - nothing is deleted until you confirm.
          </div>
        )}
        {report && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {report.targets.map((t) => (
              <label
                key={t.id}
                title={t.available ? `${t.note}\n${t.path ?? ""}` : t.skipped_reason ?? ""}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: t.available && t.bytes > 0 ? 1 : 0.42,
                  cursor: t.available && t.bytes > 0 ? "pointer" : "default",
                }}
              >
                <input
                  type="checkbox"
                  disabled={!t.available || t.bytes === 0}
                  checked={picked.has(t.id)}
                  onChange={(e) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(t.id);
                      else next.delete(t.id);
                      return next;
                    })
                  }
                />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.title}
                </span>
                <span style={{ marginLeft: "auto", color: t.bytes > 0 ? "var(--color-ink)" : "var(--color-mute)" }}>
                  {t.available ? fmtBytes(t.bytes) : t.skipped_reason}
                </span>
              </label>
            ))}

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <span style={{ color: "var(--color-mute)" }}>
                selected <b style={{ color: "var(--color-ink)" }}>{fmtBytes(pickedBytes)}</b>
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                {armed === "__clean" ? (
                  <>
                    <button style={dangerBtn} disabled={cleanBusy} onClick={() => void reclaim()}>
                      DELETE {fmtBytes(pickedBytes)}
                    </button>
                    <button style={btn} onClick={() => arm(null)}>
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    style={btn}
                    disabled={cleanBusy || pickedBytes === 0}
                    onClick={() => arm("__clean")}
                  >
                    RECLAIM
                  </button>
                )}
              </span>
            </div>
            {results.__clean && (
              <div style={{ fontSize: 10, color: results.__clean.ok ? "var(--accent)" : "var(--color-crit)" }}>
                {results.__clean.ok ? "✓ " : "✕ "}
                {results.__clean.text}
              </div>
            )}
            {!report.elevated && (
              <div style={{ fontSize: 10, color: "var(--color-mute)" }}>
                elevate to include Windows temp, Update cache and Prefetch.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
