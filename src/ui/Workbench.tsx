import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import TerminalPane from "../terminal/TerminalPane";
import SystemPanel from "./SystemPanel";
import DashboardCards from "./DashboardCards";
import ProcessMonitorPanel from "./ProcessMonitorPanel";
import AdminPanel from "./AdminPanel";
import { Frame } from "./Frame";

export type PanelId = "terminal" | "system" | "dashboard" | "processes" | "admin";

interface LeafNode {
  kind: "leaf";
  id: PanelId;
}
interface SplitNode {
  kind: "split";
  dir: "h" | "v";
  ratio: number;
  a: LayoutNode;
  b: LayoutNode;
}
type LayoutNode = LeafNode | SplitNode;

const leaf = (id: PanelId): LeafNode => ({ kind: "leaf", id });
const split = (dir: "h" | "v", ratio: number, a: LayoutNode, b: LayoutNode): SplitNode => ({
  kind: "split",
  dir,
  ratio,
  a,
  b,
});

export interface Preset {
  key: string;
  label: string;
  tree: SplitNode;
}

/** Preset layouts for the Phase-1 panel set. Terminal-first by default. */
export const PRESETS: Preset[] = [
  {
    key: "security",
    label: "SECURITY",
    tree: split("h", 0.7, leaf("terminal"), split("v", 0.55, leaf("system"), leaf("dashboard"))),
  },
  {
    key: "health",
    label: "SYSTEM HEALTH",
    tree: split("h", 0.36, split("v", 0.62, leaf("system"), leaf("processes")), leaf("terminal")),
  },
  {
    key: "network",
    label: "NETWORK",
    tree: split("h", 0.62, leaf("terminal"), split("v", 0.5, leaf("dashboard"), leaf("system"))),
  },
  {
    key: "hardening",
    label: "ADMIN / HARDENING",
    tree: split("h", 0.56, leaf("terminal"), split("v", 0.68, leaf("admin"), leaf("system"))),
  },
  {
    key: "pentest",
    label: "PENTEST",
    tree: split("h", 0.8, leaf("terminal"), leaf("processes")),
  },
  {
    key: "opsec",
    label: "OPSEC",
    tree: split("h", 0.64, leaf("terminal"), leaf("dashboard")),
  },
];

/** Hard minimum sizes so the terminal can never be squeezed unusable. */
const LEAF_MIN: Record<PanelId, { w: number; h: number }> = {
  terminal: { w: 480, h: 240 },
  system: { w: 300, h: 200 },
  dashboard: { w: 280, h: 170 },
  processes: { w: 300, h: 160 },
  admin: { w: 320, h: 220 },
};

/** Panel chrome is uniform: every leaf is a titled Frame except the terminal,
 *  which builds its own header so xterm can own the full body box. */
const PANEL_CHROME: Record<Exclude<PanelId, "terminal">, { title: string; hint: string }> = {
  system: { title: "SYSTEM", hint: "live telemetry" },
  dashboard: { title: "DASHBOARD", hint: "posture at a glance" },
  processes: { title: "PROCESSES", hint: "top by cpu" },
  admin: { title: "ADMIN CONTROL", hint: "confirm-gated · audited" },
};

const FILL = { flex: 1, minWidth: 0, minHeight: 0 } as const;

function renderPanel(id: PanelId): ReactNode {
  if (id === "terminal") return <TerminalPane />;
  const chrome = PANEL_CHROME[id];
  return (
    <Frame title={chrome.title} hint={chrome.hint} style={FILL}>
      {id === "system" && <SystemPanel />}
      {id === "dashboard" && <DashboardCards />}
      {id === "processes" && <ProcessMonitorPanel />}
      {id === "admin" && <AdminPanel />}
    </Frame>
  );
}

function cloneTree(n: LayoutNode): LayoutNode {
  if (n.kind === "leaf") return { ...n };
  return { ...n, a: cloneTree(n.a), b: cloneTree(n.b) };
}

function updateRatio(node: LayoutNode, path: number[], ratio: number): LayoutNode {
  if (path.length === 0) {
    if (node.kind !== "split") return node;
    return { ...node, ratio };
  }
  const [head, ...rest] = path;
  if (node.kind !== "split") return node;
  const nextA = head === 0 ? updateRatio(node.a, rest, ratio) : node.a;
  const nextB = head === 1 ? updateRatio(node.b, rest, ratio) : node.b;
  return { ...node, a: nextA, b: nextB };
}

function NodeView({
  node,
  path,
  tree,
  setTree,
  maximized,
  setMaximized,
}: {
  node: LayoutNode;
  path: number[];
  tree: LayoutNode;
  setTree: (t: LayoutNode) => void;
  maximized: PanelId | null;
  setMaximized: (id: PanelId | null) => void;
}): ReactNode {
  if (node.kind === "leaf") {
    if (maximized && node.id !== maximized) return null;
    return (
      <div
        style={{
          minWidth: 0,
          minHeight: 0,
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {renderPanel(node.id)}
        {!maximized && (
          <button title="Maximize panel" className="mini-btn" onClick={() => setMaximized(node.id)}>
            ▢ MAX
          </button>
        )}
      </div>
    );
  }

  const s: SplitNode = node;
  const isH = s.dir === "h";

  // CSS Grid with fr tracks: exact proportions + hard minimums, no flex quirks.
  const aPart = (s.ratio * 100).toFixed(2);
  const bPart = (100 - s.ratio * 100).toFixed(2);
  const trackA =
    s.a.kind === "leaf"
      ? `minmax(${isH ? LEAF_MIN[s.a.id].w : LEAF_MIN[s.a.id].h}px, ${aPart}fr)`
      : `${aPart}fr`;
  const trackB =
    s.b.kind === "leaf"
      ? `minmax(${isH ? LEAF_MIN[s.b.id].w : LEAF_MIN[s.b.id].h}px, ${bPart}fr)`
      : `${bPart}fr`;

  return (
    <div
      style={
        isH
          ? {
              display: "grid",
              gridTemplateColumns: `${trackA} 7px ${trackB}`,
              width: "100%",
              height: "100%",
              minWidth: 0,
              minHeight: 0,
            }
          : {
              display: "grid",
              gridTemplateRows: `${trackA} 7px ${trackB}`,
              width: "100%",
              height: "100%",
              minWidth: 0,
              minHeight: 0,
            }
      }
    >
      <NodeView
        node={s.a}
        path={[...path, 0]}
        tree={tree}
        setTree={setTree}
        maximized={maximized}
        setMaximized={setMaximized}
      />
      <Divider dir={s.dir} onDrag={(r) => setTree(updateRatio(tree, path, r))} />
      <NodeView
        node={s.b}
        path={[...path, 1]}
        tree={tree}
        setTree={setTree}
        maximized={maximized}
        setMaximized={setMaximized}
      />
    </div>
  );
}

function Divider({ dir, onDrag }: { dir: "h" | "v"; onDrag: (ratio: number) => void }) {
  const onDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const parent = (e.currentTarget as HTMLDivElement).parentElement;
    if (!parent) return;
    const move = (ev: PointerEvent) => {
      const r = parent.getBoundingClientRect();
      const t =
        dir === "h"
          ? (ev.clientX - r.left) / Math.max(r.width, 1)
          : (ev.clientY - r.top) / Math.max(r.height, 1);
      onDrag(Math.min(Math.max(t, 0.15), 0.85));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = dir === "h" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      onPointerDown={onDown}
      style={{
        flex: "none",
        width: dir === "h" ? 7 : undefined,
        height: dir === "v" ? 7 : undefined,
        cursor: dir === "h" ? "col-resize" : "row-resize",
        zIndex: 2,
      }}
      title="drag to resize"
    />
  );
}

export default function Workbench({
  presetKey,
  maximized,
  setMaximized,
}: {
  presetKey: string;
  maximized: PanelId | null;
  setMaximized: (id: PanelId | null) => void;
}) {
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];
  const [tree, setTree] = useState<LayoutNode>(() => cloneTree(preset.tree));
  const presetRef = useRef(preset.key);

  // Switching presets replaces the tree exactly once per change.
  if (presetRef.current !== preset.key) {
    presetRef.current = preset.key;
    setTree(cloneTree(preset.tree));
  }

  // Clear stale maximize target after a preset switch (side-effect free in render).
  useEffect(() => {
    if (maximized && !containsLeaf(tree, maximized)) setMaximized(null);
  }, [maximized, tree, setMaximized]);

  // Maximized bypass: render only the target panel, full-size.
  if (maximized) {
    return (
      <div style={{ width: "100%", height: "100%", padding: 6, boxSizing: "border-box", position: "relative" }}>
        {renderPanel(maximized)}
        <button title="Restore panels" className="restore-btn" onClick={() => setMaximized(null)}>
          ⤡ RESTORE
        </button>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", padding: 6, boxSizing: "border-box" }}>
      <NodeView
        node={tree}
        path={[]}
        tree={tree}
        setTree={setTree}
        maximized={null}
        setMaximized={setMaximized}
      />
    </div>
  );
}

function containsLeaf(n: LayoutNode, id: PanelId): boolean {
  if (n.kind === "leaf") return n.id === id;
  return containsLeaf(n.a, id) || containsLeaf(n.b, id);
}
