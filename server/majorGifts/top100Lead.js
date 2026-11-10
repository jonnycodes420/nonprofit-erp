// server/majorGifts/top100Lead.js · TOP100-1. TOP 100 TOUCHES COME FIRST.
//
// On Home's list (composeThreads) and in the morning email, a planned touch
// for someone on the Top 100 that is due today or overdue comes first, marked
// with the person's rank: "#3 Hollis Brandt: visit, due Thu". The order among
// them is her rank. Everything else keeps the order it had.
"use strict";

let _shape = null;
const shapeMod = async () => _shape || (_shape = await import("../../shared/careShape.js"));

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "today", "Thu" within the last or next six days, else "Nov 5".
function dayWords(day, today) {
  if (day === today) return "today";
  const [y, m, d] = String(day).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const [ty, tm, td] = String(today).split("-").map(Number);
  const gap = Math.round((t - Date.UTC(ty, tm - 1, td)) / 86400000);
  return Math.abs(gap) <= 6 ? DOW[t.getUTCDay()] : `${MON[m - 1]} ${d}`;
}

// The Top 100 ranks and the care touches among `taskIds`, in two reads.
async function facts(query, orgId, donorIds, taskIds) {
  const ranks = new Map(), touches = new Map();
  if (!donorIds.length) return { ranks, touches };
  for (const r of await query(
    `SELECT m.donor_id, m.rank FROM portfolio_members m JOIN portfolio_lists l ON l.id = m.list_id AND l.org_id = m.org_id
      WHERE m.org_id = ? AND m.donor_id = ANY(?::text[])`, [orgId, donorIds]).catch(() => []))
    ranks.set(r.donor_id, r.rank);
  if (ranks.size && taskIds.length)
    for (const t of await query(
      `SELECT id, donor_id, touch_type, due FROM tasks WHERE org_id = ? AND id = ANY(?::text[]) AND care_plan_id IS NOT NULL AND done = 0 AND voided_at IS NULL`,
      [orgId, taskIds]).catch(() => []))
      touches.set(t.id, { type: t.touch_type, due: String(t.due || "").slice(0, 10), donorId: t.donor_id });
  return { ranks, touches };
}

// Home's rows (composeThreads, before the ranking): each row is one person,
// its head step plus `moreSteps`.
async function annotate(query, orgId, rows, today) {
  const S = await shapeMod();
  const donorIds = [...new Set(rows.map(r => r.donorId).filter(Boolean))];
  const taskIds = [];
  for (const r of rows) {
    if (r.kind === "task") taskIds.push(r.id);
    for (const m of r.moreSteps || []) if (m.kind === "task") taskIds.push(m.id);
  }
  const { ranks, touches } = await facts(query, orgId, donorIds, taskIds);
  if (!ranks.size) return rows;
  return rows.map(r => {
    const rank = ranks.get(r.donorId);
    if (!rank) return r;
    const steps = [r.kind === "task" ? r.id : null, ...(r.moreSteps || []).filter(m => m.kind === "task").map(m => m.id)].filter(Boolean);
    const due = steps.map(id => touches.get(id) ? { id, ...touches.get(id) } : null)
      .filter(t => t && S.isDay(t.due) && t.due <= today).sort((a, b) => a.due.localeCompare(b.due))[0] || null;
    return { ...r, top100Rank: rank, top100Lead: !!due,
      top100Touch: due ? { taskId: due.id, type: due.type, label: S.touchLabel(due.type), due: due.due,
        line: S.touchLine({ rank, name: r.donorName, type: due.type, due: due.due }, d => dayWords(d, today)) } : null };
  });
}

// The morning email's tasks ({ rows, overdue, dueToday, count }): the Top 100
// touches first, by rank, each titled with the rank, then the rest as before.
async function leadTasks(query, orgId, tasks, today) {
  const all = [...(tasks.dueToday || []), ...(tasks.overdue || [])];
  if (!all.length) return tasks;
  const S = await shapeMod();
  const { ranks, touches } = await facts(query, orgId, [...new Set(all.map(t => t.donor_id).filter(Boolean))], all.map(t => t.id));
  const lead = all.filter(t => touches.has(t.id) && ranks.has(t.donor_id))
    .sort((a, b) => ranks.get(a.donor_id) - ranks.get(b.donor_id) || String(a.due).localeCompare(String(b.due)))
    .map(t => ({ ...t, top100Rank: ranks.get(t.donor_id),
      title: S.touchLine({ rank: ranks.get(t.donor_id), name: t.donor_name || "", type: t.touch_type, due: String(t.due).slice(0, 10) }, d => dayWords(d, today)) }));
  const ids = new Set(lead.map(t => t.id));
  return { ...tasks, top100: lead, ordered: [...lead, ...all.filter(t => !ids.has(t.id))] };
}

module.exports = { annotate, leadTasks, dayWords };
