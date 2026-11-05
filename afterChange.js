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
const { newId } = require("./server/shared/newId");   // IDS-1: every new row id is prefix + 20 hex

const ACTOR = { id: "system:after-change", name: "Steward (after a change)" };

// Every door, by name. tests/live1-alive.test.js asserts each one calls this.
const DOORS = [
  "gift_form", "stripe_webhook", "giving_page", "csv_import", "history_import", "old_reports_import",
  "giving_source_read", "qbo_read", "event_checkin", "volunteer_hours", "logged_touch", "mail_calendar_sync",
  "capture", "pledge", "relationship", "person_flag",   // PEOPLE-1: marked deceased, or not
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
  // NUMBERS-4: in batches, so 25,000 people after an import is linear.
  await require("./donorSummary").recomputeSummaries(query, orgId, ids);
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
                   VALUES (?,?,?,?,?,?,?)`, [newId("gx"), orgId, g.id, id, door, ACTOR.id, ACTOR.name]);
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
  // LEDGER-1: this year and last are the org's FISCAL years (shared/numbers/fiscalYear.js),
  // as the profile's This fiscal year counts them; they were calendar years here.
  const FY = require("./shared/numbers/fiscalYear");
  const [orgRow] = await query(`SELECT vocabulary_json FROM orgs WHERE id=?`, [orgId]);
  const sm = FY.startMonth(orgRow || {});
  const year = FY.startYearOf(today, sm);
  const rows = await query(
    // STATUS-1: money only (no soft or matching credit row), as the profile's live read (engagement.givingRows)
    `SELECT g.donor_id, array_agg(g.date ORDER BY g.date) AS dates, array_agg(g.amount ORDER BY g.date) AS amounts
       FROM gifts g WHERE g.org_id=? AND g.donor_id = ANY(?) AND g.amount > 0 AND ${require("./shared/numbers/money").MONEY("g")} GROUP BY g.donor_id`, [orgId, ids]);
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
      const day = g.date, y = FY.startYearOf(day, sm);
      if (y === year && day <= today) thisYear += g.amount; else if (y === year - 1) lastYear += g.amount;
      if (g.amount > largest) largest = g.amount;
    }
    const a = drift.assessDrift(gifts, today);
    const rhythm = drift.rhythmOf(a);
    const d = driftMap.get(id);
    const state = d ? d.state : a.state;
    if (state === "drifting" && prior.get(id) !== "drifting") becameLate.push(id);
    // STATUS-1: the stored date is the last day they are on time (rhythm.js onTimeThrough), which today cannot move
    vals.push(orgId, id, rhythm, a.cadenceDays || null, a.onTimeThrough || a.expectedNext || null, state,
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
async function afterChangeNow(orgId, donorIds, { door, history = false, fire = null, recalc = true, runTag = null } = {}) {
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
    // FIX-60: a pledge is giving activity; an automatic Lapsed it outlived goes.
    if (deps.unlapseHeldByPledge) await deps.unlapseHeldByPledge(orgId, ids);
    const r = await rhythmFor(orgId, ids, { door: stamp, today });
    result.becameLate = r.becameLate;
    result.crossings = await groupCrossings(orgId, ids, { door: stamp, today, fire: history ? null : fire });
    // SCORES-1: the people it touched are rescored; history (an import, a
    // first read) asks for the one full pass, folded to the import's end.
    await deps.scheduleScores(orgId, history ? null : ids);
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

// JOBS-1 · THE DOOR WRITES THE EVENT; A HANDLER RUNS THE STEP. afterChange()
// writes `donor.changed` (server/shared/outbox.js) and relays it onto the
// queue, and server/donors/handlers/afterChange.js runs afterChangeNow() for
// it, tried again when it fails. Inside an import's ambient transaction the
// event commits, or not, with the import. The totals (`recalc`) are part of the
// write, as recordGift's rollup is, so they are written here, before the
// answer; what follows them (rhythm, Drift, groups, scores, the stored
// figures) is the handler's. `fire` (a "joins a group" journey) travels as
// `startsJourneys`. A door whose own readout needs the step's answer before it
// is written (a giving-source read, a QuickBooks read, an import's recent
// gifts, all background work already) calls afterChangeNow() itself.
async function afterChange(orgId, donorIds, { door, history = false, fire = null, recalc = true, runTag = null } = {}) {
  const ids = [...new Set((donorIds || []).filter(Boolean))];
  const result = { door, history, recalc, donors: ids.length, crossings: [], becameLate: [], queued: false, ms: 0 };
  if (!deps || !orgId || !ids.length) return result;
  const started = Date.now();
  if (recalc) await recalcDonorSummaryBatch(deps.query, ids, orgId);
  const OUTBOX = require("./server/shared/outbox");
  const id = await OUTBOX.write(orgId, "donor.changed", { door, history, runTag, startsJourneys: typeof fire === "function" }, { donorIds: ids });
  await OUTBOX.relay([id]).catch(e => console.error("[after-change] relay (the sweep will):", e.message));
  return { ...result, queued: true, eventId: id, ms: Date.now() - started };
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

module.exports = { ACTOR, DOORS, configure, afterChange, afterChangeNow, afterChangeSoon, recalcDonorSummaryBatch, LOG };
