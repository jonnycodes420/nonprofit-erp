// BUILD-61 — non-destructive crop math (JSX-free, Node-testable). Shared by the
// banner render (PortalBanner.bannerImgStyle) and the crop editor
// (PortalBannerCrop) so "preview equals render" holds by reuse. A crop is a
// normalized rect {x,y,w,h} (fractions of the ORIGINAL image), authored so it
// matches the slot's aspect ratio — the render shows exactly that sub-rectangle
// scaled to fill the slot. Nothing is ever re-encoded.

// "1200 / 300" → 4 (slot aspect = width/height).
export function ratioValue(ratio) {
  const p = String(ratio).split("/").map(s => parseFloat(s.trim()));
  return (p.length === 2 && p[1] > 0) ? p[0] / p[1] : 4;
}

// The largest slot-aspect rect that fits the image (the "cover" crop), shrunk by
// `zoom` (>=1) and centered on {cx,cy}. natAR = naturalW/naturalH. Guarantees
// (w·naturalW)/(h·naturalH) === slotAR, so the render fills the slot exactly.
export function cropFor(zoom, center, natAR, slotAR) {
  let baseW, baseH;
  if (natAR >= slotAR) { baseH = 1; baseW = slotAR / natAR; }
  else { baseW = 1; baseH = natAR / slotAR; }
  const z = Math.max(1, Number(zoom) || 1);
  const w = baseW / z, h = baseH / z;
  const cx = Number(center?.cx ?? 0.5), cy = Number(center?.cy ?? 0.5);
  const x = Math.min(1 - w, Math.max(0, cx - w / 2));
  const y = Math.min(1 - h, Math.max(0, cy - h / 2));
  return { x, y, w, h };
}

// Recover the {zoom, center} that produced a stored crop, given the image — so
// re-opening the editor lands on the saved crop.
export function zoomCenterFromCrop(crop, natAR, slotAR) {
  const baseW = natAR >= slotAR ? slotAR / natAR : 1;
  const zoom = crop && crop.w > 0 ? Math.max(1, baseW / crop.w) : 1;
  const center = crop ? { cx: crop.x + crop.w / 2, cy: crop.y + crop.h / 2 } : { cx: 0.5, cy: 0.5 };
  return { zoom, center };
}

// The <img> style that renders a crop: scale the full image so the crop's width
// fills the slot, then translate the crop's top-left to the slot's origin.
// height:auto preserves aspect (no distortion); transform % is of the img's OWN
// box, so no natural-size measurement is needed at render time.
export function cropImgStyle(crop) {
  const w = Math.max(0.02, Math.min(1, crop.w));
  const x = Math.min(1 - w, Math.max(0, crop.x));
  const y = Math.max(0, Math.min(1, crop.y));
  return {
    position: "absolute", top: 0, left: 0,
    width: `${(100 / w).toFixed(4)}%`, height: "auto", maxWidth: "none",
    transform: `translate(${(-x * 100).toFixed(4)}%, ${(-y * 100).toFixed(4)}%)`,
    display: "block",
  };
}
