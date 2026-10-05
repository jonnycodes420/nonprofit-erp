// shared/calendarMoves.js · CAL-1. A DRAG IS A REQUEST TO THE ITEM'S OWN ROUTE.
//
// The calendar never writes on its own account. Dragging a block (or its
// bottom edge) becomes the request that item's own screen already makes:
//   meeting  POST  /calendar/events/:id/move   { startsAt, endsAt }  (instants;
//            the route moves it on Google or Outlook first, or says it can't)
//   step     PUT   /threads/:id                { due, time }
//   shift    PATCH /volunteer-hub/slots/:id    { date, startTime, endTime }
//   event    PATCH /events/:id/schedule        { date, startTime, endTime }
// so each move is that route's one audit write. Undo is the same route with
// the values the item had before: exactly back, and audited like any write.
//
// A move is a DELTA (whole days and minutes) applied to what the item holds,
// so a meeting's instants move by exactly the drag and no timezone is guessed.
// Pure: no fetch, no clock. The page and the test both build requests here.

const pad = n => String(n).padStart(2, "0");
export function addDaysCivil(ymd, n) {
  const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
// "HH:MM" + minutes, with the days it rolled over.
export function addMinutes(hhmm, mins) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const t = h * 60 + m + mins;
  const day = Math.floor(t / 1440), r = ((t % 1440) + 1440) % 1440;
  return { time: `${pad(Math.floor(r / 60))}:${pad(r % 60)}`, days: day };
}
const shiftInstant = (iso, days, mins) => new Date(Date.parse(iso) + (days * 1440 + mins) * 60000).toISOString();

// What a move would change, or { refused } in plain words.
//   item: the calendar's item (type, ref, start, end, allDay, editable)
//   d:    { days, minutes, endMinutes } — start moves by days+minutes; the end
//         moves by the same plus endMinutes (a resize is days 0, minutes 0).
export function moveRequest(item, d) {
  const days = d.days || 0, mins = d.minutes || 0, endMins = d.endMinutes || 0;
  const resize = !days && !mins && !!endMins;
  if (resize ? !(item.editable && item.editable.resize) : !(item.editable && item.editable.move))
    return { refused: resize ? "That item's length is set where it lives, not here." : "That item is moved where it lives, not here." };
  const dayOf = s => String(s).slice(0, 10), timeOf = s => (String(s).length > 10 ? String(s).slice(11, 16) : null);
  if (item.type === "meeting") {
    const r = item.ref || {};
    if (!r.startsAt || !r.endsAt) return { refused: "This meeting has no times to move." };
    const startsAt = shiftInstant(r.startsAt, days, mins), endsAt = shiftInstant(r.endsAt, days, mins + endMins);
    if (Date.parse(endsAt) <= Date.parse(startsAt)) return { refused: "A meeting has to end after it starts." };
    return { method: "POST", path: `/calendar/events/${encodeURIComponent(r.calendarEventId)}/move`, body: { startsAt, endsAt },
      undo: { method: "POST", path: `/calendar/events/${encodeURIComponent(r.calendarEventId)}/move`, body: { startsAt: r.startsAt, endsAt: r.endsAt } } };
  }
  if (item.type === "step") {
    if (!item.ref || !item.ref.threadId) return { refused: "A task is moved from Tasks." };
    const was = { due: dayOf(item.start), time: timeOf(item.start) || "" };
    let due = addDaysCivil(was.due, days), time = was.time;
    if (time && mins) { const t = addMinutes(time, mins); time = t.time; due = addDaysCivil(due, t.days); }
    return { method: "PUT", path: `/threads/${encodeURIComponent(item.ref.threadId)}`, body: { due, time },
      undo: { method: "PUT", path: `/threads/${encodeURIComponent(item.ref.threadId)}`, body: was } };
  }
  if (item.type === "shift" || item.type === "event") {
    const was = { date: dayOf(item.start), startTime: timeOf(item.start), endTime: timeOf(item.end) };
    let date = addDaysCivil(was.date, days), startTime = was.startTime, endTime = was.endTime;
    if (startTime) {
      const s = addMinutes(startTime, mins), e = addMinutes(endTime || startTime, mins + endMins);
      if (s.days || e.days || e.time <= s.time) return { refused: "It has to start and end on the same day, end after start." };
      startTime = s.time; endTime = e.time;
    }
    const path = item.type === "shift" ? `/volunteer-hub/slots/${encodeURIComponent(item.ref.slotId)}` : `/events/${encodeURIComponent(item.ref.eventId)}/schedule`;
    const body = { date, ...(startTime ? { startTime, endTime } : {}) };
    return { method: "PATCH", path, body, undo: { method: "PATCH", path, body: { date: was.date, ...(was.startTime ? { startTime: was.startTime, endTime: was.endTime } : {}) } } };
  }
  return { refused: "That item is moved where it lives, not here." };
}

// The words on the Undo toast: "Moved Coffee with Margaret to Tue Oct 6, 10:30."
export function movedWords(item, req) {
  const b = req.body || {};
  const when = b.startsAt ? null : b.date || b.due;
  const t = b.startTime || b.time || null;
  const day = w => { const [y, m, d] = w.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); };
  const clock = hhmm => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + pad(m) : ""}${h >= 12 ? "pm" : "am"}`; };
  return `Moved ${item.title}${when ? ` to ${day(when)}${t ? `, ${clock(t)}` : ""}` : ""}.`;
}
