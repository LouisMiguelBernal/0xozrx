import { ANSI } from "./output";
import { BANNER_ART, TAGLINE } from "./banner";
import {
  auditTail,
  checkOllama,
  execShell,
  getSystemInfo,
  getResources,
  getTopProcesses,
  listScans,
  procDetail,
  runModule,
} from "../lib/ipc";
import { applyAccent, ACCENTS, useLive, useSettings, type AccentName } from "../store/settings";
import { fmtBytes, fmtPct, fmtRate, fmtUptime } from "../lib/format";
import type { ConsoleEngine } from "./console";
import type { ParsedCommand } from "./parser";
import type { ScanRecord } from "../types/system";
import type { CommandDefLike } from "./cmdtypes";
import { adminCmd } from "./cmds/admin";
import { backdropCmd } from "./cmds/backdrop";
import { cleanCmd } from "./cmds/clean";
import { neofetchCmd } from "./cmds/fetch";
import { modelCmd } from "./cmds/model";

export type { CommandDefLike };

export const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434";

const pad = (s: string, n: number) => s.padEnd(n);
const rjust = (s: string, n: number) => s.padStart(n);

/** Modules planned for later phases - never faked. */
export const PENDING_MODULES: Record<string, { summary: string; phase: number }> = {};

function pendingNotice(eng: ConsoleEngine, name: string): void {
  const m = PENDING_MODULES[name];
  eng.tag("WARN", `${name} module ships in PHASE ${m?.phase ?? "?"} - not yet implemented.`);
}

function sanitizeExternal(text: string): string {
  return text.replace(/\x1b/g, "^[");
}

/* ------------------------------------------------------------------ */
/* CORE                                                                */
/* ------------------------------------------------------------------ */

const helpCmd: CommandDefLike = {
  name: "help",
  usage: "help [command]",
  summary: "list available commands",
  group: "core",
  run(eng, p) {
    if (p.args[0]) {
      const def = COMMANDS[p.args[0].toLowerCase()];
      if (def) eng.tag("INFO", `${def.usage}  - ${def.summary}`);
      else eng.tag("ERROR", `no such command: ${p.args[0]}`);
      return;
    }
    const cols = eng.io?.cols?.() ?? 100;
    const usageW = Math.min(24, Math.max(...Object.values(COMMANDS).map((d) => d.usage.length)) + 2);
    const descW = Math.max(30, cols - usageW - 4);

    const emit = (title: string, group: CommandDefLike["group"]) => {
      eng.raw(`\r\n${ANSI.bold(ANSI.color(245, `── ${title} `))}${ANSI.dim("─".repeat(Math.max(2, cols - title.length - 5)))}\r\n`);
      for (const d of Object.values(COMMANDS).filter((x) => x.group === group)) {
        const words = d.summary.split(" ");
        let line = "";
        let first = true;
        for (const w of words) {
          if ((line + " " + w).trim().length > descW) {
            eng.raw(`  ${ANSI.color(82, first ? pad(d.usage, usageW) : pad("", usageW))}${line.trim()}\r\n`);
            line = "";
            first = false;
          }
          line += w + " ";
        }
        if (line.trim()) eng.raw(`  ${ANSI.color(82, first ? pad(d.usage, usageW) : pad("", usageW))}${line.trim()}\r\n`);
      }
    };

    emit("CORE", "core");
    emit("SYSTEM", "system");
    emit("SECURITY OPS", "security");
    emit("NETWORK / PENTEST", "network");
    emit("AI · LOCAL GEMMA", "ai");
    emit("APPEARANCE", "appearance");
    eng.raw(`\r\n${ANSI.dim(`${" ".repeat(2)}Tab completes · Up/Down history · Ctrl+K palette · Ctrl+Shift+S quick scan · type "ai" to chat`)}\r\n\r\n`);
  },
};

const clearCmd: CommandDefLike = {
  name: "clear",
  usage: "clear",
  summary: "clear the terminal",
  group: "core",
  run(eng) { eng.io?.clear(); },
};

const bannerCmd: CommandDefLike = {
  name: "banner",
  usage: "banner",
  summary: "reprint the workstation banner",
  group: "core",
  run(eng) {
    const hex = ACCENTS[useSettings.getState().accent] ?? ACCENTS.arch;
    for (const row of BANNER_ART) eng.raw(ANSI.hex(hex, row) + "\r\n");
    eng.raw(ANSI.bold(ANSI.hex(hex, `  ${TAGLINE}`)) + "\r\n\r\n");
  },
};

const statusCmd: CommandDefLike = {
  name: "status",
  usage: "status",
  summary: "module status matrix",
  group: "core",
  async run(eng) {
    const live = useLive.getState();
    const rows: Array<[string, string, number, string]> = [
      ["SYSTEM", "OK", 82, live.sysInfo ? `${live.sysInfo.os_name}` : "..."],
      ["RESOURCES", "LIVE", 39, "cpu/mem/disk/net polling"],
      ["PRIVILEGE", live.elevated ? "ADMIN" : "USER", live.elevated ? 196 : 39, live.elevated ? "elevated token - full rights" : "unelevated"],
      ["SCANNERS", "ONLINE", 82, "scan --quick | --full | --events | ..."],
      ["SCORE", latestScoreLabel(), scoreColor(), "transparent category-capped scoring"],
      [
        "OLLAMA/AI",
        live.ollamaOnline === null ? "CHECK" : live.ollamaOnline ? "ONLINE" : "OFFLINE",
        live.ollamaOnline ? 82 : 196,
        live.aiModel ?? "model auto-detect (prefers gemma e4b)",
      ],
      ["ADMIN OPS", live.elevated ? "UNLOCKED" : "LOCKED", live.elevated ? 82 : 214, "admin list · confirm-gated, audited hardening"],
      [
        "CLEANUP",
        live.reclaimableBytes === null ? "READY" : fmtBytes(live.reclaimableBytes),
        live.reclaimableBytes && live.reclaimableBytes > 1_073_741_824 ? 214 : 39,
        "clean (dry-run) · clean --apply --yes",
      ],
      ["BASELINE", "READY", 39, "baseline create|compare"],
      ["REPORTS", "READY", 39, "report --html|--json|--md"],
      ["PENTEST", "LEVEL1", 214, "observe-only; authorize gate; private ranges"],
      ["MOCK MODE", useSettings.getState().mockMode ? "ACTIVE" : "OFF", useSettings.getState().mockMode ? 214 : 240, "synthetic data flag"],
    ];
    eng.raw(ANSI.color(245, "MODULE          STATE     NOTE") + "\r\n");
    for (const [mod, state, color, note] of rows)
      eng.raw(`  ${pad(mod, 16)}${ANSI.color(color, pad(state, 10))}${ANSI.dim(note)}\r\n`);
  },
};

function latestScore(): number | null {
  return useLive.getState().latestScore;
}
function latestScoreLabel(): string {
  const s = latestScore();
  return s === null ? "NO SCAN" : `${s}/100`;
}
function scoreColor(): number {
  const s = latestScore() ?? 0;
  return s >= 80 ? 82 : s >= 55 ? 214 : 196;
}

const echoCmd: CommandDefLike = {
  name: "echo",
  usage: "echo <text...>",
  summary: "print text",
  group: "core",
  run(eng, p) { eng.raw(p.args.join(" ") + "\r\n"); },
};

const historyCmd: CommandDefLike = {
  name: "history",
  usage: "history",
  summary: "show command history",
  group: "core",
  run(eng) {
    if (!eng.history.length) { eng.tag("DIM", "(empty)"); return; }
    eng.history.forEach((l, i) => eng.raw(`${ANSI.dim(pad(String(i + 1), 5))}${l}\r\n`));
  },
};

const exitCmd: CommandDefLike = {
  name: "exit",
  usage: "exit",
  summary: "close hint",
  group: "core",
  run(eng) { eng.tag("INFO", "Close the workstation via the title bar or Alt+F4."); },
};

const elevateCmd: CommandDefLike = {
  name: "elevate",
  usage: "elevate",
  summary: "restart with Administrator rights (single UAC prompt)",
  group: "core",
  async run(eng) {
    const elevated = useLive.getState().elevated;
    if (elevated === true) {
      eng.tag("INFO", "already running elevated.");
      return;
    }
    eng.tag("WARN", "UAC prompt incoming - approving relaunches 0xOZrx!! as Administrator...");
    try {
      const { elevateRelaunch } = await import("../lib/ipc");
      const ok = await elevateRelaunch();
      if (ok) {
        eng.tag("DIM", "this instance will close; the elevated one takes over.");
      } else {
        eng.tag("ERROR", "elevation cancelled or blocked.");
      }
    } catch (e) {
      eng.tag("ERROR", String(e));
    }
  },
};

/* ------------------------------------------------------------------ */
/* SYSTEM                                                              */
/* ------------------------------------------------------------------ */

const sysinfoCmd: CommandDefLike = {
  name: "sysinfo",
  usage: "sysinfo",
  summary: "detected system information (real)",
  group: "system",
  async run(eng) {
    const info = await getSystemInfo();
    useLive.getState().setSysInfo(info);
    const kv = (k: string, v: string) => eng.raw(`  ${ANSI.dim(pad(k, 20))}${v}\r\n`);
    kv("HOSTNAME", info.hostname);
    kv("USER", info.username);
    kv("OS", `${info.os_name} ${info.os_version} build ${info.os_build}`);
    kv("KERNEL", info.kernel);
    kv("ARCH", info.arch);
    kv("CPU", info.cpu_model);
    kv("CORES", `${info.cpu_cores_physical}P/${info.cpu_cores_logical}L`);
    kv("RAM", fmtBytes(info.total_mem_bytes));
    kv("UPTIME", fmtUptime(info.uptime_secs));
  },
};

const resCmd: CommandDefLike = {
  name: "res",
  usage: "res",
  summary: "one-shot resource readout (real)",
  group: "system",
  async run(eng) {
    const r = await getResources();
    eng.raw(`  CPU   ${fmtPct(r.cpu_pct)}\r\n`);
    eng.raw(`  RAM   ${fmtBytes(r.mem_used_bytes)} / ${fmtBytes(r.mem_total_bytes)} (${fmtPct(r.mem_pct)})\r\n`);
    for (const d of r.disks)
      eng.raw(`  DISK  ${pad(d.mount, 8)} ${fmtBytes(d.free_bytes)} free / ${fmtBytes(d.total_bytes)}\r\n`);
    const rx = r.nets.reduce((a, n) => a + n.rx_bps, 0);
    const tx = r.nets.reduce((a, n) => a + n.tx_bps, 0);
    eng.raw(`  NET   RX ${fmtRate(rx)}   TX ${fmtRate(tx)}\r\n`);
    eng.raw(`  UP    ${fmtUptime(r.uptime_secs)}\r\n`);
  },
};

const psCmd: CommandDefLike = {
  name: "ps",
  usage: "ps [count]",
  summary: "top processes by CPU (real)",
  group: "system",
  async run(eng, p) {
    const n = Math.min(Math.max(parseInt(p.args[0] ?? "12", 10) || 12, 1), 50);
    const procs = await getTopProcesses(n);
    eng.raw(`${ANSI.dim(pad("PID", 8) + rjust("CPU%", 7) + rjust("MEM", 11) + "  NAME")}\r\n`);
    for (const pr of procs)
      eng.raw(`${pad(String(pr.pid), 8)}${rjust(fmtPct(pr.cpu_pct), 7)}${rjust(fmtBytes(pr.mem_bytes), 11)}  ${pr.name}\r\n`);
  },
};

const inspectCmd: CommandDefLike = {
  name: "inspect",
  usage: "inspect <pid>",
  summary: "process path + signature status",
  group: "system",
  async run(eng, p) {
    const pid = parseInt(p.args[0] ?? "", 10);
    if (!Number.isFinite(pid)) { eng.tag("ERROR", "usage: inspect <pid>"); return; }
    try {
      const d = await procDetail(pid);
      eng.raw(`  ${pad("NAME", 8)}${d.name}\r\n  ${pad("PATH", 8)}${d.path ?? "(access denied / system)"}\r\n  ${pad("PARENT", 8)}${d.parent}\r\n  ${pad("SIGNATURE", 8)}${sigColor(d.sig)}\r\n`);
      if (d.path && /(\\Temp\\|\\Downloads\\|AppData\\Local\\Temp)/i.test(d.path))
        eng.tag("FAIL", `running from user-writable location: ${d.path}`);
    } catch (e) {
      eng.tag("ERROR", String(e));
    }
  },
};
function sigColor(sig: string): string {
  if (/Valid/i.test(sig)) return ANSI.color(82, sig);
  if (/NotSigned/i.test(sig)) return ANSI.color(196, sig + "  <- unsigned");
  return ANSI.color(214, sig || "unknown");
}

const healthCmd: CommandDefLike = {
  name: "health",
  usage: "health [--disk|--memory|--gpu]",
  summary: "system health vitals (real)",
  group: "system",
  async run(eng, p) {
    const r = await getResources();
    if (!p.flags.disk && !p.flags.memory && !p.flags.gpu) {
      eng.tag("SCAN", "system health overview");
      eng.raw(`  UPTIME  ${fmtUptime(r.uptime_secs)}\r\n  CPU     ${fmtPct(r.cpu_pct)}\r\n  RAM     ${fmtBytes(r.mem_used_bytes)} / ${fmtBytes(r.mem_total_bytes)} (${fmtPct(r.mem_pct)})\r\n`);
    }
    if (p.flags.disk) {
      const disks = await runModule<{ drive: string; sizeGB: number; freeGB: number; freePct: number }[]>("disk_space").catch(() => null);
      if (Array.isArray(disks)) {
        eng.raw(`\r\n  DRIVE   SIZE      FREE      FREE%\r\n`);
        for (const d of disks)
          eng.raw(`  ${pad(d.drive, 8)}${pad(`${d.sizeGB} GB`, 10)}${pad(`${d.freeGB} GB`, 10)}${d.freePct < 10 ? ANSI.color(196, `${d.freePct}%`) : d.freePct}%\r\n`);
      }
      const pf = await runModule<{ name: string; sizeMB: number; peakMB: number; useMB: number }[]>("pagefile").catch(() => null);
      if (Array.isArray(pf)) for (const p2 of pf) eng.raw(`  PAGEFILE ${p2.name}: ${p2.sizeMB}MB, peak ${p2.peakMB}MB\r\n`);
    }
    if (p.flags.memory) {
      const r2 = await getResources();
      eng.raw(`  RAM used ${fmtBytes(r2.mem_used_bytes)} / ${fmtBytes(r2.mem_total_bytes)} (${fmtPct(r2.mem_pct)})\r\n`);
    }
    if (p.flags.gpu) {
      const gpu = await runModule<{ name: string; driver: string; status: string; ramMB: number }[]>("gpu").catch(() => null);
      if (Array.isArray(gpu)) for (const g of gpu) eng.raw(`  GPU ${g.name} driver=${g.driver} status=${g.status}\r\n`);
      else eng.tag("DIM", "GPU enumeration unavailable");
    }
    const bat = await runModule<{ present: boolean; charge?: number }>("battery").catch(() => null);
    if (bat?.present) eng.raw(`  BATTERY ${bat.charge ?? "?"}%\r\n`);
    eng.tag("DIM", "deep SFC/DISM checks require confirmation + admin - Phase 14 hardening pass");
  },
};

const shellCmd: CommandDefLike = {
  name: "shell",
  usage: "shell <command...> | !<command>",
  summary: "run one PowerShell line (30s timeout, output-capped)",
  group: "system",
  async run(eng, p) {
    const cmdline = p.args.join(" ");
    if (!cmdline) { eng.tag("INFO", shellCmd.usage); return; }
    const t = typeof p.flags.timeout === "string" ? parseInt(p.flags.timeout, 10) : NaN;
    const timeoutSecs = Number.isFinite(t) ? Math.min(Math.max(t, 1), 120) : 30;
    eng.tag("DIM", `$ ${cmdline}`);
    const res = await execShell(cmdline, timeoutSecs);
    if (res.stdout) for (const l of sanitizeExternal(res.stdout).split(/\r?\n/)) eng.raw(`${ANSI.dim(l)}\r\n`);
    if (res.stderr) for (const l of sanitizeExternal(res.stderr).split(/\r?\n/)) eng.raw(ANSI.color(196, l) + "\r\n");
    const meta: string[] = [`exit=${res.exit_code ?? "null"}`];
    if (res.timed_out) meta.push("TIMED OUT");
    if (res.truncated) meta.push("OUTPUT TRUNCATED");
    eng.raw(ANSI.dim(meta.join("  ")) + "\r\n");
  },
};

/* ------------------------------------------------------------------ */
/* SECURITY OPS                                                        */
/* ------------------------------------------------------------------ */

async function printScanResult(eng: ConsoleEngine, record: ScanRecord): Promise<void> {
  const c = record.score.counts;
  eng.tag(
    record.findings.some((f) => f.severity === "CRITICAL") ? "FAIL" : record.findings.length ? "WARN" : "PASS",
    `scan complete in ${(record.durationMs / 1000).toFixed(1)}s`
  );
  eng.raw(`  SCORE   ${scoreColorText(record.score.total)}\r\n`);
  eng.raw(`  COUNTS  CRIT ${c.CRITICAL} · HIGH ${c.HIGH} · MED ${c.MEDIUM} · LOW ${c.LOW} · INFO ${c.INFO}\r\n`);
  if (record.exposure) eng.raw(`  EXPOSE  ${record.exposure}\r\n`);

  if (record.findings.length) {
    eng.raw(`\r\n${ANSI.color(245, "TOP FINDINGS")}\r\n`);
    for (const f of record.findings.slice(0, 10)) {
      const color = f.severity === "CRITICAL" ? 196 : f.severity === "HIGH" ? 208 : f.severity === "MEDIUM" ? 220 : 245;
      eng.raw(`  ${ANSI.color(color, pad(f.severity, 9))}${pad(f.id, 10)}${f.title}\r\n`);
      eng.raw(`  ${ANSI.dim(pad("", 19) + f.evidence.slice(0, 90))}\r\n`);
      if (f.recommendation) eng.raw(`  \x1b[38;5;114m→ ${f.recommendation.slice(0, 95)}\x1b[0m\r\n`);
    }
  } else {
    eng.tag("PASS", "No detected issues within the scope of this scan.");
    eng.tag("DIM", "This is NOT a guarantee of security - scanners are imperfect.");
  }
  if (record.id) eng.tag("DIM", `saved as ${record.id} · report --html to export · ai analyze scan to discuss with local AI`);
}
function scoreColorText(total: number): string {
  const color = total >= 80 ? 82 : total >= 55 ? 214 : 196;
  return ANSI.bold(ANSI.color(color, `${total}/100`));
}

const scanCmd: CommandDefLike = {
  name: "scan",
  usage: "scan [--quick|--full|--security|--network|--startup|--processes|--events|--privacy]",
  summary: "endpoint security audit (real modules, scored)",
  group: "security",
  async run(eng, p) {
    const { mockBanner } = await import("../scan/scans");
    if (mockBanner(eng)) { eng.tag("DIM", "turn off with: mock off"); return; }
    const kind = p.flags.quick ? "quick" : p.flags.full ? "full" : p.flags.security ? "security"
      : p.flags.network ? "network" : p.flags.startup ? "startup" : p.flags.processes ? "processes"
      : p.flags.events ? "events" : p.flags.privacy ? "privacy" : "quick";
    const { runScan } = await import("../scan/scans");
    const record = await runScan(eng, kind);
    await printScanResult(eng, record);
  },
};

const scoreCmd: CommandDefLike = {
  name: "score",
  usage: "score",
  summary: "latest security score breakdown",
  group: "security",
  async run(eng) {
    const s = latestScore();
    if (s === null) { eng.tag("WARN", "no scans yet - run: scan --quick"); return; }
    eng.raw(`  SECURITY SCORE  ${scoreColorText(s)}\r\n`);
    const metas = await listScans().catch(() => []);
    if (metas[0]?.id) {
      const rec = await import("../lib/ipc").then((m) => m.getScan(metas[0].id)).catch(() => null);
      if (rec) {
        for (const b of rec.score.breakdown)
          if (b.lost > 0) eng.raw(`  ${pad(b.category, 12)} -${String(b.lost).padStart(3)}/${b.max}\r\n`);
      }
    }
  },
};

const reportCmd: CommandDefLike = {
  name: "report",
  usage: "report [--latest] [--json|--md] (default html)",
  summary: "export last scan as HTML/JSON/MD report",
  group: "security",
  async run(eng, p) {
    let record = (await import("../scan/scans")).getLatestScan();
    if (!record || p.flags.latest) {
      const metas = await listScans().catch(() => []);
      if (!metas.length) { eng.tag("WARN", "no stored scans"); return; }
      record = await import("../lib/ipc").then((m) => m.getScan(metas[0].id)).catch(() => null);
    }
    if (!record) { eng.tag("WARN", "no scan data available"); return; }
    const fmt = p.flags.json ? "json" : p.flags.md ? "md" : "html";
    const { exportReport } = await import("../reports/export");
    eng.tag("SCAN", `building ${fmt.toUpperCase()} report...`);
    await exportReport(eng, record, fmt);
  },
};

const baselineCmd: CommandDefLike = {
  name: "baseline",
  usage: "baseline create|compare|show",
  summary: "configuration drift detection",
  group: "security",
  async run(eng, p) {
    const sub = p.args[0] ?? "show";
    const mod = await import("../scan/baseline");
    if (sub === "create") await mod.createBaseline(eng);
    else if (sub === "compare") await mod.compareBaseline(eng);
    else {
      const base = await import("../lib/ipc").then((m) => m.getBaseline());
      if (!base) { eng.tag("DIM", "(no baseline) - create one with: baseline create"); return; }
      eng.tag("INFO", `baseline from ${base.created}: ${base.processes?.length ?? 0} procs, ${base.services?.length ?? 0} services, ${base.ports?.length ?? 0} ports`);
    }
  },
};

const auditsCmd: CommandDefLike = {
  name: "audit",
  usage: "audit [n]",
  summary: "show audit trail (never hidden)",
  group: "security",
  async run(eng, p) {
    const n = Math.min(parseInt(p.args[0] ?? "20", 10) || 20, 200);
    const entries = await auditTail(n).catch(() => []);
    if (!entries.length) { eng.tag("DIM", "(empty)"); return; }
    for (const e of entries.slice().reverse())
      eng.raw(`  ${ANSI.dim(e.ts)}  ${pad(e.action, 18)}${typeof e.detail === "object" ? JSON.stringify(e.detail).slice(0, 70) : ""}\r\n`);
  },
};

const opsecCmd: CommandDefLike = {
  name: "opsec",
  usage: "opsec --check",
  summary: "privacy / attack-surface review (real checks)",
  group: "security",
  async run(eng) {
    const { runScan } = await import("../scan/scans");
    const record = await runScan(eng, "privacy");
    await printScanResult(eng, record);
    eng.tag("OPSEC", "framing: privacy + attack-surface reduction. Not anonymity tooling.");
  },
};

const mockCmd: CommandDefLike = {
  name: "mock",
  usage: "mock on|off|status",
  summary: "toggle synthetic-data mode (always labeled MOCK DATA)",
  group: "security",
  run(eng, p) {
    const sub = p.args[0] ?? "status";
    const cur = useSettings.getState().mockMode;
    if (sub === "on" && !cur) useSettings.getState().toggleMock();
    if (sub === "off" && cur) useSettings.getState().toggleMock();
    const now = useSettings.getState().mockMode;
    if (now) eng.tag("WARN", "MOCK MODE ON - synthetic results will be labeled MOCK DATA.");
    else eng.tag("PASS", `MOCK MODE OFF${sub === "status" ? "" : "."}`);
  },
};

/* ------------------------------------------------------------------ */
/* NETWORK / PENTEST                                                   */
/* ------------------------------------------------------------------ */

const networkCmd: CommandDefLike = {
  name: "network",
  usage: "network [--connections|--interfaces|--routes|--dns|--firewall]",
  summary: "local network configuration & exposure",
  group: "network",
  async run(eng, p) {
    const M = <T,>(m: string) => runModule<T>(m).catch(() => null);
    if (p.flags.firewall) {
      const fw = await M<{ name: string; enabled: boolean; inbound: string; outbound: string }[]>("firewall");
      if (Array.isArray(fw)) {
        eng.raw(`  PROFILE  STATE     INBOUND   OUTBOUND\r\n`);
        for (const x of fw)
          eng.raw(`  ${pad(x.name.toUpperCase(), 9)}${x.enabled ? ANSI.color(82, pad("ON", 10)) : ANSI.color(196, pad("OFF", 10))}${pad(x.inbound, 10)}${x.outbound}\r\n`);
      }
      return;
    }
    if (p.flags.interfaces || p.flags.dns) {
      const ifs = await M<{ alias: string; addrs: string[]; v6: string[]; gw: string; dns: string[] }[]>("interfaces");
      if (Array.isArray(ifs))
        for (const i of ifs) {
          eng.raw(`  ${ANSI.color(39, i.alias)}  v4=${i.addrs.join(",") || "-"}  gw=${i.gw || "-"}\r\n`);
          if (p.flags.dns) eng.raw(`    dns: ${i.dns.join(", ") || "-"}\r\n`);
        }
      if (!p.flags.connections) return;
    }
    if (p.flags.routes) {
      const rt = await M<{ dst: string; gw: string; iface: string; metric: number }[]>("routes");
      if (Array.isArray(rt)) for (const r of rt) eng.raw(`  ${pad(r.dst, 10)} via ${pad(r.gw, 16)} ${r.iface} metric=${r.metric}\r\n`);
      return;
    }
    // default: connections/exposure
    const ports = await M<{ addr: string; port: number; pid: number; proc: string }[]>("tcp_ports");
    const exposure = Array.isArray(ports) ? classify(ports) : "?";
    eng.raw(`  LISTENERS (${ports?.length ?? 0})\r\n`);
    if (Array.isArray(ports))
      for (const r of ports.slice(0, 30))
        eng.raw(`  ${pad(r.addr, 12)}${ANSI.color(39, String(r.port).padEnd(7))}${pad(String(r.pid), 8)}${r.proc}\r\n`);
    eng.raw(`  EXPOSURE  ${exposure}\r\n`);
    eng.tag("DIM", "loopback-only bindings are excluded from exposure rating");

    function classify(list: { addr: string }[]): "LOW" | "MODERATE" | "ELEVATED" {
      const ext = list.filter((r) => r.addr !== "127.0.0.1" && r.addr !== "::1");
      return ext.length > 10 ? "ELEVATED" : ext.length > 0 ? "MODERATE" : "LOW";
    }
  },
};

const pentestCmd: CommandDefLike = {
  name: "pentest",
  usage: "pentest discover|ports <target> [--ports 80,443]|authorize <target>",
  summary: "authorized testing workspace (LEVEL 1 observe)",
  group: "network",
  async run(eng, p) {
    const mod = await import("../scan/pentest");
    const sub = p.args[0];
    if (sub === "discover") await mod.pentestDiscover(eng);
    else if (sub === "authorize") {
      if (!p.args[1]) { eng.tag("ERROR", "usage: pentest authorize <ip>"); return; }
      mod.pentestAuthorize(eng, p.args[1]);
    } else if (sub === "ports") {
      if (!p.args[1]) { eng.tag("ERROR", "usage: pentest ports <target> [--ports 80,443]"); return; }
      await mod.pentestPorts(eng, p.args[1], p.flags, p.args);
    } else {
      eng.tag("INFO", pentestCmd.usage);
      eng.tag("DIM", "Backend hard-refuses public targets. LAN needs explicit authorization. LEVEL1 = observe only.");
    }
  },
};

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

const aiCmd: CommandDefLike = {
  name: "ai",
  usage: 'ai <question> | ai explain scan | ai (repl mode)',
  summary: "ask local Gemma about findings/security (offline)",
  group: "ai",
  async run(eng, p) {
    const { askAi, resetAiHistory } = await import("../ai/client");
    if (!p.args.length) {
      bindSelf();
      resetAiHistory();
      eng.raw(ANSI.dim("AI mode - ask anything about your system's security. /exit or Ctrl+C returns.\r\n"));
      return;
    }
    const q = p.args.join(" ").toLowerCase();
    const withScan = p.flags.scan === true || typeof p.flags.scan === "string" || /explain (latest|scan)|analyze/.test(q);
    await askAi(eng, p.args.join(" "), { withScan });
  },
};

let _engineRef: ConsoleEngine | null = null;
function bindSelf(): void {
  _engineRef?.setMode("ai");
}
export function bindEngineForCommands(eng: ConsoleEngine): void {
  _engineRef = eng;
  eng.aiHandler = async (line: string) => {
    const { handleAiLine } = await import("../ai/client");
    await handleAiLine(eng, line);
  };
}

const ollamaCmd: CommandDefLike = {
  name: "ollama",
  usage: "ollama",
  summary: "probe Ollama + pick model (prefers gemma*e4b*)",
  group: "ai",
  async run(eng) {
    eng.tag("INFO", `probing ${DEFAULT_OLLAMA_ENDPOINT} ...`);
    try {
      const st = await checkOllama(DEFAULT_OLLAMA_ENDPOINT);
      useLive.getState().setOllama(st.online, st.models);
      const pick = await import("../lib/ipc").then((m) => m.pickModel(DEFAULT_OLLAMA_ENDPOINT));
      useLive.getState().setAiModel(pick.model);
      if (st.online) {
        eng.tag("PASS", `OLLAMA: CONNECTED · MODE: LOCAL ONLY`);
        for (const m of st.models) {
          const marker = m === pick.model ? ANSI.color(82, " ← selected") : "";
          eng.raw(`    ${ANSI.color(207, m)}${marker}\r\n`);
        }
        eng.tag("DIM", `assistant model: ${pick.model ?? "(none)"} · ask: ai <question> or type ai`);
      } else {
        eng.tag("WARN", "OLLAMA: OFFLINE");
        eng.tag("DIM", "Optional - docs/OLLAMA.md has setup steps. Everything else works offline.");
      }
    } catch (e) {
      eng.tag("ERROR", String(e));
    }
  },
};

/* ------------------------------------------------------------------ */
/* APPEARANCE                                                          */
/* ------------------------------------------------------------------ */

const themeCmd: CommandDefLike = {
  name: "theme",
  usage: "theme <phosphor|arch|green|cyan|amber|magenta|purple|list>",
  summary: "switch accent color (repaints panels, grid and backdrop)",
  group: "appearance",
  run(eng, p) {
    const cur = useSettings.getState().accent;
    if (!p.args[0] || p.args[0] === "list") {
      eng.tag("INFO", `accents: ${Object.keys(ACCENTS).join(" | ")} (current: ${cur})`);
      return;
    }
    const a = p.args[0] as AccentName;
    if (!(a in ACCENTS)) { eng.tag("ERROR", `unknown accent "${p.args[0]}"`); return; }
    useSettings.getState().setAccent(a);
    applyAccent(a);
    eng.tag("PASS", `accent -> ${a}`);
  },
};

const wallpaperCmd: CommandDefLike = {
  name: "wallpaper",
  usage: "wallpaper <status|pick|off|blur N|dark N|path C:\\file.png>",
  summary: "custom background image controls",
  group: "appearance",
  async run(eng, p) {
    const cfg = useSettings.getState().wallpaper;
    const sub = (p.args[0] ?? "status").toLowerCase();
    const set = useSettings.getState().setWallpaper;
    switch (sub) {
      case "status":
        eng.raw(`  enabled=${cfg.enabled}  blur=${cfg.blurPx}px  darkness=${cfg.darkness}%\r\n  path=${cfg.path ?? "(none)"}\r\n`);
        break;
      case "off": set({ enabled: false }); eng.tag("PASS", "wallpaper disabled"); break;
      case "on":
        if (!cfg.path) { eng.tag("ERROR", "no wallpaper path set - use: wallpaper pick"); return; }
        set({ enabled: true }); eng.tag("PASS", "wallpaper enabled");
        break;
      case "blur": {
        const n = parseInt(p.args[1] ?? "", 10);
        if (!Number.isFinite(n)) { eng.tag("ERROR", "usage: wallpaper blur <0-24>"); return; }
        set({ blurPx: Math.min(Math.max(n, 0), 24) });
        eng.tag("PASS", `blur -> ${Math.min(Math.max(n, 0), 24)}px`);
        break;
      }
      case "dark":
      case "darkness": {
        const n = parseInt(p.args[1] ?? "", 10);
        if (!Number.isFinite(n)) { eng.tag("ERROR", "usage: wallpaper dark <0-95>"); return; }
        set({ darkness: Math.min(Math.max(n, 0), 95) });
        eng.tag("PASS", `darkness -> ${Math.min(Math.max(n, 0), 95)}%`);
        break;
      }
      case "pick": {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const sel = await open({ multiple: false, directory: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }] });
        if (typeof sel === "string") { set({ path: sel, enabled: true }); eng.tag("PASS", `wallpaper -> ${sel}`); }
        else eng.tag("DIM", "cancelled");
        break;
      }
      default: {
        const target = p.args.join(" ");
        if (!/\.(png|jpe?g|webp|bmp)$/i.test(target)) { eng.tag("ERROR", "expected an image path (.png/.jpg/.jpeg/.webp/.bmp)"); return; }
        set({ path: target, enabled: true });
        eng.tag("PASS", `wallpaper -> ${target}`);
      }
    }
  },
};

/* ------------------------------------------------------------------ */

export const COMMANDS: Record<string, CommandDefLike> = {
  help: helpCmd,
  clear: clearCmd,
  banner: bannerCmd,
  status: statusCmd,
  elevate: elevateCmd,
  echo: echoCmd,
  history: historyCmd,
  exit: exitCmd,
  sysinfo: sysinfoCmd,
  neofetch: neofetchCmd,
  clean: cleanCmd,
  res: resCmd,
  ps: psCmd,
  inspect: inspectCmd,
  health: healthCmd,
  shell: shellCmd,
  scan: scanCmd,
  score: scoreCmd,
  report: reportCmd,
  baseline: baselineCmd,
  audit: auditsCmd,
  opsec: opsecCmd,
  admin: adminCmd,
  mock: mockCmd,
  network: networkCmd,
  pentest: pentestCmd,
  ai: aiCmd,
  model: modelCmd,
  ollama: ollamaCmd,
  theme: themeCmd,
  backdrop: backdropCmd,
  wallpaper: wallpaperCmd,
};

export const ALIASES: Record<string, string> = {
  "?": "help",
  cls: "clear",
  quit: "exit",
  "!": "shell",
  fetch: "neofetch",
  archfetch: "neofetch",
  screenfetch: "neofetch",
  cleanup: "clean",
  tmp: "clean",
  sudo: "admin",
  privileges: "admin",
  models: "model",
  bg: "backdrop",
};

type TagChannel = Parameters<ConsoleEngine["tag"]>[0];

/** Resolve aliases and dispatch to command definitions. */
export async function dispatch(eng: ConsoleEngine, p: ParsedCommand | null): Promise<void> {
  if (!p) return;
  let name = p.name;
  if (ALIASES[name]) name = ALIASES[name];

  const def = COMMANDS[name];
  if (def) {
    await def.run(eng, p);
    return;
  }
  if (PENDING_MODULES[name]) {
    pendingNotice(eng, name);
    return;
  }

  const pool = Object.keys(COMMANDS);
  const suggestions = pool.filter((k) => k.startsWith(name.slice(0, 2))).slice(0, 4);
  eng.tag(
    "ERROR" as TagChannel,
    `unknown command: ${name}${suggestions.length ? ` - try: ${suggestions.join(", ")}` : ""} ("help" lists all)`
  );
}
