// shared/pageTheme.js · PAGES-1. HOW ONE DONOR-FACING PAGE LOOKS, said once.
//
// Giving, volunteer and membership pages share one theme: the org's brand
// colors by default, and on top of them, per page, an accent color, one of a
// few curated font pairings (never free text: the keys are portalTheme's), a
// button style, how round the corners are, and light or dark sections. It is
// stored on the page as `design.theme` (shared/givingPageDesign.js keeps it),
// drafted and published with the rest of the page.
//
// The contrast check lives here too, so the editor's warning and the test read
// the same arithmetic (WCAG 2.x relative luminance, AA = 4.5 for body text).
//
// Pure: no database, no network, no DOM. The server loads it with import().

export const FONT_KEYS = ["dm", "classic", "editorial", "literary", "modern"];
export const FONT_LABELS = {
  dm: "DM Serif & DM Sans",
  classic: "Georgia & Verdana",
  editorial: "Palatino & Gill Sans",
  literary: "Baskerville & Helvetica",
  modern: "Modern system sans",
};
export const BUTTON_STYLES = [
  { key: "filled", label: "Filled" },
  { key: "outline", label: "Outline" },
  { key: "pill", label: "Pill" },
];
export const CORNERS = [
  { key: "square", label: "Square", radius: 3 },
  { key: "soft", label: "Soft", radius: 12 },
  { key: "round", label: "Round", radius: 22 },
];
export const SECTIONS = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];
const BUTTON_KEYS = BUTTON_STYLES.map(b => b.key);
const CORNER_KEYS = CORNERS.map(c => c.key);
const SECTION_KEYS = SECTIONS.map(s => s.key);

// The ink and paper a section is drawn in. Dark sections use Steward's ink,
// light ones white; the brand color is the org's.
export const INK = "#0F1A12";
export const PAPER = "#FFFFFF";
export const AA = 4.5;

const HEX = /^#[0-9a-f]{6}$/i;
export function cleanHex(v) {
  const s = String(v == null ? "" : v).trim();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ("#" + s.slice(1).split("").map(c => c + c).join("")).toUpperCase();
  return HEX.test(s) ? s.toUpperCase() : "";
}

// The stored shape, cleaned. Anything unknown is dropped; nothing throws.
// Empty means "the org's brand": a page with no theme of its own looks like
// every other page the org has.
export function normalizeTheme(raw) {
  const t = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    accent: cleanHex(t.accent),
    fonts: FONT_KEYS.includes(t.fonts) ? t.fonts : "",
    button: BUTTON_KEYS.includes(t.button) ? t.button : "filled",
    corners: CORNER_KEYS.includes(t.corners) ? t.corners : "soft",
    sections: SECTION_KEYS.includes(t.sections) ? t.sections : "light",
  };
}

export function validateTheme(raw) {
  const errors = [];
  const t = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (raw != null && !t) errors.push({ field: "design.theme", message: "The page theme is a set of choices." });
  if (t) {
    if (t.accent && !cleanHex(t.accent)) errors.push({ field: "design.theme.accent", message: "An accent color is a hex color like #0D5C3A." });
    if (t.fonts && !FONT_KEYS.includes(t.fonts)) errors.push({ field: "design.theme.fonts", message: "Choose one of the font pairings." });
    if (t.button && !BUTTON_KEYS.includes(t.button)) errors.push({ field: "design.theme.button", message: "Choose Filled, Outline or Pill." });
    if (t.corners && !CORNER_KEYS.includes(t.corners)) errors.push({ field: "design.theme.corners", message: "Choose Square, Soft or Round." });
    if (t.sections && !SECTION_KEYS.includes(t.sections)) errors.push({ field: "design.theme.sections", message: "Choose Light or Dark sections." });
  }
  return { ok: errors.length === 0, errors, theme: errors.length ? null : normalizeTheme(t) };
}

// ── Contrast ──────────────────────────────────────────────────────────────
function channel(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
export function luminance(hex) {
  const h = cleanHex(hex);
  if (!h) return null;
  const n = parseInt(h.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
// The text that reads best on a color: ink or white.
export function textOn(hex) {
  const c1 = contrastRatio(hex, INK) || 0, c2 = contrastRatio(hex, PAPER) || 0;
  return c1 >= c2 ? INK : PAPER;
}

// What the page will draw, from the org's brand and the page's own choices.
//   brand: { primary, button, primaryFg, buttonFg } (the org's, from Design)
export function resolvePageTheme(brand, rawTheme) {
  const b = brand || {};
  const t = normalizeTheme(rawTheme);
  const primary = cleanHex(b.primary) || "#1A6B4A";
  const accent = t.accent || cleanHex(b.button) || primary;
  const dark = t.sections === "dark";
  const corner = CORNERS.find(c => c.key === t.corners) || CORNERS[1];
  return {
    ...t, primary, accent,
    accentFg: textOn(accent),
    ground: dark ? INK : PAPER,            // a section's ground
    text: dark ? PAPER : INK,              // a section's words
    radius: corner.radius,
    buttonRadius: t.button === "pill" ? 999 : corner.radius,
  };
}

// Every pair that fails AA, as a sentence the editor shows beside the colors.
// Each pair is one a donor actually reads: the words on a button, a link or a
// heading in the accent color on the section's ground, and the brand band's
// name on the brand color.
export function contrastWarnings(brand, rawTheme) {
  const r = resolvePageTheme(brand, rawTheme);
  const out = [];
  const check = (key, fg, bg, sentence) => {
    const ratio = contrastRatio(fg, bg);
    if (ratio != null && ratio < AA) out.push({ key, ratio, fg, bg, sentence: sentence(ratio) });
  };
  if (r.button === "outline") {
    check("button", r.accent, r.ground, x => `Outline buttons in ${r.accent} on ${r.sections} sections read at ${x}:1, under the 4.5:1 people need to read them easily. Pick a ${r.sections === "dark" ? "lighter" : "darker"} accent or Filled buttons.`);
  } else {
    check("button", r.accentFg, r.accent, x => `Button words on ${r.accent} read at ${x}:1, under the 4.5:1 people need to read them easily. Pick a darker or lighter accent.`);
  }
  check("accent", r.accent, r.ground, x => `Links and figures in ${r.accent} on ${r.sections} sections read at ${x}:1, under 4.5:1. Pick a ${r.sections === "dark" ? "lighter" : "darker"} accent.`);
  return out;
}

// CSS variables for the renderers. `--pt-*` is what PortalWidgets reads.
export function pageThemeVars(brand, rawTheme, fonts) {
  const r = resolvePageTheme(brand, rawTheme);
  const f = fonts && r.fonts && fonts[r.fonts] ? fonts[r.fonts] : null;
  return {
    "--pt-accent": r.accent, "--pt-accent-fg": r.accentFg,
    "--pt-button": r.accent, "--pt-button-fg": r.accentFg,
    "--pt-radius": r.radius + "px", "--pt-card-radius": r.radius + "px", "--pt-button-radius": r.buttonRadius + "px",
    "--pt-ground": r.ground, "--pt-text": r.text,
    ...(f ? { "--pt-serif": f.serif, "--pt-sans": f.sans } : {}),
  };
}
