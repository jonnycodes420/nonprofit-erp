// server/home/portfolioCard.js · ACCESS-3. "YOUR PORTFOLIO", HOME'S RAIL FOR
// SOMEONE WHO SEES ONLY THEIR OWN PEOPLE.
//
// A Campaign cabinet member's rail held one line ("Today: 1 person with a next
// step") in a column that was otherwise blank. Their rail is now one card
// about the people assigned to them, and every figure on it is the same
// number the rest of Steward shows, read through their scope only
// (server/auth/portfolio.js visibleSql):
//
//   people     shared/numbers/everyone.js everyoneCount, the Donors list's
//              "Everyone" for them
//   given      shared/numbers/givingBetween.js over the fiscal year to date
//              (fiscalYear.fiscalYearToDate), their people only
//   overdue    shared/numbers/nextSteps.js, people with a next step overdue
//   top        givingBetweenByPerson, their five who gave the most this year
//   next       the next three open touches, tasks or follow-ups on their Top
//              100 rows, soonest first, with their dates
//
//   GET /home/portfolio   (declared "scoped" in portfolioRoutes.js)
//
// Someone who sees everyone gets { scoped: false } and no figures: for them
// this card would be the whole org under the word "Your", which it is not.
// An empty portfolio says so in a sentence; it is never a row of zeros.
"use strict";
const N = require("../../shared/numbers");
const PF = require("../auth/portfolio");

const SENTENCES = {
  people: "The people assigned to you: you own them, or the main person of their household. The same count as Everyone on your Donors list.",
  given: "Money given this fiscal year to date by your people, refunds taken off. Soft credits are not counted.",
  overdue: N.nextSteps.SENTENCE,
  top: "Your five people who gave the most this fiscal year to date.",
  next: "The next open touches, tasks and follow-ups on your people on the Top 100, soonest first.",
};
const EMPTY = "No one is assigned to you yet. Ask your admin to assign donors.";

async function portfolioCard(query, req, atInstant = new Date()) {
  if (!PF.isScoped(req.user)) return { scoped: false };
  const orgId = req.user.orgId;
  const visible = PF.visibleSql(req, "d");
  const visibleBare = PF.visibleSql(req, "donors");
  const people = await N.everyone.everyoneCount(query, orgId, visibleBare);
  if (!people) return { scoped: true, empty: true, sentence: EMPTY };
  const [org] = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
  const fy = N.fiscalYear.fiscalYearToDate(org || {}, 0, atInstant);
  const given = await N.givingBetween.givingBetween(query, orgId, { from: fy.from, to: fy.to, today: fy.today, visible });
  const overdue = await N.nextSteps.peopleWithStepOverdue(query, orgId, fy.today, visible);
  const top = await N.givingBetween.givingBetweenByPerson(query, orgId, { from: fy.from, to: fy.to, today: fy.today, visible, limit: 5 });
  return {
    scoped: true, empty: false, today: fy.today,
    year: { from: fy.from, to: fy.to, label: fy.label },
    people, givenCents: given.cents, overdue, top,
    next: await nextOnTop100(query, orgId, visible, fy.today),
    onTop100: await onTop100(query, orgId, visible),
    sentences: SENTENCES,
  };
}

// Their people on the org's Top 100 (portfolio_members), live only.
const TOP100_PEOPLE = vsql => `SELECT d.id FROM portfolio_members m
    JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id
   WHERE m.org_id = ? AND ${N.everyone.EVERYONE("d")}${vsql}`;

async function onTop100(query, orgId, visible) {
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM (${TOP100_PEOPLE(visible.sql)}) x`, [orgId, ...visible.args]);
  return r ? Number(r.n) : 0;
}

// The next three: open tasks (a planned touch is a task with a care plan) and
// open follow-ups on their Top 100 people, soonest first, undated last. A
// follow-up's next step is mirrored as a task (link_kind 'next_step'), so a
// follow-up is read only when it has no open mirror: one step, one line.
async function nextOnTop100(query, orgId, visible, today) {
  const rows = await query(
    `SELECT * FROM (
       SELECT k.id, 'task' AS kind, k.donor_id, d.name, k.title AS label, k.touch_type, LEFT(COALESCE(k.due, ''), 10) AS due
         FROM tasks k JOIN donors d ON d.id = k.donor_id AND d.org_id = k.org_id
        WHERE k.org_id = ? AND COALESCE(k.done, 0) = 0 AND k.voided_at IS NULL AND k.donor_id IN (${TOP100_PEOPLE(visible.sql)})
       UNION ALL
       SELECT t.id, 'step' AS kind, t.donor_id, d.name, t.next_step_label AS label, NULL AS touch_type, LEFT(COALESCE(t.due_date::text, ''), 10) AS due
         FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
        WHERE t.org_id = ? AND t.closed_at IS NULL AND t.donor_id IN (${TOP100_PEOPLE(visible.sql)})
          AND NOT EXISTS (SELECT 1 FROM tasks k2 WHERE k2.org_id = t.org_id AND k2.thread_id = t.id AND k2.link_kind = 'next_step'
                           AND COALESCE(k2.done, 0) = 0 AND k2.voided_at IS NULL)
     ) x ORDER BY (x.due = '') ASC, x.due ASC, x.id LIMIT 3`,
    [orgId, orgId, ...visible.args, orgId, orgId, ...visible.args]);
  return rows.map(r => ({ id: r.id, kind: r.kind, donorId: r.donor_id, name: r.name, label: r.label || "Next step",
    due: r.due || null, overdue: !!(r.due && r.due < today) }));
}

function mount(ctx, app) {
  const { query, requireAuth, wrap } = ctx;
  app.get("/home/portfolio", requireAuth, wrap(async (req, res) => {
    res.json(await portfolioCard(query, req));
  }));
}

module.exports = { mount, portfolioCard, SENTENCES, EMPTY };
