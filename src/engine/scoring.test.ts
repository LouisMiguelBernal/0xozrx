import { describe, expect, it } from "vitest";
import { computeScore } from "./scoring";
import type { Finding } from "../types/system";

const f = (severity: Finding["severity"], category: Finding["category"]): Finding => ({
  id: `T-${Math.random().toString(36).slice(2, 7)}`,
  title: "t",
  severity,
  confidence: "HIGH",
  category,
  evidence: "e",
});

describe("computeScore", () => {
  it("perfect score with no findings", () => {
    expect(computeScore([]).total).toBe(100);
  });

  it("deducts by severity", () => {
    expect(computeScore([f("MEDIUM", "FIREWALL")]).total).toBe(94);
    expect(computeScore([f("HIGH", "DEFENDER")]).total).toBe(88);
  });

  it("caps per-category loss", () => {
    // FIREWALL cap is 15; five HIGH findings would be 60 raw -> capped to 15.
    const s = computeScore(Array.from({ length: 5 }, () => f("HIGH", "FIREWALL")));
    expect(s.total).toBe(85);
    expect(s.breakdown.find((b) => b.category === "FIREWALL")?.lost).toBe(15);
  });

  it("never goes below zero and floors at zero when everything is broken", () => {
    const many: Finding[] = [];
    const cats = [
      "DEFENDER", "FIREWALL", "UPDATES", "ACCOUNTS", "STARTUP",
      "SERVICES", "NETWORK", "DISKCRYPT", "PRIVACY", "HEALTH", "APPS",
    ] as const;
    for (const c of cats) for (let i = 0; i < 4; i++) many.push(f("CRITICAL", c));
    expect(computeScore(many).total).toBe(0);
  });

  it("INFO findings cost nothing but are counted", () => {
    const s = computeScore([f("INFO", "EXPOSURE"), f("INFO", "HEALTH")]);
    expect(s.total).toBe(100);
    expect(s.counts.INFO).toBe(2);
  });
});
