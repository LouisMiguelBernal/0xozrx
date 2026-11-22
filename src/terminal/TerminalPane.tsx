import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { engine, commandNames } from "../engine/console";
import { ANSI } from "../engine/output";
import { ALIASES, bindEngineForCommands } from "../engine/commands";
import { ACCENTS, applyAccent, useSettings } from "../store/settings";
import { runBootSequence } from "./boot";

const MAX_LINE = 4096;

function fgHex(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

export default function TerminalPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const accentHex = () => ACCENTS[useSettings.getState().accent] ?? ACCENTS.arch;
    const rgba = (hex: string, a: number) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.14,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 5000,
      allowTransparency: true,
      convertEol: false,
      theme: {
        background: "rgba(0,0,0,0)",
        foreground: "#e4efe8",
        cursor: accentHex(),
        cursorAccent: "#050605",
        selectionBackground: rgba(accentHex(), 0.24),
        // Arch-flavoured 16-colour palette: blue-leaning, severity colours intact
        black: "#0a0d0b",
        red: "#ff3d8b",
        green: "#34e3a8",
        yellow: "#ffb547",
        blue: "#1793d1",
        magenta: "#ff3d8b",
        cyan: "#22d3ee",
        white: "#e4efe8",
        brightBlack: "#56665c",
        brightRed: "#ff7aae",
        brightGreen: "#7ff0c8",
        brightYellow: "#ffd08a",
        brightBlue: "#5ab9ea",
        brightMagenta: "#ff7aae",
        brightCyan: "#8af2ff",
        brightWhite: "#f2fbf6",
      },
    });
    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    // xterm lives in a zero-padding wrapper so column math is exact
    const pad = document.createElement("div");
    pad.className = "term-pad";
    host.appendChild(pad);
    term.open(pad);

    const safeFit = () => {
      try {
        fit.fit();
      } catch {
        /* transient zero-size container */
      }
    };
    safeFit();

    // Refit once the real monospace font finishes loading (col-width drift fix)
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!disposed) safeFit();
      });
      document.fonts.addEventListener?.("loadingdone", () => safeFit());
    }
    // Warm-up refits while flex layout settles on first paint
    for (const ms of [30, 120, 300, 700]) {
      timers.push(setTimeout(safeFit, ms));
    }

    /* ---------------- input state ---------------- */
    let lineBuf = "";
    let busy = false;
    let histIdx = engine.history.length;

    function writePrompt(): void {
      if (engine.mode === "ai") {
        term.write(`${fgHex(ACCENTS.magenta)}ai${ANSI.reset}${ANSI.color(240, ">")} `);
      } else {
        term.write(`${fgHex(accentHex())}sentinel${ANSI.reset}${ANSI.color(240, ">")} `);
      }
      term.scrollToBottom();
    }

    const insert = (s: string): void => {
      if (lineBuf.length + s.length > MAX_LINE) return;
      lineBuf += s;
      term.write(s);
    };

    const redrawInput = (): void => {
      term.write(`\r\x1b[2K`);
      writePrompt();
      if (lineBuf) term.write(lineBuf);
    };

    const completeTab = (): void => {
      if (engine.mode === "ai") return;
      const parts = lineBuf.split(/\s+/);
      const frag = parts[parts.length - 1]?.toLowerCase() ?? "";
      if (!frag || parts.length > 1) return;
      const pool = [...commandNames(), ...Object.keys(ALIASES)].sort();
      const hits = pool.filter((c) => c.startsWith(frag));
      if (hits.length === 1) {
        insert(hits[0].slice(frag.length) + " ");
      } else if (hits.length > 1) {
        term.write("\r\n" + ANSI.dim(hits.join("   ")) + "\r\n");
        redrawInput();
      }
    };

    const submit = async (): Promise<void> => {
      term.write("\r\n");
      const line = lineBuf.trim();
      lineBuf = "";
      busy = true;
      try {
        if (line) {
          engine.pushHistory(line);
          histIdx = engine.history.length;
          await engine.run(engine.parse(line));
        }
      } catch (e) {
        engine.tag("ERROR", String(e));
      } finally {
        busy = false;
        if (!disposed) writePrompt();
      }
    };

    term.onData((data) => {
      if (disposed || busy) return;

      // Pasted chunks are inserted literally - never auto-executed.
      if (data.includes("\n")) {
        insert(data.replace(/[\r\n\t]+/g, " ").replace(/\x1b/g, "").slice(0, 2000));
        return;
      }
      switch (data) {
        case "\r":
          void submit();
          break;
        case "\x7f":
          if (lineBuf.length) {
            lineBuf = lineBuf.slice(0, -1);
            term.write("\b \b");
          }
          break;
        case "\t":
          completeTab();
          break;
        case "\x03": // Ctrl+C - also leaves ai mode
          if (engine.mode === "ai") engine.setMode("sentinel");
          term.write("^C\r\n");
          lineBuf = "";
          writePrompt();
          break;
        case "\x1b[A":
          if (histIdx > 0 && engine.mode !== "ai") {
            histIdx--;
            lineBuf = engine.history[histIdx] ?? "";
            redrawInput();
          }
          break;
        case "\x1b[B":
          if (histIdx < engine.history.length && engine.mode !== "ai") {
            histIdx++;
            lineBuf = engine.history[histIdx] ?? "";
            redrawInput();
          }
          break;
        default:
          if (data >= " " && !data.startsWith("\x1b")) insert(data);
      }
    });

    const ro = new ResizeObserver(() => safeFit());
    ro.observe(host);

    engine.attach({
      write: (s) => {
        term.write(s);
        term.scrollToBottom();
      },
      clear: () => {
        term.clear();
        term.write("\x1b[2J\x1b[H");
      },
      cols: () => term.cols,
    });
    bindEngineForCommands(engine);

    applyAccent(useSettings.getState().accent);
    // Accent switches repaint the terminal too, not just the CSS chrome.
    const unsubAccent = useSettings.subscribe((st, prev) => {
      if (st.accent === prev.accent) return;
      const hex = ACCENTS[st.accent] ?? ACCENTS.arch;
      term.options.theme = { ...term.options.theme, cursor: hex, selectionBackground: rgba(hex, 0.24) };
    });

    void runBootSequence().finally(() => {
      if (!disposed) writePrompt();
    });

    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
      unsubAccent();
      ro.disconnect();
      engine.detach();
      termRef.current = null;
      term.dispose();
    };
  }, []);

  return (
    <div className="panel" style={{ height: "100%", flex: 1, minWidth: 0 }} data-panel="terminal">
      <div className="panel-header">
        <span style={{ color: "var(--accent)" }}>▮</span>
        <span>TERMINAL</span>
        <span style={{ marginLeft: "auto", color: "var(--color-mute)", textTransform: "none" }}>
          sentinel shell · ctrl+k palette
        </span>
      </div>
      <div className="panel-body" style={{ position: "relative" }}>
        <div ref={hostRef} className="term-host" onClick={() => termRef.current?.focus()} />
      </div>
    </div>
  );
}
