import type { ConsoleEngine } from "./console";
import type { ParsedCommand } from "./parser";

export type CommandGroup =
  | "core"
  | "system"
  | "security"
  | "network"
  | "ai"
  | "appearance";

export interface CommandDefLike {
  name: string;
  usage: string;
  summary: string;
  group: CommandGroup;
  run: (eng: ConsoleEngine, p: ParsedCommand) => void | Promise<void>;
}

/** Shared column helpers so every command table lines up the same way. */
export const pad = (s: string, n: number): string => s.padEnd(n);
export const rjust = (s: string, n: number): string => s.padStart(n);

/**
 * Resolve a flag value written either as `--name=value` or `--name value`.
 *
 * The tokenizer only understands the `=` form: `--age 60` parses as
 * `flags.age === true` with `60` landing in `args`. Rather than change
 * tokenizer semantics (bare boolean flags like `--quick` depend on them),
 * commands that document a space-separated value resolve it here - taking the
 * first positional argument that matches `shape` and is not already claimed.
 */
export function flagValue(
  flags: Record<string, boolean | string>,
  args: string[],
  name: string,
  shape: RegExp,
  claimed: string[] = []
): string | undefined {
  const v = flags[name];
  if (typeof v === "string") return v;
  if (v !== true) return undefined;
  return args.find((a) => shape.test(a) && !claimed.includes(a.toLowerCase()));
}
