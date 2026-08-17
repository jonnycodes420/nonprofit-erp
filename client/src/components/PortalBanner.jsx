// BUILD-59 — THE one banner-image renderer, shared by Portal.jsx and
// GivingDashboard.jsx so "the preview equals the render" and both white-label
// surfaces behave identically. It settles every image-handling decision the
// build brief lists, in one place:
//
//   • FOCAL POINT — object-position from a normalized {x,y} (default center),
//     so the subject (the installation photo's students sit right-of-center)
//     survives an object-fit:cover crop into a banner it doesn't share a ratio
//     with. This is the fix for "out of crop".
//   • NO LAYOUT SHIFT — the container carries an explicit aspect-ratio, so the
//     space is reserved before the image loads. CLS 0 by construction.
//   • COLOR BAND WHILE LOADING — the container background is the org's own
//     color, so a slow hero shows a solid brand band, never a spinner, a grey
//     box, or generated art (standing rule).
//   • RESPONSIVE DELIVERY — srcset over the /portal-assets/:id?w= width ladder
//     (server resizes via sharp, never upscales), sizes=100vw for a full-bleed
//     banner. A phone gets ~400–800px, not the 2400px master.
//   • LAZY/PRELOAD — the hero is eager + fetchpriority=high; anything below the
//     fold is loading=lazy.
//   • SCRIM — a gradient behind the text only (never a flat wash over the
//     photo), strong enough that overlaid text clears WCAG AA against the
//     actual pixels even on the lightest image (the church). Tuned + pinned by
//     tests/portal-contrast.test.js.
//
// The SAME shape is used by the editor crop preview (PortalBannerPreview
// below), which is why preview == render is provable.
import { resolveAssetUrl } from "../lib/assetUrl";
import { BANNER_SCRIM } from "../lib/portalScrim";

// The width ladder the server's /portal-assets/:id?w= route resizes to. Kept
// in lock-step with PORTAL_ASSET_WIDTHS in server.js.
export const BANNER_WIDTHS = [400, 800, 1280, 1920, 2560];

// The header banner ratio, fixed so the crop is identical at every breakpoint
// (object-fit:cover crops by RATIO, not pixel size) — which is exactly what
// makes "preview equals render" provable: the editor preview and the live
// banner share this ratio, so they show the same crop.
export const PORTAL_HEADER_RATIO = "1200 / 300";

// Only content-addressed portal assets get a srcset (a data-URI or external
// URL can't be resized by our route). Returns "" to skip srcset cleanly.
export function bannerSrcSet(url) {
  if (typeof url !== "string" || !url.includes("/portal-assets/")) return "";
  const base = resolveAssetUrl(url);
  const join = base.includes("?") ? "&" : "?";
  return BANNER_WIDTHS.map(w => `${base}${join}w=${w} ${w}w`).join(", ");
}

// object-position string from a normalized focal point (0..1 → 0..100%).
export function focalPosition(focal) {
  const x = Math.min(1, Math.max(0, Number(focal?.x ?? 0.5) || 0.5));
  const y = Math.min(1, Math.max(0, Number(focal?.y ?? 0.5) || 0.5));
  return `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`;
}

// The scrim gradient lives in lib/portalScrim.js (pure, shared with the Node
// contrast test so the render and the AA proof use the same numbers).
export { BANNER_SCRIM };

// The IMG element every banner render + the editor preview share. Split out so
// the preview can wrap the identical element (preview == render, by reuse).
export function bannerImgStyle(focal) {
  return { width: "100%", height: "100%", objectFit: "cover", objectPosition: focalPosition(focal), display: "block" };
}

// PortalBanner — the full banner: color band + responsive img + scrim + the
// overlaid children (the identity plaque). `ratio` is a CSS aspect-ratio
// string; `bandColor` is the org primary (the loading band); `priority` marks
// the hero (eager + high fetch priority) vs below-fold (lazy).
export default function PortalBanner({ url, focal, bandColor, ratio = "1200 / 320", priority = false, scrim = true, alt = "", children, radius = 0 }) {
  const src = resolveAssetUrl(url);
  const srcSet = bannerSrcSet(url);
  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: ratio, background: bandColor || "var(--pt-primary, #1a6b4a)", overflow: "hidden", borderRadius: radius }}>
      {url && (
        <img
          src={src}
          {...(srcSet ? { srcSet, sizes: "100vw" } : {})}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchpriority={priority ? "high" : "auto"}
          style={bannerImgStyle(focal)}
        />
      )}
      {scrim && children != null && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: BANNER_SCRIM, pointerEvents: "none" }} />
      )}
      {children != null && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>{children}</div>
      )}
    </div>
  );
}

// PortalBannerPreview — the editor CROP UI, which is the render (same img
// style, same ratio, same scrim) so "preview equals render" holds by reuse:
// the ONLY addition is a focal dot + click-to-set. One control, no crop
// handles, no zoom (per the brief). Clicking anywhere sets the normalized
// focal point to that spot; the crop re-centers on it immediately.
export function PortalBannerPreview({ url, focal, onFocalChange, bandColor, ratio = "1200 / 300", radius = 10 }) {
  const fx = Math.min(1, Math.max(0, Number(focal?.x ?? 0.5) || 0.5));
  const fy = Math.min(1, Math.max(0, Number(focal?.y ?? 0.5) || 0.5));
  function setFromEvent(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    onFocalChange && onFocalChange(+x.toFixed(4), +y.toFixed(4));
  }
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Set the focal point — click the most important part of the image"
        onClick={setFromEvent}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFocalChange && onFocalChange(fx, fy); } }}
        style={{ position: "relative", width: "100%", aspectRatio: ratio, background: bandColor || "var(--pt-primary, #1a6b4a)", overflow: "hidden", borderRadius: radius, cursor: "crosshair" }}
      >
        {url && <img src={resolveAssetUrl(url)} alt="" style={bannerImgStyle({ x: fx, y: fy })} draggable={false} />}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: BANNER_SCRIM, pointerEvents: "none" }} />
        {/* the focal dot — where the crop centers on */}
        <div aria-hidden="true" style={{ position: "absolute", left: `${fx * 100}%`, top: `${fy * 100}%`, width: 18, height: 18, marginLeft: -9, marginTop: -9, borderRadius: "50%", border: "2px solid #fff", boxShadow: "0 0 0 2px rgba(0,0,0,0.45)", pointerEvents: "none" }} />
      </div>
      <div style={{ fontSize: 11, color: "#6b6b64", marginTop: 4, lineHeight: 1.4 }}>
        Click the most important part of the image — the banner keeps it in view as it crops.
      </div>
    </div>
  );
}
