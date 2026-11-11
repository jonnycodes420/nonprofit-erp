// lib/taskRow.js · FLOWS-6 (W-1110-Donors-23X). A TASK ROW SAYS ITS STATE ONCE.
//
// The profile's Tasks tab drew every task with a ticked box, open ones too, and
// a task done early sat on its due day, in the future, reading "Done." Now an
// open task is an empty box with its due day, and a done one is a check with
// the day it was done, and sits on that day. The due day is never read as the
// day it was done (TOUCH-1's "done early" keeps the due day on the row).
import { civilDayOf } from "./orgToday";
import { displayDateShort } from "../../../shared/displayDate.js";

export function taskRowOf(t, today) {
  const done = Number(t.done) === 1 || t.done === true;
  const due = String(t.due || "").slice(0, 10);
  // A step closed through its thread has no completed_at; the sync trigger
  // stamps updated_at when it goes Done (server/db/ddl/part7.js), so that day.
  const doneAt = done ? (t.completed_at || t.updated_at || null) : null;
  const doneOn = doneAt ? civilDayOf(new Date(doneAt)) : null;
  return {
    done,
    state: done ? "done" : "open",
    // where the row sits on the timeline: the day it was done, else its due day
    date: (done ? doneOn || String(t.created_at || "").slice(0, 10) : due || String(t.created_at || "").slice(0, 10)) || "",
    doneWords: done ? (doneOn ? `Done ${displayDateShort(doneOn, today)}.` : "Done.") : null,
  };
}
