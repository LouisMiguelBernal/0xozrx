/** 5x5 block glyphs, uniform width -> always aligned. */
const G: Record<string, string[]> = {
  "0": ["█████", "█   █", "█   █", "█   █", "█████"],
  X: ["█   █", " █ █ ", "  █  ", " █ █ ", "█   █"],
  O: ["█████", "█   █", "█   █", "█   █", "█████"],
  Z: ["█████", "   █ ", "  █  ", " █   ", "█████"],
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
  "!": ["  █  ", "  █  ", "  █  ", "     ", "  █  "],
};

export const BANNER_ART: string[] = (() => {
  const word = "0XOZRX!!".split("").map((ch) => G[ch] ?? G["!"]);
  return [0, 1, 2, 3, 4].map((i) => word.map((glyph) => glyph[i]).join(" "));
})();

export const TAGLINE = "LOCAL-FIRST WINDOWS SECURITY WORKSTATION";
