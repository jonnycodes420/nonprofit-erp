// components/majorGifts/InlineCell.jsx · TOUCH-1. CLICK A CELL TO EDIT IT.
//
// The Top 100's Ask, Ask by, Stage, Owner and Next step, and the same fields
// on the plan of care. Click (or Enter on it) opens the editor in place; Enter
// or leaving the box saves; Escape puts it back. A pencil shows on hover and
// on focus, so she can tell the cell is editable. One save per change, and the
// server's one audit write records each.
import { useEffect, useRef, useState } from "react";
import { T } from "../shared";
import DateInput from "../inputs/LazyDateInput";

const PENCIL = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20l1.5-5L16 4.5a2.1 2.1 0 0 1 3 3L8.5 18z"/></svg>;
const box = { padding: "4px 6px", border: "1px solid " + T.greenDk, borderRadius: 7, fontSize: 12.5, background: T.white, color: T.ink, boxSizing: "border-box", width: "100%", fontFamily: "inherit" };

// kind: "money" (dollars in, cents out), "date", "select" (options [{value,label}]), "text".
export function InlineCell({ kind = "text", value, display, options = [], onSave, label, testid, disabled = false, placeholder = "" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef(null);
  const done = useRef(false);
  useEffect(() => { if (editing && ref.current && ref.current.focus) ref.current.focus(); }, [editing]);
  const start = () => {
    if (disabled || busy) return;
    done.current = false; setErr("");
    setDraft(kind === "money" ? (value == null ? "" : String(value / 100)) : value == null ? "" : String(value));
    setEditing(true);
  };
  const cancel = () => { done.current = true; setEditing(false); setErr(""); };
  const commit = async (v = draft) => {
    if (done.current) return;
    done.current = true;
    let out = v;
    if (kind === "money") {
      const t = String(v).replace(/[$,\s]/g, "");
      if (t === "") out = null;
      else { const n = Number(t); if (!Number.isFinite(n) || n < 0) { done.current = false; setErr("An amount in dollars."); return; } out = Math.round(n * 100); }
    } else if (v === "") out = null;
    const before = kind === "money" ? value : value == null ? null : String(value);
    if (out === before || (out == null && before == null)) { setEditing(false); return; }
    setBusy(true);
    try { await onSave(out); setEditing(false); }
    catch (e) { done.current = false; setErr((e && (e.sentence || e.message)) || "That did not save."); }
    setBusy(false);
  };
  const keys = e => {
    if (e.key === "Enter") { e.preventDefault(); commit(e.currentTarget.value != null && kind !== "date" ? e.currentTarget.value : draft); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
  };
  if (editing) {
    return (
      <div data-testid={testid ? testid + "-editor" : undefined} style={{ minWidth: 0 }}>
        {kind === "select" ? (
          <select ref={ref} aria-label={label} value={draft} disabled={busy} onKeyDown={keys}
            onChange={e => { setDraft(e.target.value); commit(e.target.value); }} onBlur={() => commit()} style={box}>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : kind === "date" ? (
          <span onKeyDown={keys}><DateInput value={draft} aria-label={label} onChange={e => setDraft(e.target.value)} onBlur={() => commit()} style={box} /></span>
        ) : (
          <input ref={ref} aria-label={label} value={draft} disabled={busy} inputMode={kind === "money" ? "decimal" : undefined} placeholder={placeholder}
            onChange={e => setDraft(e.target.value)} onKeyDown={keys} onBlur={e => commit(e.target.value)} style={box} />
        )}
        {err && <div role="alert" style={{ fontSize: 10.5, color: T.gold700, marginTop: 2 }}>{err}</div>}
      </div>
    );
  }
  return (
    <div role={disabled ? undefined : "button"} tabIndex={disabled ? undefined : 0} aria-label={disabled ? undefined : `Edit ${label}`} data-testid={testid}
      onClick={start} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      title={disabled ? undefined : "Click to edit"}
      style={{ display: "flex", alignItems: "flex-start", gap: 4, cursor: disabled ? "default" : "text", minWidth: 0, borderRadius: 6,
               outline: hover && !disabled ? "1px dashed " + T.bg3 : "none", outlineOffset: 2 }}>
      <span style={{ minWidth: 0, flex: "0 1 auto", overflowWrap: "anywhere" }}>{display}</span>
      {!disabled && <span data-testid={testid ? testid + "-pencil" : undefined} style={{ color: T.ink3, opacity: hover ? 1 : 0, transition: "opacity .12s", flexShrink: 0, marginTop: 1 }}>{PENCIL}</span>}
    </div>
  );
}
