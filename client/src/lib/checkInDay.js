// INPUT-1 item 6 · CHECK-IN HAPPENS ON THE DAY.
// Before the shift's or event's day the server answers 409 { code: "not_the_day", sentence, choices }
// (server/volunteers/shiftDay.js). She picks: check in then (nothing is written),
// or record it for that date (sent again with forShiftDate: true). null = nothing written.
import { apiFetch } from "../api";
import { askConfirm } from "../components/ConfirmDialog";

export async function checkInOnTheDay(url, body) {
  const send = b => apiFetch(url, { method: "POST", body: JSON.stringify(b) });
  try { return await send(body); }
  catch (e) {
    const q = (e && e.body) || e || {};
    if (!(e && e.status === 409 && (q.code === "not_the_day" || e.code === "not_the_day"))) throw e;
    const c = q.choices || {};
    const yes = await askConfirm({ title: "Not today", body: q.sentence || e.message, yes: c.record || "Record it for that date", no: c.later || "Check in then" });
    if (!yes) return null;
    return send({ ...body, forShiftDate: true });
  }
}

// An event dated before today asks first (a past event is real; a typo is likelier). true = create it.
export async function confirmPastEvent(date, today, words) {
  if (!date || date >= today) return true;
  return !!(await askConfirm({ title: "This date has passed. Record a past event?", body: `${words} is before today. Record it as an event that already happened, or change the date.`, yes: "Record a past event", no: "Change the date" }));
}
