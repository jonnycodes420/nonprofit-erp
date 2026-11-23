// PersonField.jsx · GIFTS-3 item 2. A PERSON IS PICKED, NEVER GUESSED FROM TYPING.
//
// Soft credit, tribute and matching employer were <datalist> boxes over an exact
// name: no suggestions a person (or a walk) could see, and typed text that named
// nobody was found by exact name at Save or quietly not at all. Now the matches
// show as she types (the Donors list's own person search) and the field holds a
// person only once one is clicked. A tribute may honour somebody who is not on
// file (a memorial often is), so its list ends with "Use the name 'X'", which is
// a choice too. Text typed and not picked is reported up (onTyped) and Save says so.
//
// value: { id, name } | { id: null, name, nameOnly: true } | null
import { useEffect, useState } from "react";
import { T } from "../shared";
import { usePeoplePicker } from "../../lib/people";

const SHOWN = 6;

export default function PersonField({ label, value, onChange, onTyped, nameOnlyOk = false, testid, compact = false, style }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const typed = text.trim();
  const [rows, pending] = usePeoplePicker(!value && typed ? typed : "", { match: "person", limit: SHOWN, enabled: !value && !!typed });
  useEffect(() => { if (onTyped) onTyped(value ? "" : typed); }, [typed, value]);   // eslint-disable-line react-hooks/exhaustive-deps
  const fs = compact ? 12 : 13;
  const box = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: compact ? "6px 8px" : "8px 10px", color: T.ink, fontSize: fs, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%" };
  const pick = v => { setText(""); setOpen(false); onChange(v); };

  if (value) {
    return (
      <div style={style}>
        <span data-testid={testid + "-picked"} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.white, border: "1px solid " + T.bg3, borderRadius: 99, padding: compact ? "4px 10px" : "6px 12px", fontSize: fs, color: T.ink, maxWidth: "100%" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ color: T.ink3, fontWeight: 700 }}>{label}: </span>{value.name}{value.nameOnly ? <span style={{ color: T.ink3 }}> · not on file</span> : null}
          </span>
          <button type="button" aria-label={`Clear ${label.toLowerCase()}`} data-testid={testid + "-clear"} onClick={() => onChange(null)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: T.ink3, fontSize: fs + 2, lineHeight: 1 }}>×</button>
        </span>
      </div>
    );
  }
  const none = typed && !pending && rows.length === 0;
  return (
    <div style={{ position: "relative", ...style }}>
      <input value={text} onChange={e => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={`${label}: search people on file`} aria-label={label} data-testid={testid} style={box} autoComplete="off" role="combobox" aria-expanded={open && !!typed} />
      {open && typed && (
        <div role="listbox" data-testid={testid + "-matches"} style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", marginTop: 2, background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, boxShadow: "0 6px 18px rgba(15,26,18,.12)", maxHeight: 240, overflowY: "auto" }}>
          {rows.slice(0, SHOWN).map(d => (
            <button key={d.id} type="button" role="option" aria-selected="false" data-testid={testid + "-opt"} onMouseDown={e => e.preventDefault()} onClick={() => pick({ id: d.id, name: d.name })}
              style={{ display: "flex", justifyContent: "space-between", gap: 10, width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 10px", fontSize: fs, color: T.ink, cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ fontWeight: 700 }}>{d.name}</span><span style={{ color: T.ink3, fontSize: fs - 1 }}>{d.email || [d.city, d.state].filter(Boolean).join(", ")}</span>
            </button>))}
          {pending && rows.length === 0 && <div style={{ padding: "8px 10px", fontSize: fs, color: T.ink3 }}>Searching…</div>}
          {none && <div data-testid={testid + "-none"} style={{ padding: "8px 10px", fontSize: fs, color: T.ink2 }}>Nobody called '{typed}' is on file.{nameOnlyOk ? "" : " Add them first, then pick them here."}</div>}
          {nameOnlyOk && !pending && (
            <button type="button" data-testid={testid + "-name-only"} onMouseDown={e => e.preventDefault()} onClick={() => pick({ id: null, name: typed, nameOnly: true })}
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid " + T.bg3, padding: "8px 10px", fontSize: fs, color: T.greenDk, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Use the name '{typed}' (not on file)
            </button>)}
        </div>)}
    </div>
  );
}
