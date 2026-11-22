import { ANSI } from "../output";
import { flagValue, pad, rjust, type CommandDefLike } from "../cmdtypes";
import { auditAppend, cleanApply, cleanScan, emptyRecycleBin } from "../../lib/ipc";
import { fmtBytes } from "../../lib/format";
import { useLive } from "../../store/settings";
import type { CleanReport } from "../../types/system";
import type { ConsoleEngine } from "../console";

function printReport(eng: ConsoleEngine, rep: CleanReport): void {
  eng.raw(
    `\r\n${ANSI.color(245, `  ${pad("TARGET", 24)}${rjust("SIZE", 10)}${rjust("FILES", 9)}  LOCATION / STATUS`)}\r\n`
  );
  for (const t of rep.targets) {
    if (!t.available) {
      eng.raw(
        `  ${ANSI.dim(pad(t.id, 24) + rjust("-", 10) + rjust("-", 9) + "  " + (t.skipped_reason ?? "unavailable"))}\r\n`
      );
      continue;
    }
    const sizeTone = t.bytes > 1_073_741_824 ? 214 : t.bytes > 0 ? 82 : 240;
    eng.raw(
      `  ${ANSI.color(39, pad(t.id, 24))}${ANSI.color(sizeTone, rjust(fmtBytes(t.bytes), 10))}${rjust(String(t.files), 9)}  ${ANSI.dim(t.path ?? "")}\r\n`
    );
  }
  eng.raw(
    `\r\n  ${ANSI.bold(`RECLAIMABLE  ${fmtBytes(rep.total_bytes)}`)} across ${rep.total_files} files ` +
      ANSI.dim(`(older than ${rep.min_age_mins} min · ${(rep.elapsed_ms / 1000).toFixed(1)}s)`) +
      "\r\n"
  );
  if (!rep.elevated) eng.tag("DIM", "admin-only targets were skipped - run `elevate` to include Windows temp / Update cache / Prefetch.");
}

export const cleanCmd: CommandDefLike = {
  name: "clean",
  usage: "clean [--apply --yes] [--targets a,b] [--age 60] | clean recycle --yes",
  summary: "measure and reclaim temp/cache junk (dry-run by default)",
  group: "system",
  async run(eng, p) {
    // both `--age=60` and `--age 60` work; "recycle" is never mistaken for a value
    const ageRaw = flagValue(p.flags, p.args, "age", /^\d+$/, ["recycle"]);
    const ageFlag = ageRaw === undefined ? NaN : parseInt(ageRaw, 10);
    const minAge = Number.isFinite(ageFlag) ? Math.max(0, Math.min(ageFlag, 43200)) : 60;

    /* -------- recycle bin: separate, and the one unrecoverable action ------ */
    if ((p.args[0] ?? "").toLowerCase() === "recycle") {
      if (!p.flags.yes) {
        eng.tag("WARN", "emptying the Recycle Bin is NOT recoverable.");
        eng.tag("INFO", "to proceed: clean recycle --yes");
        return;
      }
      try {
        const out = await emptyRecycleBin("EMPTY-RECYCLE-BIN");
        eng.tag("PASS", out || "recycle bin emptied");
      } catch (e) {
        eng.tag("ERROR", String(e).slice(0, 200));
      }
      return;
    }

    /* ---------------------------- dry run -------------------------------- */
    eng.tag("SCAN", `measuring temp + cache targets (ignoring anything newer than ${minAge} min)...`);
    const rep = await cleanScan(minAge);
    useLive.getState().setElevated(rep.elevated);
    useLive.getState().setReclaimable(rep.total_bytes);
    printReport(eng, rep);

    if (!p.flags.apply) {
      eng.tag("INFO", "dry run - nothing deleted. to reclaim: clean --apply --yes");
      return;
    }

    /* ---------------------------- apply ---------------------------------- */
    const targetsRaw = flagValue(p.flags, p.args, "targets", /^[a-z0-9_]+(,[a-z0-9_]+)*$/i, [
      "recycle",
      ...(ageRaw ? [ageRaw] : []),
    ]);
    const requested = targetsRaw
      ? targetsRaw.split(",").map((t) => t.trim()).filter(Boolean)
      : rep.targets.filter((t) => t.available && t.bytes > 0).map((t) => t.id);

    if (!requested.length) {
      eng.tag("PASS", "nothing to reclaim.");
      return;
    }
    if (!p.flags.yes) {
      eng.tag("WARN", `would delete ${fmtBytes(rep.total_bytes)} from: ${requested.join(", ")}`);
      eng.tag("INFO", "add --yes to confirm. files still in use are skipped automatically.");
      return;
    }

    eng.tag("SCAN", `deleting from ${requested.length} target(s)...`);
    void auditAppend("clean.cmd", { targets: requested, minAge, via: "terminal" });
    try {
      const res = await cleanApply(requested, "CLEAN", minAge);
      for (const r of res.results) {
        if (r.error) {
          eng.raw(`  ${ANSI.color(214, pad(r.id, 24))}${ANSI.dim(r.error)}\r\n`);
          continue;
        }
        eng.raw(
          `  ${ANSI.color(82, pad(r.id, 24))}${rjust(fmtBytes(r.bytes_freed), 10)}  ${ANSI.dim(`${r.removed} removed, ${r.failed} locked/skipped`)}\r\n`
        );
      }
      eng.tag(
        "PASS",
        `reclaimed ${fmtBytes(res.bytes_freed)} · ${res.removed} entries removed · ${res.failed} skipped (in use) · ${(res.elapsed_ms / 1000).toFixed(1)}s`
      );
      useLive.getState().setReclaimable(null);
      if (res.failed > 0)
        eng.tag("DIM", "skipped entries are locked by running processes - re-run after a reboot to catch them.");
    } catch (e) {
      eng.tag("ERROR", String(e).slice(0, 220));
    }
  },
};
