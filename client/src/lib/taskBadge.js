// COUNTS-1 · THE TASKS BADGE IS THE SERVER'S COUNT OF THE LIST IT OPENS.
//
// The rail's Tasks badge was worked out in the browser from a copy of the
// task list taken when the app loaded (data.tasks), refreshed only when the
// Tasks page itself loaded, with its own date sums in UTC. On a demo org the
// Tasks page said Today 1, Overdue 12 (30 open) while the badge said 13, and
// a task added anywhere else did not move it.
//
// Now the badge is GET /tasks/counts?scope=mine, the same rule and the same
// rows the Tasks page's tabs count: her own open tasks due today or overdue
// (today + overdue). It says so in its tooltip, and the Tasks page shows the
// same number ("13 due today or overdue"). It re-reads after every write the
// app makes (api.js onWrite), and when Tell Steward changes something.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useChanged } from "./changes";   // STALE-1: the one channel; told() is in it

export const TASK_BADGE_READ = "/tasks/counts?scope=mine";
export const dueNowOf = c => (c && !c.failed ? (Number(c.today) || 0) + (Number(c.overdue) || 0) : 0);
export const dueNowWords = c => {
  const n = dueNowOf(c);
  return `${n} ${n === 1 ? "task" : "tasks"} due today or overdue (Today ${Number(c && c.today) || 0}, Overdue ${Number(c && c.overdue) || 0})`;
};

// FEEL-1: Home's "follow-ups" is a different list, and the badge says how, so
// 13 on Home beside 14 here is never read as one number disagreeing.
// SENDS-1 (W-1107-Volunteers-14): both labels say exactly what they count, and each names the other.
export const BADGE_VS_FOLLOWUPS = "Home's follow-ups count something else: Home's \"people to follow up\" is each person with a next step planned, whenever it is due. This counts your tasks due today or overdue, with or without a person.";
export const badgeTitle = c => `${dueNowWords(c)}. ${BADGE_VS_FOLLOWUPS}`;

export function useTaskBadge(enabled = true) {
  const [counts, setCounts] = useState(null);
  const load = useCallback(() => {
    if (!enabled) return;
    apiFetch(TASK_BADGE_READ).then(setCounts).catch(() => {});
  }, [enabled]);
  useEffect(() => { load(); }, [load]);
  // STALE-1: a change that touches tasks (a write, Tell Steward, Atlas, the
  // worker), and no other: a gift no longer re-reads the badge.
  useChanged(["task"], () => load(), null, 150);
  return { n: dueNowOf(counts), counts, title: counts ? badgeTitle(counts) : "" };
}
