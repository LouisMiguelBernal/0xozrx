import { ANSI } from "../output";
import { pad, type CommandDefLike } from "../cmdtypes";
import { adminApply, adminStatus, auditAppend, elevateRelaunch, runModule } from "../../lib/ipc";
import { useLive } from "../../store/settings";
import type { AdminAction } from "../../types/system";
import type { ConsoleEngine } from "../console";

const impactColor = (i: string): number => (i === "HIGH" ? 196 : i === "MED" ? 214 : 82);

function printCatalog(eng: ConsoleEngine, actions: AdminAction[], elevated: boolean): void {
  eng.raw(`\r\n${ANSI.color(245, `${pad("ID", 22)}${pad("IMPACT", 9)}${pad("NEEDS", 8)}TITLE`)}\r\n`);
  for (const a of actions) {
    const gate = a.requires_admin ? (elevated ? ANSI.color(82, pad("admin", 8)) : ANSI.color(196, pad("admin", 8))) : pad("-", 8);
    eng.raw(
      `  ${ANSI.color(39, pad(a.id, 22))}${ANSI.color(impactColor(a.impact), pad(a.impact, 9))}${gate}${a.title}\r\n`
    );
  }
  eng.raw(
    `\r\n${ANSI.dim("  admin apply <id>        preview the change (no mutation)")}\r\n` +
      `${ANSI.dim("  admin apply <id> --yes  execute it (elevation enforced backend-side, audit-logged)")}\r\n\r\n`
  );
}

/** Live UAC / account posture, read-only. */
async function printPosture(eng: ConsoleEngine): Promise<void> {
  const uac = await runModule<{ enableLUA?: number; consentAdmin?: number; secureDesktop?: number }>("uac").catch(
    () => null
  );
  if (!uac || typeof uac.enableLUA !== "number") {
    eng.tag("DIM", "UAC policy unreadable");
    return;
  }
  const luaOk = uac.enableLUA === 1;
  const consentOk = (uac.consentAdmin ?? 0) >= 2;
  const deskOk = uac.secureDesktop === 1;
  const mark = (ok: boolean, text: string) => (ok ? ANSI.color(82, text) : ANSI.color(214, text));
  eng.raw(`  ${pad("UAC ENABLED", 22)}${mark(luaOk, luaOk ? "yes" : "NO - EnableLUA=0")}\r\n`);
  eng.raw(
    `  ${pad("ADMIN PROMPT", 22)}${mark(consentOk, `ConsentPromptBehaviorAdmin=${uac.consentAdmin ?? "?"}`)}\r\n`
  );
  eng.raw(`  ${pad("SECURE DESKTOP", 22)}${mark(deskOk, deskOk ? "yes" : "no")}\r\n`);
  if (!luaOk || !consentOk || !deskOk) eng.tag("WARN", "UAC is weaker than recommended - see: admin apply uac_max");
}

export const adminCmd: CommandDefLike = {
  name: "admin",
  usage: "admin [status|list|elevate|apply <id> [--yes]]",
  summary: "privilege state + allowlisted hardening actions (confirm-gated, audited)",
  group: "security",
  async run(eng, p) {
    const sub = (p.args[0] ?? "status").toLowerCase();

    if (sub === "elevate") {
      if (useLive.getState().elevated === true) {
        eng.tag("INFO", "already running elevated.");
        return;
      }
      eng.tag("WARN", "UAC prompt incoming - approving relaunches 0xOZrx!! as Administrator...");
      const ok = await elevateRelaunch();
      eng.tag(ok ? "DIM" : "ERROR", ok ? "this instance will close; the elevated one takes over." : "elevation cancelled or blocked.");
      return;
    }

    const st = await adminStatus();
    useLive.getState().setElevated(st.elevated);

    if (sub === "list") {
      printCatalog(eng, st.actions, st.elevated);
      return;
    }

    if (sub === "apply") {
      const id = p.args[1];
      if (!id) {
        eng.tag("ERROR", "usage: admin apply <id> [--yes]   (admin list shows ids)");
        return;
      }
      const action = st.actions.find((a) => a.id === id);
      if (!action) {
        eng.tag("ERROR", `unknown action "${id}" - run: admin list`);
        return;
      }

      // Preview mode: describe exactly what happens and how to undo it.
      if (!p.flags.yes) {
        eng.raw(`\r\n  ${ANSI.bold(action.title)}\r\n`);
        eng.raw(`  ${ANSI.dim(pad("IMPACT", 12))}${ANSI.color(impactColor(action.impact), action.impact)}\r\n`);
        eng.raw(`  ${ANSI.dim(pad("REQUIRES", 12))}${action.requires_admin ? "Administrator" : "no elevation"}\r\n`);
        eng.raw(`  ${ANSI.dim(pad("CHANGES", 12))}${action.detail}\r\n`);
        eng.raw(`  ${ANSI.dim(pad("REVERT", 12))}${action.revert}\r\n\r\n`);
        if (action.requires_admin && !st.elevated)
          eng.tag("WARN", "session is NOT elevated - run `elevate` first or this will be refused.");
        eng.tag("INFO", `nothing changed. to execute: admin apply ${id} --yes`);
        return;
      }

      if (action.requires_admin && !st.elevated) {
        eng.tag("ERROR", `"${id}" needs an elevated session - run \`elevate\` first.`);
        return;
      }

      eng.tag("SCAN", `applying ${id} ...`);
      void auditAppend("admin.cmd", { id, via: "terminal" });
      try {
        const res = await adminApply(id, id, 180);
        if (res.ok) {
          eng.tag("PASS", `${id} applied in ${(res.elapsed_ms / 1000).toFixed(1)}s`);
          for (const l of res.output.split(/\r?\n/).filter(Boolean)) eng.raw(`  ${ANSI.dim(l)}\r\n`);
          eng.tag("DIM", `revert: ${action.revert}`);
        } else {
          eng.tag("FAIL", `${id} did not complete: ${(res.error ?? "unknown error").slice(0, 200)}`);
          if (res.output) for (const l of res.output.split(/\r?\n/).filter(Boolean)) eng.raw(`  ${ANSI.dim(l)}\r\n`);
        }
      } catch (e) {
        eng.tag("ERROR", String(e).slice(0, 220));
      }
      return;
    }

    // default: status
    eng.raw(`\r\n  ${pad("SESSION", 22)}${st.username}@${st.hostname || "local"}\r\n`);
    eng.raw(
      `  ${pad("TOKEN", 22)}${st.elevated ? ANSI.bold(ANSI.color(196, "ADMINISTRATOR (elevated)")) : ANSI.color(39, "standard user")}\r\n`
    );
    await printPosture(eng);
    eng.raw(`  ${pad("ACTIONS AVAILABLE", 22)}${st.actions.filter((a) => !a.requires_admin || st.elevated).length}/${st.actions.length}\r\n`);
    printCatalog(eng, st.actions, st.elevated);
    if (!st.elevated) eng.tag("DIM", "run `elevate` (single UAC prompt) to unlock admin-only actions.");
  },
};
