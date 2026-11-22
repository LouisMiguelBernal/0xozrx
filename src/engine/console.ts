import { tagLine, Channel } from "./output";
import { dispatch, COMMANDS, type CommandDefLike } from "./commands";
import { ParsedCommand, parseLine } from "./parser";

export interface TermIO {
  /** Write raw ANSI string. */
  write(s: string): void;
  clear(): void;
  /** Current terminal width in columns (for adaptive formatting). */
  cols?(): number;
}

export type { CommandDefLike };

/**
 * Application-native command engine ("sentinel" shell).
 * Owns history + IO binding; the xterm view attaches to it.
 */
export class ConsoleEngine {
  readonly promptName = "sentinel";
  private _io: TermIO | null = null;
  private _history: string[] = [];
  booted = false;

  /** Prompt mode: normal sentinel shell or ai> assistant REPL. */
  mode: "sentinel" | "ai" = "sentinel";
  /** Installed by the AI command module; receives ai> lines. */
  aiHandler: ((line: string) => Promise<void>) | null = null;

  setMode(m: "sentinel" | "ai"): void {
    this.mode = m;
  }

  attach(io: TermIO): void {
    this._io = io;
  }
  detach(): void {
    this._io = null;
  }
  get io(): TermIO | null {
    return this._io;
  }

  get history(): readonly string[] {
    return this._history;
  }

  pushHistory(line: string): void {
    if (!line.trim()) return;
    if (this._history[this._history.length - 1] === line) return;
    this._history.push(line);
    if (this._history.length > 500) this._history.shift();
  }

  /** Tagged line writer; safe no-op when detached. */
  tag(channel: Channel, msg: string): void {
    this._io?.write(tagLine(channel, msg) + "\r\n");
  }

  raw(s: string): void {
    this._io?.write(s);
  }

  parse(line: string): ParsedCommand | null {
    return parseLine(line);
  }

  async run(parsed: ParsedCommand | null): Promise<void> {
    if (!parsed) return;
    try {
      await dispatch(this, parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.tag("ERROR", msg);
    }
  }
}

export function findCommand(name: string): CommandDefLike | undefined {
  return COMMANDS[name];
}

export function commandNames(): string[] {
  return Object.keys(COMMANDS).sort();
}

/** Process-wide singleton - one sentinel shell per app. */
export const engine = new ConsoleEngine();
