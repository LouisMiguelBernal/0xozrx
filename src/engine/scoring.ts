import type { Category, Finding, ScoreResult, Severity } from "../types/system";

/**
 * Transparent security scoring.
 * - Each severity has a fixed point cost.
 * - Each category has a maximum loss cap (weights sum to exactly 100),
 *   so a category can never dominate the score and the floor is 0.
 * Score = 100 - sum(min(pointsLostInCategory, cap)).
 */
export const SEVERITY_POINTS: Record<Severity, number> = {
  CRITICAL: 25,
  HIGH: 12,
  MEDIUM: 6,
  LOW: 2,
  INFO: 0,
};

export const CATEGORY_CAPS: Record<Category, number> = {
  DEFENDER: 15,
  FIREWALL: 15,
  UPDATES: 10,
  ACCOUNTS: 10,
  STARTUP: 8,
  SERVICES: 7,
  NETWORK: 10,
  DISKCRYPT: 15,
  PRIVACY: 5,
  HEALTH: 5,
  APPS: 5,
  EXPOSURE: 0, // exposure is reported, not scored
};

export function computeScore(findings: Finding[]): ScoreResult {
  const lostByCat = new Map<Category, number>();
  const counts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };

  for (const f of findings) {
    counts[f.severity]++;
    const pts = SEVERITY_POINTS[f.severity];
    if (pts > 0) lostByCat.set(f.category, (lostByCat.get(f.category) ?? 0) + pts);
  }

  const breakdown = (Object.keys(CATEGORY_CAPS) as Category[]).map((cat) => ({
    category: cat,
    lost: Math.min(lostByCat.get(cat) ?? 0, CATEGORY_CAPS[cat]),
    max: CATEGORY_CAPS[cat],
  }));

  const totalLost = breakdown.reduce((a, b) => a + b.lost, 0);
  return { total: Math.max(0, Math.min(100, 100 - totalLost)), breakdown, counts };
}

export function severityRank(s: Severity): number {
  return { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 }[s];
}
