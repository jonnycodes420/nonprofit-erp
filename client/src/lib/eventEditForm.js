// client/src/lib/eventEditForm.js · WALKB-2 item 2. THE EDIT EVENT DIALOG
// OPENS WITH THE EVENT'S OWN DATE AND TIME.
//
// events.date is a Postgres DATE, which reaches the page as a whole instant
// ("2026-11-20T00:00:00.000Z"). A date field shows nothing for that, so the
// dialog opened blank, and saving it would have sent the empty field. The
// day is the first ten characters; the times are the page's own HH:MM.
const dayOf = v => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || ""));
  return m ? m[1] : "";
};
const timeOf = v => (/^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : "");

export function eventEditForm(event = {}) {
  const e = event || {};
  return {
    name: e.name || "", eventType: e.event_type, date: dayOf(e.date), endDate: dayOf(e.end_date),
    startTime: timeOf(e.start_time), endTime: timeOf(e.end_time),
    location: e.location || "", description: e.description || "", capacity: e.capacity || "",
    status: e.status, revenue: e.revenue || 0, cost: e.cost || 0, notes: e.notes || "",
  };
}
