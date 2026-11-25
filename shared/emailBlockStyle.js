// shared/emailBlockStyle.js · BUILDER-2A item 4. EVERY BLOCK'S STYLE FIELDS, IN ONE SCHEMA.
//
// Pure: no DB, no network, no clock. The editor's right pane (BUILDER-1, then
// BUILDER-2) reads EMAIL_BLOCK_STYLE to draw its controls, so the screen never
// hard-codes a field, a unit or a limit; the server keeps what passes
// normalizeBlockStyle; the renderer (shared/emailBlocks.js) honours it.
//
// A block's style lives on the block as `style: { ... }`. A block with no style
// (every block saved before this build) renders exactly as before: the
// renderer takes the old path when `hasStyle(block)` is false, byte for byte
// (tests/builder2a-email-parts.test.js §starters).
//
// Colours are brand words, not hex: "band" and "accent" are the org's own
// colours read at render time, "cream", "white", "ink" and "hair" are the
// email's neutral surface. So a block saved today follows a brand change
// tomorrow, and nobody types a colour that fails contrast.

export const EMAIL_BLOCK_STYLE = Object.freeze({
  version: 1,
  fields: Object.freeze({
    align:        { kind: "enum", label: "Alignment", values: ["left", "center", "right"], default: null },
    // A size is { value, unit }: px is clamped to the space it sits in, % is of that space.
    width:        { kind: "size", label: "Width", units: { px: { min: 40, max: 600 }, "%": { min: 10, max: 100 } }, default: null },
    // Images only. With no width, the height sets the size and the width follows (the shape is kept).
    height:       { kind: "px", label: "Height", min: 20, max: 1200, default: null, types: ["image"] },
    // One number for every side, or { top, right, bottom, left }.
    padding:      { kind: "sides", label: "Padding", min: 0, max: 80, default: null },
    marginTop:    { kind: "px", label: "Space above", min: 0, max: 80, default: null },
    marginBottom: { kind: "px", label: "Space below", min: 0, max: 80, default: null },
    borderWidth:  { kind: "px", label: "Border", min: 0, max: 4, default: 0 },
    borderColor:  { kind: "enum", label: "Border color", values: ["band", "accent", "ink", "hair"], default: "band" },
    radius:       { kind: "px", label: "Rounded corners", min: 0, max: 32, default: 0 },
    background:   { kind: "enum", label: "Background", values: ["none", "white", "cream", "band", "accent"], default: "none" },
    hideOn:       { kind: "enum", label: "Hide on", values: ["none", "phone", "desktop"], default: "none" },
  }),
});

export const STYLE_KEYS = Object.keys(EMAIL_BLOCK_STYLE.fields);
const SIDES = ["top", "right", "bottom", "left"];

const int = (v, min, max) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
};

// Clean a style for one block type. Unknown keys and default values are
// dropped, so `{}` and a style of all defaults both come back as null (the
// block renders as if it had none). A bad value throws, with a sentence.
export function normalizeBlockStyle(raw, type) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("style must be a set of fields.");
  const F = EMAIL_BLOCK_STYLE.fields;
  const out = {};
  for (const key of STYLE_KEYS) {
    const v = raw[key];
    if (v === undefined || v === null || v === "") continue;
    const f = F[key];
    if (f.types && !f.types.includes(type)) continue;
    if (f.kind === "enum") {
      if (!f.values.includes(v)) throw new Error(`${f.label} must be one of ${f.values.join(", ")}.`);
      if (v !== f.default) out[key] = v;
    } else if (f.kind === "px") {
      const n = int(v, f.min, f.max);
      if (n == null) throw new Error(`${f.label} must be a number of pixels.`);
      if (n !== f.default) out[key] = n;
    } else if (f.kind === "size") {
      const unit = v && typeof v === "object" ? v.unit : "px";
      const val = v && typeof v === "object" ? v.value : v;
      const lim = f.units[unit];
      if (!lim) throw new Error(`${f.label} must be in px or %.`);
      const n = int(val, lim.min, lim.max);
      if (n == null) throw new Error(`${f.label} must be a number.`);
      if (!(unit === "%" && n === 100)) out[key] = { value: n, unit };
    } else if (f.kind === "sides") {
      if (typeof v === "object") {
        const s = {};
        for (const side of SIDES) {
          const n = int(v[side] == null ? 0 : v[side], f.min, f.max);
          if (n == null) throw new Error(`${f.label} must be numbers of pixels.`);
          s[side] = n;
        }
        out[key] = s;
      } else {
        const n = int(v, f.min, f.max);
        if (n == null) throw new Error(`${f.label} must be a number of pixels.`);
        out[key] = n;
      }
    }
  }
  // A border colour means nothing without a border.
  if (!out.borderWidth) delete out.borderColor;
  return Object.keys(out).length ? out : null;
}

export function hasStyle(block) {
  return !!(block && block.style && typeof block.style === "object" && Object.keys(block.style).length);
}

// Padding as four numbers, or null when the block keeps its own.
export function sidesOf(p) {
  if (p == null) return null;
  if (typeof p === "number") return { top: p, right: p, bottom: p, left: p };
  return { top: p.top || 0, right: p.right || 0, bottom: p.bottom || 0, left: p.left || 0 };
}
export const sidesCss = s => `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px`;

// A width in pixels within `avail` (a % is of avail; px never passes it).
export function widthPx(size, avail) {
  if (!size) return avail;
  if (size.unit === "%") return Math.max(1, Math.round(avail * size.value / 100));
  return Math.min(avail, size.value);
}

// The brand word as a hex colour.
export function styleColor(word, brand, C) {
  switch (word) {
    case "white": return "#ffffff";
    case "cream": return C.page;
    case "band": return brand.band;
    case "accent": return brand.accent;
    case "ink": return C.ink;
    case "hair": return C.hair;
    default: return null;
  }
}
// The words' colour on a background: the band and the accent take the brand's own foreground.
export function inkOn(word, brand) {
  if (word === "band") return brand.bandFg;
  if (word === "accent") return brand.accentFg;
  return null;
}

// The classes the phone media query reads, and the CSS they need. The CSS is
// added to an email only when a block uses it, so an email without these
// classes is the same bytes it always was.
export const HIDE_CSS = {
  phone: { cls: "st-hide-phone", phone: ".st-hide-phone{display:none !important;max-height:0 !important;overflow:hidden !important;}" },
  desktop: { cls: "st-show-phone", phone: ".st-show-phone{display:table-row !important;max-height:none !important;overflow:visible !important;}",
    inline: "display:none;mso-hide:all;max-height:0;overflow:hidden;" },
};
