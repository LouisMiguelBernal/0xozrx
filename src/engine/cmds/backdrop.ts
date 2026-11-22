import { pad, type CommandDefLike } from "../cmdtypes";
import { ANSI } from "../output";
import { BACKDROPS, useSettings, type BackdropKind } from "../../store/settings";

export const backdropCmd: CommandDefLike = {
  name: "backdrop",
  usage: "backdrop [arch|grid|void|list]",
  summary: "built-in background (no image file needed)",
  group: "appearance",
  run(eng, p) {
    const cur = useSettings.getState().backdrop;
    const arg = (p.args[0] ?? "list").toLowerCase();

    if (arg === "list" || arg === "status") {
      eng.raw("\r\n");
      for (const [k, desc] of Object.entries(BACKDROPS)) {
        const mark = k === cur ? ANSI.color(82, " ← active") : "";
        eng.raw(`  ${ANSI.color(39, pad(k, 10))}${ANSI.dim(desc)}${mark}\r\n`);
      }
      eng.raw(`\r\n${ANSI.dim("  a custom image still overrides this: wallpaper pick")}\r\n\r\n`);
      return;
    }

    if (!(arg in BACKDROPS)) {
      eng.tag("ERROR", `unknown backdrop "${arg}" - one of: ${Object.keys(BACKDROPS).join(" | ")}`);
      return;
    }
    useSettings.getState().setBackdrop(arg as BackdropKind);
    const wp = useSettings.getState().wallpaper;
    eng.tag("PASS", `backdrop -> ${arg}`);
    if (wp.enabled && wp.path)
      eng.tag("DIM", "a custom wallpaper is active and covers it - `wallpaper off` to see the backdrop.");
  },
};
