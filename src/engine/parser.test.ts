import { describe, expect, it } from "vitest";
import { parseLine, tokenize } from "./parser";

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("scan --full")).toEqual(["scan", "--full"]);
  });

  it("respects double quotes", () => {
    expect(tokenize('echo "hello world"')).toEqual(["echo", "hello world"]);
  });

  it("respects single quotes", () => {
    expect(tokenize("shell 'Get-Process -Name x'")).toEqual(["shell", "Get-Process -Name x"]);
  });

  it("handles escaped quotes", () => {
    expect(tokenize('echo "say \\"hi\\""')).toEqual(["echo", 'say "hi"']);
  });
});

describe("parseLine", () => {
  it("returns null for blank input", () => {
    expect(parseLine("   ")).toBeNull();
    expect(parseLine("")).toBeNull();
  });

  it("parses command name case-insensitively", () => {
    expect(parseLine("SCAN --quick")?.name).toBe("scan");
    expect(parseLine("HELP")?.name).toBe("help");
  });

  it("collects long flags", () => {
    const p = parseLine("scan --full --json");
    expect(p?.flags.full).toBe(true);
    expect(p?.flags.json).toBe(true);
    expect(p?.args).toEqual([]);
  });

  it("parses flag values with =", () => {
    const p = parseLine("report --format=html");
    expect(p?.flags.format).toBe("html");
  });

  it("keeps positional args in order", () => {
    const p = parseLine('wallpaper path "C:\\my pics\\bg.png"');
    expect(p?.name).toBe("wallpaper");
    expect(p?.args).toEqual(["path", "C:\\my pics\\bg.png"]);
  });

  it("handles short flag clusters but keeps negative numbers as args", () => {
    const p = parseLine("theme -abc -5");
    expect(p?.flags).toEqual({ a: true, b: true, c: true });
    expect(p?.args).toEqual(["-5"]);
  });
});
