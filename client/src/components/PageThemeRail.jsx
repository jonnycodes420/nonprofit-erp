// PageThemeRail.jsx · PAGES-1. THE PAGE'S OWN THEME, IN THE EDITOR'S RAIL.
//
// The org's brand colours are the default. On top of them a page picks an
// accent colour, one of five curated font pairings, a button style, how round
// the corners are, and light or dark sections. Each change is a draft of
// `design.theme`, saved and published with the rest of the page. A colour pair
// that fails WCAG AA (4.5:1) is named here, with its ratio, the moment it is
// picked (shared/pageTheme.js does the arithmetic the test reads too).
import { railLabel, railInput, railNote } from "./StewardEditor";
import { T } from "./shared";
import { FONT_KEYS, FONT_LABELS, BUTTON_STYLES, CORNERS, SECTIONS, normalizeTheme, contrastWarnings, resolvePageTheme } from "../../../shared/pageTheme.js";

const chip = on => ({ flex: 1, background: on ? T.ink : T.white, color: on ? T.inkInverse : T.ink, border: "1px solid " + (on ? T.ink : T.bg3),
  borderRadius: 8, padding: "7px 6px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" });

function Choice({ label, options, value, onPick, testid }) {
  return (
    <div>
      <span style={railLabel}>{label}</span>
      <div role="radiogroup" aria-label={label} data-testid={testid} style={{ display: "flex", gap: 6 }}>
        {options.map(o => (
          <button key={o.key} type="button" role="radio" aria-checked={value === o.key} data-value={o.key} onClick={() => onPick(o.key)} style={chip(value === o.key)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

// brand: { primary, button } from the org's Design. theme: the page's design.theme.
export default function PageThemeRail({ brand, theme, onChange }) {
  const t = normalizeTheme(theme);
  const r = resolvePageTheme(brand, t);
  const warnings = contrastWarnings(brand, t);
  const set = (k, v) => onChange({ ...t, [k]: v });
  return (
    <div data-testid="page-theme-rail">
      <div style={railNote}>Your brand colours are the default. Everything here is for this page only.</div>
      <span style={railLabel}>Accent colour</span>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="color" aria-label="Accent colour" data-testid="theme-accent-picker" value={r.accent.toLowerCase()} onChange={e => set("accent", e.target.value.toUpperCase())}
          style={{ width: 44, height: 36, border: "1px solid " + T.bg3, borderRadius: 8, padding: 2, background: T.white, cursor: "pointer" }} />
        <input style={{ ...railInput, flex: 1 }} data-testid="theme-accent" value={t.accent} placeholder={r.accent + " (your brand)"}
          onChange={e => set("accent", e.target.value.trim())} aria-label="Accent colour as a hex code" />
        {t.accent && <button type="button" onClick={() => set("accent", "")} style={{ ...chip(false), flex: "none" }}>Brand</button>}
      </div>
      <label style={railLabel} htmlFor="theme-fonts">Fonts</label>
      <select id="theme-fonts" data-testid="theme-fonts" style={railInput} value={t.fonts} onChange={e => set("fonts", e.target.value)}>
        <option value="">Your brand's fonts</option>
        {FONT_KEYS.map(k => <option key={k} value={k}>{FONT_LABELS[k]}</option>)}
      </select>
      <Choice label="Buttons" testid="theme-button" options={BUTTON_STYLES} value={t.button} onPick={v => set("button", v)} />
      <Choice label="Corners" testid="theme-corners" options={CORNERS} value={t.corners} onPick={v => set("corners", v)} />
      <Choice label="Sections" testid="theme-sections" options={SECTIONS} value={t.sections} onPick={v => set("sections", v)} />
      {warnings.length > 0 && (
        <div role="alert" data-testid="contrast-warning" style={{ marginTop: 12, background: T.gold50, borderLeft: "4px solid " + T.gold, padding: "9px 11px", borderRadius: 6, fontSize: 12.5, lineHeight: 1.5, color: T.ink }}>
          <strong>Hard to read</strong>
          {warnings.map(w => <div key={w.key} data-pair={w.key} style={{ marginTop: 4 }}>{w.sentence}</div>)}
        </div>
      )}
    </div>
  );
}
