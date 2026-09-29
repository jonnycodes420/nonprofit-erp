// FIX-2 A — EVERY NUMBER OPENS. The one figure component.
//
// Jonathan, 27 September: the dashboards were thin tiles and no number on them
// could be clicked. The rule since then is that every number Steward shows is
// a <Figure>: it takes its value, its kind (money, count, percent), its label,
// the sentence that defines it and a `source` — the name and filter of the
// rows that make it (figureSources.js on the server). Clicking it, or pressing
// Enter or Space on it, opens the one drill-through panel
// (MetricBreakdownPanel): the sentence, the rows, and a total that foots to
// the number on screen to the cent.
//
// A figure drawn without a source cannot open, and it says so: it renders
// `data-no-source`, which the dashboards' browser leg counts, and the number
// census (scripts/build97-number-census.js, FIGURE_SOURCE_SCOPE) fails the
// battery on a <Figure> written without `source=` on an in-scope screen.
//
// Variants — one component, the places a figure is drawn:
//   tile    a headline figure under its label
//   inline  a number inside a sentence ("We are $800 ahead…")
//   cell    a row's figure, right-aligned
//   point   a point on a chart (an SVG circle), for the Board's line
import { createContext, useContext, useState } from "react";
import { T, fmtFull } from "./shared";
import MetricBreakdownPanel from "./MetricBreakdownPanel";

// The screen that draws figures says how a person row opens that person, once.
export const FigureContext = createContext({ openPerson: null });

const centsOf = v => Math.round((Number(v) || 0) * 100);

export function Figure({ value, kind = "count", label, definition, source, blank, blankShort, variant = "tile",
                         figureKey, abs = false, suffix = "", sub, cx, cy, r = 5, color }) {
  const [open, setOpen] = useState(false);
  const { openPerson } = useContext(FigureContext);
  const isBlank = value === null || value === undefined;
  const shown = abs && !isBlank ? Math.abs(Number(value)) : value;
  const openable = !!(source && source.key);
  const data = {
    "data-figure": figureKey || label || "",
    "data-figure-key": figureKey || undefined,
    "data-source-key": openable ? source.key : undefined,
    "data-no-source": openable ? undefined : "",
    "data-cents": kind === "money" && !isBlank ? String(centsOf(value)) : undefined,
    "data-value": isBlank ? "" : String(value),
  };
  const act = () => { if (openable) setOpen(true); };
  const onKey = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } };
  const aria = `${label || "Figure"}. ${definition || ""} Opens the rows behind it.`.trim();
  const panel = open && (
    <MetricBreakdownPanel open onClose={() => setOpen(false)} title={label} explanation={definition}
      source={source} figure={{ value, kind, blank }} onSelectDonor={openPerson ? row => { setOpen(false); openPerson(row.donorId); } : undefined} />
  );

  if (variant === "point") {
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={color || T.greenDk} stroke={T.bgCard} strokeWidth={2}
          role="button" tabIndex={0} aria-label={aria} onClick={act} onKeyDown={onKey}
          style={{ cursor: openable ? "pointer" : "default" }} {...data}>
          <title>{label}</title>
        </circle>
        {panel}
      </g>
    );
  }

  const text = isBlank ? "—"
    : kind === "money" ? fmtFull(shown)
    : kind === "percent" ? `${shown}%`
    : Number(shown).toLocaleString("en-US") + suffix;

  if (variant === "inline" || variant === "cell") {
    return (
      <>
        {/* FIX-8 Part B.4 — THE DOTTED UNDERLINE IS A HOVER STATE, NOT A
            PERMANENT MARK. It was drawn in brass under every figure on every
            screen, always on: a fifth place the one attention colour was
            spent on chrome, and four of them in a row across the donor
            profile read as four things wanting to be noticed. The affordance
            is kept and moved to :hover and :focus-visible (`.figure-inline`
            in GlobalStyles), so a figure still says it opens at the moment
            somebody reaches for it. */}
        <button type="button" onClick={act} onKeyDown={onKey} title={definition} aria-label={aria} {...data}
          className={openable ? "figure-inline" : undefined}
          style={{ background: "none", border: "none", padding: 0, margin: 0, font: "inherit", color: "inherit",
                   cursor: openable ? "pointer" : "default",
                   fontWeight: variant === "cell" ? 700 : "inherit", whiteSpace: "nowrap" }}>
          {text}
        </button>
        {panel}
      </>
    );
  }

  // tile — the card, the figure as its button, and any line under it (a
  // retention cohort) outside the button, so a figure never nests in another.
  return (
    <div className="fig-tile" style={{ background: T.bgCard, border: "1px solid " + T.bg2, borderRadius: 12, minWidth: 0,
                                       display: "flex", flexDirection: "column", containerType: "inline-size" }}>
      <button type="button" onClick={act} onKeyDown={onKey} title={definition} aria-label={aria} {...data}
        style={{ textAlign: "left", background: "transparent", border: "none", borderRadius: 12, width: "100%",
                 padding: "16px 18px 12px", cursor: openable ? "pointer" : "default", minWidth: 0,
                 display: "flex", flexDirection: "column", gap: 6, font: "inherit", color: T.ink }}>
        <span style={{ fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase", color: T.ink3, fontWeight: 700 }}>{label}</span>
        {/* Sized to the TILE (a container query), never broken across lines: a
            figure split as "$1,575.7 / 5" is a different number. */}
        <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: "clamp(22px, 14cqi, 34px)", lineHeight: 1.1, color: T.ink, whiteSpace: "nowrap" }}>{text}</span>
        {/* A BLANK IS SAID, NOT GUESSED, and it says when it will appear. */}
        {/* The tile says when in a few words; the panel says the whole sentence. */}
        {isBlank && (blankShort || blank) && <span style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.45 }}>{blankShort || blank}</span>}
      </button>
      {sub && <div style={{ padding: "0 18px 14px", fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{sub}</div>}
      {panel}
    </div>
  );
}

export default Figure;
