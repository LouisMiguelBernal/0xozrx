import { ANSI } from "../engine/output";
import { BANNER_ART, TAGLINE } from "../engine/banner";
import { engine } from "../engine/console";
import { DEFAULT_OLLAMA_ENDPOINT } from "../engine/commands";
import {
  auditAppend,
  checkOllama,
  cleanScan,
  getBaseline,
  getSystemInfo,
  getResources,
  isElevated,
  pickModel,
  runModule,
} from "../lib/ipc";
import { ACCENTS, useLive, useSettings } from "../store/settings";
import { fmtBytes, fmtPct, fmtRate } from "../lib/format";
import { loadLatestMeta } from "../scan/scans";
import type { SystemInfo } from "../types/system";

/** Cache probes so re-mounts (React StrictMode) don't hammer the system. */
let sysInfoPromise: Promise<SystemInfo> | null = null;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runBootSequence(): Promise<void> {
  const accentHex = ACCENTS[useSettings.getState().accent] ?? ACCENTS.arch;
  for (const row of BANNER_ART) engine.raw(ANSI.hex(accentHex, row) + "\r\n");
  engine.raw(ANSI.bold(ANSI.hex(accentHex, `  ${TAGLINE}`)) + "\r\n");
  engine.raw(
    ANSI.color(196, "  ▲ AUTHORIZED SYSTEMS ONLY — every action is written to the local audit trail")
    + "\r\n\r\n"
  );

  await sleep(80);

  // [ SYSTEM ]
  try {
    sysInfoPromise ??= getSystemInfo();
    const info = await sysInfoPromise;
    useLive.getState().setSysInfo(info);
    engine.tag("SYSTEM", `${info.os_name} build ${info.os_build} (${info.arch}) - ${info.hostname}`);
  } catch (e) {
    engine.tag("ERROR", `system detection failed: ${String(e)}`);
  }

  // [ PRIVILEGE ]
  try {
    const elevated = await isElevated();
    useLive.getState().setElevated(elevated);
    if (elevated) {
      engine.tag("FAIL", "ELEVATED SESSION - Administrator token active");
      engine.tag("DIM", "shell commands and all modules execute with full machine rights. Audit trail is on.");
      void auditAppend("session.start", { elevated: true });
    } else {
      engine.tag("INFO", "standard user session (unelevated)");
      void auditAppend("session.start", { elevated: false });
    }
  } catch {
    engine.tag("DIM", "privilege check unavailable");
  }

  await sleep(90);

  // [ RESOURCES ]
  try {
    const r = await getResources();
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
    const rx = r.nets.reduce((a, n) => a + n.rx_bps, 0);
    const tx = r.nets.reduce((a, n) => a + n.tx_bps, 0);
    engine.tag(
      "PASS",
      `resources online - CPU ${fmtPct(r.cpu_pct)} RAM ${fmtBytes(r.mem_used_bytes)} NET RX ${fmtRate(rx)} TX ${fmtRate(tx)}`
    );
  } catch (e) {
    engine.tag("WARN", `resource polling unavailable: ${String(e)}`);
  }
  await sleep(90);

  // [ DEFENDER ]
  try {
    const d = await runModule<{ av?: boolean; rt?: boolean }>("defender", 30);
    if (d?.av && d?.rt) engine.tag("PASS", "Microsoft Defender active (AV + real-time)");
    else if (typeof d?.av === "boolean") engine.tag("WARN", "Defender components degraded - run: scan --quick");
    else engine.tag("DIM", "defender status unavailable");
  } catch {
    engine.tag("DIM", "defender status unavailable");
  }

  // [ FIREWALL ]
  try {
    const fw = await runModule<{ name: string; enabled: boolean }[]>("firewall", 30);
    if (Array.isArray(fw) && fw.length) {
      const off = fw.filter((p) => !p.enabled).map((p) => p.name);
      if (off.length) engine.tag("WARN", `firewall profiles OFF: ${off.join(", ")}`);
      else engine.tag("PASS", `firewall enabled on all ${fw.length} profiles`);
    }
  } catch {
    engine.tag("DIM", "firewall status unavailable");
  }

  // [ OLLAMA + MODEL ]
  try {
    const st = await checkOllama(DEFAULT_OLLAMA_ENDPOINT);
    useLive.getState().setOllama(st.online, st.models);
    const pinned = useSettings.getState().preferredModel;
    const pick = await pickModel(DEFAULT_OLLAMA_ENDPOINT);
    const active = pinned ?? pick.model;
    useLive.getState().setAiModel(active);
    if (st.online && active) {
      engine.tag(
        "AI",
        `ollama connected - model ${active} (local only${pinned ? ", pinned" : `, ${pick.reason}`})`
      );
      if (!pick.preferred && !pinned)
        engine.tag("DIM", `tuned for ${pick.recommended} - install it with: ollama pull ${pick.recommended}`);
    } else if (st.online) {
      engine.tag("AI", `ollama connected (${st.models.length} model(s), none auto-selected)`);
    } else {
      engine.tag("DIM", "ollama offline - optional (docs/OLLAMA.md)");
    }
  } catch {
    engine.tag("DIM", "ollama offline - optional; app remains fully functional locally");
  }

  // [ MAINTENANCE ] - dry-run only, never touches anything on boot
  try {
    const rep = await cleanScan(60);
    useLive.getState().setReclaimable(rep.total_bytes);
    if (rep.total_bytes > 512 * 1024 * 1024) {
      engine.tag("WARN", `${fmtBytes(rep.total_bytes)} reclaimable in temp/cache - review with: clean`);
    } else {
      engine.tag("PASS", `temp/cache footprint ${fmtBytes(rep.total_bytes)} - nothing urgent`);
    }
  } catch {
    engine.tag("DIM", "cleanup survey unavailable");
  }

  // [ BASELINE ]
  try {
    const base = await getBaseline();
    engine.tag(
      base ? "PASS" : "INFO",
      base ? "baseline present - drift checks ready (baseline compare)" : "no baseline yet - recommended: baseline create"
    );
  } catch {
    /* ignore */
  }

  try {
    await loadLatestMeta();
  } catch {
    /* ignore */
  }

  engine.tag(
    "DIM",
    'type "help" for commands · "scan --quick" audit · "neofetch" summary · "admin" hardening · "ai" local Gemma'
  );
  engine.raw(`\r\n${ANSI.bold('Type "help" to begin.')}\r\n\r\n`);
}
