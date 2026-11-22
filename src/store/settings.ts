import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AccentName = "phosphor" | "arch" | "green" | "cyan" | "amber" | "magenta" | "purple";

export const ACCENTS: Record<AccentName, string> = {
  phosphor: "#34e3a8", // 0xOZrx brand phosphor (default)
  arch: "#1793d1", // Arch Linux blue
  green: "#00ff9c",
  cyan: "#3ae7ff",
  amber: "#ffb454",
  magenta: "#ff6ad5",
  purple: "#a277ff",
};

/** Built-in backgrounds - no external image required. */
export type BackdropKind = "arch" | "grid" | "void";

export const BACKDROPS: Record<BackdropKind, string> = {
  arch: "Arch Linux ridge + logo watermark",
  grid: "flat terminal grid",
  void: "plain black",
};

export interface WallpaperCfg {
  enabled: boolean;
  path: string | null;
  blurPx: number; // 0..12
  darkness: number; // 0..100 (overlay opacity)
  scale: "cover" | "contain";
}

interface Settings {
  accent: AccentName;
  backdrop: BackdropKind;
  preset: string;
  wallpaper: WallpaperCfg;
  soundEnabled: boolean;
  mockMode: boolean;
  /** Preferred Ollama tag; null = auto-detect on boot. */
  preferredModel: string | null;
  /** Ollama reasoning mode for gemma4:e4b and friends. */
  aiThinking: boolean;
  setAccent: (a: AccentName) => void;
  setBackdrop: (b: BackdropKind) => void;
  setPreset: (p: string) => void;
  setWallpaper: (w: Partial<WallpaperCfg>) => void;
  setPreferredModel: (m: string | null) => void;
  setAiThinking: (v: boolean) => void;
  toggleSound: () => void;
  toggleMock: () => void;
}

/** Exactly the slice written to storage - keeps partialize and migrate in step. */
type PersistedSettings = Pick<
  Settings,
  "accent" | "backdrop" | "preset" | "wallpaper" | "soundEnabled" | "preferredModel" | "aiThinking"
>;

const PERSIST_DEFAULTS: PersistedSettings = {
  accent: "phosphor",
  backdrop: "grid",
  preset: "security",
  wallpaper: { enabled: false, path: null, blurPx: 4, darkness: 62, scale: "cover" },
  soundEnabled: false,
  preferredModel: null,
  aiThinking: false,
};

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      ...PERSIST_DEFAULTS,
      mockMode: false,
      setAccent: (accent) => set({ accent }),
      setBackdrop: (backdrop) => set({ backdrop }),
      setPreset: (preset) => set({ preset }),
      setPreferredModel: (preferredModel) => set({ preferredModel }),
      setAiThinking: (aiThinking) => set({ aiThinking }),
      setWallpaper: (w) => set((s) => ({ wallpaper: { ...s.wallpaper, ...w } })),
      toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),
      toggleMock: () => set((s) => ({ mockMode: !s.mockMode })),
    }),
    {
      // Same key as before: keep the user's wallpaper/preset across the
      // Arch redesign instead of silently resetting everything.
      name: "ozrx-settings-v1",
      version: 3,
      migrate: (persisted, from): PersistedSettings => {
        const prev = { ...PERSIST_DEFAULTS, ...((persisted ?? {}) as Partial<PersistedSettings>) };
        if (from >= 3) return prev;
        // v0-v2 pinned the green/Arch looks. Adopt the 0xOZrx brand (phosphor
        // accent, grid backdrop); `theme arch` / `backdrop arch` revert it.
        return {
          ...prev,
          accent: prev.accent === "arch" || prev.accent === "green" ? "phosphor" : prev.accent,
          backdrop: prev.backdrop === "arch" ? "grid" : prev.backdrop,
        };
      },
      partialize: (s): PersistedSettings => ({
        accent: s.accent,
        backdrop: s.backdrop,
        preset: s.preset,
        wallpaper: s.wallpaper,
        soundEnabled: s.soundEnabled,
        preferredModel: s.preferredModel,
        aiThinking: s.aiThinking,
      }),
    }
  )
);

/** Apply accent color to document root. */
export function applyAccent(a: AccentName): void {
  const hex = ACCENTS[a] ?? ACCENTS.arch;
  const root = document.documentElement;
  root.style.setProperty("--accent", hex);
  // derive a soft glow + a dim variant used by ::selection and panel washes
  root.style.setProperty("--accent-glow", hex + "59");
  root.style.setProperty("--accent-dim", hex + "26");
  root.style.setProperty("--accent-edge", hex + "3d");
}

export interface LiveResources {
  cpuPct: number;
  memPct: number;
  memUsed: number;
  memTotal: number;
  rx: number;
  tx: number;
  uptimeSecs: number;
  disks: { mount: string; total: number; free: number }[];
  tsMs: number;
}

interface LiveState {
  resources: LiveResources | null;
  sysInfo: Awaited<ReturnType<typeof import("../lib/ipc").getSystemInfo>> | null;
  ollamaOnline: boolean | null;
  ollamaModels: string[];
  aiModel: string | null;
  latestScore: number | null;
  elevated: boolean | null;
  /** Bytes reclaimable per the last `clean` dry-run; null = never measured. */
  reclaimableBytes: number | null;
  setResources: (r: LiveResources) => void;
  setSysInfo: (i: LiveState["sysInfo"]) => void;
  setOllama: (online: boolean, models: string[]) => void;
  setAiModel: (m: string | null) => void;
  setLatestScore: (n: number | null) => void;
  setElevated: (v: boolean) => void;
  setReclaimable: (n: number | null) => void;
}

export const useLive = create<LiveState>((set) => ({
  resources: null,
  sysInfo: null,
  ollamaOnline: null,
  ollamaModels: [],
  aiModel: null,
  latestScore: null,
  elevated: null,
  reclaimableBytes: null,
  setResources: (resources) => set({ resources }),
  setSysInfo: (sysInfo) => set({ sysInfo }),
  setOllama: (ollamaOnline, ollamaModels) => set({ ollamaOnline, ollamaModels }),
  setAiModel: (aiModel) => set({ aiModel }),
  setLatestScore: (latestScore) => set({ latestScore }),
  setElevated: (elevated) => set({ elevated }),
  setReclaimable: (reclaimableBytes) => set({ reclaimableBytes }),
}));
