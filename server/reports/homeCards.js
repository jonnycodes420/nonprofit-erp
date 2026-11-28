// server/reports/homeCards.js · HOME-7 items 2 to 5. WHAT HOME'S PANEL, CARDS AND RAIL READ.
//
//   GET /home/cards   one read, in Home's rail bundle (client/src/lib/homeReads.js RAIL_READS), so
//                     the rail draws once and starts nothing after Home's first paint (HOME-4):
//
//   thankYous    the gifts waiting to be thanked (shared/numbers/thankBacklog.js, the one rule the
//                rail card, the Thank-yous tab and Reports read), oldest first, and the oldest's age
//   recentGifts  every gift dated in the last 7 days (figureSources `gifts`, the Giving report's
//                source), newest first, each Thanked, Receipted or To thank
//   major        only when the org has Major Gifts turned on (NAV-2, orgs.nav_layout): the Major
//                Gifts page's own figures (GET /major-gifts/dashboard), the assigned people at each
//                `donors.stage` (figureSources `pipeline-stage`'s rule), and the three whose next
//                step is soonest or most overdue
//   yearEnd      given since Nov 1, every fund (givingBetween), against last year by the same date;
//                a goal bar only when a running goal is named for year-end
//   retention    computeRetentionRate, this fiscal year and last (the Retention report's number)
//   connections  each connected app's badge (HONEST-3, server/connections/checks.js badgeOf) and its
//                last real activity
//   today        today's meetings on her calendar, each with what the person gave this fiscal year
//
// Read only. Nothing here writes, and nothing sends.
"use strict";
const TB = require("../../shared/numbers/thankBacklog");
const GB = require("../../shared/numbers/givingBetween");
const FY = require("../../shared/numbers/fiscalYear");
const { AWAITING } = require("../../shared/numbers/thanks");

const money = cents => "$" + Math.round((Number(cents) || 0) / 100).toLocaleString("en-US");
const DAY = 86400000;
const civil = s => String(s || "").slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.UTC(...b.split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0))) - Date.UTC(...a.split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0)))) / DAY);
const addDays = (d, n) => new Date(Date.UTC(...d.split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0))) + n * DAY).toISOString().slice(0, 10);
const STAGES = ["prospect", "qualify", "cultivate", "solicit", "steward", "lapsed"];

// Major Gifts is on for an org when its sidebar names it visible (NAV-2: off until the org adds it).
const majorOn = saved => {
  let layout = saved;
  if (typeof layout === "string") { try { layout = JSON.parse(layout); } catch { layout = null; } }
  return Array.isArray(layout) && layout.some(r => r && r.id === "majorgifts" && r.visible !== false);
};

// Year-end so far: since the latest Nov 1, to today (or Dec 31, once the season has passed).
function yearEndSpan(today) {
  const y = Number(today.slice(0, 4)), inSeason = today.slice(5) >= "11-01";
  const from = `${inSeason ? y : y - 1}-11-01`, to = inSeason ? today : `${y - 1}-12-31`;
  const ly = n => `${Number(n.slice(0, 4)) - 1}${n.slice(4)}`;
  return { from, to, lastFrom: ly(from), lastTo: ly(to), inSeason, daysLeft: inSeason ? daysBetween(today, `${y}-12-31`) : 0 };
}

async function thankYous(query, orgId, today) {
  const since = await require("../../routes/crm").reportHooks.thanksSince(orgId);
  const [all, { rows }] = await Promise.all([TB.backlog(query, orgId, since), TB.waitingOlderThan(query, orgId, since, today)]);
  const oldest = rows[0] ? civil(rows[0].date) : null;
  const oldestDays = oldest ? Math.max(0, daysBetween(oldest, today)) : null;
  return {
    n: all.n, cents: all.cents, drafted: all.drafted, since, oldest, oldestDays,
    source: { key: "unthanked", params: { since } }, definition: TB.SENTENCE,
    sentence: all.n ? `Gifts since ${require("../../orgTime").formatCivil(since)} with no thank-you yet. The oldest is ${oldestDays === 0 ? "from today" : oldestDays === 1 ? "1 day" : `${oldestDays} days`}${oldestDays === 0 ? "" : " old"}.` : "Every gift has its thank-you.",
    rows: rows.slice(0, 50).map(r => ({ id: r.id, donorId: r.donor_id, name: r.name, date: civil(r.date), cents: Math.round(Number(r.amount) * 100), fund: r.fund || null })),
  };
}

async function recentGifts(query, orgId, today) {
  const FS = require("../../figureSources");
  const source = { key: "gifts", params: { from: addDays(today, -6), to: today } };
  const f = await FS.figure(orgId, source, {}, { page: 1, pageSize: 50 });
  const gifts = ((f && f.rows) || []).filter(r => Number(r.amount) > 0);
  const ids = gifts.map(r => r.id);
  const st = ids.length ? await query(
    `SELECT g.id, ${AWAITING("g")} AS waiting, g.method, g.recurring_gift_id IS NOT NULL AS monthly,
            EXISTS (SELECT 1 FROM receipts r WHERE r.org_id = g.org_id AND r.gift_id = g.id) AS receipted
       FROM gifts g WHERE g.org_id = ? AND g.id = ANY(?)`, [orgId, ids]).catch(() => []) : [];
  const by = new Map(st.map(r => [r.id, r]));
  const rows = gifts.map(r => {
    const s = by.get(r.id) || {};
    return { id: r.id, donorId: r.donor_id, name: r.name, date: civil(r.date), cents: Math.round(Number(r.amount) * 100), fund: r.detail || null,
      how: s.monthly ? "Monthly" : s.method ? String(s.method).replace(/^./, c => c.toUpperCase()) : null,
      status: s.waiting === false ? "Thanked" : s.receipted ? "Receipted" : "To thank" };
  }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { n: f ? (f.totalRows != null ? f.totalRows : rows.length) : 0, gifts: rows.length, cents: f ? Math.round(Number(f.value || 0) * 100) : 0, source,
    definition: "Gifts recorded in the last 7 days, newest first.", rows };
}

async function major(req, query, orgId, today) {
  const r = await require("../../inProcess").get("/major-gifts/dashboard", { headers: req.headers, remoteAddress: req.socket && req.socket.remoteAddress });
  if (r.status !== 200) return null;
  const mg = JSON.parse(r.body);
  // The assigned people at each stage: figureSources pipeline-stage's own rule, so each count opens its rows.
  const counts = await query(`SELECT d.stage, COUNT(*)::int AS n FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.assigned_to IS NOT NULL
                                 AND d.stage = ANY(?) GROUP BY d.stage`, [orgId, STAGES.slice(0, 5)]);   // the pipeline's stages; Lapsed is not one
  const stages = STAGES.map(s => ({ stage: s, n: (counts.find(c => c.stage === s) || {}).n || 0, source: { key: "pipeline-stage", params: { stage: s } } })).filter(s => s.n > 0);
  // The three whose next step is soonest or most overdue: an open step on an assigned person with a stage.
  const next = await query(
    `SELECT t.donor_id, d.name, d.stage, t.next_step_label AS step, LEFT(t.due_date, 10) AS due,
            (SELECT SUM(o.target_amount) FROM opportunities o WHERE o.org_id = d.org_id AND o.donor_id = d.id AND o.status = 'open') AS ask
       FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND t.closed_at IS NULL AND d.deleted_at IS NULL AND d.assigned_to IS NOT NULL AND d.stage = ANY(?)
        AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)
      ORDER BY t.due_date ASC, d.name LIMIT 3`, [orgId, STAGES.slice(0, 5), today]).catch(() => []);
  const t = mg.tiles || {};
  return {
    fiscalLabel: mg.fiscalLabel || null,
    open: { cents: Math.round(Number((t.pipeline || {}).amount || 0) * 100), asks: (t.pipeline || {}).count || 0, people: (t.pipeline || {}).people ?? null, definition: (t.pipeline || {}).definition || null },
    yes: { cents: Math.round(Number((t.committedThisYear || {}).amount || 0) * 100), gifts: (t.committedThisYear || {}).count || 0, definition: (t.committedThisYear || {}).definition || null },
    stages, stagesDefinition: "Every prospect assigned to an officer, by the stage they are in today.",
    next: next.map(x => ({ donorId: x.donor_id, name: x.name, stage: x.stage, step: x.step, due: x.due, late: x.due < today ? daysBetween(x.due, today) : 0,
      askCents: x.ask != null ? Math.round(Number(x.ask) * 100) : null })),
  };
}

async function retention(deps, orgId) {
  if (!deps.computeRetentionRate) return null;
  const now = await deps.computeRetentionRate(orgId);
  const last = await deps.computeRetentionRate(orgId, { year: now.year - 1 }).catch(() => null);
  return {
    rate: now.thinData ? null : now.retentionRate, retained: now.retained, prior: now.prevYearCount, label: now.period.label, prevLabel: now.period.prevLabel,
    lastRate: last && !last.thinData ? last.retentionRate : null, thin: !!now.thinData,
    source: { key: "retention", params: {} },
    sentence: now.thinData ? null : `${now.retained.toLocaleString("en-US")} of ${now.prevYearCount.toLocaleString("en-US")} people who gave in ${now.period.prevLabel} have given in ${now.period.label}.${last && !last.thinData && last.retentionRate != null ? ` Last year: ${last.retentionRate}%.` : ""}`,
  };
}

async function yearEnd(req, query, orgId, today) {
  const s = yearEndSpan(today);
  const [now, then] = await Promise.all([GB.givingBetween(query, orgId, { from: s.from, to: s.to, today }), GB.givingBetween(query, orgId, { from: s.lastFrom, to: s.lastTo, today })]);
  let goal = null;
  try {
    const r = await require("../../inProcess").get("/home/annual-goal", { headers: req.headers, remoteAddress: req.socket && req.socket.remoteAddress });
    const g = r.status === 200 ? ((JSON.parse(r.body).running || []).find(x => /year[\s-]?end/i.test(x.name || "") && x.goalCents > 0)) : null;
    if (g) goal = { name: g.name, goalCents: g.goalCents, raisedCents: g.raisedCents, pct: Math.round(g.raisedCents / g.goalCents * 100) };
  } catch { /* no goal bar */ }
  return { ...s, cents: now.cents, lastCents: then.cents, source: { key: "gifts", params: { from: s.from, to: s.to } }, lastSource: { key: "gifts", params: { from: s.lastFrom, to: s.lastTo } },
    sentence: `Given since Nov 1, every fund. Last year by this date: ${money(then.cents)}.`, goal };
}

async function connections(deps, orgId) {
  const body = await require("../connections/honest").connectionsFor(deps, orgId);
  return (body.cards || []).filter(c => c.connected).map(c => {
    const at = c.lastSyncedAt || (c.checks && c.checks[0] && c.checks[0].at) || null;
    return { id: c.id, label: c.label, state: c.badge ? c.badge.state : null, words: c.badge ? c.badge.words : null, reason: c.badge ? c.badge.reason : null, at };
  });
}

async function todayMeetings(query, orgId, userId, org, today) {
  const rows = await query(`SELECT c.id, c.title, c.starts_at, c.person_ids FROM calendar_events c WHERE c.org_id = ? AND c.owner_user_id = ?
      AND (c.starts_at AT TIME ZONE ?)::date = ?::date ORDER BY c.starts_at`, [orgId, userId, org.timezone, today]).catch(() => []);
  const ids = [...new Set(rows.flatMap(r => r.person_ids || []))];
  const fy = FY.fiscalYearToDate(org);
  const [names, given] = ids.length ? await Promise.all([
    query(`SELECT id, name FROM donors WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NULL`, [orgId, ids]),
    GB.givingBetweenOf(query, orgId, { from: fy.from, to: fy.to, today: fy.today, donorIds: ids }),
  ]) : [[], new Map()];
  const nm = new Map(names.map(r => [r.id, r.name]));
  return rows.map(r => {
    const people = (r.person_ids || []).filter(id => nm.has(id)).map(id => ({ id, name: nm.get(id), cents: (given.get(id) || {}).cents || 0 }));
    return { id: r.id, title: r.title, startsAt: r.starts_at, people };
  }).filter(m => m.people.length || m.title);
}

function mount(app, deps) {
  const { query, wrap, requireAuth } = deps;
  app.get("/home/cards", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const [org] = await query(`SELECT nav_layout FROM orgs WHERE id = ?`, [orgId]);
    const tz = await deps.orgTz(orgId);   // ORG_TZ_SEAM_OK
    const today = deps.orgToday(tz);
    const safe = (p, label) => p.catch(e => { console.error(`[home/cards] ${label}:`, e.message); return null; });
    const [ty, rg, mj, ye, rt, cn, td] = await Promise.all([
      safe(thankYous(query, orgId, today), "thank-yous"),
      safe(recentGifts(query, orgId, today), "recent gifts"),
      majorOn(org && org.nav_layout) ? safe(major(req, query, orgId, today), "major") : Promise.resolve(null),
      safe(yearEnd(req, query, orgId, today), "year-end"),
      safe(retention(deps, orgId), "retention"),
      safe(connections(deps, orgId), "connections"),
      safe(todayMeetings(query, orgId, req.user.userId, tz, today), "today"),
    ]);
    res.json({ today, thankYous: ty, recentGifts: rg, major: mj, yearEnd: ye, retention: rt, connections: cn, meetings: td });
  }));
}

module.exports = { mount, yearEndSpan, majorOn };
