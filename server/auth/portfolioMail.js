// server/auth/portfolioMail.js · ACCESS-2. THE MORNING EMAIL OF SOMEONE WHO
// SEES ONLY THEIR OWN PEOPLE.
//
// The morning tick and Settings' preview both build the email with
// server/mail/morningBrief.js composeFor. For a portfolio user, every item
// that names a person outside their portfolio comes out here, and the
// org-wide readouts (yesterday's gifts across the org) are left off. The
// predicate is portfolio.js's, the one every screen uses.
"use strict";
const PF = require("./portfolio");

const personOf = x => x && (x.donor_id || x.donorId || (x.donor && x.donor.id) || null);

async function forPortfolio(orgId, u, parts) {
  const access = await PF.accessFor(u.id, orgId);
  const role = await require("./access").liveRoleIn(u.id, orgId);
  const user = { userId: u.id, orgId, role, portfolio: access };
  if (!PF.isScoped(user)) return { ...parts, scoped: false };
  // Every list the tasks part carries (rows, overdue, due today, the Top 100's
  // lead and its order), so a list added there later is filtered too.
  const taskLists = Object.keys(parts.tasks).filter(k => Array.isArray(parts.tasks[k]));
  const all = [...parts.threads, ...taskLists.flatMap(k => parts.tasks[k]), ...parts.meetings];
  const hidden = new Set(await PF.hiddenOf(user, orgId, all.map(personOf).filter(Boolean)));
  const keep = list => (list || []).filter(x => !hidden.has(personOf(x)));
  const tasks = { ...parts.tasks };
  for (const k of taskLists) tasks[k] = keep(parts.tasks[k]);
  return {
    scoped: true,
    threads: keep(parts.threads),
    tasks: { ...tasks, count: (tasks.rows || []).length },
    meetings: keep(parts.meetings),
    readouts: [],
  };
}

module.exports = { forPortfolio };
