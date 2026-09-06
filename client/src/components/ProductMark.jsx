// ProductMark — the two named products, The Thread and Drift, rendered the
// same everywhere they appear (the landing page AND inside the app). A pill
// with an 18×18 glyph and the name in DM Serif Display.
//
// DELIBERATELY DEPENDENCY-FREE: the landing page is the eager entry chunk
// (BUILD-07 route-split), so this file must never import shared.jsx or
// anything heavy — colors are the fixed brand values, inlined.
//
// Variants (the `on` prop names the GROUND the pill sits on):
//   on="ink"   → transparent fill, 1.5px solid brass border, cream text
//   on="cream" → ink fill, no border, cream text

const INK = "#0F1A12", CREAM = "#F0EDE6", BRASS = "#C9A84C", FOREST = "#0D5C3A", SAGE = "#8FA896";

function ThreadGlyph() {
  // a knot on a thread: the vertical line, the brass circle on it
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <line x1="9" y1="1" x2="9" y2="17" stroke={SAGE} strokeWidth="2" />
      <circle cx="9" cy="9" r="4.5" fill={BRASS} />
    </svg>
  );
}

function DriftGlyph({ on }) {
  // three dots drifting right; the third has gone brass
  const steady = on === "ink" ? SAGE : FOREST;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <circle cx="4" cy="9" r="3" fill={steady} />
      <circle cx="9" cy="9" r="3" fill={steady} />
      <circle cx="14" cy="9" r="3" fill={BRASS} />
    </svg>
  );
}

const NAMES = { thread: "The Thread", drift: "Drift" };

export function ProductMark({ product = "thread", on = "cream", style }) {
  const pill = {
    display: "inline-flex", alignItems: "center", gap: 10,
    padding: "8px 14px 8px 11px", borderRadius: 999,
    background: on === "ink" ? "transparent" : INK,
    border: on === "ink" ? `1.5px solid ${BRASS}` : "none",
    ...style,
  };
  const name = {
    fontFamily: "'DM Serif Display', Georgia, serif", fontWeight: 400,
    fontSize: 18, letterSpacing: "-0.01em", color: CREAM, lineHeight: 1,
  };
  return (
    <span className="pm-mark" data-product={product} style={pill}>
      {product === "thread" ? <ThreadGlyph /> : <DriftGlyph on={on} />}
      <span style={name}>{NAMES[product]}</span>
    </span>
  );
}

export default ProductMark;
