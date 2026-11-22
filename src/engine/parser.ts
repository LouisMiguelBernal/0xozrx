/**
 * Command line tokenizer for the application-native shell.
 * Pure function — unit tested in src/engine/parser.test.ts
 *
 * Supports:
 *   - double quotes  "two words"
 *   - single quotes  'two words'
 *   - backslash escapes outside quotes  \" \'
 *   - long flags      --full        -> flags.full = true
 *   - flag values     --out=rep.xml -> flags.out = "rep.xml"
 */
export interface ParsedCommand {
  raw: string;
  name: string;
  args: string[]; // arguments after the command name (flags removed)
  flags: Record<string, boolean | string>;
}

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let hasCur = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"' && line[i + 1] === quote) {
        cur += '"';
        i++;
      } else if (c === "\\" && quote === "'" && line[i + 1] === "'") {
        cur += "'";
        i++;
      } else if (c === quote) {
        quote = null;
      } else {
        cur += c;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
      hasCur = true;
    } else if (c === "\\" && (line[i + 1] === '"' || line[i + 1] === "'")) {
      cur += line[++i];
      hasCur = true;
    } else if (c === " " || c === "\t") {
      if (hasCur) out.push(cur);
      cur = "";
      hasCur = false;
    } else {
      cur += c;
      hasCur = true;
    }
  }
  if (hasCur) out.push(cur);
  return out;
}

export function parseLine(rawLine: string): ParsedCommand | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;

  const name = tokens[0].toLowerCase();
  const args: string[] = [];
  const flags: Record<string, boolean | string> = {};

  for (const t of tokens.slice(1)) {
    if (t.startsWith("--")) {
      const body = t.slice(2);
      const eq = body.indexOf("=");
      if (eq > 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (body.length > 0) {
        flags[body.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())] = true;
      }
    } else if (t.startsWith("-") && t.length > 1 && !/^-\d/.test(t)) {
      // short flag cluster: -abc
      for (const ch of t.slice(1)) flags[ch] = true;
    } else {
      args.push(t);
    }
  }

  return { raw: trimmed, name, args, flags };
}
