// client/src/components/profile/TaskTick.jsx · FLOWS-17 item 2. THE BOX BESIDE A TASK ON THE
// PROFILE TICKS IT.
//
// The profile's timeline (Activity and the Tasks tab) drew an empty square beside each open task,
// the shape of a checkbox, and a click on it only opened the card. This is that square as a real
// checkbox: one click completes the task through the one complete call (lib/completeTask.js),
// with Undo, and every screen that lists tasks re-reads. A call or a meeting that has to say how
// it went first opens Log a touch (onNeedsOutcome), the way the Tasks page asks; what the server
// said comes back through onSay, for the card to show. Read-only (no
// write access) draws the plain icon, with no box: a box that does nothing is the bug.
import { useEffect, useState } from "react";
import { T } from "../shared";
import { completeTask, completeCall } from "../../lib/completeTask";
import { errorMessage } from "../../lib/domainError";

// Read-only, an open task is a list mark, never an empty box.
const LIST = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>;
const BOX = { width: 44, height: 44, borderRadius: 12, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 };

export function TaskTick({ task, done, canWrite, icon, onNeedsOutcome = null, onSay = () => {} }) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(null);     // what she just did, until the re-read lands
  useEffect(() => { setShown(null); }, [done]);   // the re-read (or an Undo from the toast) is the truth again
  const isDone = shown == null ? !!done : shown;
  if (!canWrite) return <div data-testid="tl-task-icon" style={{ ...BOX, background: T.white, border: "1px solid " + T.bg3, color: T.ink }}>{isDone ? icon : LIST}</div>;
  const click = async (e) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true); onSay("");
    try {
      if (isDone) { await completeCall(task.id, false); setShown(false); }
      else {
        const r = await completeTask(task);
        if (r.needsOutcome) { onSay(r.sentence || ""); if (onNeedsOutcome) onNeedsOutcome(task); }
        else setShown(true);
      }
    } catch (x) { onSay((x && x.sentence) || errorMessage(x, "That did not save.")); }
    setBusy(false);
  };
  return <button type="button" role="checkbox" aria-checked={isDone} aria-label={isDone ? `Reopen: ${task.title}` : `Mark done: ${task.title}`}
      title={isDone ? "Reopen" : "Mark done"} data-testid="tl-task-tick" data-task-tick={task.id} disabled={busy}
      onClick={click} onKeyDown={e => e.stopPropagation()}
      style={{ ...BOX, background: T.white, border: "1px solid " + T.bg3, cursor: busy ? "wait" : "pointer" }}>
      <span style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${T.greenDk}`, background: isDone ? T.greenDk : "transparent", boxSizing: "border-box",
        color: T.white, fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{isDone ? "✓" : ""}</span>
    </button>;
}
