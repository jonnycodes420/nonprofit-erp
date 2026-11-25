// shared/emailBlockStyle.js · BUILDER-1. HOW ONE EMAIL BLOCK LOOKS.
//
// Pure: no DB, no network, no clock. The validator (emailBlocks.js
// validateEmailBlocks) keeps only what this file allows, and the renderer
// (renderEmail) draws it email-safe: table cells, inline styles, padding, a
// bgcolor, a border on a nested table, and two classes the phone media query
// reads. Nothing here needs flexbox, grid or a web font, and the editor's
// Style tab offers only what STYLE_CAPS lists for a type, so it never offers
// something an inbox can't show.
//
// A block may carry:
//   style   { align, width, height (images, BUILDER-2A), pad:[t,r,b,l], mt, mb, border, borderColor, radius, bg, hide }
//   and its own settings, by type:
//     richtext   size (px), lineHeight
//     image      link (https:// or {{give_link}})
//     button     color ("button" | "band" | "accent", the brand's own), fullPhone
//     divider    thickness (px), spacing (px above and below)
//     signature  signatureImage (her signature picture, LETTERS-1, as a stored URL)
//     footer     page ("cream" | "white" | "band"): the email's own background
// A block with none of these renders exactly as it did before BUILDER-1.

export const ALIGNS = ["left", "center", "right"];
export const BACKGROUNDS = ["white", "cream", "band"];
export const BORDER_COLORS = ["hair", "band", "accent"];
export const BUTTON_COLORS = ["button", "band", "accent"];
export const PAGE_BACKGROUNDS = ["cream", "white", "band"];
export const EMAIL_INNER = 536;   // 600 less 32 each side: the widest anything inside the card is
export const LIMITS = {
  width: [40, EMAIL_INNER], pad: [0, 80], margin: [0, 80], radius: [0, 32],
  size: [13, 24], lineHeight: [1.2, 2.2], thickness: [1, 8], spacing: [0, 48],
  height: [20, 1200],   // BUILDER-2A: an image's height, its shape kept
};

// Which style settings each type's render honours. The Style tab reads this,
// so a setting the renderer can't draw for that type is never offered.
const BOXED = ["align", "width", "pad", "mt", "mb", "border", "bg", "hide"];
export const STYLE_CAPS = {
  richtext: BOXED, image: [...BOXED, "height"], photos2: ["pad", "mt", "mb", "border", "bg", "hide"], stats: BOXED, quote: BOXED,
  button: ["align", "width", "pad", "mt", "mb", "bg", "hide"], event: BOXED, givingpage: BOXED,
  divider: ["width", "align", "mt", "mb", "bg", "hide"], giftsummary: BOXED, signature: BOXED,
  hero: ["align", "mt", "mb", "hide"], video: ["mt", "mb", "hide"], header: ["mt", "mb", "hide"], footer: [],
  // BUILDER-2A: the full builder's blocks (shared/emailMoreBlocks.js). A Box's
  // look is all style; Social takes alignment; Code is its own HTML inside.
  columns: BOXED, box: ["width", "pad", "mt", "mb", "border", "bg", "hide"],
  social: ["align", "pad", "mt", "mb", "bg", "hide"], code: ["pad", "mt", "mb", "bg", "hide"],
};
export const capsOf = type => STYLE_CAPS[type] || [];

const num = (v, [lo, hi], dp = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(Math.min(hi, Math.max(lo, n)) * f) / f;
};

// The style a block may keep, for its type. Returns null when nothing is set.
export function cleanStyle(s, type) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const caps = new Set(capsOf(type));
  const out = {};
  if (caps.has("align") && ALIGNS.includes(s.align)) out.align = s.align;
  if (caps.has("width") && s.width != null) { const w = num(s.width, LIMITS.width); if (w != null) out.width = w; }
  if (caps.has("height") && s.height != null && out.width == null) { const h = num(s.height, LIMITS.height); if (h != null) out.height = h; }   // BUILDER-2A
  if (caps.has("pad") && Array.isArray(s.pad) && s.pad.length === 4) {
    const p = s.pad.map(v => num(v, LIMITS.pad));
    if (p.every(v => v != null)) out.pad = p;
  }
  for (const k of ["mt", "mb"]) if (caps.has(k) && s[k] != null) { const m = num(s[k], LIMITS.margin); if (m) out[k] = m; }
  if (caps.has("border") && s.border === "thin") {
    out.border = "thin";
    out.borderColor = BORDER_COLORS.includes(s.borderColor) ? s.borderColor : "hair";
  }
  if ((caps.has("border") || caps.has("width")) && s.radius != null) { const r = num(s.radius, LIMITS.radius); if (r) out.radius = r; }
  if (caps.has("bg") && BACKGROUNDS.includes(s.bg) && s.bg !== "white") out.bg = s.bg;
  if (caps.has("hide") && (s.hide === "phone" || s.hide === "desktop")) out.hide = s.hide;
  return Object.keys(out).length ? out : null;
}

// A link an image may open: https, or the giving link field.
export function cleanLink(v) {
  const s = String(v == null ? "" : v).trim().slice(0, 1000);
  if (!s) return "";
  if (/^https:\/\/[^\s"'<>]+$/i.test(s) || /^\{\{\s*give_link\s*\}\}$/.test(s)) return s;
  return null;   // refused: the caller says so
}

// A block's own settings (beside `style`), cleaned. `imageRef(v)` is the
// validator's photo check, for the signature picture. Throws a sentence.
export function cleanOptions(w, at, imageRef) {
  const out = {};
  const style = cleanStyle(w.style, w.type);
  if (style) out.style = style;
  switch (w.type) {
    case "richtext": {
      const size = w.size != null ? num(w.size, LIMITS.size) : null;
      const lh = w.lineHeight != null ? num(w.lineHeight, LIMITS.lineHeight, 1) : null;
      if (size && size !== 16) out.size = size;
      if (lh && lh !== 1.6) out.lineHeight = lh;
      break;
    }
    case "image": {
      const l = cleanLink(w.link);
      if (l === null) throw new Error(`${at}: the photo's link must start with https://.`);
      if (l) out.link = l;
      break;
    }
    case "button":
      if (BUTTON_COLORS.includes(w.color) && w.color !== "button") out.color = w.color;
      if (w.fullPhone === true) out.fullPhone = true;
      break;
    case "divider": {
      const t = w.thickness != null ? num(w.thickness, LIMITS.thickness) : null;
      const sp = w.spacing != null ? num(w.spacing, LIMITS.spacing) : null;
      if (t && t !== 1) out.thickness = t;
      if (sp != null && sp !== 8) out.spacing = sp;
      break;
    }
    case "signature": {
      if (w.signatureImage != null && w.signatureImage !== "") {
        const r = imageRef(w.signatureImage);
        if (!r.ok) throw new Error(`${at}: the signature picture must be one Steward stored, not a pasted image.`);
        if (r.v) out.signatureImage = r.v;
      }
      break;
    }
    case "footer":
      if (PAGE_BACKGROUNDS.includes(w.page) && w.page !== "cream") out.page = w.page;
      break;
    default: break;
  }
  return out;
}

// ── Drawing (used by renderEmail) ──────────────────────────────────────────
// colors: { card, page, band, bandFg, accent, hair, body, ink, muted }
export function bgOf(S, colors) {
  return S && S.bg === "cream" ? colors.page : S && S.bg === "band" ? colors.band : colors.card;
}
const borderHex = (S, colors) => (S.borderColor === "band" ? colors.band : S.borderColor === "accent" ? colors.accent : colors.hair);

// One block's row, with its style. `pad` is the type's own padding, used
// when the block sets none. Every style is inline; the card's white stays the
// default so an unstyled block is the same HTML as before.
export function styledRow(S, inner, pad, cls, colors, PAD) {
  S = S || {};
  const bg = bgOf(S, colors);
  const klass = S.bg === "band" ? "st-bandrow" : cls;
  let body = inner;
  if (S.bg === "band") {
    // Words on the brand band take the band's own text colour.
    for (const c of [colors.body, colors.ink, colors.muted]) body = body.split(`color:${c};`).join(`color:${colors.bandFg};`);
  }
  const alignAttr = S.align ? ` align="${S.align}"` : "";
  const alignCss = S.align ? `text-align:${S.align};` : "";
  if (S.width) {
    const m = S.align === "left" ? "" : S.align === "right" ? "margin-left:auto;" : "margin:0 auto;";
    const a = S.align || "center";
    body = `<table role="presentation" width="${S.width}" align="${a}" cellpadding="0" cellspacing="0" border="0" style="width:${S.width}px;max-width:100%;${m}"><tr><td${alignAttr} style="${alignCss}">${body}</td></tr></table>`;
  }
  const padCss = S.pad ? S.pad.map(n => `${n}px`).join(" ") : pad;
  if (S.border) {
    // BUILDER-2A: with a border, the ground is inside it (a cream box is cream
    // within its line); the cell around it stays the card, so the sheet's edge
    // still shows beside it.
    const r = S.radius ? `border-radius:${S.radius}px;` : "";
    const inBg = S.bg ? ` bgcolor="${bg}"` : "";
    body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${inBg} style="${S.bg ? `background:${bg};` : ""}border:1px solid ${borderHex(S, colors)};${r}border-collapse:separate;"><tr><td${alignAttr} style="padding:${S.pad ? padCss : "16px 20px"};${alignCss}">${body}</td></tr></table>`;
    return `<tr><td class="${cls}"${alignAttr} bgcolor="${colors.card}" style="background:${colors.card};padding:${S.pad ? `0 ${PAD}px` : pad};${alignCss}">${body}</td></tr>`;
  }
  return `<tr><td class="${klass}"${alignAttr} bgcolor="${bg}" style="background:${bg};padding:${padCss};${alignCss}">${body}</td></tr>`;
}

// Space above or below a block, in the card's colour.
export function spacerRow(px, colors) {
  return `<tr><td class="st-card" bgcolor="${colors.card}" height="${px}" style="background:${colors.card};height:${px}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

// Hide on phones or on desktop: a class the phone media query reads (desktop-
// hidden rows are hidden inline and shown again on a phone). In the editor's
// preview nothing is hidden, so the block can still be clicked; it is marked.
export function hideRow(rowHtml, hide, editable) {
  if (!hide) return rowHtml;
  if (editable) return rowHtml.replace(/^<tr\b/, `<tr data-st-hide="${hide}"`);
  if (hide === "phone") return rowHtml.replace(/^<tr\b/, `<tr class="st-hide-phone"`);
  return rowHtml.replace(/^<tr\b/, `<tr class="st-hide-desktop" style="display:none;mso-hide:all;"`);
}
export const HIDE_CSS_PHONE = ".st-hide-phone{display:none !important;}\n.st-hide-desktop{display:table-row !important;}\n.st-btn-full{width:100% !important;}\n.st-btn-full a{display:block !important;}";

// BUILDER-2A item 4 · THE SCHEMA, PUBLISHED. Every style field, its values or
// limits, and the types that take it, read from the constants above (one home:
// nothing here is a second copy of a limit). The editor's Style tab and
// BUILDER-2's new blocks read this, so the screen never hard-codes a field.
const FIELD_OF = {
  align:  { kind: "enum", label: "Alignment", values: ALIGNS },
  width:  { kind: "px", label: "Width", min: LIMITS.width[0], max: LIMITS.width[1] },
  height: { kind: "px", label: "Height (the shape is kept)", min: LIMITS.height[0], max: LIMITS.height[1] },
  pad:    { kind: "sides", label: "Padding", min: LIMITS.pad[0], max: LIMITS.pad[1], order: ["top", "right", "bottom", "left"] },
  mt:     { kind: "px", label: "Space above", min: LIMITS.margin[0], max: LIMITS.margin[1] },
  mb:     { kind: "px", label: "Space below", min: LIMITS.margin[0], max: LIMITS.margin[1] },
  border: { kind: "enum", label: "Border", values: ["none", "thin"], colors: BORDER_COLORS, radius: { min: LIMITS.radius[0], max: LIMITS.radius[1] } },
  bg:     { kind: "enum", label: "Background", values: BACKGROUNDS },
  hide:   { kind: "enum", label: "Hide on", values: ["none", "phone", "desktop"] },
};
export const EMAIL_BLOCK_STYLE = Object.freeze({
  fields: FIELD_OF,
  types: Object.fromEntries(Object.entries(STYLE_CAPS).map(([t, caps]) => [t, caps.slice()])),
});
