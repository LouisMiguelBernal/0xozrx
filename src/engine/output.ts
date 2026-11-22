import { nowStamp } from "../lib/format";

/**
 * Tagged terminal output formatter.
 * Produces ANSI-styled lines like:
 *   [22:41:09] [PASS] Windows Firewall enabled
 */

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type Channel =
  | "SYSTEM"
  | "PASS"
  | "FAIL"
  | "WARN"
  | "INFO"
  | "SCAN"
  | "NETWORK"
  | "AI"
  | "OPSEC"
  | "ERROR"
  | "DIM";

interface Style {
  fg: number; // ansi 256/truecolor foreground
  sev?: Severity;
}

const STYLES: Record<Channel, Style> = {
  SYSTEM: { fg: 90 },
  PASS: { fg: 82, sev: "INFO" },
  FAIL: { fg: 196, sev: "HIGH" },
  WARN: { fg: 214, sev: "MEDIUM" },
  INFO: { fg: 245, sev: "INFO" },
  SCAN: { fg: 39, sev: "INFO" },
  NETWORK: { fg: 135, sev: "INFO" },
  AI: { fg: 207, sev: "INFO" },
  OPSEC: { fg: 44, sev: "INFO" },
  ERROR: { fg: 196, sev: "HIGH" },
  DIM: { fg: 240 },
};

export const ANSI = {
  reset: "\x1b[0m",
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  color: (n: number, s: string) => `\x1b[38;5;${n}m${s}\x1b[0m`,
  /** Truecolor from a #rrggbb string - lets branding follow the live accent. */
  hex: (h: string, s: string) => {
    const n = parseInt(h.replace("#", ""), 16);
    return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${s}\x1b[0m`;
  },
};

/** Build one styled output line (no trailing newline). */
export function tagLine(channel: Channel, message: string, withTime = true): string {
  const st = STYLES[channel] ?? STYLES.INFO;
  const ts = withTime ? `[${nowStamp()}] ` : "";
  return `${ANSI.dim(ts)}${ANSI.color(st.fg, `[${channel}]`)} ${message}`;
}

export function plainLine(message: string): string {
  return message;
}

export function severityColor(sev: Severity): string {
  switch (sev) {
    case "CRITICAL":
      return "#ff3d8b";
    case "HIGH":
      return "#ffb547";
    case "MEDIUM":
      return "#ffd24a";
    case "LOW":
      return "#58a6ff";
    default:
      return "#8aa39b";
  }
}
