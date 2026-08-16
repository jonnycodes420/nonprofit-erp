// FIX (2026-07-19) — set CREO (the Fairhope demo org) up on the BUILD-16/21
// typed roll-up goal model so its Home hero shows the overarching FY goal with
// its Annual / Capital / Project breakdown, instead of the stale single
// "$25,000 this quarter" banner.
//
// The Home hero prefers the roll-up whenever the org has >=1 active top-level
// goal'd campaign (Dashboard.jsx `hasCampaignGoals`), so simply giving CREO a
// coherent typed goal structure retires the old single-goal banner from the
// hero — the old `fundraising_goals` row is superseded, not deleted (there is
// no DELETE /goals route; the roll-up wins by construction).
//
// Idempotent: goes through the real API. If the overarching campaign already
// exists with its children raised > 0, it does nothing — re-running never
// double-adds gifts. Gifts are REAL gifts on REAL demo donors (they recalc
// donor totals + stamp the finance ledger exactly once, so the consistency
// audit still reconciles), attributed to each child campaign by name so every
// thermometer is a live SUM(gifts), never a stored counter.
//
// One child (Annual Fund) is deliberately seeded PAST its goal so the hero's
// exceeded-goal display ("Goal met · $8,500 over", not a misleading flat 100%)
// is visible on a real card.
//
// Usage (LOCAL by default — writes real data, so prod is opt-in):
//   BASE=http://localhost:5601 node scripts/seed-creo-goals.js
//   BASE=https://nonprofit-erp-production.up.railway.app \
//     DEMO_EMAIL=admin@creoarts.org DEMO_PASSWORD=demo1234 \
//     node scripts/seed-creo-goals.js                 # prod (deliberate)

const BASE = require("./lib/prodGuard").writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const EMAIL = process.env.DEMO_EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.DEMO_PASSWORD || "demo1234";

const iso = d => d.toISOString().slice(0, 10);
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

// The overarching FY goal + its three typed children. Child goal_amounts sum to
// $198k; the overarching target is $180k so the roll-up reads a healthy ~76%
// ($136k raised) while one leaf (Annual Fund) beats its own goal.
const OVERARCHING = { name: "FY2026 Comprehensive Campaign", category: "annual", goal: 180000 };
const CHILDREN = [
  {
    name: "Annual Fund 2026", category: "annual", goal: 60000,
    // Seeded to $68,500 — over goal, to exercise the exceeded-goal display.
    gifts: [15000, 12000, 10000, 8500, 7500, 6000, 5000, 4500],
  },
  {
    name: "Studio Expansion Capital Campaign", category: "capital", goal: 120000,
    // Seeded to $54,000 — a long capital campaign climbing, ahead of early pace.
    gifts: [25000, 12000, 8000, 5000, 4000],
  },
  {
    name: "Youth Arts Access Fund", category: "project", goal: 18000,
    // Seeded to $13,500 — on track.
    gifts: [5000, 3500, 2500, 1500, 1000],
  },
];

// Generous shared window (~25% elapsed) so pace reads positively where earned.
const START = daysAgo(90);
const END = daysAgo(-270);

async function jf(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let body; try { body = t ? JSON.parse(t) : null; } catch { body = t; }
  return { ok: r.ok, status: r.status, body };
}

async function main() {
  const login = await jf(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.body?.token) throw new Error("login failed: " + JSON.stringify(login.body));
  const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.body.token };

  // Idempotency — already set up?
  const existing = (await jf(`${BASE}/fundraising/campaigns`, { headers: H })).body || [];
  const byName = Object.fromEntries(existing.map(c => [c.name, c]));
  const childrenRaised = CHILDREN.reduce((s, c) => s + (byName[c.name]?.raised || 0), 0);
  if (byName[OVERARCHING.name] && childrenRaised > 0) {
    console.log(`✓ CREO typed roll-up already seeded (children raised $${childrenRaised}). No-op.`);
    return;
  }

  // 1) Ensure the overarching goal exists (top-level, no parent).
  let overId = byName[OVERARCHING.name]?.id;
  if (!overId) {
    const r = await jf(`${BASE}/fundraising/campaigns`, {
      method: "POST", headers: H,
      body: JSON.stringify({ name: OVERARCHING.name, goalAmount: OVERARCHING.goal, goalCategory: OVERARCHING.category, startDate: START, endDate: END }),
    });
    if (!r.ok) throw new Error(`create overarching failed: ${r.status} ${JSON.stringify(r.body)}`);
    overId = r.body.id;
    console.log(`+ overarching "${OVERARCHING.name}" (goal $${OVERARCHING.goal})`);
  }

  // 2) Ensure each typed child exists, rolling up under the overarching goal.
  for (const c of CHILDREN) {
    if (byName[c.name]) { c.id = byName[c.name].id; continue; }
    const r = await jf(`${BASE}/fundraising/campaigns`, {
      method: "POST", headers: H,
      body: JSON.stringify({ name: c.name, goalAmount: c.goal, goalCategory: c.category, parentGoalId: overId, startDate: START, endDate: END }),
    });
    if (!r.ok) throw new Error(`create child "${c.name}" failed: ${r.status} ${JSON.stringify(r.body)}`);
    c.id = r.body.id;
    console.log(`+ ${c.category} child "${c.name}" (goal $${c.goal})`);
  }

  // 3) Real demo donors to attribute gifts to (cycled across all children).
  const dres = (await jf(`${BASE}/donors/summaries`, { headers: H })).body;
  const pool = (Array.isArray(dres) ? dres : dres?.donors || []).filter(d => d.id);
  if (!pool.length) throw new Error("no donors available to attribute gifts to");

  let di = 0, grand = 0;
  for (const c of CHILDREN) {
    let sub = 0;
    for (let i = 0; i < c.gifts.length; i++) {
      const donor = pool[di % pool.length]; di++;
      const amount = c.gifts[i];
      const ago = 80 - Math.round((i / c.gifts.length) * 78); // spread across the window
      const r = await jf(`${BASE}/donors/${donor.id}/gifts`, {
        method: "POST", headers: H,
        body: JSON.stringify({ amount, date: daysAgo(ago), type: "cash", campaign: c.name, notes: `${c.name} — FY2026 seed` }),
      });
      if (!r.ok) { console.log(`  ! $${amount} for ${donor.name} → ${c.name} failed: ${r.status}`); continue; }
      sub += amount; grand += amount;
    }
    console.log(`  = ${c.name}: $${sub} of $${c.goal} (${Math.round(sub / c.goal * 100)}%)`);
  }
  console.log(`\n✓ roll-up: $${grand} of $${OVERARCHING.goal} (${Math.round(grand / OVERARCHING.goal * 100)}%) across ${CHILDREN.length} typed goals`);
  console.log(`  (Annual Fund exceeds its goal — exercises the exceeded-goal "over" display.)`);
}

main().catch(e => { console.error(e); process.exit(1); });
