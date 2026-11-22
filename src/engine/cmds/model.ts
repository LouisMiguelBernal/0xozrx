import { ANSI } from "../output";
import { pad, type CommandDefLike } from "../cmdtypes";
import { checkOllama, pickModel } from "../../lib/ipc";
import { useLive, useSettings } from "../../store/settings";
import {
  OLLAMA_ENDPOINT,
  PREFERRED_MODEL,
  describeModel,
  invalidateModelCache,
  resetAiHistory,
  warmUp,
} from "../../ai/client";

export const modelCmd: CommandDefLike = {
  name: "model",
  usage: "model [list|use <tag>|auto|info [tag]|warm|think on|off]",
  summary: `local AI model control (tuned for ${PREFERRED_MODEL})`,
  group: "ai",
  async run(eng, p) {
    const sub = (p.args[0] ?? "status").toLowerCase();
    const settings = useSettings.getState();

    /* ------------------------------ think -------------------------------- */
    if (sub === "think") {
      const want = (p.args[1] ?? "").toLowerCase();
      if (want !== "on" && want !== "off") {
        eng.tag("INFO", `reasoning mode is ${settings.aiThinking ? "ON" : "OFF"} · usage: model think on|off`);
        return;
      }
      settings.setAiThinking(want === "on");
      eng.tag(
        "PASS",
        want === "on"
          ? "reasoning ON - gemma4:e4b will emit a thinking trace before each answer (slower)"
          : "reasoning OFF - answers only"
      );
      return;
    }

    /* ------------------------------- use --------------------------------- */
    if (sub === "use") {
      const tag = p.args[1];
      if (!tag) {
        eng.tag("ERROR", "usage: model use <tag>   (model list shows installed tags)");
        return;
      }
      const st = await checkOllama(OLLAMA_ENDPOINT);
      if (st.online && st.models.length && !st.models.includes(tag)) {
        eng.tag("WARN", `"${tag}" is not installed. Installed: ${st.models.join(", ") || "(none)"}`);
        eng.tag("DIM", `pull it first:  ollama pull ${tag}`);
        return;
      }
      settings.setPreferredModel(tag);
      invalidateModelCache();
      resetAiHistory();
      useLive.getState().setAiModel(tag);
      eng.tag("PASS", `pinned model -> ${tag} (persists across restarts; "model auto" to unpin)`);
      return;
    }

    if (sub === "auto") {
      settings.setPreferredModel(null);
      invalidateModelCache();
      const pick = await pickModel(OLLAMA_ENDPOINT);
      useLive.getState().setAiModel(pick.model);
      eng.tag("PASS", `auto-detect restored -> ${pick.model ?? "(none installed)"} · ${pick.reason}`);
      return;
    }

    /* ------------------------------- warm -------------------------------- */
    if (sub === "warm") {
      await warmUp(eng);
      return;
    }

    /* ------------------------------- info -------------------------------- */
    if (sub === "info") {
      const tag = p.args[1] ?? useLive.getState().aiModel ?? settings.preferredModel ?? PREFERRED_MODEL;
      await describeModel(eng, tag);
      return;
    }

    /* --------------------------- list / status --------------------------- */
    const st = await checkOllama(OLLAMA_ENDPOINT);
    useLive.getState().setOllama(st.online, st.models);
    if (!st.online) {
      eng.tag("WARN", "OLLAMA OFFLINE - start Ollama, then re-run. Everything else works offline.");
      eng.tag("DIM", `this workstation is tuned for ${PREFERRED_MODEL}:  ollama pull ${PREFERRED_MODEL}`);
      return;
    }

    const pick = await pickModel(OLLAMA_ENDPOINT);
    const pinned = settings.preferredModel;
    const active = pinned ?? pick.model;
    useLive.getState().setAiModel(active);

    eng.raw(`\r\n  ${ANSI.dim(pad("ENDPOINT", 14))}${OLLAMA_ENDPOINT}\r\n`);
    eng.raw(`  ${ANSI.dim(pad("ACTIVE", 14))}${ANSI.bold(ANSI.color(207, active ?? "(none)"))}${pinned ? ANSI.dim("  [pinned]") : ANSI.dim(`  [auto · ${pick.reason}]`)}\r\n`);
    eng.raw(`  ${ANSI.dim(pad("REASONING", 14))}${settings.aiThinking ? "ON" : "OFF"}\r\n`);
    eng.raw(`  ${ANSI.dim(pad("TUNED FOR", 14))}${PREFERRED_MODEL}${pick.preferred ? ANSI.color(82, "  ← installed and selected") : ""}\r\n`);

    eng.raw(`\r\n  ${ANSI.color(245, "INSTALLED MODELS")}\r\n`);
    for (const m of st.models) {
      const marker = m === active ? ANSI.color(82, " ← active") : m === PREFERRED_MODEL ? ANSI.color(214, " ← recommended") : "";
      eng.raw(`    ${ANSI.color(207, m)}${marker}\r\n`);
    }
    if (!st.models.includes(PREFERRED_MODEL))
      eng.tag("DIM", `recommended model missing:  ollama pull ${PREFERRED_MODEL}`);
    eng.raw(
      `\r\n${ANSI.dim("  model info · model warm · model use <tag> · model think on|off")}\r\n\r\n`
    );
  },
};
