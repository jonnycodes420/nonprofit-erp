// BUILD-59 — the banner scrim, defined ONCE as a pure model so both the render
// (PortalBanner.jsx) and the Node contrast test (tests/portal-contrast.test.js)
// use the same numbers. A scrim is a gradient behind the TEXT only — never a
// flat wash over the whole photo — sized so overlaid text clears WCAG AA
// against the actual pixels even on the lightest image (the church).

// Gradient stops: [yFraction (0=top,1=bottom), black alpha]. Anchored to the
// bottom, where the identity plaque sits. The 0.72 bottom is what carries AA
// over the pale church sky (proven by the contrast test).
export const SCRIM_STOPS = [[0.36, 0], [0.66, 0.42], [1.0, 0.72]];

export const BANNER_SCRIM = `linear-gradient(${SCRIM_STOPS.map(([y, a]) => `rgba(0,0,0,${a}) ${(y * 100).toFixed(0)}%`).join(", ")})`;

// The scrim's black alpha at a vertical fraction y (0 top … 1 bottom),
// piecewise-linear between stops.
export function scrimAlphaAt(y) {
  const yy = Math.min(1, Math.max(0, y));
  for (let i = 1; i < SCRIM_STOPS.length; i++) {
    const [y0, a0] = SCRIM_STOPS[i - 1], [y1, a1] = SCRIM_STOPS[i];
    if (yy <= y1) {
      if (yy <= y0) return a0;
      const t = (yy - y0) / (y1 - y0);
      return a0 + t * (a1 - a0);
    }
  }
  return SCRIM_STOPS[SCRIM_STOPS.length - 1][1];
}

// ── WCAG relative luminance + contrast (sRGB 0..255) ────────────────────────
function chan(c) { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
export function relLuminance(r, g, b) { return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b); }
export function contrastRatio(rgbA, rgbB) {
  const la = relLuminance(...rgbA), lb = relLuminance(...rgbB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Composite black at `alpha` over a background pixel (source-over, per channel).
export function compositeBlackOver(rgb, alpha) {
  return rgb.map(c => Math.round(c * (1 - alpha)));
}

// The contrast a text color gets over an image pixel once the scrim (at that
// pixel's vertical fraction) is composited under it.
export function textContrastOverPixel(pixelRgb, yFraction, textRgb = [255, 255, 255]) {
  const scrimmed = compositeBlackOver(pixelRgb, scrimAlphaAt(yFraction));
  return contrastRatio(scrimmed, textRgb);
}
