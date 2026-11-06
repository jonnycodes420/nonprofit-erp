// HOME-3 · "RAISED" THE WAY SHE SAYS IT, drawn once.
//
// "Finding Joy Dinner: $124,290 raised ($45,340 received, $78,950 pledged)".
// The event page, the first look and Reports all draw an event's money with
// this, from the one server function (numbers.eventsRaised), and every number
// in the line is a <Figure> that opens its own rows: raised opens the gifts and
// the pledged installments together, received the gifts, pledged the unpaid
// installments due within a year of the event. Installments due in later years
// are said apart, never added to raised. The figures carry no "?" of their
// own (each has its sentence on hover and in its drawer); the line has one.
import { Figure, FigureWhy } from "./Figure";
import { T } from "./shared";
import { eventStoryParts } from "../../../shared/giftWords";

const STORY_LABELS = { attended: "Came", cameGave: "Came and gave", cameDidntGive: "Came, didn't give", gaveNotCame: "Gave, didn't come", gave: "Gave" };

export default function EventRaised({ e, showName = true, style }) {
  if (!e) return null;
  const f = (k, label) => (
    <Figure variant="inline" kind="money" value={e[k]} label={label} definition={e.definitions && e.definitions[k]} source={e.sources && e.sources[k]} why={false} />
  );
  return (
    <div data-testid="event-raised" data-event-id={e.id} data-raised-cents={e.raisedCents}
      onClick={ev => ev.stopPropagation()}
      style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, ...(style || {}) }}>
      {showName && <strong>{e.name}: </strong>}
      {f("raised", `${e.name}, raised`)} raised ({f("received", `${e.name}, received`)} received, {f("pledged", `${e.name}, pledged`)} pledged)
      {e.laterCents ? <>, and {f("later", `${e.name}, pledged for later years`)} more pledged for later years</> : null}
      {/* One "?" for the line, after it: never inside the parentheses (HOME-3 item 3). */}
      <FigureWhy definition={[e.definitions.raised, e.definitions.received, e.definitions.pledged].join(" ")} label={`${e.name}, raised`} source={e.sources.raised} />
    </div>
  );
}

// FUNDRAISING-2 · THE NIGHT'S STORY. Raised, received, pledged this year and
// over all years, who came, who gave, and who came and did not give, each a
// figure that opens its rows, from numbers.eventStory. The event page and
// Fundraising's lead card draw it the same way.
// EVENTS-3: a guest count is parties (a household once); its people sit
// beside it, smaller: "172 came · 252 people". Said only when they differ.
export const peopleLine = f => (f && f.people != null && f.people !== f.value
  ? `${Number(f.people).toLocaleString("en-US")} ${f.people === 1 ? "person" : "people"}` : null);

// "a, b and c" over the clauses that are there
const joinClauses = parts => {
  const p = parts.filter(Boolean);
  return p.map((x, i) => <span key={i}>{i === 0 ? "" : i === p.length - 1 ? " and " : ", "}{x}</span>);
};

export function EventStory({ s, style, noGiftShownBelow }) {
  if (!s) return null;
  const tile = (k, label, kind = "money") => (
    <Figure key={k} kind={kind} whole value={s[k]} label={label} definition={s.definitions && s.definitions[k]} source={s.sources && s.sources[k]} figureKey={"event." + k}
      sub={kind === "count" && s.peopleWords ? s.peopleWords[k] : null} />
  );
  const inline = (k, label) => (
    <Figure variant="inline" kind="count" value={s[k]} label={label} definition={s.definitions && s.definitions[k]} source={s.sources && s.sources[k]} why={false} />
  );
  return (
    <div data-testid="event-story" data-event-id={s.id} onClick={ev => ev.stopPropagation()}
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, ...(style || {}) }}>
      {tile("raised", "Raised")}
      {tile("received", "Received")}
      {tile("pledged", "Pledged · first year")}
      {s.laterCents ? tile("pledgedAll", "Pledged · all years") : null}
      {tile("attended", "Came", "count")}
      {tile("gave", "Gave", "count")}
      {noGiftShownBelow ? null : tile("cameDidntGive", "Came, didn't give", "count")}
      {/* FIX-58 + EVENTS-3: each count is parties, once, and the line shows they add up */}
      {s.addsUp ? (
        <div data-testid="event-story-adds-up" style={{ gridColumn: "1 / -1", fontSize: 13, color: T.ink, lineHeight: 1.6 }}>
          {/* FEEL-1: "1 came, and nobody gave yet." (shared/giftWords.js); each count opens its rows */}
          {(eventStoryParts(s) || []).map((p, i) => typeof p === "string" ? <span key={i}>{p}</span> : <span key={i}>{inline(p.k, STORY_LABELS[p.k])}</span>)}
        </div>
      ) : null}
      {/* FIX-59: the list adds up too: invited = said yes or came + declined + no reply */}
      {s.listAddsUp ? (
        <div data-testid="event-story-list-adds-up" style={{ gridColumn: "1 / -1", fontSize: 13, color: T.ink, lineHeight: 1.6 }}>
          {/* EVENTS-3: a clause whose count is 0 is left out */}
          {inline("invited", "Invited")} invited: {joinClauses([
            s.registered ? <>{inline("registered", "Registered")} said yes or came</> : null,
            s.declined ? <>{inline("declined", "Declined")} declined</> : null,
            s.noReply ? <>{inline("noReply", "No reply")} didn't reply</> : null])}.
          {s.invitedDidntCome != null && s.registered ? <> Of the {inline("registered", "Registered")}, {joinClauses([
            s.attended ? <>{inline("attended", "Came")} came</> : null,
            s.invitedDidntCome ? <>{inline("invitedDidntCome", "Said yes, didn't come")} didn't</> : null])}.</> : null}
        </div>
      ) : null}
    </div>
  );
}
