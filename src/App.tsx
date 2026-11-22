import { useEffect, useState } from "react";
import TopBar from "./ui/TopBar";
import StatusBar from "./ui/StatusBar";
import Workbench from "./ui/Workbench";
import type { PanelId } from "./ui/Workbench";
import WallpaperLayer from "./ui/WallpaperLayer";
import CommandPalette from "./ui/CommandPalette";
import SettingsModal from "./ui/SettingsModal";
import { getResources } from "./lib/ipc";
import { applyAccent, useLive, useSettings } from "./store/settings";
import { engine } from "./engine/console";

export default function App() {
  const preset = useSettings((s) => s.preset);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [maximizedPanel, setMaximizedPanel] = useState<PanelId | null>(null);

  /* live resource polling (2s) */
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await getResources();
        if (!alive) return;
        useLive.getState().setResources({
          cpuPct: r.cpu_pct,
          memPct: r.mem_pct,
          memUsed: r.mem_used_bytes,
          memTotal: r.mem_total_bytes,
          rx: r.nets.reduce((a, n) => a + n.rx_bps, 0),
          tx: r.nets.reduce((a, n) => a + n.tx_bps, 0),
          uptimeSecs: r.uptime_secs,
          disks: r.disks.map((d) => ({ mount: d.mount, total: d.total_bytes, free: d.free_bytes })),
          tsMs: r.ts_ms,
        });
      } catch {
        /* keep last good values; backend may be busy */
      }
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  /* keyboard shortcuts */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey && !e.altKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((v) => !v);
        return;
      }
      if (mod && e.shiftKey) {
        // shortcuts route through the terminal so every action stays visible/auditable
        const map: Record<string, string> = {
          s: "scan --quick",
          h: "health",
          n: "network --connections",
          o: "opsec --check",
          a: "ollama",
          p: "pentest discover",
          r: "report --html",
        };
        const cmd = map[e.key.toLowerCase()];
        if (cmd) {
          e.preventDefault();
          void engine.run(engine.parse(cmd));
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  /* restore persisted accent on boot */
  useEffect(() => {
    applyAccent(useSettings.getState().accent);
  }, []);

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
      <WallpaperLayer />
      <div className="fx-grid" aria-hidden />
      <TopBar />
      <main style={{ flex: 1, minHeight: 0, zIndex: 2 }}>
        <Workbench
          presetKey={preset}
          maximized={maximizedPanel}
          setMaximized={setMaximizedPanel}
        />
      </main>
      <StatusBar />
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onOpenSettings={() => {
            setPaletteOpen(false);
            setSettingsOpen(true);
          }}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {/* atmosphere overlays - pointer-transparent */}
      <div className="fx-vignette" aria-hidden />
      <div className="fx-scanlines" aria-hidden />
    </div>
  );
}
