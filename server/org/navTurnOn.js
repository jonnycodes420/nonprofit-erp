// server/org/navTurnOn.js · NAV-2 (27 Nov). TURN ENTRIES ON IN AN ORG'S MENU.
//
// Auctions, Peer-to-peer, Memberships and Major Gifts start off an org's rail
// (client/src/lib/navGroups.js DEFAULT_OFF). This is the one way a script or a
// seed turns some of them on for an org: the org's saved layout, merged with
// the canonical groups (orgNavLayout), those ids set visible, flattened, and
// put through the menu route's own normalizer (server/org/menu.js changesFrom),
// so it is exactly what Settings → Menu would have saved. Every entry is named
// in its current order, so nothing else on the rail moves or changes.
//
// Used by scripts/ops/nav2-keep-in-use.js, scripts/ci/seed-demo.js and
// scripts/ops/staging-seed.js.
"use strict";
const path = require("path");
const { changesFrom } = require("./menu");

const nav = () => import(path.join(__dirname, "..", "..", "client", "src", "lib", "navGroups.js"));
const parse = s => { try { return typeof s === "string" ? JSON.parse(s) : (Array.isArray(s) ? s : null); } catch { return null; } };

// Did the org choose a setting for this entry (its saved layout names it, on or off)?
function chose(savedLayout, id) {
  const rows = parse(savedLayout);
  return Array.isArray(rows) && rows.some(r => r && r.id === id);
}

// The SET clause (Postgres $n placeholders) that turns `ids` on in `savedLayout`.
async function turnOnChange(savedLayout, ids) {
  const N = await nav();
  let groups = N.orgNavLayout(parse(savedLayout));
  for (const id of ids) groups = N.setNavVisible(groups, id, true);
  const layout = N.flattenNav(groups);
  const ch = changesFrom({ layout });
  if (ch.error) throw new Error(ch.error);
  let n = 0;
  return { sql: ch.sets.map(s => s.replace(/\?/g, () => "$" + (++n))).join(", "), vals: ch.vals, layout };
}

// Turn `ids` on for one org, through `q(sql, params)` (a pg-style query). Returns the layout written.
async function turnOn(q, orgId, ids) {
  const rows = await q(`SELECT nav_layout FROM orgs WHERE id = $1`, [orgId]);
  const saved = rows && rows[0] ? rows[0].nav_layout : null;
  const ch = await turnOnChange(saved, ids);
  await q(`UPDATE orgs SET ${ch.sql} WHERE id = $${ch.vals.length + 1}`, [...ch.vals, orgId]);
  return ch.layout;
}

const NAV2_OFF = ["auctions", "p2p", "memberships", "majorgifts"];

// A new org's nav_layout with all four on (the demo: a prospect sees what they saw before NAV-2).
const allFourOn = async () => (await turnOnChange(null, NAV2_OFF)).vals[0];

module.exports = { chose, turnOnChange, turnOn, allFourOn, NAV2_OFF };
