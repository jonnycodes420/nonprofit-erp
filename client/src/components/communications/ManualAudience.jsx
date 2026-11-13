// components/communications/ManualAudience.jsx · COMMS-SPEED-1 item 2.
// A HAND-PICKED AUDIENCE SEARCHES ON THE SERVER, A PAGE AT A TIME.
//
// The Manual audience used to read every person's summary when it was chosen
// (21 pages of 500 on a 10,000-person org, ~40 s, and on after you left the
// page) to draw one long checklist. Now it asks the server as you type, with
// the Donors list's own person search (GET /donors/pick, match "person"): the
// first PAGE people with an email address, highest giving first, the same
// order the old list had. The people already chosen are read by id, so they
// stay on screen whatever is typed.
import { useState } from "react";
import { usePeoplePicker, usePeopleById } from "../../lib/people";
import { T } from "../shared";

const PAGE = 50;

export function ManualAudience({ ids, onToggle }) {
  const [text, setText] = useState("");
  const chosenIds = ids || [];
  const [rows, pending, failed] = usePeoplePicker(text, { match: "person", limit: PAGE, withEmail: true, emptyToo: true });
  const [chosenMap, chosenReady] = usePeopleById(chosenIds);
  const chosen = chosenIds.map(id => (chosenMap && chosenMap[id]) || null).filter(Boolean);
  const isOn = id => chosenIds.includes(id);
  const others = rows.filter(d => !isOn(d.id));
  const row = d => (
    <label key={d.id} data-testid="manual-person" style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", borderBottom: "1px solid " + T.bg2, cursor: "pointer" }}>
      <input type="checkbox" checked={isOn(d.id)} onChange={() => onToggle(d.id)} style={{ accentColor: T.green }} />
      <span style={{ fontSize: 13, color: T.ink, flex: 1 }}>{d.name}</span>
      <span style={{ fontSize: 11, color: T.ink3 }}>{d.email}</span>
    </label>
  );
  const note = s => <div style={{ fontSize: 12, color: T.ink3, padding: 8 }}>{s}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input data-testid="manual-search" value={text} onChange={e => setText(e.target.value)} placeholder="Search people by name or email"
        aria-label="Search people to add"
        style={{ border: "1px solid " + T.bg3, borderRadius: 7, padding: "6px 10px", fontSize: 12.5, color: T.ink, background: T.white }} />
      <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 8px" }}>
        {chosenIds.length > 0 && !chosenReady && note("Loading the people you chose…")}
        {chosen.map(row)}
        {failed ? note("The search did not answer. Try again in a moment.")
          : pending && others.length === 0 ? note("Searching…")
          : others.length === 0 ? note(text.trim() ? "Nobody with an email address matches that." : "Nobody here has an email address yet.")
          : others.map(row)}
        {!pending && !failed && rows.length >= PAGE && note(`The first ${PAGE} who match, highest giving first. Type a name or email to find someone else.`)}
      </div>
    </div>
  );
}

export default ManualAudience;
