// email-builder/controls.jsx · BUILDER-1. THE PANES' SMALL PARTS.
//
// Tabs, sections, a slider with its exact number, a segmented choice, a
// switch and colour swatches, drawn the same in both panes (mockup D). Ink
// words on white, emerald for what is on, nothing else.
import { T } from "../shared";

export const paneInput = { width: "100%", boxSizing: "border-box", padding: "7px 9px", fontSize: 13, border: "1px solid " + T.bg3, borderRadius: 7, fontFamily: "inherit", color: T.ink, background: T.white };
export const paneBtn = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
export const paneNote = { fontSize: 12.5, color: T.ink3, lineHeight: 1.5 };
export const paneLabel = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 700, color: T.ink3 };

export function PaneTabs({ tabs, on, onPick, testid }) {
  return (
    <div role="tablist" data-testid={testid} style={{ display: "flex", borderBottom: "1px solid " + T.bg2, flexShrink: 0, background: T.white }}>
      {tabs.map(t => (
        <button key={t.id} type="button" role="tab" aria-selected={on === t.id} data-testid={(testid || "tab") + "-" + t.id} onClick={() => onPick(t.id)}
          style={{ flex: 1, border: 0, background: T.white, padding: "11px 0 9px", fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
            color: on === t.id ? T.green : T.ink3, borderBottom: "2px solid " + (on === t.id ? T.green : "transparent"), cursor: "pointer", fontFamily: "inherit" }}>{t.label}</button>
      ))}
    </div>
  );
}

export function Sec({ title, children, testid, right }) {
  return (
    <section data-testid={testid} style={{ padding: "13px 16px", borderBottom: "1px solid " + T.bg2 }}>
      {title && <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}><span style={{ ...paneLabel, flex: 1 }}>{title}</span>{right}</div>}
      {children}
    </section>
  );
}

export function Row({ label, children, htmlFor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13, padding: "5px 0", color: T.ink }}>
      <label htmlFor={htmlFor} style={{ flexShrink: 0 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>{children}</div>
    </div>
  );
}

// A slider and the exact number beside it, in step. `unit` is shown after.
export function Slider({ id, value, min, max, step = 1, unit = "px", onChange, testid, label }) {
  const v = value == null ? "" : value;
  return (
    <>
      <input id={id} type="range" min={min} max={max} step={step} value={v === "" ? min : v} aria-label={label} data-testid={testid}
        onChange={e => onChange(Number(e.target.value))} style={{ width: 104, accentColor: T.green }} />
      <input type="number" min={min} max={max} step={step} value={v} aria-label={label ? label + " exactly" : undefined} data-testid={testid ? testid + "-n" : undefined}
        onChange={e => { const n = e.target.value === "" ? null : Number(e.target.value); if (n == null || Number.isFinite(n)) onChange(n == null ? null : Math.min(max, Math.max(min, n))); }}
        style={{ ...paneInput, width: 54, padding: "4px 6px", textAlign: "right" }} />
      {unit && <span style={{ fontSize: 11.5, color: T.ink3 }}>{unit}</span>}
    </>
  );
}

// `full` spreads the choices across the pane (three long words fit a 300 px pane).
export function Segmented({ options, value, onChange, testid, label, full = false }) {
  return (
    <div role="group" aria-label={label} data-testid={testid} style={{ display: full ? "flex" : "inline-flex", width: full ? "100%" : undefined, border: "1px solid " + T.bg3, borderRadius: 8, overflow: "hidden" }}>
      {options.map((o, k) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} data-testid={testid ? testid + "-" + o.id : undefined} title={o.title || o.label} onClick={() => onChange(o.id)}
          style={{ border: 0, borderLeft: k ? "1px solid " + T.bg3 : 0, background: value === o.id ? T.ink : T.white, color: value === o.id ? T.white : T.ink, flex: full ? 1 : undefined,
            padding: full ? "5px 4px" : "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{o.label}</button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label, testid }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} data-testid={testid} onClick={() => onChange(!on)}
      style={{ width: 34, height: 19, borderRadius: 99, border: 0, padding: 0, background: on ? T.green : T.bg3, position: "relative", cursor: "pointer", flexShrink: 0 }}>
      <span aria-hidden="true" style={{ position: "absolute", top: 2, left: on ? 17 : 2, width: 15, height: 15, borderRadius: "50%", background: T.white, transition: "left .12s" }} />
    </button>
  );
}

// Colour swatches: [{ id, hex, label }]. The colours are the org's own brand
// (or the email's white and cream), never a picker.
export function Swatches({ options, value, onChange, testid, label }) {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testid} style={{ display: "flex", gap: 7 }}>
      {options.map(o => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} aria-label={o.label} title={o.label} data-testid={testid ? testid + "-" + o.id : undefined} onClick={() => onChange(o.id)}
          style={{ width: 24, height: 24, borderRadius: "50%", background: o.hex, cursor: "pointer", padding: 0,
            border: "2px solid " + T.white, boxShadow: `0 0 0 ${value === o.id ? 2 : 1}px ${value === o.id ? T.green : T.bg3}` }} />
      ))}
    </div>
  );
}
