import type { ConsoleEngine } from "../engine/console";
import { getBaseline, getTopProcesses, runModule, saveBaseline, auditAppend } from "../lib/ipc";
import { useLive } from "../store/settings";
import type { ServiceRow, StartupRow, TaskRow, TcpPortRow } from "../scan/scans";

interface Snapshot {
  created: string;
  host: string;
  processes: string[];
  services: string[];
  ports: [string, number, string][];
  startup: string[];
  tasks: string[];
}

export async function createBaseline(eng: ConsoleEngine): Promise<void> {
  eng.tag("SCAN", "capturing baseline snapshot...");
  const [procsRaw, services, ports, startup, tasks] = await Promise.all([
    getTopProcesses(50).catch(() => []),
    runModule<ServiceRow[]>("services").catch(() => null),
    runModule<TcpPortRow[]>("tcp_ports").catch(() => null),
    runModule<StartupRow[]>("startup").catch(() => null),
    runModule<TaskRow[]>("tasks").catch(() => null),
  ]);

  const snap: Snapshot = {
    created: new Date().toISOString(),
    host: useLive.getState().sysInfo?.hostname ?? "",
    processes: procsRaw.map((p) => p.name).sort(),
    services: (services ?? []).filter((s) => s.start === "Auto").map((s) => s.name).sort(),
    ports: (ports ?? []).map((p) => [p.addr, p.port, p.proc]),
    startup: (startup ?? []).map((s) => `${s.src}::${s.name}`),
    tasks: (tasks ?? []).map((t) => `${t.path}${t.name}`),
  };
  await saveBaseline(snap);
  void auditAppend("baseline.create", { items: snap.processes.length + snap.services.length });
  eng.tag("PASS", `baseline saved (${snap.processes.length} procs, ${snap.services.length} auto-services, ${snap.ports.length} listeners)`);
}

export async function compareBaseline(eng: ConsoleEngine): Promise<void> {
  const base = await getBaseline();
  if (!base || typeof base !== "object" || !("processes" in base)) {
    eng.tag("WARN", "no baseline yet - run: baseline create");
    return;
  }
  const b = base as Snapshot;
  eng.tag("SCAN", `comparing against baseline from ${b.created}`);

  const [procsNow, servicesNow, portsNow, startupNow, tasksNow] = await Promise.all([
    getTopProcesses(50).catch(() => []),
    runModule<ServiceRow[]>("services").catch(() => null),
    runModule<TcpPortRow[]>("tcp_ports").catch(() => null),
    runModule<StartupRow[]>("startup").catch(() => null),
    runModule<TaskRow[]>("tasks").catch(() => null),
  ]);

  const diffSets = <T>(oldS: Set<T>, nowS: Set<T>) => ({
    added: [...nowS].filter((x) => !oldS.has(x)),
    removed: [...oldS].filter((x) => !nowS.has(x)),
  });

  const procs = diffSets(new Set(b.processes), new Set(procsNow.map((p) => p.name)));
  const services = diffSets(new Set(b.services), new Set((servicesNow ?? []).filter((s) => s.start === "Auto").map((s) => s.name)));
  const portKey = (t: [string, number, string]) => `${t[0]}:${t[1]}:${t[2]}`;
  const ports = diffSets(new Set(b.ports.map(portKey)), new Set((portsNow ?? []).map((p) => portKey([p.addr, p.port, p.proc]))));
  const startup = diffSets(new Set(b.startup), new Set((startupNow ?? []).map((s) => `${s.src}::${s.name}`)));
  const tasks = diffSets(new Set(b.tasks), new Set((tasksNow ?? []).map((t) => `${t.path}${t.name}`)));

  const section = (title: string, added: string[], removed: string[]) => {
    eng.raw(`\r\n\x1b[1m${title}\x1b[0m\r\n`);
    if (!added.length && !removed.length) {
      eng.raw("\x1b[2m  unchanged\x1b[0m\r\n");
      return;
    }
    for (const a of added.slice(0, 12)) eng.raw(`  \x1b[38;5;214mNEW     \x1b[0m${a}\r\n`);
    for (const r of removed.slice(0, 12)) eng.raw(`  \x1b[38;5;245mREMOVED \x1b[0m${r}\r\n`);
    const hidden = Math.max(0, added.length - 12) + Math.max(0, removed.length - 12);
    if (hidden > 0) eng.raw(`\x1b[2m  ...and ${hidden} more\x1b[0m\r\n`);
  };

  section("PROCESSES (top-50 window)", procs.added, procs.removed);
  section("AUTO-SERVICES", services.added, services.removed);
  section("LISTENING PORTS", ports.added, ports.removed);
  section("STARTUP ITEMS", startup.added, startup.removed);
  section("SCHEDULED TASKS", tasks.added, tasks.removed);

  const totalNew = procs.added.length + services.added.length + ports.added.length + startup.added.length + tasks.added.length;
  if (totalNew > 0) eng.tag("WARN", `${totalNew} NEW item(s) since baseline - review above.`);
  else eng.tag("PASS", "No drift detected in tracked sets.");
  void auditAppend("baseline.compare", { newItems: totalNew });
}
