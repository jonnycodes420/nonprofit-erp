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
export function EventStory({ s, style, noGiftShownBelow }) {
  if (!s) return null;
  const tile = (k, label, kind = "money") => (
    <Figure key={k} kind={kind} whole value={s[k]} label={label} definition={s.definitions && s.definitions[k]} source={s.sources && s.sources[k]} figureKey={"event." + k} />
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
      {/* FIX-58: each count is people, once, and the line shows they add up */}
      {s.addsUp ? (
        <div data-testid="event-story-adds-up" style={{ gridColumn: "1 / -1", fontSize: 13, color: T.ink, lineHeight: 1.6 }}>
          {inline("attended", "Came")} came: {inline("cameGave", "Came and gave")} gave and {inline("cameDidntGive", "Came, didn't give")} didn't.{" "}
          {inline("gave", "Gave")} gave or pledged: {inline("cameGave", "Came and gave")} who came and {inline("gaveNotCame", "Gave, didn't come")} who didn't.
        </div>
      ) : null}
      {/* FIX-59: the list adds up too: invited = said yes or came + declined + no reply */}
      {s.listAddsUp ? (
        <div data-testid="event-story-list-adds-up" style={{ gridColumn: "1 / -1", fontSize: 13, color: T.ink, lineHeight: 1.6 }}>
          {inline("invited", "Invited")} invited: {inline("registered", "Registered")} said yes or came, {inline("declined", "Declined")} declined, {inline("noReply", "No reply")} didn't reply.
          {s.invitedDidntCome != null ? <> Of them, {inline("attended", "Came")} came and {inline("invitedDidntCome", "Said yes, didn't come")} didn't.</> : null}
        </div>
      ) : null}
    </div>
  );
}
