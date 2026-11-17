// server/admin/sales/scanRows.js · SALES-4 item 3. A LIST YOU CAN SCAN.
//
// Every list shows, by default: name, organization, fit, last touch, next step, and nothing else.
// lists.rowsFor calls add() once per read; it adds, in a fixed number of statements:
//   last_touch       when the newest call, meeting, note, drafted or captured email was (touch.js)
//   last_touch_kind  what it was ("Interested", "Email", "Meeting")
//   next_up          a deal's next step, else the earliest open task on the record (next_up_on: its day)
//   fit_line         a contact's or a deal's organization's fit ("Fits 4 of 5"), the org's own on an org
"use strict";
const T = require("./touch");

const day = t => (t ? String(t).slice(0, 10) : null);

async function add(query, type, rows) {
  if (!rows.length) return rows;
  const [touches, tasks] = await Promise.all([
    T.lastTouches(query),
    query(`SELECT DISTINCT ON (l.record_type, l.record_id) l.record_type, l.record_id, a.body, a.due_on::text AS due_on
             FROM sales_activity_links l JOIN sales_activities a ON a.id = l.activity_id
            WHERE a.kind = 'task' AND a.done_at IS NULL AND a.deleted_at IS NULL AND l.record_type = ?
            ORDER BY l.record_type, l.record_id, a.due_on NULLS LAST, a.at`, [type]),
  ]);
  const task = new Map(tasks.map(t => [t.record_id, t]));
  let orgFit = null;
  if (type !== "org") {
    const orgs = await require("./lists").rowsFor(query, "org", { scan: false });
    orgFit = new Map(orgs.map(o => [o.id, o.fit_line]));
  }
  for (const r of rows) {
    const t = type === "deal" ? T.newest(touches, [`deal:${r.id}`, ...(r.linked_org_ids || []).map(id => `org:${id}`)]) : touches.get(`${type}:${r.id}`);
    const cell = T.cellOf(t);
    r.last_touch = cell ? cell.at : null;
    r.last_touch_kind = cell ? cell.kind : null;
    const own = type === "deal" && String(r.next_step || "").trim() ? { body: r.next_step, due_on: day(r.next_step_on) } : task.get(r.id) || null;
    r.next_up = own ? own.body : null;
    r.next_up_on = own ? own.due_on || null : null;
    if (orgFit) r.fit_line = r.org_id ? orgFit.get(r.org_id) || null : null;
  }
  return rows;
}

module.exports = { add };
