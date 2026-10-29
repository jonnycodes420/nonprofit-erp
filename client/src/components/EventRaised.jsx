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
