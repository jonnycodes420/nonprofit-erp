// TIDY-1 · ONE BUILDER FOR THE MORNING EMAIL: THE SEND, THE PREVIEW, THE TEST.
//
// What one person's morning email carries (composeFor) and what it says
// (renderFor) were inline in runMorningBriefForOrg (server/boot/helpers-5.js).
// They live here so Settings' "Preview today's email" and "Send me a test"
// render exactly what the morning tick would send, from the same calls.
// The tick still reserves its ledgers and drops a section already sent today;
// the preview and the test reserve nothing.
//
// The server's shared names (composeThreadNudgeQueue, renderMorningBriefBody,
// …) are read from the boot registry at call time.
"use strict";

const S = () => require("../boot/share").ctx;

const ORG_COLS = "id, name, legal_name, timezone, receipt_address, thread_nudge_weekends";
const USER_COLS = "id, name, email, role, notify_thread_nudge, brief_sections, brief_hour, brief_days";

// The team roll-up an ADMIN gets beneath their own list: counts per person,
// never everyone's rows. FLOWS-7: TASKS, by Tasks' own rule
// (shared/numbers/taskDue.js), so "Dana · 17 open · 8 overdue" is what Tasks
// says for Dana. It counted conversation threads before, under the same words.
async function teamRollup(orgId, today) {
  const teamRows = await require("../../shared/numbers/taskDue").teamCounts(S().query, orgId, today);
  return { teamRows, multiOfficer: teamRows.filter(r => r.user_id).length >= 2 };
}

// What goes in person `u`'s email today, by their own sections. Compose FIRST,
// apply the preference SECOND: "a clear morning" and "turned the section off
// and missing three overdue steps" are different facts (`suppressed`).
async function composeFor(org, u, today, team) {
  const c = S();
  const b = c.briefSettings(u);
  const keepTimed = !(await c.userWantsEmail(u.id, "step_reminder"));
  const tqAll = await c.composeThreadNudgeQueue(org.id, today, { userId: u.id, isAdmin: u.role === "admin", keepTimed });
  const taskAll = await require("../majorGifts/top100Lead").leadTasks(S().query, org.id, await c.composeDailyTaskReminder(org.id, u.id, today, { isAdmin: u.role === "admin" }), today);   // TOP100-1: Top 100 touches first
  const suppressed = (!b.sections.steps && tqAll.list.length > 0) || (!b.sections.tasks && taskAll.count > 0);
  const tq = b.sections.steps ? tqAll : { list: [], more: 0, total: 0 };
  const tasks = b.sections.tasks ? taskAll : { rows: [], overdue: [], dueToday: [], count: 0 };
  // FIX-34 · today's meetings, their own section (STAFF-MAIL-1).
  let meetings = [];
  if (b.sections.meetings) {
    try { meetings = (await require("../../routes/finance").composeTodayMeetings(org.id, u.id, { withLogged: true })).meetings || []; }
    catch (e) { console.error("[morning-brief] meetings:", e.message); }
  }
  // LIVE-1 · yesterday's readouts (Friday's and the weekend's on a Monday).
  const readouts = b.sections.readouts ? await c.yesterdaysReadouts(org.id, today) : [];
  // ACCESS-2: someone who sees only their own people gets only their people:
  // the items about anyone else come out, and the org-wide readouts with them.
  const own = await require("../auth/portfolioMail").forPortfolio(org.id, u, { threads: tq.list, tasks, meetings, readouts });
  const empty = own.threads.length === 0 && own.tasks.count === 0 && own.meetings.length === 0 && own.readouts.length === 0;
  return { b, suppressed, empty, threads: own.threads, more: own.scoped ? 0 : tq.more, tasks: own.tasks, meetings: own.meetings, readouts: own.readouts,
           team: u.role === "admin" && team && team.multiOfficer && b.sections.team ? team.teamRows : null };
}

// The subject and body for parts `p` (composeFor's, or the tick's after it
// dropped a section already sent).
function renderFor(org, u, today, p) {
  const c = S();
  return {
    subject: c.morningBriefSubject(p.threads, p.tasks.count, org, p.meetings.length, p.readouts.length),
    body: c.renderMorningBriefBody({ threads: p.threads, more: p.more, tasks: p.tasks, org, user: u, today,
                                     meetings: p.meetings, readouts: p.readouts, team: p.team }),
  };
}

// The items an email carries, as the "Last sent" line counts them.
const itemCount = p => p.threads.length + p.tasks.count + p.meetings.length + p.readouts.length;

module.exports = { ORG_COLS, USER_COLS, teamRollup, composeFor, renderFor, itemCount };
