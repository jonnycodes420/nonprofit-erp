// BUILD-59 — THE modular type + spacing scales for the donor portal, defined
// ONCE (JSX-free so the Node suites can import them). Portal.jsx and
// GivingDashboard.jsx both inject portalScaleVars() as CSS custom properties,
// so every font size and every margin/padding on the portal resolves to a
// value from these tables — the "one scale, used everywhere" the brief asks
// for, and the count of distinct values drops hard (reported in FINDINGS).
//
// Font rules (locked by the brief): DM Serif Display for DISPLAY sizes only
// (page title, org name, section headers); DM Sans for everything else,
// including all numbers. Body line-height 1.5–1.6, display 1.1–1.2, body
// measure capped at 65–75 characters.

// Type scale — a ~1.2 modular scale from 12. `display` is the one fluid step
// (the org name over the banner). Serif is applied only at h2/h1/display.
export const TYPE_SCALE = {
  micro: "12px",   // eyebrows / uppercase labels
  small: "13px",   // captions, footer, secondary
  body: "15px",    // default body + inputs + buttons
  bodyLg: "16px",  // lead paragraph
  h3: "18px",      // sub-headers, key numbers
  h2: "22px",      // card / section headers (serif)
  h1: "28px",      // page title (serif)
  display: "clamp(26px, 3.4vw, 34px)", // org name over the banner (serif)
};

// Spacing scale — a strict 4/8 base. Every portal margin/padding snaps here.
export const SPACE_SCALE = {
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "24px",
  6: "32px",
  7: "48px",
  8: "64px",
};

// Line-heights + the body measure cap (characters).
export const LINE = { display: 1.15, heading: 1.2, body: 1.55 };
export const BODY_MEASURE_CH = 72; // within the 65–75 target

// CSS custom properties injected onto the portal root. Consumed as
// var(--pt-fs-*, fallback) / var(--pt-sp-*, fallback) across the portal.
export function portalScaleVars() {
  const vars = {};
  for (const [k, v] of Object.entries(TYPE_SCALE)) vars[`--pt-fs-${k}`] = v;
  for (const [k, v] of Object.entries(SPACE_SCALE)) vars[`--pt-sp-${k}`] = v;
  vars["--pt-lh-body"] = String(LINE.body);
  vars["--pt-lh-display"] = String(LINE.display);
  vars["--pt-measure"] = `${BODY_MEASURE_CH}ch`;
  return vars;
}
