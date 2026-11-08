// client/src/components/inputs/DateInput.jsx · POLISH-6 (W-1107-Finance-19X).
// THE ONE DATE BOX. A drop-in for <input type="date">: the same value (ISO
// YYYY-MM-DD, or "") and the same onChange(e) with e.target.value. It takes a
// typed MM/DD/YYYY or M/D/YY, eight digits, or a pasted ISO date
// (shared/dateEntry.js). A complete date is passed up as it is typed; on blur
// anything else shows the error and passes up "", so a garbled date is never
// saved. The draft lives only here: a form that is cancelled and closed takes
// it away with it.
import { useEffect, useRef, useState } from "react";
import { parseDateEntry, showDateEntry } from "../../../../shared/dateEntry.js";
import { T } from "../shared";

export default function DateInput({ value, onChange, onBlur, style, name, id, disabled, placeholder, min, max, required, ...rest }) {
  const [draft, setDraft] = useState(showDateEntry(value));
  const [err, setErr] = useState("");
  const last = useRef(value || "");
  useEffect(() => {   // a value set from outside (a reset, another record) replaces the draft
    if ((value || "") !== last.current) { last.current = value || ""; setDraft(showDateEntry(value)); setErr(""); }
  }, [value]);
  const emit = iso => { last.current = iso; if (onChange) onChange({ target: { value: iso, name, id }, currentTarget: { value: iso, name, id } }); };
  const range = iso => (iso && ((min && iso < min) || (max && iso > max)) ? "That date is outside the dates this field takes." : "");
  const change = e => {
    const t = e.target.value;
    setDraft(t);
    const r = parseDateEntry(t);
    if (r.ok && r.iso && /\d{4}/.test(t) && !range(r.iso)) { setErr(""); if (r.iso !== last.current) emit(r.iso); }
  };
  const blur = e => {
    const r = parseDateEntry(draft);
    const why = r.ok ? range(r.iso) : r.error;
    if (why) { setErr(why); if (last.current !== "") emit(""); }
    else { setErr(""); setDraft(showDateEntry(r.iso)); if (r.iso !== last.current) emit(r.iso); }
    if (onBlur) onBlur(e);
  };
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, maxWidth: "100%" }}>
      <input {...rest} type="text" inputMode="numeric" autoComplete="off" data-date-input="" data-iso={value || ""} data-min={min || undefined} data-max={max || undefined}
        name={name} id={id} disabled={disabled} required={required}
        value={draft} onChange={change} onBlur={blur} placeholder={placeholder && !/date/i.test(placeholder) ? placeholder : "MM/DD/YYYY"}
        aria-invalid={err ? "true" : undefined} style={{ ...(style || {}), ...(err ? { borderColor: T.gold700 || "#C9A84C" } : {}) }} />
      {err && <span role="alert" data-testid="date-input-error" style={{ fontSize: 11, color: T.ink, lineHeight: 1.3 }}>{err}</span>}
    </span>
  );
}
