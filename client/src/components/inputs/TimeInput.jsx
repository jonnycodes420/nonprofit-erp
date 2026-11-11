// client/src/components/inputs/TimeInput.jsx · FLOWS-5 (W-1110-Volunteers-09X). ONE TIME BOX.
//
// A text box that takes a time as she types it (shared/timeEntry.js: "11",
// "11:00", "11am", "23:00") and says what it read beside it before anything is
// saved. It hands its parent "HH:MM", like the browser's time control did.
import { useEffect, useRef, useState } from "react";
import { T } from "../shared";
import { parseTimeEntry, showTime } from "../../../../shared/timeEntry.js";

export default function TimeInput({ value, onChange, style, id, "aria-label": ariaLabel, disabled, ...rest }) {
  const [draft, setDraft] = useState(showTime(value));
  const [err, setErr] = useState("");
  const last = useRef(value || "");
  useEffect(() => {   // a value set from outside replaces what is typed
    if ((value || "") !== last.current) { last.current = value || ""; setDraft(showTime(value)); setErr(""); }
  }, [value]);
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
  const shown = read.ok && read.value && showTime(read.value) !== draft.trim() ? `= ${showTime(read.value)}` : "";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, ...(style && style.flex ? { flex: style.flex } : {}) }}>
      <input {...rest} id={id} aria-label={ariaLabel} type="text" inputMode="text" autoComplete="off" data-time-input="" data-value={value || ""}
        value={draft} disabled={disabled} placeholder="e.g. 11am" onChange={change} onBlur={blur}
        aria-invalid={err ? "true" : undefined} style={{ ...style, flex: undefined, width: "100%" }} />
      {err ? <span role="alert" data-testid="time-input-error" style={{ fontSize: 11, color: T.ink, lineHeight: 1.3 }}>{err}</span>
        : shown ? <span data-testid="time-input-read" style={{ fontSize: 11, color: T.ink3, lineHeight: 1.3 }}>{shown}</span> : null}
    </span>
  );
}
