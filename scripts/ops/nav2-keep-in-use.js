#!/usr/bin/env node
// NAV-2 item 4 · ORGS ALREADY USING THEM KEEP THEM. DRY RUN BY DEFAULT.
//
// NAV-2 starts Auctions, Peer-to-peer, Memberships and Major Gifts off the
// rail of an org that never chose a setting for them (client/src/lib/
// navGroups.js DEFAULT_OFF). An org already using one would lose it from the
// sidebar. This lists every org that never chose a setting for one of the four
// (its saved menu does not name it) and has live data in it:
//   auctions     any auction item
//   p2p          any peer-to-peer fundraiser
//   memberships  any membership level or member
//   majorgifts   the Top 100 turned on, or any portfolio (a person assigned to
//                someone), move or plan
// and with --apply turns that entry on in the org's menu, through the menu
// route's own normalizer (server/org/navTurnOn.js → server/org/menu.js), with
// one audit row per org in that org's log. It prints org ids and counts,
// never a name. org_creo (the boot fixture) and the demo are never touched.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/nav2-keep-in-use.js                            # read only
//   DATABASE_URL=… node scripts/ops/nav2-keep-in-use.js --apply --i-know-this-is-prod
// --apply resolves its database through prodGuard.writerDbUrl(), so a remote
// one also needs --i-know-this-is-prod.
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");
if (process.argv.includes("--apply")) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();
const { chose, turnOnChange, NAV2_OFF } = require("../../server/org/navTurnOn");

const ACTOR = { id: "system:scripts/ops/nav2-keep-in-use", name: "Menu: entries already in use kept on (NAV-2)" };
const SKIP = new Set(["org_creo", "org_b72demo"]);

// org id → count, for one table and an optional condition
const countBy = async (pool, sql) => {
  const out = new Map();
  for (const r of (await pool.query(sql)).rows) out.set(r.org_id, Number(r.n) || 0);
  return out;
};

async function findInUse(pool) {
  const [items, peers, levels, members, assigned, moves, plans] = await Promise.all([
    countBy(pool, `SELECT org_id, COUNT(*) AS n FROM auction_items GROUP BY org_id`),
    countBy(pool, `SELECT org_id, COUNT(*) AS n FROM peer_fundraisers GROUP BY org_id`),
    countBy(pool, `SELECT org_id, COUNT(*) AS n FROM membership_levels GROUP BY org_id`),
    countBy(pool, `SELECT org_id, COUNT(*) AS n FROM memberships GROUP BY org_id`),
    countBy(pool, `SELECT org_id, COUNT(*) AS n FROM donors WHERE assigned_to IS NOT NULL AND deleted_at IS NULL GROUP BY org_id`),
    countBy(pool, `SELECT org_id, COUNT(*) AS n FROM moves GROUP BY org_id`),
    countBy(pool, `SELECT org_id, COUNT(*) AS n FROM cultivation_plans GROUP BY org_id`),
  ]);
  const orgs = (await pool.query(`SELECT id, nav_layout, top100_enabled FROM orgs ORDER BY id`)).rows.filter(o => !SKIP.has(o.id));
  const found = [];
  for (const o of orgs) {
    const n = m => m.get(o.id) || 0;
    const data = {
      auctions: { "auction items": n(items) },
      p2p: { "peer-to-peer fundraisers": n(peers) },
      memberships: { "membership levels": n(levels), members: n(members) },
      majorgifts: { "Top 100 on": o.top100_enabled === true ? 1 : 0, "people in a portfolio": n(assigned), moves: n(moves), plans: n(plans) },
    };
    const turn = NAV2_OFF.filter(id => !chose(o.nav_layout, id) && Object.values(data[id]).some(n => n > 0));
    if (turn.length) found.push({ id: o.id, saved: o.nav_layout, turn, counts: Object.fromEntries(turn.map(id => [id, data[id]])) });
  }
  return found;
}

async function main({ pool, apply, log = console.log }) {
  const found = await findInUse(pool);
  for (const f of found) {
    log(`${f.id}: turn on ${f.turn.join(", ")}`);
    for (const id of f.turn) log(`  ${id}: ` + Object.entries(f.counts[id]).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", "));
  }
  if (!found.length) log("No org has live data in an entry it never chose a setting for.");
  if (!apply) { if (found.length) log(`\nRead only. Run again with --apply --i-know-this-is-prod to turn these on for ${found.length} org(s).`); return found; }
  for (const f of found) {
    const ch = await turnOnChange(f.saved, f.turn);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`UPDATE orgs SET ${ch.sql} WHERE id = $${ch.vals.length + 1}`, [...ch.vals, f.id]);
      await c.query(`INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id, entity_label, changes, summary, record_count, request_method, request_path)
                     VALUES ($1,$2,$3,$4,'system','nav2 keep in use','org setting',$2,'Menu',$5,$6,$7,'SCRIPT','scripts/ops/nav2-keep-in-use.js')`,
        ["al_" + crypto.randomBytes(10).toString("hex"), f.id, ACTOR.id, ACTOR.name, JSON.stringify({ turnedOn: f.turn, counts: f.counts }),
         `Kept on the menu because they are in use: ${f.turn.join(", ")}`, f.turn.length]);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
  }
  log(`\nTurned on ${found.reduce((n, f) => n + f.turn.length, 0)} entr(ies) for ${found.length} org(s), one audit row per org.`);
  return found;
}

module.exports = { findInUse, main };

if (require.main === module) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "") ? false : { rejectUnauthorized: false } });
  main({ pool, apply: process.argv.includes("--apply") })
    .then(() => pool.end())
    .catch(async e => { console.error(e.message); await pool.end().catch(() => {}); process.exit(1); });
}
