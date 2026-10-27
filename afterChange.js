// LIVE-1 · THE ONE AFTER-CHANGE STEP.
//
// Every door that adds or changes donor data (a gift at the form, Stripe, a
// giving page, a CSV, a history file, a giving-source read, QuickBooks, a
// logged touch, hours, a check-in, a synced email or meeting) calls this once
// after it writes, with the people it touched and whether what it wrote was
// LIVE or HISTORY. Before this, some doors woke Steward up and some did not:
// a Stripe gift moved the person's totals, groups and scores, and the same
// gift in a CSV moved only the totals.
//
// For those people only, it recomputes:
//   · lifetime giving, gift count, last gift (the batch recalc the importer
//     already used, moved here so there is one)
//   · this year's and last year's giving, and their largest gift
//   · their rhythm and expected next gift, and Drift's status, read from
//     drift.js (Drift already measures "late" against each donor's own
//     cadence; this does not compute a second one, it remembers the answer)
//   · group membership by rule, recording who crossed into a group
//   · engagement (scheduled for the org: a percentile is relative, so one
//     person's change can move everyone's)
//
// ONE BATCH, NOT ONE PER ROW. A 5,000-row import calls this once with every
// person it touched: a fixed number of statements, whatever the count.
"use strict";

const { uuid } = require("./db");
const drift = require("./drift");

const ACTOR = { id: "system:after-change", name: "Steward (after a change)" };

// Every door, by name. tests/live1-alive.test.js asserts each one calls this.
const DOORS = [
  "gift_form", "stripe_webhook", "giving_page", "csv_import", "history_import", "old_reports_import",
  "giving_source_read", "qbo_read", "event_checkin", "volunteer_hours", "logged_touch", "mail_calendar_sync",
  "capture",
];

// The doors that write gifts: after any of them, an old report's check may move.
const GIFT_DOORS = new Set(["gift_form", "stripe_webhook", "giving_page", "csv_import", "history_import", "giving_source_read", "qbo_read", "capture"]);

let deps = null;
// server.js hands its helpers over at boot (this file is required by routes
// that load after server.js has defined them; a require cycle is avoided).
function configure(d) { deps = d; }

// The last few runs, for /test/after-change-log (TEST_MODE) and the timing in
// the LIVE-1 report. Never read by a screen.
const LOG = [];
function logRun(entry) { LOG.push(entry); if (LOG.length > 500) LOG.shift(); }

// Lifetime, count, last gift: one statement for the whole set.
async function recalcDonorSummaryBatch(query, donorIds, orgId) {
  const ids = [...new Set(donorIds)].filter(Boolean);
  if (!ids.length) return;
  // NUMBERS-1: the one statement (donorSummary.js), which also zeroes a person
  // whose last gift was removed (the old one only touched people with gifts).
  await query(require("./donorSummary").DONOR_SUMMARY_UPDATE("AND d.id = ANY($2)"), [orgId, ids]);
}

// Who is newly in a group by rule. Every group by rule is compared, not only
// the ones a journey watches, so a readout can say "3 people crossed into Mid
// donors". The seen-set is the journeys' own (group_sweep_seen), so a person
// is "new" to a group exactly once, whichever looked first.
async function groupCrossings(orgId, ids, { door, today, fire }) {
  const { query } = deps;
  const GR = deps.GR;
  const groups = (await GR.listGroups(orgId)).filter(g => g.kind === "dynamic");
  if (!groups.length) return [];
  const watched = new Set((await GR.watchedDynamicGroups(orgId)).map(g => g.id));
  const out = [];
  for (const g of groups) {
    const [base] = await query(`SELECT 1 FROM group_sweep_seen WHERE group_id=? AND donor_id='__baseline__'`, [g.id]);
    if (!base) { await GR.baselineGroup(orgId, g, today); continue; }
    const m = await GR.memberSql(orgId, g);
    const now = (await query(`SELECT gx.id FROM (${m.sql}) gx WHERE gx.id = ANY(?)`, [...m.args, ids])).map(r => r.id);
    const nowSet = new Set(now);
    const seen = new Set((await query(
      `SELECT donor_id FROM group_sweep_seen WHERE group_id=? AND donor_id = ANY(?)`, [g.id, ids])).map(r => r.donor_id));
    for (const id of now) {
      if (seen.has(id)) continue;
      await query(`INSERT INTO group_sweep_seen (org_id, group_id, donor_id, seen_on) VALUES (?,?,?,?)
                   ON CONFLICT (group_id, donor_id) DO NOTHING`, [orgId, g.id, id, today || ""]);
      await query(`INSERT INTO group_crossings (id, org_id, group_id, donor_id, door, created_by, created_by_name)
                   VALUES (?,?,?,?,?,?,?)`, ["gx_" + uuid().slice(0, 12), orgId, g.id, id, door, ACTOR.id, ACTOR.name]);
      out.push({ groupId: g.id, groupName: g.name, donorId: id });
      if (watched.has(g.id) && typeof fire === "function") await fire(id, g.id);
    }
    // Somebody who left is forgotten, so coming back in is a crossing again.
    const left = [...seen].filter(id => !nowSet.has(id));
    if (left.length) await query(`DELETE FROM group_sweep_seen WHERE group_id=? AND donor_id = ANY(?)`, [g.id, left]);
  }
  return out;
}

// The person-level figures and the rhythm, for the whole set in two reads
// and one write.
async function rhythmFor(orgId, ids, { door, today }) {
  const { query } = deps;
  const year = Number(String(today).slice(0, 4));
  const rows = await query(
    `SELECT donor_id, array_agg(date ORDER BY date) AS dates, array_agg(amount ORDER BY date) AS amounts
       FROM gifts WHERE org_id=? AND donor_id = ANY(?) AND amount > 0 GROUP BY donor_id`, [orgId, ids]);
  const byDonor = new Map(rows.map(r => [r.donor_id, r]));
  const { map: driftMap } = await deps.computeDriftForDonors(orgId, { donorIds: ids });
  const prior = new Map((await query(
    `SELECT donor_id, drift_state FROM donor_rhythm WHERE org_id=? AND donor_id = ANY(?)`, [orgId, ids]))
    .map(r => [r.donor_id, r.drift_state]));
  const becameLate = [];
  const vals = [], tuples = [];
  for (const id of ids) {
    const r = byDonor.get(id);
    const gifts = r ? r.dates.map((d, i) => ({ date: String(d).slice(0, 10), amount: Number(r.amounts[i]) || 0 })) : [];
    let thisYear = 0, lastYear = 0, largest = 0;
    for (const g of gifts) {
      const y = Number(g.date.slice(0, 4));
      if (y === year) thisYear += g.amount; else if (y === year - 1) lastYear += g.amount;
      if (g.amount > largest) largest = g.amount;
    }
    const a = drift.assessDrift(gifts, today);
    const rhythm = drift.rhythmOf(a);
    const d = driftMap.get(id);
    const state = d ? d.state : a.state;
    if (state === "drifting" && prior.get(id) !== "drifting") becameLate.push(id);
    vals.push(orgId, id, rhythm, a.cadenceDays || null, a.expectedNext || null, state,
              Math.round(thisYear * 100) / 100, Math.round(lastYear * 100) / 100, largest, door, today,
              ACTOR.id, ACTOR.name);
    tuples.push("(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  }
  for (let i = 0; i < tuples.length; i += 2000) {
    const t = tuples.slice(i, i + 2000);
    await query(
      `INSERT INTO donor_rhythm (org_id, donor_id, rhythm, cadence_days, expected_next, drift_state,
         giving_this_year, giving_last_year, largest_gift, last_door, computed_for, created_by, created_by_name)
       VALUES ${t.join(",")}
       ON CONFLICT (org_id, donor_id) DO UPDATE SET
         rhythm = EXCLUDED.rhythm, cadence_days = EXCLUDED.cadence_days, expected_next = EXCLUDED.expected_next,
         state_changed_at = CASE WHEN donor_rhythm.drift_state IS DISTINCT FROM EXCLUDED.drift_state
                                 THEN NOW() ELSE donor_rhythm.state_changed_at END,
         drift_state = EXCLUDED.drift_state,
         giving_this_year = EXCLUDED.giving_this_year, giving_last_year = EXCLUDED.giving_last_year,
         largest_gift = EXCLUDED.largest_gift, last_door = EXCLUDED.last_door,
         computed_for = EXCLUDED.computed_for, computed_at = NOW()`,
      vals.slice(i * 13, (i + t.length) * 13));
  }
  return { becameLate };
}

// THE STEP. `door` names who called (one of DOORS); `history` is true when
// what was written is history (an import, a first read) rather than live.
// `fire(donorId, groupId)` starts a "joins a group" journey; a history write
// passes none, so an import never starts a journey by moving someone into a
// group (FIX-36's rule, applied here too).
// `recalc: false` skips the totals: when the caller just wrote them itself
// (recordGift), and on EVERY door that writes no gift (hours, touches, mail,
// meetings, check-in, history notes). A recompute that writes no news is not
// free: it reads the gifts, then waits on the person's row, and if a merge
// commits in between it writes the totals from before the merge (found by
// wire-journey §8 on CI's slower runner).
async function afterChange(orgId, donorIds, { door, history = false, fire = null, recalc = true, runTag = null } = {}) {
  const ids = [...new Set((donorIds || []).filter(Boolean))];
  // The run a readout will look for: "csv_import:imp_123" on every crossing
  // and every rhythm row this call wrote.
  const stamp = runTag ? `${door}:${runTag}` : door;
  const started = Date.now();
  const result = { door, history, recalc, donors: ids.length, crossings: [], becameLate: [], ms: 0 };
  if (!deps || !orgId || !ids.length) { logRun({ ...result, orgId, at: new Date().toISOString() }); return result; }
  const today = deps.orgToday(await deps.orgTz(orgId));   // ORG_TZ_SEAM_OK
  try {
    if (recalc) await recalcDonorSummaryBatch(deps.query, ids, orgId);
    const r = await rhythmFor(orgId, ids, { door: stamp, today });
    result.becameLate = r.becameLate;
    result.crossings = await groupCrossings(orgId, ids, { door: stamp, today, fire: history ? null : fire });
    deps.scheduleScores(orgId);
    // SCALE-2: the org's stored Home figures are recomputed off the request path.
    require("./orgSummary").scheduleRefresh(orgId);
    // RECONCILE-1: a door that writes gifts re-checks the org's old reports
    // against Steward, once, a moment later ("Checked Oct 14, 2026").
    if (GIFT_DOORS.has(door)) require("./reconcile").scheduleRecheck(orgId);
    // POLISH-3: a gift (or receipt) Atlas was waiting to record, now written
    // through any door, stops asking for its tap.
    if (!history) await require("./routes/atlas").settleForDonors(orgId, ids).catch(e => console.error("[after-change] atlas settle:", e.message));
  } catch (e) {
    console.error(`[after-change] ${door} for ${ids.length}:`, e.message);
    result.error = e.message;
  }
  result.ms = Date.now() - started;
  logRun({ ...result, orgId, at: new Date().toISOString() });
  return result;
}

// For a door that writes one row at a time (a shift, a synced email, a
// check-in) and must not wait: the people are collected per org and door for
// a moment and the step runs ONCE for all of them, so a 1,000-row hours file
// is one recompute, not 1,000. Errors are logged, never thrown.
const COALESCE_MS = Number(process.env.AFTER_CHANGE_COALESCE_MS || 400);
const pending = new Map();
function afterChangeSoon(orgId, donorIds, opts = {}) {
  if (!orgId) return;
  const key = `${orgId}|${opts.door}|${opts.history ? 1 : 0}`;
  let p = pending.get(key);
  if (!p) {
    p = { ids: new Set(), opts };
    pending.set(key, p);
    const t = setTimeout(() => {
      pending.delete(key);
      afterChange(orgId, [...p.ids], p.opts).catch(e => console.error("[after-change]", e.message));
    }, COALESCE_MS);
    if (t.unref) t.unref();
  }
  for (const id of donorIds || []) if (id) p.ids.add(id);
}

module.exports = { ACTOR, DOORS, configure, afterChange, afterChangeSoon, recalcDonorSummaryBatch, LOG };
