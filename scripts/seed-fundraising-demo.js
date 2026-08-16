// BUILD-11 — seed ONE coherent, healthy, current fundraising campaign on the
// demo org so the Fundraising Overview (and the landing hero captured from it)
// tells a true, attractive story.
//
// Idempotent: goes through the real API. If the campaign already exists with
// raised > 0, it does nothing — re-running never double-adds gifts. Gifts are
// real gifts on real demo donors (they recalc donor totals + sync the finance
// ledger exactly like any gift), attributed to the campaign by name so its
// thermometer is a live SUM, never a stored number.
//
// Usage (LOCAL by default — writes real data, so prod is opt-in):
//   BASE=http://localhost:5601 node scripts/seed-fundraising-demo.js
//   BASE=https://nonprofit-erp-production.up.railway.app \
//     DEMO_EMAIL=admin@creoarts.org DEMO_PASSWORD=demo1234 \
//     node scripts/seed-fundraising-demo.js        # prod (deliberate)

const BASE = require("./lib/prodGuard").writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const EMAIL = process.env.DEMO_EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.DEMO_PASSWORD || "demo1234";

const CAMPAIGN_NAME = "Spring Studio Scholarships";
const GOAL = 15000;

const iso = d => d.toISOString().slice(0, 10);
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

// Curated, believable arts-org gifts within the campaign window (~65% of goal,
// slightly ahead of pace). Assigned to real demo donors at run time.
const GIFTS = [
  { amount: 2500, ago: 38 },
  { amount: 1000, ago: 33 },
  { amount: 1500, ago: 27 },
  { amount: 500, ago: 21 },
  { amount: 750, ago: 16 },
  { amount: 2000, ago: 12 },
  { amount: 1000, ago: 8 },
  { amount: 250, ago: 4 },
  { amount: 300, ago: 1 },
]; // total = $9,800

async function main() {
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then(r => r.json());
  if (!login.token) throw new Error("login failed: " + JSON.stringify(login));
  const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };

  // Already seeded? (idempotent)
  const existing = await fetch(`${BASE}/fundraising/campaigns`, { headers: H }).then(r => r.json());
  const already = existing.find(c => c.name === CAMPAIGN_NAME);
  if (already && already.raised > 0) {
    console.log(`✓ "${CAMPAIGN_NAME}" already seeded (raised $${already.raised}). No-op.`);
    return;
  }

  // Create the campaign if it doesn't exist yet
  const start = daysAgo(42), end = daysAgo(-45); // ~47% elapsed
  if (!already) {
    const r = await fetch(`${BASE}/fundraising/campaigns`, {
      method: "POST", headers: H,
      body: JSON.stringify({ name: CAMPAIGN_NAME, goalAmount: GOAL, startDate: start, endDate: end }),
    });
    if (!r.ok) throw new Error("create campaign failed: " + r.status + " " + await r.text());
    console.log(`+ created campaign "${CAMPAIGN_NAME}" (goal $${GOAL})`);
  }

  // Pick real demo donors to attribute gifts to
  const donors = await fetch(`${BASE}/donors/summaries`, { headers: H }).then(r => r.json());
  const pool = (Array.isArray(donors) ? donors : donors.donors || []).filter(d => d.id).slice(0, GIFTS.length);
  if (pool.length < GIFTS.length) console.log(`(only ${pool.length} donors available; seeding what we can)`);

  let total = 0;
  for (let i = 0; i < Math.min(GIFTS.length, pool.length); i++) {
    const g = GIFTS[i], donor = pool[i];
    const r = await fetch(`${BASE}/donors/${donor.id}/gifts`, {
      method: "POST", headers: H,
      body: JSON.stringify({ amount: g.amount, date: daysAgo(g.ago), type: "cash", campaign: CAMPAIGN_NAME, notes: "Spring Studio Scholarships appeal" }),
    });
    if (!r.ok) { console.log(`  ! gift for ${donor.name} failed: ${r.status}`); continue; }
    total += g.amount;
    console.log(`  + $${g.amount} — ${donor.name} (${daysAgo(g.ago)})`);
  }
  console.log(`\n✓ seeded ${CAMPAIGN_NAME}: $${total} of $${GOAL} (${Math.round(total / GOAL * 100)}%)`);
}

main().catch(e => { console.error(e); process.exit(1); });
