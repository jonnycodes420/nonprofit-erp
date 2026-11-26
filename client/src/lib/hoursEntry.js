// INPUT-1 item 5 · ONE ENTRY OF MORE THAN 16 HOURS ASKS FIRST.
// The server answers 409 { code: "long_hours", sentence } (server/volunteers/longHours.js);
// she confirms and the same entry goes again with confirmLong: true. null = she chose to change it.
import { apiFetch } from "../api";
import { askConfirm } from "../components/ConfirmDialog";

export async function saveHours(url, method, body) {
  const send = b => apiFetch(url, { method, body: JSON.stringify(b) });
  try { return await send(body); }
  catch (e) {
    const q = (e && e.body) || e || {};
    if (!(e && e.status === 409 && (q.code === "long_hours" || e.code === "long_hours"))) throw e;
    const yes = await askConfirm({ title: q.sentence || e.message, body: "Hours count toward the person's total and every hours report.", yes: q.yes || "Yes, keep it", no: q.no || "Change it" });
    if (!yes) return null;
    return send({ ...body, confirmLong: true });
  }
}
