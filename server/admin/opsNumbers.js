// NUMBERS-6 item 6 · THE NIGHTLY CHECK ON /ops, REAL ORGS FIRST.
//
// What the Numbers card on /ops reads: the nightly check (number_checks, which
// numberCheck.js writes, counts only), per org: its name, its problems by rule
// and the last 7 nights; orgs a super-admin marked as a test (orgs.is_test_org)
// sorted below the real ones. Orgs that share a name are grouped, each with its
// users (how many, the last sign-in), people, gifts and the day it was made,
// so it is plain which CKRH is the real one. Read only; never a donor, a name
// of a person, an amount or an address. Nothing here merges or deletes an org.
"use strict";

const NIGHTS = 7;

// "Org: 4 problems; 3 stored donor totals that disagree; 1 rows pointing at removed gifts"
// -> { "donor-stored": 3, removed: 1 }, for a night written before by_rule was kept.
function parseLine(line, units) {
  const out = {};
  const parts = String(line || "").split(";").slice(1);
  for (const p of parts) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(p);
    if (!m) continue;
    const rule = Object.keys(units).find(k => units[k] === m[2]);
    if (rule) out[rule] = (out[rule] || 0) + Number(m[1]);
  }
  return out;
}

const fmt = n => Number(n || 0).toLocaleString("en-US");
// "real orgs: 30 problems in 3 orgs; test orgs: 1,247" (the digest line and the card's sentence).
function splitLine(rows) {
  const real = rows.filter(r => !r.isTest && r.problems > 0), test = rows.filter(r => r.isTest);
  const realN = real.reduce((s, r) => s + r.problems, 0), testN = test.reduce((s, r) => s + r.problems, 0);
  return `real orgs: ${fmt(realN)} problem${realN === 1 ? "" : "s"} in ${fmt(real.length)} org${real.length === 1 ? "" : "s"}; test orgs: ${fmt(testN)}`;
}

async function card(query) {
  const { UNIT } = require("../../scripts/ci/check-numbers");
  const nights = (await query(`SELECT DISTINCT ran_on FROM number_checks ORDER BY ran_on DESC LIMIT ${NIGHTS}`)).map(r => String(r.ran_on instanceof Date ? r.ran_on.toISOString() : r.ran_on).slice(0, 10)).reverse();
  if (!nights.length) return { nights: [], orgs: [], sameName: [], sentence: "The nightly check has not run yet.", digest: null, units: UNIT };
  const latest = nights[nights.length - 1];
  const rows = await query(
    `SELECT to_char(nc.ran_on, 'YYYY-MM-DD') AS ran_on, nc.org_id, COALESCE(o.name, nc.org_name) AS name, nc.problems, nc.line, nc.by_rule,
            COALESCE(o.is_test_org, false) AS is_test
       FROM number_checks nc LEFT JOIN orgs o ON o.id = nc.org_id
      WHERE nc.ran_on >= $1::date ORDER BY nc.ran_on`, [nights[0]]);
  const byOrg = new Map();
  for (const r of rows) {
    const o = byOrg.get(r.org_id) || { id: r.org_id, name: r.name, isTest: r.is_test, trend: Object.fromEntries(nights.map(n => [n, null])), problems: 0, byRule: {}, checked: false };
    o.trend[r.ran_on] = r.problems;
    if (r.ran_on === latest) {
      o.problems = r.problems; o.checked = true;
      o.byRule = r.by_rule && typeof r.by_rule === "object" ? r.by_rule : parseLine(r.line, UNIT);
      if (!Object.keys(o.byRule).length && r.problems > 0 && /could not run/.test(r.line)) o.byRule = { "could-not-run": 1 };
    }
    byOrg.set(r.org_id, o);
  }
  const orgs = [...byOrg.values()].filter(o => o.checked).map(o => ({ ...o, trend: nights.map(n => o.trend[n]) }))
    .sort((a, b) => (a.isTest - b.isTest) || (b.problems - a.problems) || String(a.name).localeCompare(String(b.name)));

  // Orgs that share a name, each with what tells them apart.
  const same = await query(
    `WITH named AS (SELECT o.id, o.name, LOWER(BTRIM(o.name)) AS k, o.created_at, COALESCE(o.is_test_org, false) AS is_test FROM orgs o WHERE o.name IS NOT NULL AND BTRIM(o.name) <> ''),
          dup AS (SELECT k FROM named GROUP BY k HAVING COUNT(*) > 1)
     SELECT n.id, n.name, n.k, to_char(n.created_at, 'YYYY-MM-DD') AS created, n.is_test,
            (SELECT COUNT(*) FROM users u WHERE u.org_id = n.id)::int AS users,
            (SELECT to_char(MAX(s.created_at), 'YYYY-MM-DD') FROM user_sessions s WHERE s.org_id = n.id) AS last_sign_in,
            (SELECT COUNT(*) FROM donors d WHERE d.org_id = n.id AND d.deleted_at IS NULL)::int AS people,
            (SELECT COUNT(*) FROM gifts g WHERE g.org_id = n.id)::int AS gifts
       FROM named n JOIN dup ON dup.k = n.k ORDER BY n.k, n.created_at`);
  const groups = new Map();
  for (const r of same) {
    const g = groups.get(r.k) || { name: r.name, orgs: [] };
    const chk = byOrg.get(r.id);
    g.orgs.push({ id: r.id, name: r.name, created: r.created, isTest: r.is_test, users: r.users, lastSignIn: r.last_sign_in, people: r.people, gifts: r.gifts,
      problems: chk && chk.checked ? chk.problems : null });
    groups.set(r.k, g);
  }
  const digest = splitLine(orgs);
  return { nights, latest, orgs, sameName: [...groups.values()], digest, units: UNIT,
    sentence: `The nightly check on ${latest}: ${digest}. Orgs marked as a test are listed below the real ones; marking one changes no data.` };
}

module.exports = { card, splitLine, parseLine, NIGHTS };
