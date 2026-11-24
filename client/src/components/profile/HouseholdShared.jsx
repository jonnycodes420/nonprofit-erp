// components/profile/HouseholdShared.jsx · HOUSEHOLD-1 item 3. THE HOUSEHOLD SHARES;
// EACH PERSON KEEPS THEIR OWN. Under the household panel (Household and related):
// combined giving by year, the shared address, the household's open asks and
// next step, and each person with their own email, phone, photo and Contact
// preferences. "Log a touch with the household" logs one on each person's
// timeline, one line in Recent changes and one Undo (EDIT-2's touch batch).
import { useState } from "react";
import { T, PersonMark } from "../shared";
import { Figure } from "../Figure";
import { BulkLogTouch } from "../donors/BulkLogTouch";

const head = { fontSize: 10, fontWeight: 800, color: T.ink3, marginBottom: 4 };
const dayWords = d => { if (!d) return ""; const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };

export function HouseholdShared({ household, isReadOnly, onLogged }) {
  const [logOpen, setLogOpen] = useState(false);
  if (!household || !household.people) return null;
  const h = household;
  return (
    <div data-testid="dp-household-shared" style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid " + T.bg3, paddingTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
        {h.people.map(p => (
          <div key={p.id} data-testid="dp-household-person" style={{ display: "flex", gap: 10, alignItems: "flex-start", background: T.bg, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px" }}>
            <PersonMark id={p.id} name={p.name} url={p.photoUrl} size={34} />
            <div style={{ minWidth: 0, fontSize: 12, color: T.ink2, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 800, color: T.ink, fontSize: 13 }}>{p.name}</div>
              <div style={{ overflowWrap: "anywhere" }}>{p.email || <span style={{ color: T.ink3 }}>No email</span>}</div>
              <div>{p.phone || <span style={{ color: T.ink3 }}>No phone</span>}</div>
              <div style={{ color: p.preferences.length ? T.gold700 : T.ink3, fontWeight: p.preferences.length ? 700 : 400 }}>{p.preferences.length ? p.preferences.join(" · ") : "No contact limits"}</div>
            </div>
          </div>
        ))}
      </div>
      {h.address && (
        <div>
          <div style={head}>Address</div>
          <div style={{ fontSize: 12.5, color: T.ink }}>{h.address.lines.join(", ")}</div>
          <div style={{ fontSize: 11, color: T.ink3 }}>{h.address.differs.length ? `Shared by ${h.address.sharedBy.join(" and ")}; ${h.address.differs.join(" and ")} ${h.address.differs.length === 1 ? "has" : "have"} another address.` : "Shared by everyone in the household."}{h.addressee ? ` Mail reads "${h.addressee}".` : ""}</div>
        </div>
      )}
      {h.by_year && h.by_year.length > 0 && (
        <div>
          <div style={head}>Combined giving by year</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5 }}>
            {h.by_year.slice(0, 6).map(y => (
              <div key={y.label}><span style={{ color: T.ink3 }}>{y.label} </span>
                <Figure variant="cell" kind="money" value={y.cents / 100} label={`${h.name}, ${y.label}`} definition="What the people in this household gave in this year, added together. Each gift stays on the person who gave it." source={y.source} /></div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <div>
          <div style={head}>Open asks</div>
          {h.open_asks.length ? h.open_asks.map(a => (
            <div key={a.id} style={{ fontSize: 12.5, color: T.ink }}>{a.name} · <Figure variant="cell" kind="money" value={a.cents / 100} label={`${a.who}'s open ask`} source={a.source} /> <span style={{ color: T.ink3 }}>({a.stage}, {a.who}{a.expectedClose ? `, by ${dayWords(a.expectedClose)}` : ""})</span></div>
          )) : <div style={{ fontSize: 12, color: T.ink3 }}>No open asks.</div>}
        </div>
        <div>
          <div style={head}>Next step</div>
          {h.next_step ? <div style={{ fontSize: 12.5, color: h.next_step.overdue ? T.gold700 : T.ink, fontWeight: h.next_step.overdue ? 700 : 400 }}>{h.next_step.label}{h.next_step.due ? ` · ${h.next_step.overdue ? "overdue since " : ""}${dayWords(h.next_step.due)}` : ""} <span style={{ color: T.ink3, fontWeight: 400 }}>({h.next_step.who})</span></div>
            : <div style={{ fontSize: 12, color: T.ink3 }}>No next step planned.</div>}
        </div>
      </div>
      {!isReadOnly && h.people.length > 1 && (
        <div>
          <button type="button" data-testid="dp-household-log" onClick={() => setLogOpen(true)}
            style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, color: T.greenDk, cursor: "pointer", fontFamily: "inherit" }}>
            Log a touch with the household
          </button>
          <span style={{ fontSize: 11, color: T.ink3, marginLeft: 8 }}>One touch on each person's timeline, with one Undo.</span>
        </div>
      )}
      {logOpen && <BulkLogTouch zIndex={500} ids={h.people.map(p => p.id)} onClose={() => setLogOpen(false)} onDone={x => onLogged && onLogged(x)} />}
    </div>
  );
}
