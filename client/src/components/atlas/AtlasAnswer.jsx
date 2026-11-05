// atlas/AtlasAnswer.jsx · ATLAS-3. A LIST IS A LIST; A PERSON IS WHAT WE KNOW.
//
// Under an Atlas line that answered something: the people (each name opens
// their record, with why they matched, and the count), and "Open list", which
// opens the same people in Groups every time (POST /atlas/actions/:id/list
// keeps them as one group on the first click). For one person: the About note,
// the last conversations and the next step, each opening where it lives.
import { useState } from "react";
import { T } from "../shared";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";

const link = { background: "none", border: "none", padding: 0, font: "inherit", color: T.ink, textAlign: "left", cursor: "pointer",
  textDecoration: "underline", textDecorationColor: T.bg3, textUnderlineOffset: 3 };
const quiet = { fontSize: 12.5, color: T.ink3, lineHeight: 1.45 };

export default function AtlasAnswer({ line, onGo, busy }) {
  const a = line && line.answer;
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState("");
  if (!a) return null;
  if (a.type === "person") return (
    <ul data-testid="atlas-person" style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {a.facts.map((f, i) => <li key={i} data-fact={f.kind} style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink }}>
        <button type="button" style={link} onClick={() => onGo(f.link)}>{f.line}</button></li>)}
    </ul>
  );
  if (a.type !== "list") return null;
  const open = async () => {
    setOpening(true); setErr("");
    try { const r = await apiFetch(`/atlas/actions/${line.id}/list`, { method: "POST", body: "{}" }); onGo({ tab: "groups", groupId: r.groupId }); }
    catch (e) { setErr(errorMessage(e, "The list didn't open. Try again.")); }
    setOpening(false);
  };
  return (
    <div data-testid="atlas-list" style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
      {a.reason && <div style={quiet}>Each of them: {a.reason}.</div>}
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
        {a.people.map(p => <li key={p.donorId} data-testid="atlas-list-person" style={{ fontSize: 13.5, lineHeight: 1.4, color: T.ink }}>
          <button type="button" style={{ ...link, fontWeight: 700 }} onClick={() => onGo({ tab: "donor", donorId: p.donorId })}>{p.name}</button>
          <span style={quiet}> · {p.reason}</span></li>)}
      </ol>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span data-testid="atlas-list-count" style={{ fontSize: 13, color: T.ink2 }}>{a.count === 1 ? "1 person" : `${a.count.toLocaleString("en-US")} people`}{a.more > 0 ? `, ${a.more.toLocaleString("en-US")} more in the list` : ""}.</span>
        <button type="button" data-testid="atlas-open-list" disabled={busy || opening} onClick={open}
          style={{ background: T.white, color: T.ink, border: "1px solid " + T.greenDk, borderRadius: 8, padding: "4px 12px", minHeight: 32, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          {opening ? "Opening…" : "Open list"}</button>
      </div>
      {err && <div role="alert" style={quiet}>{err}</div>}
    </div>
  );
}
