// client/src/components/volunteers/PersonShiftLists.jsx · FLOWS-3
// (W-1107-Volunteers-24). THE DRAWER'S COMING UP AND PAST SHIFTS.
// Both lists come from GET /volunteer-hub/person/:id, which reads the
// Schedule's own rows (server/volunteers/personShifts.js), so every shift the
// Schedule shows this person on is here too: ahead of today under Coming up,
// before it under Past shifts.
import { T } from "../shared";
import { displayDate } from "../../../../shared/displayDate";

const eyebrow = { fontSize: 10, fontWeight: 800, color: T.ink3 };
const NOTE = { waitlisted: u => ` · waiting list${u.position ? `, number ${u.position}` : ""}`, no_show: () => " · did not come", completed: () => " · done" };

function Row({ u }) {
  return (
    <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.7 }}>
      {displayDate(u.date)} · {u.name || u.opportunity}
      {NOTE[u.status] && <span style={{ color: u.status === "waitlisted" ? T.gold700 : T.ink3 }}>{NOTE[u.status](u)}</span>}
      {u.location && <span style={{ color: T.ink3 }}> · {u.location}</span>}
    </div>
  );
}

export function PersonShiftLists({ view }) {
  const up = view.upcoming || [], past = view.past || [];
  return (
    <>
      <div data-testid="vol-person-upcoming">
        <div style={{ ...eyebrow, marginBottom: 6 }}>Coming up</div>
        {up.length ? up.map(u => <Row key={u.id} u={u} />) : <div style={{ fontSize: 13, color: T.ink3 }}>{view.upcomingSentence}</div>}
      </div>
      {past.length > 0 && (
        <div data-testid="vol-person-past">
          <div style={{ ...eyebrow, marginBottom: 6 }}>Past shifts</div>
          {past.map(u => <Row key={u.id} u={u} />)}
        </div>
      )}
    </>
  );
}
