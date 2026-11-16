// client/src/lib/completeTask.js · FLOWS-17 item 2 (Justin's Place, a paying customer).
// ONE WAY TO TICK A TASK, WHEREVER IT IS SHOWN.
//
// Allie: "I keep coming to this screen and want to … check box on this screen to mark it as
// done and it doesn't let you here … I have to go to the task tab on the left column." The
// profile drew an empty square beside each open task (Activity and its Tasks tab) that was only a
// picture, and its "Mark done" wrote the whole row back with PUT /tasks/:id, with no Undo and
// no next repeat. Every box now comes here: the Tasks page's own call, POST /tasks/:id/complete
// (which closes a next step through its Thread and makes a repeat's next one), with the same Undo.
// api.js tells lib/changes.js that a task changed, so the Tasks page, Home, the badge and the
// profile all re-read with no reload.
//
// Answers { ok: true, row } when done; { needsOutcome: true, kind } when it is a call or meeting
// that has to say how it went first (the caller opens that dialog, as the Tasks page does);
// throws anything else.
import { apiFetch } from "../api";
import { offerUndo } from "../components/EditHistory";
import { fmtDayShort } from "./taskDue";

export const completeCall = (id, done) =>
  apiFetch(`/tasks/${encodeURIComponent(id)}/complete`, { method: "POST", body: JSON.stringify({ done }) });

export async function completeTask(t, { after = null, undo = true } = {}) {
  let row;
  try { row = await completeCall(t.id, true); }
  catch (e) {
    if (e && e.error === "needs_outcome") return { needsOutcome: true, kind: e.kind || null, sentence: e.sentence || null };
    throw e;
  }
  if (after) await after();
  if (undo) offerUndo({
    message: row && row.next ? `Done: ${t.title}. The next one is on ${fmtDayShort(row.next.due)}.` : `Done: ${t.title}.`,
    undoAction: async () => { const r = await completeCall(t.id, false); if (after) await after(); return r; },
  }, t.title);
  return { ok: true, row };
}
