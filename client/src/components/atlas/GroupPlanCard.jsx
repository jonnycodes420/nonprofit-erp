// atlas/GroupPlanCard.jsx · ATLAS-7. ONE CONFIRM SCREEN, THEN ACT.
// A group ask ("every donor who gave over $1,000 … in my Top 100 … a journey")
// shows the whole plan with the server's numbers before anything is written:
// who (the count, and "See the 38"), the list (added, already on it), the
// journey (new or existing, its steps, who it leaves out), and when the first
// tasks land. One "Do it" (POST /atlas/:id/group, claimed once). After it ran,
// the request's lines say what each action did, and "Undo all of it" reverses it.
import { useState } from "react";
import { T } from "../shared";

const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: "1px solid " + (primary ? T.greenDk : T.bg3),
  borderRadius: 10, padding: "6px 14px", minHeight: 36, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const link = { background: "none", border: "none", padding: 0, font: "inherit", color: T.ink, textAlign: "left", cursor: "pointer",
  textDecoration: "underline", textDecorationColor: T.bg3, textUnderlineOffset: 3 };
const row = { fontSize: 13.5, color: T.ink, lineHeight: 1.5 };
const label = { fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 };
const people = n => `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;
const stepDay = d => (d === 0 ? "day 0" : `day ${d}`);

export default function GroupPlanCard({ request, busy, onDo, onDiscard, onGo }) {
  const p = request && request.groupPlan;
  const [seeAll, setSeeAll] = useState(false);
  if (!p) return null;
  const line = (request.lines || []).find(l => l.kind === "group_plan");
  const done = !!p.doneAt;
  const dropped = !done && line && line.state === "discarded";
  const jr = p.journey;
  return (
    <section data-testid="atlas-group-plan" data-done={done ? "1" : "0"} style={{ border: "1px solid " + T.greenDk, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{done ? "You pressed Do it. Here's the plan it ran." : dropped ? "Discarded. Nothing was changed." : "Do all of this?"}</div>
      <div data-testid="atlas-group-who">
        <div style={label}>Who</div>
        <div style={row}><strong>{people(p.count)}</strong>{p.whoWords ? `: ${p.whoWords}` : ""}.{" "}
          <button type="button" data-testid="atlas-group-see" style={link} onClick={() => setSeeAll(s => !s)}>{seeAll ? "Hide them" : `See the ${p.count.toLocaleString("en-US")}`}</button></div>
        {seeAll && <ul data-testid="atlas-group-people" style={{ listStyle: "none", margin: "6px 0 0", padding: 0, maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {p.people.map(x => <li key={x.id} style={{ fontSize: 13 }}><button type="button" style={link} onClick={() => onGo({ tab: "donor", donorId: x.id })}>{x.name}</button></li>)}
          {p.more > 0 && <li style={{ fontSize: 12.5, color: T.ink3 }}>and {people(p.more)} more</li>}
        </ul>}
      </div>
      {p.list && <div data-testid="atlas-group-list">
        <div style={label}>List</div>
        <div style={row}>{p.list.refused ? p.list.refused
          : <>Add <strong>{people(p.list.add)}</strong> to your {p.list.name}{p.list.already ? `; ${p.list.already} ${p.list.already === 1 ? "is" : "are"} already on it` : ""}. The list has no cap.</>}</div>
      </div>}
      {jr && <div data-testid="atlas-group-journey">
        <div style={label}>Journey</div>
        <div style={row}>{jr.create ? <>Make a new journey, <strong>"{jr.name}"</strong>: {jr.words}.</> : <>Use <strong>"{jr.name}"</strong>, the journey you have.</>}{" "}
          Put <strong>{people(jr.joinCount)}</strong> in it{jr.leftOut && jr.leftOut.length ? `; left out: ${jr.leftOut.join(", ")}` : ""}.</div>
        <div style={{ ...row, color: T.ink2, fontSize: 13 }}>Steps: {jr.steps.map(s => `${s.label}, ${stepDay(s.offsetDays)}`).join("; ")}. Each step is a task for your team; nothing is sent.</div>
        {jr.off && <div style={{ ...row, color: T.ink2, fontSize: 13 }}>This journey is off, so it can't take people until it's turned on.</div>}
      </div>}
      {jr && jr.spread && <div data-testid="atlas-group-when">
        <div style={label}>When</div>
        <div style={row}>{jr.spread}</div>
      </div>}
      {!done && !dropped && <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {onDiscard && line && <button type="button" data-testid="atlas-group-discard" disabled={busy} onClick={() => onDiscard(line.id)} style={btn(false)}>Discard</button>}
        <button type="button" data-testid="atlas-group-do" disabled={busy} onClick={onDo} style={btn(true)}>Do it</button>
      </div>}
      {!done && !dropped && <div style={{ fontSize: 12, color: T.ink3 }}>Nothing is changed until you press Do it. Nothing is sent to anyone.</div>}
    </section>
  );
}
