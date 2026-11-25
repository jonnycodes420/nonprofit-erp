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
