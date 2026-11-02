// components/profile/headerParts.jsx (PROFILE-3): the header's small pieces —
// the quiet action button's look, its icons, and the contact line under the name.
import { useState } from "react";
import { T } from "../shared";

const INK60 = "rgba(15,26,18,0.6)";

// Note, Email and Task: an outline button with an icon; the word shows when
// the header has room for it (a container query in shared.jsx hides it below).
const ACT = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "0 12px", color: T.ink, fontSize: 13, fontWeight: 700,
  cursor: "pointer", minHeight: 40, minWidth: 40, whiteSpace: "nowrap", fontFamily: "inherit", textDecoration: "none",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, boxSizing: "border-box" };

function ActIcon({ kind }) {
  const p = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  if (kind === "mail") return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>;
  if (kind === "task") return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>;
  return <svg {...p}><path d="M5 19h4L19.5 8.5a2.1 2.1 0 0 0-3-3L6 16v3z" /><path d="M14 7l3 3" /></svg>;
}

// PROFILE-3 · THE CONTACT LINE: email · phone · city, each copied with a
// click, or one quiet "Add email or phone" when there is neither.
function Copyable({ text, label, testid }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {}); } catch { /* no clipboard */ }
  };
  return <button type="button" data-testid={testid} onClick={copy} title={done ? "Copied" : `Copy ${label}`} aria-label={`Copy ${label}: ${text}`}
    style={{ background: "none", border: "none", padding: 0, margin: 0, font: "inherit", color: "inherit", cursor: "copy", overflowWrap: "anywhere", textAlign: "left" }}>
    {done ? "Copied" : text}</button>;
}

function ContactLine({ donor, isReadOnly, onAdd }) {
  const place = [donor.city, donor.state].filter(Boolean).join(", ");
  const bits = [donor.email && ["email", donor.email], donor.phone && ["phone", donor.phone], place && ["city", place]].filter(Boolean);
  return (
    <div className="dph-contact" data-testid="dp-contact-line" style={{ gridColumn: "2 / -1", gridRow: 4, marginTop: 8, fontSize: 13, color: INK60, lineHeight: 1.5,
      display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 2, minWidth: 0 }}>
      {bits.length ? bits.map(([k, v], i) => <span key={k} style={{ display: "inline-flex", gap: 8, minWidth: 0 }}>
        {i > 0 && <span aria-hidden="true">·</span>}<Copyable text={v} label={k} testid={"dp-contact-" + k} /></span>)
        : (!isReadOnly && onAdd
          ? <button type="button" data-testid="dp-contact-add" onClick={onAdd} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: INK60, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>Add email or phone</button>
          : null)}
    </div>
  );
}

export { ACT, ActIcon, ContactLine };
