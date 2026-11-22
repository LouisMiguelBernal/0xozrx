import { describe, expect, it } from "vitest";
import { tagLine } from "./output";

describe("tagLine", () => {
  it("prefixes timestamp and channel tag", () => {
    const line = tagLine("PASS", "Windows Firewall enabled", true);
    expect(line).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    expect(line).toContain("[PASS]");
    expect(line).toContain("Windows Firewall enabled");
  });

  it("omits timestamp when asked", () => {
    const line = tagLine("WARN", "4 startup applications require review", false);
    expect(line.startsWith("[")).toBe(false);
    expect(line).toContain("[WARN]");
  });

  it("uses ANSI color codes for tags", () => {
    const line = tagLine("ERROR", "x", false);
    expect(line).toContain("\x1b[");
  });
});
