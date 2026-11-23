// client/src/lib/removeThrough.js · TRASH-1 item 3. The screens whose Delete
// used to write its own confirm now ask removal.js (GET /removals/:kind/:id)
// and show its title, body and buttons as given, then offer the one Undo.
import { apiFetch } from "../api";
import { offerUndo } from "../components/EditHistory";

export const removalPlan = (kind, id) => apiFetch(`/removals/${kind}/${encodeURIComponent(id)}`);

// The confirm's options from a plan: one yes, or two ways forward (plan.choice).
export const confirmOpts = p => ({ title: p.title, body: p.body,
  yes: p.choice ? p.choice.keep : p.yes, ...(p.choice ? { alt: p.choice.remove } : {}), danger: !p.choice && p.mode === "delete" });

// The removal's answer ({ undoIds, sentence }) offers Undo, which puts back exactly what was there.
export function offerRemovalUndo(r, label, after) {
  if (!r || !Array.isArray(r.undoIds) || !r.undoIds.length) return;
  offerUndo({ undoSeconds: r.undoSeconds, message: r.sentence, undoAction: async () => {
    const x = await apiFetch("/removals/undo", { method: "POST", body: JSON.stringify({ undoIds: r.undoIds }) });
    if (after) after();
    return x || {};
  } }, label);
}

// Ask with the plan's own words, then remove through `path` (the screen's DELETE
// route, which answers through removal.js). A refusal is shown and nothing
// moves. Returns the removal's answer, or null when nothing was removed.
export async function askAndRemove(kind, id, path, askConfirm) {
  const p = await removalPlan(kind, id);
  if (p.mode === "refuse") { await askConfirm({ title: p.title, body: p.body, yes: "OK" }); return null; }
  if (!(await askConfirm(confirmOpts(p)))) return null;
  return apiFetch(path, { method: "DELETE" });
}
