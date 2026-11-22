import { describe, expect, it } from "vitest";
import { ARCH_PEAK, ARCH_PEAK_WIDTH } from "./archArt";

describe("arch peak art", () => {
  it("never exceeds the advertised width", () => {
    // fetch.ts pads the info column to ARCH_PEAK_WIDTH; an over-long row would
    // shove that column right and break the two-column layout.
    for (const row of ARCH_PEAK) expect(row.length).toBeLessThanOrEqual(ARCH_PEAK_WIDTH);
    expect(Math.max(...ARCH_PEAK.map((r) => r.length))).toBe(ARCH_PEAK_WIDTH);
  });

  it("widens monotonically down the peak", () => {
    const peak = ARCH_PEAK.slice(0, -1); // last row is the split base
    for (let i = 1; i < peak.length; i++) {
      expect(peak[i].trimEnd().length).toBeGreaterThan(peak[i - 1].trimEnd().length);
    }
  });

  it("stays centred - left and right margins match within a column", () => {
    const peak = ARCH_PEAK.slice(0, -1);
    for (const row of peak) {
      const left = row.length - row.trimStart().length;
      const right = ARCH_PEAK_WIDTH - row.trimEnd().length;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    }
  });

  it("contains no tabs or newlines that would corrupt terminal output", () => {
    for (const row of ARCH_PEAK) expect(row).not.toMatch(/[\t\r\n]/);
  });
});
