// atlas/ProposalCard.jsx · SENDS-1 item 2. ATLAS PROPOSES, SHE SAVES.
// One card listing exactly what Save will write: the call and its note, the
// follow-up and its date, the draft and its words. Edit changes any of it;
// nothing is written until Save (POST /atlas/:id/save, claimed by the
// proposal's id, so a second press writes nothing).
import { useState } from "react";
import { T } from "../shared";
import DateInput from "../inputs/LazyDateInput";   // POLISH-6: the one date box

const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: "1px solid " + (primary ? T.greenDk : T.bg3),
  borderRadius: 10, padding: "6px 14px", minHeight: 36, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const input = { width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 8px", fontSize: 14, fontFamily: "inherit", color: T.ink };
const day = d => { const x = new Date(String(d) + "T12:00:00Z"); return isNaN(x) ? String(d || "") : x.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); };

export function itemTitle(it) {
  if (it.kind === "call") return `Log the ${String(it.label || "conversation").toLowerCase()} with ${it.name}, ${day(it.date)}`;
  if (it.kind === "note") return `Add a note on ${it.name}`;
  if (it.kind === "follow_up") return `Follow-up${it.name ? ` with ${it.name}` : ""} on ${day(it.due)}: ${it.title}`;
  if (it.kind === "draft") return `A draft email to ${it.name} in Communications (not sent)`;
  return "";
}

export default function ProposalCard({ request, busy, onSave }) {
  const p = request && request.proposal;
  const [edit, setEdit] = useState(false);
  const [items, setItems] = useState(() => (p ? p.items.map(i => ({ ...i })) : []));
  if (!p || !p.items || !p.items.length) return null;
  const saved = !!p.savedAt;
  const shown = saved ? p.items : items;
  const set = (pid, k, v) => setItems(list => list.map(i => i.pid === pid ? { ...i, [k]: v } : i));
  return (
    <section data-testid="atlas-proposal" data-saved={saved ? "1" : "0"} style={{ border: "1px solid " + T.greenDk, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{saved ? "Saved." : "Save these?"}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map(it => <li key={it.pid} data-testid="atlas-proposal-item" data-kind={it.kind} style={{ fontSize: 13.5, color: it.skip ? T.ink3 : T.ink, lineHeight: 1.45 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            {!saved && <input type="checkbox" checked={!it.skip} onChange={e => set(it.pid, "skip", !e.target.checked)} aria-label={`Include: ${itemTitle(it)}`} style={{ marginTop: 3, accentColor: T.greenDk }} />}
            <span style={{ fontWeight: 600, textDecoration: it.skip ? "line-through" : "none" }}>{itemTitle(it)}</span>
          </label>
          {edit && !saved && !it.skip ? <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {it.kind === "call" && <><DateInput value={it.date} onChange={e => set(it.pid, "date", e.target.value)} style={input} aria-label="When" />
              <textarea rows={3} value={it.note} onChange={e => set(it.pid, "note", e.target.value)} style={input} aria-label="The note" /></>}
            {it.kind === "note" && <textarea rows={2} value={it.note} onChange={e => set(it.pid, "note", e.target.value)} style={input} aria-label="The note" />}
            {it.kind === "follow_up" && <><input value={it.title} onChange={e => set(it.pid, "title", e.target.value)} style={input} aria-label="Follow-up" />
              <DateInput value={it.due} onChange={e => set(it.pid, "due", e.target.value)} style={input} aria-label="Due" /></>}
            {it.kind === "draft" && <><input value={it.subject} onChange={e => set(it.pid, "subject", e.target.value)} style={input} aria-label="Subject" />
              <textarea rows={8} value={it.body} onChange={e => set(it.pid, "body", e.target.value)} style={input} aria-label="The email" /></>}
          </div>
          : <div style={{ color: T.ink2, whiteSpace: "pre-wrap", marginTop: 2, paddingLeft: saved ? 0 : 22 }}>
            {it.kind === "call" || it.kind === "note" ? it.note : it.kind === "draft" ? <><strong>{it.subject}</strong>{"\n"}{it.body}</> : null}
          </div>}
          {it.kind === "draft" && !it.skip && <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, paddingLeft: saved ? 0 : 22, fontSize: 13, color: T.ink2 }}>
            <input type="checkbox" data-testid="atlas-remind-me" disabled={saved} checked={!!it.remindMe} onChange={e => set(it.pid, "remindMe", e.target.checked)} style={{ accentColor: T.greenDk }} />
            Remind me on {day(it.remindDue)}: {it.remindTitle}
          </label>}
        </li>)}
      </ul>
      {!saved && <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" data-testid="atlas-proposal-edit" disabled={busy} onClick={() => setEdit(e => !e)} style={btn(false)}>{edit ? "Done editing" : "Edit"}</button>
        <button type="button" data-testid="atlas-proposal-save" disabled={busy || items.every(i => i.skip)} onClick={() => onSave(p.id, items)} style={btn(true)}>Save</button>
      </div>}
      {!saved && <div style={{ fontSize: 12, color: T.ink3 }}>Nothing is written until you press Save. Nothing is sent.</div>}
    </section>
  );
}
