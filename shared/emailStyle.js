// shared/emailStyle.js · BUILDER-3 item 6. THE HOUSE STYLE, SET ONCE.
//
// Pure. The org's one style for every email (Styles tab, portal_settings.email_style): the
// heading and body fonts, their sizes, the link colour and the button shape. The renderer reads
// it at render time (shared/emailBlocks.js renderEmail, brand.emailStyle), so a change shows in
// every template the next time it is opened or sent, and no saved block is rewritten. A block
// that sets its own size keeps it: the style is the default under a block's own.
//
// The fonts are the stacks Steward already sends (EMAIL_FONT_STACKS in emailBlocks.js, which
// imports this file, so they are named here by pairing and role and looked up at render time).
// The link colour is one of the brand's own colours, never a new one.
export const EMAIL_STYLE_FONTS = [
  { key: "georgia", label: "Georgia", from: ["dm", "serif"] },
  { key: "palatino", label: "Palatino", from: ["editorial", "serif"] },
  { key: "baskerville", label: "Baskerville", from: ["literary", "serif"] },
  { key: "helvetica", label: "Helvetica", from: ["dm", "sans"] },
  { key: "verdana", label: "Verdana", from: ["classic", "sans"] },
  { key: "gill", label: "Gill Sans", from: ["editorial", "sans"] },
  { key: "system", label: "System", from: ["modern", "sans"] },
];
export const EMAIL_STYLE_LINK_COLORS = [
  { key: "band", label: "Brand color" },
  { key: "accent", label: "Accent" },
  { key: "button", label: "Button color" },
  { key: "ink", label: "Ink" },
];
export const EMAIL_STYLE_BUTTONS = [
  { key: "square", label: "Square", radius: 0 },
  { key: "rounded", label: "Rounded", radius: 8 },
  { key: "pill", label: "Pill", radius: 26 },
];
export const EMAIL_STYLE_SIZES = { heading: [18, 36], body: [14, 20] };
// What an email looks like with no house style: exactly as before this build.
export const EMAIL_STYLE_DEFAULTS = { headingFont: null, bodyFont: null, headingSize: 24, bodySize: 16, linkColor: "band", buttonShape: "rounded" };

const fontOf = k => EMAIL_STYLE_FONTS.find(f => f.key === k) || null;

// A stored style, made safe to render (anything unknown falls back to the default).
export function normalizeEmailStyle(s) {
  const o = s && typeof s === "object" ? s : {};
  const size = (v, [lo, hi], d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  return {
    headingFont: fontOf(o.headingFont) ? o.headingFont : null,
    bodyFont: fontOf(o.bodyFont) ? o.bodyFont : null,
    headingSize: size(o.headingSize, EMAIL_STYLE_SIZES.heading, EMAIL_STYLE_DEFAULTS.headingSize),
    bodySize: size(o.bodySize, EMAIL_STYLE_SIZES.body, EMAIL_STYLE_DEFAULTS.bodySize),
    linkColor: EMAIL_STYLE_LINK_COLORS.some(c => c.key === o.linkColor) ? o.linkColor : EMAIL_STYLE_DEFAULTS.linkColor,
    buttonShape: EMAIL_STYLE_BUTTONS.some(b => b.key === o.buttonShape) ? o.buttonShape : EMAIL_STYLE_DEFAULTS.buttonShape,
  };
}

// A style someone set: refused with a sentence when a value is not one Steward offers.
export function validateEmailStyle(input) {
  const o = input && typeof input === "object" ? input : {};
  for (const k of ["headingFont", "bodyFont"]) if (o[k] != null && o[k] !== "" && !fontOf(o[k])) return { ok: false, error: `That is not one of the fonts an email can use.` };
  for (const [k, [lo, hi]] of [["headingSize", EMAIL_STYLE_SIZES.heading], ["bodySize", EMAIL_STYLE_SIZES.body]]) {
    if (o[k] != null && !(Number(o[k]) >= lo && Number(o[k]) <= hi)) return { ok: false, error: `${k === "headingSize" ? "Headings" : "Body text"} can be ${lo} to ${hi} px.` };
  }
  if (o.linkColor != null && !EMAIL_STYLE_LINK_COLORS.some(c => c.key === o.linkColor)) return { ok: false, error: "The link color is one of your brand's colors." };
  if (o.buttonShape != null && !EMAIL_STYLE_BUTTONS.some(b => b.key === o.buttonShape)) return { ok: false, error: "A button is square, rounded or a pill." };
  return { ok: true, style: normalizeEmailStyle({ ...o, headingFont: o.headingFont || null, bodyFont: o.bodyFont || null }) };
}

// What the renderer needs: the two stacks, the two sizes, the radius and the link colour's key.
// `fonts` is the pairing's own { serif, sans }; `stacks` is EMAIL_FONT_STACKS.
export function styleForRender(s, fonts, stacks) {
  const n = normalizeEmailStyle(s);
  const stackOf = k => { const f = fontOf(k); return f && stacks && stacks[f.from[0]] ? stacks[f.from[0]][f.from[1]] : null; };
  return {
    serif: (n.headingFont && stackOf(n.headingFont)) || fonts.serif,
    sans: (n.bodyFont && stackOf(n.bodyFont)) || fonts.sans,
    headingSize: n.headingSize, bodySize: n.bodySize,
    radius: EMAIL_STYLE_BUTTONS.find(b => b.key === n.buttonShape).radius,
    linkColor: n.linkColor,
  };
}
