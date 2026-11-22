import { convertFileSrc } from "@tauri-apps/api/core";
import { useSettings } from "../store/settings";
import ArchBackdrop from "./ArchBackdrop";

export default function WallpaperLayer() {
  const wp = useSettings((s) => s.wallpaper);
  const backdrop = useSettings((s) => s.backdrop);

  // No custom image -> one of the built-in backdrops (Arch by default).
  if (!wp.enabled || !wp.path) {
    return <ArchBackdrop kind={backdrop} />;
  }

  const src = convertFileSrc(wp.path);
  const blur = Math.max(0, wp.blurPx);
  const dark = Math.min(Math.max(wp.darkness, 0), 95) / 100;

  return (
    <div className="fixed inset-0 overflow-hidden" aria-hidden style={{ zIndex: 0 }}>
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: wp.scale,
          objectPosition: "center",
          filter: blur ? `blur(${blur}px)` : undefined,
          transform: blur ? "scale(1.07)" : undefined,
        }}
      />
      {/* darkness overlay keeps every panel readable regardless of image */}
      <div style={{ position: "absolute", inset: 0, background: "#05080a", opacity: dark }} />
    </div>
  );
}
