// server/admin/sales/today.js · SALES-1. TODAY, AT THE TOP OF THE SALES TAB.
//
// buildToday(input, now, tz) is pure; loadToday reads its input in a fixed
// number of statements. Six lines, each row opening its record:
//   due        open tasks and deal next steps due today or overdue (overdue first, in brass)
//   trials     trials and betas ending in the next 14 days
//   quiet      linked Steward orgs with no sign-in for 7 days
//   noNext     open deals with no next step AND no open task (brass on the board too)
//   meetings   this week's meetings (Monday to Sunday, Jonathan's own days)
//   stuck      open deals in one stage longer than that stage's limit (default 21 days)
//   revisit    deals parked in Later whose revisit day has come
//
// THE PLANTED DEFECT (SALES1_PLANT=notask on the server): noNext ignores open
// tasks, so a deal with an open task still lands there. §12 goes red.
"use strict";
const LINK = require("./stewardLink");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES1_PLANT || "" : "";
const DAY = 86400000;
const TRIAL_DAYS = 14, QUIET_DAYS = 7;

// The civil day ("2026-11-11") of an instant in a time zone.
const civil = (t, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = d => new Date(`${d}T12:00:00Z`).getUTCDay();   // 0 Sunday
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

// input: { tasks, deals, meetings, links: [{ salesOrgId, salesOrgName, stewardOrgId }], facts: { [stewardOrgId]: facts } }
function buildToday(input, now, tz = "America/New_York") {
  const today = civil(now, tz);
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const sunday = addDays(monday, 6);
  const open = (input.deals || []).filter(d => d.stage_kind === "open");

  const due = [
    ...(input.tasks || []).filter(t => t.due_on && t.due_on <= today && !t.done_at)
      .map(t => ({ kind: "task", id: t.id, says: t.body, on: t.due_on, overdue: t.due_on < today, open: t.records[0] || null, records: t.records })),
    ...open.filter(d => d.next_step_on && d.next_step_on <= today)
      .map(d => ({ kind: "next_step", id: d.id, says: d.next_step || "Next step", on: d.next_step_on, overdue: d.next_step_on < today, open: { type: "deal", id: d.id, name: d.displayName } })),
  ].sort((a, b) => (b.overdue - a.overdue) || a.on.localeCompare(b.on));

  const trialEnd = addDays(today, TRIAL_DAYS);
  const trials = [];
  for (const d of open) if (d.trial_ends_on && d.trial_ends_on >= today && d.trial_ends_on <= trialEnd) trials.push({ on: d.trial_ends_on, says: `${d.displayName}'s trial or beta ends`, open: { type: "deal", id: d.id, name: d.displayName } });
  const quiet = [];
  for (const l of input.links || []) {
    const f = (input.facts || {})[l.stewardOrgId];
    if (!f) continue;
    if (f.trialEndsOn && f.trialEndsOn >= today && f.trialEndsOn <= trialEnd && !trials.some(t => t.open.type === "org" && t.open.id === l.salesOrgId))
      trials.push({ on: f.trialEndsOn, says: `${l.salesOrgName}'s Steward trial ends`, open: { type: "org", id: l.salesOrgId, name: l.salesOrgName } });
    const lastDay = f.lastSignInAt ? civil(f.lastSignInAt, tz) : null;
    if (!lastDay || daysBetween(lastDay, today) >= QUIET_DAYS)
      quiet.push({ on: lastDay, days: lastDay ? daysBetween(lastDay, today) : null, says: lastDay ? `${l.salesOrgName}: no sign-in for ${daysBetween(lastDay, today)} days` : `${l.salesOrgName}: no one has signed in yet`, open: { type: "org", id: l.salesOrgId, name: l.salesOrgName } });
  }
  trials.sort((a, b) => a.on.localeCompare(b.on));
  quiet.sort((a, b) => (b.days == null) - (a.days == null) || (b.days || 0) - (a.days || 0));

  const noNext = open.filter(d => !String(d.next_step || "").trim() && (PLANT === "notask" || !d.has_open_task))
    .map(d => ({ says: `${d.displayName} has no next step and no open task`, open: { type: "deal", id: d.id, name: d.displayName } }));

  const meetings = (input.meetings || []).filter(m => { const d = civil(m.at, tz); return d >= monday && d <= sunday; })
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map(m => ({ at: new Date(m.at).toISOString(), on: civil(m.at, tz), says: m.body, open: m.records[0] || null, records: m.records }));

  const stuck = [];
  for (const d of open) {
    if (!d.stage_entered_at) continue;
    const days = daysBetween(civil(d.stage_entered_at, tz), today);
    const limit = Number(d.limit_days || 21);
    if (days > limit) stuck.push({ days, limit, says: `${d.displayName}: ${days} days in ${d.stage_name} (limit ${limit})`, open: { type: "deal", id: d.id, name: d.displayName } });
  }
  stuck.sort((a, b) => (b.days - b.limit) - (a.days - a.limit));

  const revisit = (input.deals || []).filter(d => d.stage_kind === "later" && d.revisit_on && d.revisit_on <= today)
    .sort((a, b) => a.revisit_on.localeCompare(b.revisit_on))
    .map(d => ({ on: d.revisit_on, overdue: d.revisit_on < today, says: `Revisit ${d.displayName}`, open: { type: "deal", id: d.id, name: d.displayName } }));

  return {
    today, week: { from: monday, to: sunday },
    lines: { due, revisit, trials, quiet, noNext, meetings, stuck },
    sentences: {
      due: "Open tasks and deals' next steps due today or earlier. Overdue first.",
      trials: `Trials and betas ending in the next ${TRIAL_DAYS} days: a deal's own end date, or its linked Steward org's trial.`,
      quiet: `Linked Steward orgs where no one has signed in for ${QUIET_DAYS} days or more.`,
      noNext: "Open deals with no next step written and no open task.",
      meetings: "Meetings logged for this week, Monday to Sunday.",
      stuck: "Open deals that have sat in one stage longer than that stage's limit.",
      revisit: "Deals parked in Later whose revisit date is today or earlier.",
    },
  };
}

// The input, read once. `rows` are the deal list's own rows (lists.rowsFor), so
// Today and the board read the same has_open_task and the same stage.
async function loadToday(query, dealRows, stages, now = Date.now()) {
  const [tasks, meetings, links] = await Promise.all([
    query(`SELECT a.id, a.body, a.due_on::text AS due_on, a.done_at FROM sales_activities a WHERE a.kind = 'task' AND a.done_at IS NULL AND a.deleted_at IS NULL AND a.due_on IS NOT NULL`),
    query(`SELECT a.id, a.body, a.at FROM sales_activities a WHERE a.kind = 'meeting' AND a.deleted_at IS NULL AND a.at > ? AND a.at < ?`,
      [new Date(now - 8 * DAY).toISOString(), new Date(now + 8 * DAY).toISOString()]),
    query(`SELECT id AS "salesOrgId", name AS "salesOrgName", steward_org_id AS "stewardOrgId" FROM sales_orgs WHERE deleted_at IS NULL AND steward_org_id IS NOT NULL`),
  ]);
  const ACT = require("./activities");
  const [tasksR, meetingsR, facts] = await Promise.all([ACT.withRecords(query, tasks), ACT.withRecords(query, meetings), LINK.facts(query, links.map(l => l.stewardOrgId))]);
  const limit = new Map([...stages.values()].map(s => [s.id, s.limit_days]));
  const deals = dealRows.map(d => ({ ...d, limit_days: limit.get(d.stage_id) }));
  return { tasks: tasksR, meetings: meetingsR, deals, links, facts };
}

module.exports = { buildToday, loadToday, civil, addDays, TRIAL_DAYS, QUIET_DAYS };
