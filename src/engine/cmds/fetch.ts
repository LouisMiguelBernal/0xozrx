import { ANSI } from "../output";
import { ARCH_PEAK, ARCH_PEAK_WIDTH } from "../archArt";
import { pad, type CommandDefLike } from "../cmdtypes";
import { getResources, getSystemInfo, runModule } from "../../lib/ipc";
import { fmtBytes, fmtUptime } from "../../lib/format";
import { useLive, useSettings } from "../../store/settings";

/** neofetch-style key/value rows painted beside the peak glyph. */
interface Row {
  k: string;
  v: string;
}

function colorBlocks(): string {
  // classic fetch colour strip - also a quick check that 256-colour works
  const top = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `\x1b[48;5;${n}m   `).join("");
  const bot = [8, 9, 10, 11, 12, 13, 14, 15].map((n) => `\x1b[48;5;${n}m   `).join("");
  return `${top}\x1b[0m\r\n${bot}\x1b[0m`;
}

export const neofetchCmd: CommandDefLike = {
  name: "neofetch",
  usage: "neofetch",
  summary: "Arch-style system summary beside the peak glyph",
  group: "system",
  async run(eng) {
    const [info, res] = await Promise.all([getSystemInfo(), getResources()]);
    useLive.getState().setSysInfo(info);

    const M = <T,>(m: string) => runModule<T>(m).catch(() => null);
    const [gpu, ifs] = await Promise.all([
      M<{ name: string; driver: string }[]>("gpu"),
      M<{ alias: string; addrs: string[] }[]>("interfaces"),
    ]);

    const live = useLive.getState();
    const settings = useSettings.getState();
    const sysDisk =
      res.disks.find((d) => /^[cC]:/.test(d.mount)) ?? res.disks[0] ?? null;
    const lanIp =
      ifs?.flatMap((i) => i.addrs).find((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) ??
      null;

    const user = `${info.username}@${info.hostname}`;
    const rows: Row[] = [
      { k: "os", v: `${info.os_name} ${info.os_build}` },
      { k: "kernel", v: info.kernel || "nt" },
      { k: "arch", v: info.arch },
      { k: "uptime", v: fmtUptime(res.uptime_secs) },
      { k: "shell", v: "sentinel · 0xOZrx!! v0.2.0" },
      { k: "terminal", v: "xterm.js / webview2" },
      { k: "resolution", v: `${window.innerWidth}x${window.innerHeight}` },
      { k: "cpu", v: `${info.cpu_model} (${info.cpu_cores_physical}P/${info.cpu_cores_logical}L) ${res.cpu_pct.toFixed(0)}%` },
      { k: "gpu", v: gpu?.[0]?.name ?? "unavailable" },
      { k: "memory", v: `${fmtBytes(res.mem_used_bytes)} / ${fmtBytes(res.mem_total_bytes)} (${res.mem_pct.toFixed(0)}%)` },
      {
        k: "disk",
        v: sysDisk
          ? `${sysDisk.mount} ${fmtBytes(sysDisk.total_bytes - sysDisk.free_bytes)} / ${fmtBytes(sysDisk.total_bytes)}`
          : "unavailable",
      },
      { k: "lan", v: lanIp ?? "no private address" },
      { k: "session", v: live.elevated ? "ADMINISTRATOR (elevated token)" : "standard user" },
      { k: "theme", v: `${settings.accent} · backdrop ${settings.backdrop}` },
      {
        k: "ai",
        v: live.ollamaOnline === false
          ? "ollama offline"
          : `${live.aiModel ?? "detecting"} @ 127.0.0.1:11434`,
      },
      { k: "score", v: live.latestScore === null ? "no scan yet" : `${live.latestScore}/100` },
    ];

    // header + separator occupy the first two info lines
    const info_lines: string[] = [
      ANSI.bold(`\x1b[38;5;39m${info.username}\x1b[0m@\x1b[38;5;39m${info.hostname}\x1b[0m`),
      ANSI.dim("─".repeat(Math.min(user.length, 46))),
      ...rows.map(
        (r) => `\x1b[38;5;39m${pad(r.k, 12)}\x1b[0m${r.v}`
      ),
    ];

    const artW = ARCH_PEAK_WIDTH + 4;
    const height = Math.max(ARCH_PEAK.length, info_lines.length);
    for (let i = 0; i < height; i++) {
      const art = ARCH_PEAK[i] ?? "";
      const left = `\x1b[38;5;39m${pad(art, artW)}\x1b[0m`;
      eng.raw(left + (info_lines[i] ?? "") + "\r\n");
    }
    eng.raw("\r\n" + " ".repeat(artW) + colorBlocks().split("\r\n").join(`\r\n${" ".repeat(artW)}`) + "\r\n\r\n");
  },
};
