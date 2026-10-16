// FIX-41 · A PICTURE, DRAWN THE ONE WAY. A fixed aspect-ratio box with the
// image covering it from its focal point, so a tall or wide photo never moves
// the page around it. No colours of its own: it is used on the org's public
// pages (white-label) as well as Steward's screens.
//
// A picture is { url, alt, fx, fy } (pictures.js); a bare URL string still
// reads, as a picture with no words and a centred focus.
import { resolveAssetUrl } from "../lib/assetUrl";

export function readPicture(v) {
  if (!v) return null;
  if (typeof v === "string") return v.trim() ? { url: v.trim(), alt: "", fx: 0.5, fy: 0.5 } : null;
  if (typeof v !== "object") return null;
  const url = String(v.url || v.src || "").trim();
  if (!url) return null;
  const n = x => (Number.isFinite(Number(x)) ? Math.min(1, Math.max(0, Number(x))) : 0.5);
  return { url, alt: String(v.alt || ""), fx: n(v.fx ?? 0.5), fy: n(v.fy ?? 0.5) };
}

export const focusOf = p => `${Math.round((p ? p.fx : 0.5) * 100)}% ${Math.round((p ? p.fy : 0.5) * 100)}%`;

// The src a picture renders from: a stored asset through the asset origin (at a
// width), a data URI or an https address as it is.
export function pictureSrc(p, w) {
  if (!p) return "";
  const u = p.url;
  if (u.startsWith("data:") || /^https?:\/\//.test(u)) return u;
  return resolveAssetUrl(u) + (w ? `?w=${w}` : "");
}

export default function Picture({ value, alt, ratio = "16 / 9", radius = 12, width = 1280, style = null, testid = "picture", children = null }) {
  const p = readPicture(value);
  if (!p) return null;
  return (
    <div data-testid={testid} data-picture style={{ position: "relative", width: "100%", aspectRatio: ratio, overflow: "hidden", borderRadius: radius, ...(style || {}) }}>
      <img src={pictureSrc(p, width)} alt={p.alt || alt || ""} loading="lazy"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: focusOf(p), display: "block" }} />
      {children}
    </div>
  );
}
