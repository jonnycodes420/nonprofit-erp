// BUILD-45 D-2 Fix B — seed believable ASKS (opportunities) into the demo org
// so the Prospect Pipeline header tiles (OPEN ASKS / WEIGHTED FORECAST /
// CLOSED THIS FY) carry real numbers for the Fairhope demo, instead of the
// honest-but-bare "—" the Fix A empty state renders when nothing is logged.
//
// The DIAGNOSIS (audit/BUILD-45-FINDINGS.md) confirmed the demo org has ZERO
// opportunity records — the tiles were arithmetically correct, just empty.
//
// What it seeds (all via the real API, org-scoped, reversible):
//   • Open asks on the four Solicit-stage prospects, each a CREDIBLE step up
//     from that donor's own giving history and never more than ~2× their
//     largest prior gift (computed per donor, not a random number).
//   • Two closed-WON asks (closed now → inside the current fiscal year, so
//     CLOSED THIS FY is non-zero and demonstrably wired).
//   • One closed-LOST ask, so the board doesn't imply a 100% win rate.
//
// Idempotent: if the org already has ANY opportunity (open or closed), it is a
// strict no-op — re-running never double-seeds. Reversible: every row is a
// normal opportunity (DELETE /opportunities/:id).
//
// Seeds the DEMO org ONLY. Do NOT point this at org_wap2 or any state-diff
// fixture — those manifests are keyed to their exact state and will fail loudly.
//
// Usage (LOCAL by default — writes real data, so prod is opt-in):
//   BASE=http://localhost:5601 node scripts/seed-build45-asks.js
//   BASE=https://nonprofit-erp-production.up.railway.app \
//     DEMO_EMAIL=admin@creoarts.org DEMO_PASSWORD=demo1234 \
//     node scripts/seed-build45-asks.js                 # prod (deliberate)

const BASE = require("./lib/prodGuard").writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const EMAIL = process.env.DEMO_EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.DEMO_PASSWORD || "demo1234";

// Mirrors server.js STAGE_WEIGHT — printed so the weighted forecast reconciles
// by hand without running anything.
const STAGE_WEIGHT = { prospect: 0.1, qualify: 0.2, cultivate: 0.4, solicit: 0.7, steward: 0.9, lapsed: 0.05 };

const iso = d => d.toISOString().slice(0, 10);
const daysOut = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const roundNice = n => Math.max(500, Math.round(n / 2500) * 2500); // nearest $2,500
const fmt = n => "$" + Number(n || 0).toLocaleString("en-US");

async function jf(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let body; try { body = t ? JSON.parse(t) : null; } catch { body = t; }
  return { ok: r.ok, status: r.status, body };
}

// Largest prior gift for a donor (the 2× cap basis); falls back to last gift
// then a fraction of lifetime when a donor has no itemized gift rows.
function maxPriorGift(donor) {
  const gifts = Array.isArray(donor.gifts) ? donor.gifts.map(g => Number(g.amount) || 0) : [];
  const maxG = gifts.length ? Math.max(...gifts) : 0;
  return maxG || Number(donor.last_gift_amount) || Math.round((Number(donor.total_giving) || 0) / 3) || 0;
}

// A credible step up: ~1.25× demonstrated capacity, rounded, at least their
// last gift, and HARD-capped at 2× the largest prior gift (spec rule).
function credibleAsk(donor) {
  const maxG = maxPriorGift(donor);
  const last = Number(donor.last_gift_amount) || 0;
  const cap = Math.round(2 * maxG) || 5000;
  let ask = roundNice(maxG * 1.25);
  ask = Math.min(ask, cap);
  ask = Math.max(ask, roundNice(last), 2500);
  ask = Math.min(ask, cap); // re-clamp after the floor
  return { ask, maxG, last, cap };
}

async function main() {
  const login = await jf(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.body?.token) throw new Error("login failed: " + JSON.stringify(login.body));
  const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.body.token };
  console.log(`→ ${BASE} as ${EMAIL}`);

  // Idempotency — already seeded? (any opportunity, open or closed)
  const pipe0 = (await jf(`${BASE}/pipeline?scope=all`, { headers: H })).body || {};
  const f0 = pipe0.forecast || {};
  if ((f0.openCount || 0) > 0 || (f0.wonCount || 0) > 0) {
    console.log(`✓ Asks already present (openCount ${f0.openCount}, wonCount ${f0.wonCount}). No-op.`);
    return;
  }
  const cols = pipe0.columns || {};
  const solicit = cols.solicit || [];
  const steward = (cols.steward || []).slice().sort((a, b) => (b.totalGiving || 0) - (a.totalGiving || 0));
  const prospects = [...(cols.prospect || []), ...(cols.qualify || []), ...(cols.cultivate || [])];
  if (!solicit.length) throw new Error("no Solicit-stage donors on the board — is this the right org?");

  // Enrich the donors we act on with their full record (for gift history).
  async function full(card) {
    const d = (await jf(`${BASE}/donors/${card.donorId}`, { headers: H })).body;
    return d && d.id ? d : { id: card.donorId, name: card.name, last_gift_amount: 0, total_giving: card.totalGiving, gifts: [], stage: card.stage };
  }

  const created = { open: [], won: [], lost: [] };

  // ── 1) Open asks on the four Solicit-stage prospects ──────────────────────
  for (const card of solicit) {
    const d = await full(card);
    const { ask, maxG, last, cap } = credibleAsk(d);
    const r = await jf(`${BASE}/donors/${d.id}/opportunities`, {
      method: "POST", headers: H,
      body: JSON.stringify({ name: "FY26 major gift ask", targetAmount: ask, expectedClose: daysOut(75) }),
    });
    if (!r.ok) throw new Error(`open ask for ${d.name} failed: ${r.status} ${JSON.stringify(r.body)}`);
    created.open.push({ name: d.name, stage: d.stage || "solicit", ask, maxG, last, cap });
    console.log(`+ open ask  ${fmt(ask)}  ${d.name}  (last ${fmt(last)}, max prior ${fmt(maxG)}, cap 2× = ${fmt(cap)})`);
  }

  // ── 2) Two closed-WON asks (closed now → current FY) ──────────────────────
  const wonDonors = steward.slice(0, 2);
  if (wonDonors.length < 2) throw new Error("need 2 steward-stage donors for the closed-won asks");
  for (const card of wonDonors) {
    const d = await full(card);
    const { ask, cap } = credibleAsk(d);
    const gift = Math.min(ask, cap); // they gave the ask
    const c = await jf(`${BASE}/donors/${d.id}/opportunities`, {
      method: "POST", headers: H,
      body: JSON.stringify({ name: "FY26 gift — closed", targetAmount: ask, expectedClose: daysOut(-10) }),
    });
    if (!c.ok) throw new Error(`won opp create for ${d.name} failed: ${c.status} ${JSON.stringify(c.body)}`);
    const w = await jf(`${BASE}/opportunities/${c.body.id}`, {
      method: "PUT", headers: H, body: JSON.stringify({ status: "won", giftAmount: gift }),
    });
    if (!w.ok) throw new Error(`won close for ${d.name} failed: ${w.status} ${JSON.stringify(w.body)}`);
    created.won.push({ name: d.name, gift });
    console.log(`+ closed-won ${fmt(gift)}  ${d.name}`);
  }

  // ── 3) One closed-LOST ask (so win rate isn't a fake 100%) ────────────────
  const lostDonor = prospects[0] || solicit[solicit.length - 1];
  {
    const d = await full(lostDonor);
    const { ask } = credibleAsk(d);
    const c = await jf(`${BASE}/donors/${d.id}/opportunities`, {
      method: "POST", headers: H,
      body: JSON.stringify({ name: "FY26 ask — declined", targetAmount: ask, expectedClose: daysOut(-5) }),
    });
    if (!c.ok) throw new Error(`lost opp create for ${d.name} failed: ${c.status} ${JSON.stringify(c.body)}`);
    const l = await jf(`${BASE}/opportunities/${c.body.id}`, {
      method: "PUT", headers: H, body: JSON.stringify({ status: "lost" }),
    });
    if (!l.ok) throw new Error(`lost close for ${d.name} failed: ${l.status} ${JSON.stringify(l.body)}`);
    created.lost.push({ name: d.name, ask });
    console.log(`+ closed-lost ${fmt(ask)}  ${d.name}`);
  }

  // ── Verify + print the arithmetic (reconciles by hand) ────────────────────
  const pipe = (await jf(`${BASE}/pipeline?scope=all`, { headers: H })).body || {};
  const f = pipe.forecast || {};
  const openSum = created.open.reduce((s, o) => s + o.ask, 0);
  const weightedByHand = created.open.reduce((s, o) => s + o.ask * (STAGE_WEIGHT[o.stage] ?? 0), 0);
  const wonSum = created.won.reduce((s, w) => s + w.gift, 0);

  console.log("\n── Weighted forecast arithmetic (all open asks are Solicit-stage, weight 0.7) ──");
  for (const o of created.open) console.log(`   ${fmt(o.ask)} × ${STAGE_WEIGHT[o.stage]} = ${fmt(Math.round(o.ask * STAGE_WEIGHT[o.stage]))}   (${o.name})`);
  console.log(`   OPEN ASKS      = ${fmt(openSum)}   (${created.open.length} open)`);
  console.log(`   WEIGHTED (by hand) = ${fmt(Math.round(weightedByHand))}`);
  console.log(`   CLOSED THIS FY = ${fmt(wonSum)}   (${created.won.length} won) + 1 lost (${created.lost[0]?.name})`);
  console.log("\n── Server /pipeline forecast now reports ──");
  console.log(`   open=${fmt(f.open)}  weighted=${fmt(f.weighted)}  openCount=${f.openCount}  wonThisPeriod=${fmt(f.wonThisPeriod)}  wonCount=${f.wonCount}`);

  const okOpen = f.open === openSum && f.openCount === created.open.length;
  const okWeighted = Math.abs((f.weighted || 0) - Math.round(weightedByHand)) <= 1;
  const okWon = (f.wonThisPeriod || 0) === wonSum && f.wonCount === created.won.length;
  console.log(`\n${okOpen && okWeighted && okWon ? "✓ reconciles" : "✗ MISMATCH"} — open:${okOpen} weighted:${okWeighted} won:${okWon}`);
  if (!(okOpen && okWeighted && okWon)) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
