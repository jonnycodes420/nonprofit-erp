// client/src/components/profile/ProfileTaskSheet.jsx · EDIT-1. A TASK ON A PROFILE OPENS TO EDIT.
//
// Coming up, the timeline (Activity) and the profile's Tasks tab draw a task's title as a button;
// a click (or Enter) asks GET /tasks/:id for the row the Tasks page reads and opens the Tasks
// page's own sheet (components/tasks/TaskSheet.jsx): the same fields, the same Save, the same
// PATCH. Nothing here re-reads by hand: api.js announces the write on the one channel
// (lib/changes.js) and the profile's lists re-read (lib/profileRefresh.js), so the edit shows
// with no reload. Mark done and Reopen go through the one complete call (lib/completeTask.js).
import { useCallback, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { completeTask, completeCall } from "../../lib/completeTask";
import { TaskSheet } from "../tasks/TaskSheet";

// The title of a task on a profile, as the button that opens it.
const TITLE_BTN = { background: "none", border: "none", padding: 0, margin: 0, textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", minHeight: 24 };
export function TaskTitleButton({ task, onOpen, testid, style = null, children }) {
  return <button type="button" data-testid={testid} data-task-open={task.id} aria-label={`Open task: ${task.title || "a task"}`}
    onClick={e => { e.stopPropagation(); onOpen(task); }} onKeyDown={e => e.stopPropagation()}
    style={{ ...TITLE_BTN, ...(style || {}) }}>{children}</button>;
}

// { open(task), ui } — `ui` is the sheet (when one is open) and anything the server said.
export function useProfileTaskSheet({ isReadOnly = false, onTaskOutcome = null } = {}) {
  const [row, setRow] = useState(null);
  const [team, setTeam] = useState(null);
  const [said, setSaid] = useState("");
  const say = e => setSaid((e && e.sentence) || errorMessage(e, "That did not save."));
  const open = useCallback(async task => {
    if (!task || !task.id) return;
    setSaid("");
    if (team == null) apiFetch("/org/team").then(r => setTeam(Array.isArray(r) ? r : [])).catch(() => setTeam([]));
    try { const r = await apiFetch(`/tasks/${encodeURIComponent(task.id)}`); if (r && r.id) setRow(r); }
    catch (e) { setSaid(errorMessage(e, "That task could not be opened just now.")); }
  }, [team]);
  const onFinish = async t => {
    setRow(null);
    try { const r = await completeTask(t); if (r.needsOutcome) { if (r.sentence) setSaid(r.sentence); if (onTaskOutcome) onTaskOutcome(t); } }
    catch (e) { say(e); }
  };
  const onReopen = async t => { setRow(null); try { await completeCall(t.id, false); } catch (e) { say(e); } };
  const ui = <>
    {said && <div role="alert" data-testid="dp-task-sheet-said" style={{ fontSize: 13, color: T.ink }}>{said}</div>}
    {row && <TaskSheet key={row.id} t={row} team={team || []} isReadOnly={isReadOnly} onClose={() => setRow(null)}
      onChanged={async () => {}} onError={say} onFinish={onFinish} onReopen={onReopen}/>}
  </>;
  return { open, ui };
}
