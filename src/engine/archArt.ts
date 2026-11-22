/**
 * Arch-Linux-flavoured peak, generated so every row is guaranteed aligned
 * (same trick as banner.ts - no hand-counted spaces to drift).
 */
function buildPeak(): string[] {
  const ROWS = 11;
  const W = 2 * ROWS + 2;
  const rows: string[] = [];

  for (let r = 0; r < ROWS; r++) {
    const inner = 2 * r;
    let body: string;
    if (r >= 4) {
      // hollow below the cap so the silhouette reads as a summit, not a wedge
      const wall = 3;
      const gap = inner - 2 * wall;
      body = gap > 0 ? "█".repeat(wall) + " ".repeat(gap) + "█".repeat(wall) : "█".repeat(inner);
    } else {
      body = "█".repeat(inner);
    }
    const line = `▟${body}▙`;
    rows.push(" ".repeat(Math.max(0, Math.round((W - line.length) / 2))) + line);
  }

  // split base = the two feet of the Arch mark
  const foot = Math.floor(W / 2) - 3;
  rows.push("▀".repeat(foot) + "      " + "▀".repeat(W - foot - 6));
  return rows;
}

export const ARCH_PEAK: string[] = buildPeak();

/** Width of the widest art row - callers pad the info column to this. */
export const ARCH_PEAK_WIDTH: number = Math.max(...ARCH_PEAK.map((r) => r.length));
