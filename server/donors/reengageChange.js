// server/donors/reengageChange.js · FLOWS-19 item 5 (W-1118-Donors-T6). WHY RE-ENGAGE'S COUNT MOVED.
//
// "Re-engage is 283 (Lapsed 124 plus Lost 159), up from 282 on 2026-11-16." Nothing on the
// screen said why, so a fleet walk (or a director) reading yesterday's number could not tell the
// calendar from a bug. Now Steward keeps who was on Re-engage each day (reengage_snapshots, one
// row per org per org-day, written by the hourly job below), and the line under the count says
// what changed since the last day kept:
//   "1 more than Nov 16: Silas Inglewood crossed 12 months without a gift on Nov 17."
//   "The same 283 people as Nov 16."
// Who is on it is peopleCounts.reengageRowsSql: the count's own condition (lapse.js), never a
// second copy. A person who moved for any reason but the calendar is named with what changed
// (a gift, a deletion, a do-not-contact) or, if Steward can't see one, "for another reason",
// which is the case to report.
//   snapshot(orgId, { at })         write today's list once (the job); returns { day, n, wrote }
//   change(orgId, { at, visible })  the line for the screen: { since, today, before, now, moves, sentence }
"use strict";
const { query, run } = require("../../db");
const orgTime = require("../../orgTime");
const { LAPSED_DAYS } = require("../../lapseRule");
const { reengageRowsSql } = require("./peopleCounts");

const ACTOR = { id: "system:reengage-snapshot", name: "Steward (daily Re-engage list)" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || "")); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : ""; };
const names = list => list.length <= 1 ? (list[0] || "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

async function todayOf(orgId, at) {
  const [o] = await query("SELECT timezone FROM orgs WHERE id=?", [orgId]);
  return orgTime.orgToday({ timezone: o && o.timezone }, at || new Date());   // ORG_TZ_SEAM_OK
}
async function rowsOn(orgId, today, visible = null) {
  const { sql, args } = reengageRowsSql(orgId, today, visible);
  return query(sql, args);
}

// The day's list, written once; a second run that day writes nothing.
async function snapshot(orgId, { at = null } = {}) {
  const today = await todayOf(orgId, at);
  const rows = await rowsOn(orgId, today);
  const people = rows.map(r => ({ id: r.id, last: r.last || null }));
  const r = await run(
    `INSERT INTO reengage_snapshots (org_id, day, n, people, created_by, created_by_name) VALUES (?,?,?,?::jsonb,?,?)
     ON CONFLICT (org_id, day) DO NOTHING`, [orgId, today, people.length, JSON.stringify(people), ACTOR.id, ACTOR.name]);
  return { day: today, n: people.length, wrote: !!(r && r.changes) };
}

// Why somebody joined: the day their last gift turned 12 months old, if that fell after `since`.
function joinedWhy(p, since, today) {
  const crossed = p.last ? orgTime.addDays(p.last, LAPSED_DAYS) : null;
  if (crossed && crossed > since && crossed <= today) return { kind: "calendar", on: crossed, words: `${p.name} crossed 12 months without a gift on ${day(crossed)}` };
  return { kind: "other", words: `${p.name} joined for another reason${p.last ? ` (last gift ${day(p.last)})` : ""}` };
}
// Why somebody left: read off their record as it is now.
function leftWhy(r, before) {
  const who = r ? r.name : "Someone";
  if (!r || r.deleted_at || r.erased_at) return { kind: "deleted", words: `${who}'s record was deleted or merged` };
  const lastNow = r.last || null;
  if (lastNow && (!before.last || lastNow > before.last)) return { kind: "gave", words: `${who} gave on ${day(lastNow)}` };
  if (r.deceased) return { kind: "flag", words: `${who} was marked deceased` };
  if (r.do_not_contact) return { kind: "flag", words: `${who} was marked do not contact` };
  if (r.do_not_solicit) return { kind: "flag", words: `${who} was marked do not solicit` };
  if (r.imported_sustainer) return { kind: "flag", words: `${who} is an imported monthly giver now` };
  return { kind: "other", words: `${who} left for another reason` };
}

async function change(orgId, { at = null, visible = null } = {}) {
  const today = await todayOf(orgId, at);
  const [prev] = await query(`SELECT day, people FROM reengage_snapshots WHERE org_id=? AND day < ? ORDER BY day DESC LIMIT 1`, [orgId, today]);
  const nowRows = await rowsOn(orgId, today, visible);
  if (!prev) return { since: null, today, now: nowRows.length, moves: [], sentence: null };
  // ACCESS-2: a portfolio sees only its own people, in the day kept as well as today.
  let kept = Array.isArray(prev.people) ? prev.people : [];
  if (visible && visible.sql) {
    const ids = kept.map(p => p.id);
    const vis = ids.length ? await query(`SELECT donors.id FROM donors WHERE donors.org_id = ? AND donors.id = ANY(?::text[])${visible.sql}`, [orgId, ids, ...visible.args]) : [];
    const ok = new Set(vis.map(r => r.id));
    kept = kept.filter(p => ok.has(p.id));
  }
  const keptBy = new Map(kept.map(p => [p.id, p]));
  const nowBy = new Map(nowRows.map(p => [p.id, p]));
  const joined = nowRows.filter(p => !keptBy.has(p.id)).map(p => ({ id: p.id, name: p.name, dir: "joined", ...joinedWhy(p, prev.day, today) }));
  const goneIds = kept.filter(p => !nowBy.has(p.id)).map(p => p.id);
  const goneRows = goneIds.length ? await query(
    `SELECT d.id, d.name, d.deleted_at, d.erased_at, d.deceased, d.do_not_contact, d.do_not_solicit, d.imported_sustainer,
            LEFT(GREATEST(NULLIF(LEFT(d.last_gift_date, 10), ''), NULLIF(LEFT(d.imported_last_gift_date, 10), '')), 10) AS last
       FROM donors d WHERE d.org_id = ? AND d.id = ANY(?::text[])`, [orgId, goneIds]) : [];
  const goneBy = new Map(goneRows.map(r => [r.id, r]));
  const left = goneIds.map(id => ({ id, name: (goneBy.get(id) || {}).name || "", dir: "left", ...leftWhy(goneBy.get(id), keptBy.get(id)) }));
  const moves = [...joined, ...left];
  const diff = nowRows.length - kept.length;
  const head = diff === 0 ? `The same ${nowRows.length.toLocaleString("en-US")} as ${day(prev.day)}`
    : `${Math.abs(diff).toLocaleString("en-US")} ${diff > 0 ? "more" : "fewer"} than ${day(prev.day)}`;
  const shown = moves.slice(0, 5).map(m => m.words);
  const rest = moves.length - shown.length;
  const sentence = !moves.length ? `${head}.`
    : `${head}: ${names(rest > 0 ? [...shown, `${rest.toLocaleString("en-US")} more`] : shown)}.`;
  return { since: prev.day, today, before: kept.length, now: nowRows.length, moves, sentence };
}

// The hourly job: every live org's list, once a day.
async function snapshotAll() {
  let n = 0;
  for (const orgId of await require("../orgs/liveOrgs").liveOrgIds(query)) {
    try { if ((await snapshot(orgId)).wrote) n++; } catch (e) { console.error(`[reengage-snapshot] ${orgId}:`, e.message); }
  }
  return n;
}

module.exports = { snapshot, change, snapshotAll, joinedWhy, leftWhy, ACTOR };
