// IMPORT-10 item 5 · THE EVENT BOX FINDS THE EVENT YOU MEANT (shared/eventMatch.js).
// As she types, the org's events that match (case, spacing and typos aside,
// newest first) are offered under the box; picking one links the gifts to that
// event (answers.eventId). Creating a new event when a close one exists asks
// "Did you mean …?" first, and Import waits for the answer.
import { T } from "../shared";
import { suggestEvents, normEvent } from "../../../../shared/eventMatch";

const small = { fontSize: 12, color: T.ink3, lineHeight: 1.5 };
const btn = on => ({ background: on ? T.greenDk : T.white, color: on ? T.white : T.ink, border: on ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "6px 10px", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" });
// the calendar already knows the picked event's date: never asked again
export const dayOf = d => (/^\d{4}-\d{2}-\d{2}/.test(String(d || "")) ? String(d).slice(0, 10) : null);
const day = d => (d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "no date");

export function EventSuggest({ u, typed, answers, onPick, disabled }) {
  const list = suggestEvents(typed, (u && u.orgEvents) || []);
  const picked = answers.eventId && list.find(e => e.id === answers.eventId);
  if (!list.length || picked) return picked ? <div data-testid="sheet-event-picked" style={{ ...small, color: T.ink, marginTop: 6 }}>Linking to {picked.name}, already on your calendar ({day(picked.date)}).</div> : null;
  return (
    <div data-testid="sheet-event-suggest" style={{ marginTop: 6 }}>
      <div style={small}>Already on your calendar:</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        {list.map(e => (
          <button type="button" key={e.id} data-testid="sheet-event-suggestion" disabled={disabled} style={btn(false)} onClick={() => onPick(e)}>
            {e.name} · {day(e.date)}
          </button>))}
      </div>
    </div>
  );
}

export function EventMatchQuestion({ q, setAnswer, disabled }) {
  if (!q) return null;
  return (
    <div data-testid="sheet-event-match" style={{ background: T.white, border: "1px solid " + T.gold500, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, margin: "0 0 6px" }}>{q.text}</div>
      <div style={small}>{q.hint}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" data-testid="sheet-event-match-yes" disabled={disabled} style={btn(false)}
          onClick={() => setAnswer({ eventId: q.eventId, eventName: q.eventName, ...(dayOf(q.eventDate) ? { eventDate: dayOf(q.eventDate) } : {}) })}>Yes, use {q.eventName}</button>
        <button type="button" data-testid="sheet-event-match-no" disabled={disabled} style={btn(false)}
          onClick={() => setAnswer({ newEvent: normEvent(q.typed) })}>No, create "{q.typed}"</button>
      </div>
    </div>
  );
}
