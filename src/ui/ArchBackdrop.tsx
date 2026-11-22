import type { BackdropKind } from "../store/settings";

/**
 * Built-in backgrounds. Pure inline SVG/CSS - no image files, no network,
 * and every colour derives from `--accent` so the backdrop follows the theme.
 *
 * "arch" is the default: an Arch-Linux-flavoured ridge silhouette with a
 * mountain watermark, sitting under the panel grid.
 */
export default function ArchBackdrop({ kind }: { kind: BackdropKind }) {
  if (kind === "void") {
    return <div className="backdrop-base" aria-hidden />;
  }
  if (kind === "grid") {
    return (
      <div className="backdrop-base" aria-hidden>
        <div className="backdrop-glow" />
      </div>
    );
  }

  return (
    <div className="backdrop-base" aria-hidden>
      <div className="backdrop-glow" />

      {/* mountain watermark */}
      <svg
        className="backdrop-mark"
        viewBox="0 0 200 200"
        preserveAspectRatio="xMidYMid meet"
        role="presentation"
      >
        <defs>
          <linearGradient id="ozrx-arch-mark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {/* outer peak */}
        <path
          d="M100 14 L178 186 L150 186 L100 76 L50 186 L22 186 Z"
          fill="url(#ozrx-arch-mark)"
          stroke="var(--accent)"
          strokeOpacity="0.35"
          strokeWidth="0.8"
        />
        {/* inner notch, the detail that reads as a summit rather than a chevron */}
        <path
          d="M100 52 L126 110 L100 86 L74 110 Z"
          fill="var(--accent)"
          fillOpacity="0.18"
        />
        {/* foot flares */}
        <path
          d="M62 186 L100 122 L138 186 L124 186 L100 152 L76 186 Z"
          fill="var(--accent)"
          fillOpacity="0.1"
        />
      </svg>

      {/* horizon ridges */}
      <svg
        className="backdrop-ridge"
        viewBox="0 0 1200 220"
        preserveAspectRatio="none"
        role="presentation"
      >
        <path
          d="M0 200 L120 128 L200 172 L310 84 L420 168 L520 120 L640 190 L760 108 L880 176 L990 132 L1090 186 L1200 140 L1200 220 L0 220 Z"
          fill="var(--accent)"
          fillOpacity="0.05"
        />
        <path
          d="M0 214 L90 176 L190 206 L300 150 L400 200 L520 164 L620 210 L740 158 L860 204 L980 172 L1100 210 L1200 180 L1200 220 L0 220 Z"
          fill="var(--accent)"
          fillOpacity="0.08"
        />
      </svg>
    </div>
  );
}
