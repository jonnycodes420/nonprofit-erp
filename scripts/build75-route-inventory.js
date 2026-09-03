#!/usr/bin/env node
// BUILD-75 B.1 — enumerate the attack surface MECHANICALLY, never by hand.
//
// Boots the real server.js against the scratch stack (never prod — refuses a
// remote DATABASE_URL outright: booting the app RUNS schema init), walks the
// live Express router, annotates every route with its auth chain and every
// parameter that accepts an identifier, checks each for a frontend reference,
// and writes audit/route-inventory.json.
//
// Usage (scratch stack only):
//   DATABASE_URL=postgresql://steward@localhost:5544/steward_loadtest \
//   PORT=5699 DISABLE_BACKGROUND_TICKS=1 JWT_SECRET=local-test-secret \
//   node scripts/build75-route-inventory.js
const fs = require("fs");
const path = require("path");

const url = process.env.DATABASE_URL || "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("REFUSED: this script BOOTS server.js (schema init runs). Loopback DATABASE_URL only.");
  process.exit(1);
}
process.env.PORT = process.env.PORT || "5699";
process.env.DISABLE_BACKGROUND_TICKS = "1";

const { buildInventory } = require("./lib/routeInventory");

(async () => {
  const app = require("../server.js");
  await new Promise(r => setTimeout(r, 3000)); // let boot-time DDL settle
  const inv = buildInventory(app);

  const out = path.join(__dirname, "..", "audit", "route-inventory.json");
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), count: inv.length, routes: inv }, null, 1));

  const byAuth = {};
  for (const r of inv) {
    const k = r.auth.length ? r.auth.join("+") : "PUBLIC";
    byAuth[k] = (byAuth[k] || 0) + 1;
  }
  console.log(`routes: ${inv.length}`);
  for (const [k, n] of Object.entries(byAuth).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

  const orphans = inv.filter(r => r.frontend.referenced === false && r.auth.includes("requireAuth"));
  console.log(`\nauthenticated routes with NO frontend reference (orphan candidates): ${orphans.length}`);
  for (const o of orphans) console.log(`  ${o.method.padEnd(6)} ${o.path}`);

  const idful = inv.filter(r => r.identifiers.length).length;
  console.log(`\nroutes carrying at least one identifier-shaped parameter: ${idful}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
