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
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, onWrite } from "../api";
import { useStewardTold } from "./stewardTold";

export const TASK_BADGE_READ = "/tasks/counts?scope=mine";
export const dueNowOf = c => (c && !c.failed ? (Number(c.today) || 0) + (Number(c.overdue) || 0) : 0);
export const dueNowWords = c => {
  const n = dueNowOf(c);
  return `${n} ${n === 1 ? "task" : "tasks"} due today or overdue (Today ${Number(c && c.today) || 0}, Overdue ${Number(c && c.overdue) || 0})`;
};

export function useTaskBadge(enabled = true) {
  const [counts, setCounts] = useState(null);
  const timer = useRef(null);
  const load = useCallback(() => {
    if (!enabled) return;
    apiFetch(TASK_BADGE_READ).then(setCounts).catch(() => {});
  }, [enabled]);
  // A write tells this before it leaves and again when it lands; the read
  // that counts is the one after it lands.
  const soon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, 150);
  }, [load]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const off = onWrite(w => { if (!w || w.phase !== "before") soon(); });
    return () => { off(); if (timer.current) clearTimeout(timer.current); };
  }, [soon]);
  useStewardTold(() => soon());
  return { n: dueNowOf(counts), counts, title: counts ? dueNowWords(counts) : "" };
}
