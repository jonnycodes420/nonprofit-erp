// branding.js — org accent-color normalization + WCAG contrast (BUILD-13 Part 2).
//
// Tasteful white-label: an org picks ONE accent color that layers over the
// BUILD-12 palette on "accent moments" (primary buttons, active states, the
// receipt/email header band, the onboarding greeting). A user-chosen color can
// destroy contrast, so the accent is CONSTRAINED to an accessible range on
// save — never rendered illegibly.
//
// Guarantee after normalizeAccent():
//   • white text on the accent meets WCAG AA (contrast >= 4.5), OR ink does —
//     whichever wins is returned as `fg`, so text-on-accent is always legible;
//   • the accent on cream (#f0ede6) meets >= 3.0 (a visible UI accent / border,
//     not washed out) — the accent-on-cream direction.
// A too-light color is darkened along its own hue until both hold (hue kept,
// so it still reads as "their color"); `adjusted` flags that we moved it.
// Shared by server.js (write route) and tests/branding.test.js (contrast).

const CREAM = "#f0ede6";
const WHITE = "#ffffff";
const INK = "#0f1a12";

function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
function relLum([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const [R, G, B] = [f(r), f(g), f(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
// WCAG contrast ratio between two hex colors (1..21).
function contrast(a, b) {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  if (!ra || !rb) return 0;
  const la = relLum(ra), lb = relLum(rb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// The two invariants a legible accent must satisfy.
function accentPasses(hex) {
  const whiteOK = contrast(WHITE, hex) >= 4.5;
  const inkOK = contrast(INK, hex) >= 4.5;
  const onCream = contrast(hex, CREAM) >= 3.0;
  return (whiteOK || inkOK) && onCream;
}

// Validate + constrain an accent. Returns null on a malformed hex (caller 400s),
// otherwise { accent, fg, adjusted }.
function normalizeAccent(input) {
  let rgb = hexToRgb(input);
  if (!rgb) return null;
  const original = rgbToHex(rgb);
  let adjusted = false;
  // Darken toward the accessible range (preserves hue). Black passes both
  // invariants, so this loop always terminates on a passing color.
  for (let i = 0; i < 40 && !accentPasses(rgbToHex(rgb)); i++) {
    rgb = rgb.map(v => v * 0.9);
    adjusted = true;
  }
  const accent = rgbToHex(rgb);
  const fg = contrast(WHITE, accent) >= 4.5 ? WHITE : INK;
  return { accent, fg, adjusted: adjusted || accent !== original };
}

// ── BUILD-48 — background TINT normalization ────────────────────────────────
// A theme background is the opposite problem from an accent: text sits ON it,
// so it must stay LIGHT. The weakest text the portal/dashboard ever places on
// the page background is the muted grey (#6b6b64); requiring AA for it (and a
// comfortable margin for ink) keeps every text color legible. A too-dark tint
// is LIGHTENED toward white along its own hue (blend keeps the color family),
// mirroring normalizeAccent's deepen-and-tell pattern.
const MUTED_TEXT = "#6b6b64";

function tintPasses(hex) {
  return contrast(MUTED_TEXT, hex) >= 4.5 && contrast(INK, hex) >= 7.0;
}

// Validate + constrain a background tint. Returns null on malformed hex
// (caller 400s), otherwise { tint, adjusted }.
function normalizeTint(input) {
  let rgb = hexToRgb(input);
  if (!rgb) return null;
  const original = rgbToHex(rgb);
  let adjusted = false;
  // Lighten toward white — white passes both invariants, so this terminates.
  for (let i = 0; i < 120 && !tintPasses(rgbToHex(rgb)); i++) {
    rgb = rgb.map(v => v + (255 - v) * 0.07);
    adjusted = true;
  }
  const tint = rgbToHex(rgb);
  return { tint, adjusted: adjusted || tint !== original };
}

module.exports = { CREAM, WHITE, INK, MUTED_TEXT, hexToRgb, rgbToHex, contrast, accentPasses, normalizeAccent, tintPasses, normalizeTint };
