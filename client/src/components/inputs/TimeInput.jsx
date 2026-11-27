// client/src/components/inputs/TimeInput.jsx · FLOWS-5 (W-1110-Volunteers-09X). ONE TIME BOX.
//
// A text box that takes a time as she types it (shared/timeEntry.js: "11",
// "11:00", "11am", "23:00") and says what it read beside it before anything is
// saved. It hands its parent "HH:MM", like the browser's time control did.
//
// POLISH-15 item 3 (W-1127-Volunteers-02): with `hours`, a button beside it
// opens a list of times on the half hour, drawn inside the page (so inside the
// dialog that holds it). Choosing one sets the time and closes the list; the
// dialog stays open. Escape closes the list only (lib/pickerFocus.js).
import { useEffect, useRef, useState } from "react";
import { T } from "../shared";
import { parseTimeEntry, showTime } from "../../../../shared/timeEntry.js";

const pad = n => String(n).padStart(2, "0");
// 7 AM to 9 PM on the half hour, the calendar's own day.
const HALF_HOURS = Array.from({ length: 29 }, (_, i) => `${pad(7 + Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`);

export default function TimeInput({ value, onChange, style, id, "aria-label": ariaLabel, disabled, hours = false, ...rest }) {
  const [draft, setDraft] = useState(showTime(value));
  const [err, setErr] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const last = useRef(value || "");
  const listRef = useRef(null);
  useEffect(() => {   // a value set from outside replaces what is typed
    if ((value || "") !== last.current) { last.current = value || ""; setDraft(showTime(value)); setErr(""); }
  }, [value]);
  useEffect(() => {   // the open list starts at the time already chosen
    if (!listOpen || !listRef.current) return;
    const on = listRef.current.querySelector("[aria-selected='true']") || listRef.current.querySelector("[role='option']");
    if (on) { on.scrollIntoView?.({ block: "nearest" }); on.focus?.({ preventScroll: true }); }
  }, [listOpen]);
  const emit = v => { last.current = v; if (onChange) onChange({ target: { value: v, id }, currentTarget: { value: v, id } }); };
  const read = parseTimeEntry(draft);
  const change = e => {
    const t = e.target.value;
    setDraft(t);
    const r = parseTimeEntry(t);
    if (r.ok && r.value) { setErr(""); if (r.value !== last.current) emit(r.value); }
  };
  const blur = () => {
    const r = parseTimeEntry(draft);
    if (!r.ok) { setErr(r.error); return; }
    setErr(""); setDraft(showTime(r.value));
    if (r.value !== last.current) emit(r.value);
  };
  const choose = v => { setErr(""); setDraft(showTime(v)); if (v !== last.current) emit(v); setListOpen(false); };
  const onListKey = e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setListOpen(false); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const opts = [...(listRef.current?.querySelectorAll("[role='option']") || [])];
    const i = opts.indexOf(document.activeElement);
    const next = opts[Math.max(0, Math.min(opts.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    next?.focus();
  };
  const shown = read.ok && read.value && showTime(read.value) !== draft.trim() ? `= ${showTime(read.value)}` : "";
  return (
    <span data-own-picker={listOpen ? "open" : undefined} style={{ display: "inline-flex", flexDirection: "column", gap: 2, position: "relative", ...(style && style.flex ? { flex: style.flex } : {}) }}>
      <span style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
        <input {...rest} id={id} aria-label={ariaLabel} type="text" inputMode="text" autoComplete="off" data-time-input="" data-value={value || ""}
          value={draft} disabled={disabled} placeholder="e.g. 11am" onChange={change} onBlur={blur}
          aria-invalid={err ? "true" : undefined} style={{ ...style, flex: undefined, width: "100%", minWidth: 0 }} />
        {hours && !disabled && <button type="button" data-testid="time-input-hours" aria-label="Hours" aria-haspopup="listbox" aria-expanded={listOpen}
          onClick={() => setListOpen(o => !o)}
          style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "0 8px", color: T.ink, cursor: "pointer", fontSize: 12 }}>▾</button>}
      </span>
      {listOpen && <div ref={listRef} role="listbox" aria-label="Hours" data-testid="time-input-list" onKeyDown={onListKey}
        style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 20, background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, maxHeight: 200, overflowY: "auto", minWidth: 120, boxShadow: T.shadowLg }}>
        {HALF_HOURS.map(v => (
          <div key={v} role="option" tabIndex={-1} aria-selected={v === (value || "")} data-value={v}
            onMouseDown={e => e.preventDefault()} onClick={() => choose(v)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(v); } }}
            style={{ padding: "6px 10px", fontSize: 13, cursor: "pointer", color: T.ink, background: v === (value || "") ? T.bg2 : T.white }}>{showTime(v)}</div>))}
      </div>}
      {err ? <span role="alert" data-testid="time-input-error" style={{ fontSize: 11, color: T.ink, lineHeight: 1.3 }}>{err}</span>
        : shown ? <span data-testid="time-input-read" style={{ fontSize: 11, color: T.ink3, lineHeight: 1.3 }}>{shown}</span> : null}
    </span>
  );
}
