// BUILD-43 — the WIRING test: full-org state-diff harness.
//
// Don't test surfaces one at a time. Take a complete numeric snapshot of the
// entire org, perform ONE canonical action, snapshot again, and assert the
// diff equals a committed manifest EXACTLY:
//   - anything that moved and shouldn't have = a bug (double-counting — the
//     class that hid the BUILD-23 Stripe-webhook doubling)
//   - anything that should have moved and didn't = a bug (a dead wire)
// Then REVERSAL SYMMETRY: perform the action, reverse it through the
// product's own reversal path, and assert state returns to the baseline
// byte-for-byte (append-only ledgers — audit rows, workflow runs,
// notification reservations — are declared exclusions in the manifest, and
// every exclusion is a reviewed decision, not a shrug).
//
// The manifests live in tests/state-diff.manifests.js and ARE the spec:
// when one has to change, that's a deliberate reviewed decision, not silent
// drift. See that file's header for the review discipline.
//
// Scale: a deterministic synthetic fixture at WAP scale — 1,530 donors /
// 5,738 gifts (seeded LCG, byte-stable across runs) — big enough that an
// off-by-one or a double-count is visible in every total.
//
// Runs against the local scratch stack (tests/README.md recipe; needs
// STRIPE_WEBHOOK_SECRET=whsec_localtest for the online-gift actions).
// Runtime ~60-90s, dominated by the one-time fixture import.
//
// DISCOVER=1 prints each action's raw diff instead of asserting — the tool
// for writing/reviewing a manifest, never for CI.

const bcrypt = require("bcryptjs");
const path = require("path");
const stripeLib = require(path.join(__dirname, "..", "node_modules", "stripe"))("sk_test_dummy");
const { ok, summary, login, api, q } = require("./helpers");
const { buildManifests, FIX } = require("./state-diff.manifests");

const BASE = process.env.BASE || "http://localhost:5601";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const DISCOVER = process.env.DISCOVER === "1";
// current fiscal year (July-1 boundary): Aug 2026 → FY2027
const _now = new Date();
const FY = _now.getMonth() >= 6 ? _now.getFullYear() + 1 : _now.getFullYear();

const ORG = "org_wap";
const ACCT = "acct_wap_test";
const ADMIN_ID = "u_wap_admin", ADMIN = "wap-admin@example.org";
const OFFICER_ID = "u_wap_officer", OFFICER = "wap-officer@example.org";

// ── deterministic fixture generator (seeded LCG — identical every run) ─────
function makeFixture() {
  let s = 42;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const donors = [];
  for (let i = 0; i < FIX.N_DONORS; i++) {
    donors.push({ name: `Wap Donor ${String(i).padStart(4, "0")}`, email: `wap+${String(i).padStart(4, "0")}@example.org`, gifts: [] });
  }
  // exactly N_GIFTS: base 3 per donor + 1 extra for the first remainder donors
  const base = Math.floor(FIX.N_GIFTS / FIX.N_DONORS);
  const extra = FIX.N_GIFTS - base * FIX.N_DONORS;
  let total = 0;
  for (let i = 0; i < FIX.N_DONORS; i++) {
    const n = base + (i < extra ? 1 : 0);
    for (let g = 0; g < n; g++) {
      // historical only: 2020-01-15 .. 2025-06-15 (never the current FY /
      // current week, so baseline period + Week-in-Review figures are zero
      // and every action's delta stands alone)
      const year = 2020 + Math.floor(rnd() * 5.49);            // 2020..2025
      const month = year === 2025 ? 1 + Math.floor(rnd() * 6)  // 2025: Jan-Jun
        : 1 + Math.floor(rnd() * 12);
      const amount = 25 + Math.floor(rnd() * 40) * 25;         // $25..$1000
      const campaign = rnd() < 1 / 3 ? FIX.CAMPAIGN : null;    // ~1/3 attributed
      // day varies per gift (10+g): the import DEDUPES gifts with identical
      // (donor, amount, date) — a real behavior this harness surfaced (two
      // same-amount same-day gifts collapse to one on import); the fixture
      // avoids the collision so its counts are exact.
      donors[i].gifts.push({ amount, date: `${year}-${String(month).padStart(2, "0")}-${10 + g}`, campaign });
      total++;
    }
  }
  if (total !== FIX.N_GIFTS) throw new Error("fixture gift count drifted: " + total);
  // donors 0..99: last gift forced to 2026-05-15 (FY2026, <90d ago) → they
  // import as stage `steward` and form the exact LYBUNT cohort; everyone
  // else's last gift is ≥14 months old → stage `lapsed`.
  for (let i = 0; i < 100; i++) donors[i].gifts[donors[i].gifts.length - 1].date = "2026-05-15";
  return donors;
}

// ── snapshotOrgState: every number the product shows, keyed STABLY ─────────
const N = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : v == null ? null : String(v); };

async function snapshotOrgState(token) {
  const g = async p => (await api("GET", p, token)).body;
  const [fund, sum, ly, sy, ret, top, ann, sol, three, pipe, off, fin, finFY, grants, tasks, rec, wir, hh] = await Promise.all([
    g("/fundraising/overview"),
    g(`/reports/giving-summary?year=${FY}&yearMode=fiscal`),
    g(`/reports/lybunt?year=${FY}&yearMode=fiscal`),
    g(`/reports/sybunt?year=${FY}&yearMode=fiscal`),
    g("/reports/retention"),
    g("/reports/top-donors?scope=lifetime&limit=10"),
    g(`/reports/annual?year=${FY}&yearMode=fiscal`),
    g("/reports/solicitations"),
    g(`/reports/three-year?year=${FY}&yearMode=fiscal`),
    g("/pipeline?scope=all"),
    g("/portfolio/officers"),
    g("/finance/summary"),
    g("/finance/summary?yearMode=fiscal"),
    g("/grants"),
    g("/tasks"),
    g("/recurring/health"),
    g("/digests/preview?type=weekly"),
    g("/households"),
  ]);

  // DB truths (org-scoped): per-donor map keyed by EMAIL (stable), aggregates,
  // and the append-only / queue counters.
  const donorRows = await q(
    `SELECT email,total_giving,gift_count,stage,assigned_to,(deleted_at IS NOT NULL) AS deleted FROM donors WHERE org_id=$1`, [ORG]);
  const perDonor = {};
  for (const r of donorRows) perDonor[r.email] = {
    total: N(r.total_giving), gifts: N(r.gift_count), stage: r.stage || null,
    assigned: r.assigned_to || null, deleted: !!r.deleted,
  };
  const one = async (sql, args = [ORG]) => N((await q(sql, args))[0].c);
  const counts = {
    giftsRows: await one(`SELECT COUNT(*) c FROM gifts WHERE org_id=$1`),
    giftsSum: await one(`SELECT COALESCE(SUM(amount),0) c FROM gifts WHERE org_id=$1`),
    ledgerRows: await one(`SELECT COUNT(*) c FROM fin_transactions WHERE org_id=$1`),
    ledgerGiftLinked: await one(`SELECT COUNT(*) c FROM fin_transactions WHERE org_id=$1 AND gift_id IS NOT NULL`),
    interactions: await one(`SELECT COUNT(*) c FROM interactions WHERE org_id=$1`),
    moves: await one(`SELECT COUNT(*) c FROM moves WHERE org_id=$1`),
    workflowRuns: await one(`SELECT COUNT(*) c FROM workflow_runs WHERE org_id=$1`),
    notificationSends: await one(`SELECT COUNT(*) c FROM notification_sends WHERE org_id=$1`),
    digestSends: await one(`SELECT COUNT(*) c FROM digest_sends WHERE org_id=$1`),
    receiptsActive: await one(`SELECT COUNT(*) c FROM receipts WHERE org_id=$1 AND voided_at IS NULL`),
    receiptsVoided: await one(`SELECT COUNT(*) c FROM receipts WHERE org_id=$1 AND voided_at IS NOT NULL`),
    milestonePending: await one(`SELECT COUNT(*) c FROM milestone_drafts WHERE org_id=$1 AND status='pending_review'`),
    recoveryEvents: await one(`SELECT COUNT(*) c FROM payment_recovery_events WHERE org_id=$1`),
    pledgesOpen: await one(`SELECT COUNT(*) c FROM pledges WHERE org_id=$1 AND status='open'`),
    pledgesOpenTotal: await one(`SELECT COALESCE(SUM(amount),0) c FROM pledges WHERE org_id=$1 AND status='open'`),
    pledgesFulfilled: await one(`SELECT COUNT(*) c FROM pledges WHERE org_id=$1 AND status='fulfilled'`),
    subsActive: await one(`SELECT COUNT(*) c FROM recurring_subscriptions WHERE org_id=$1 AND status='active'`),
    subsPastDue: await one(`SELECT COUNT(*) c FROM recurring_subscriptions WHERE org_id=$1 AND status IN ('past_due','recovering')`),
    opportunitiesOpen: await one(`SELECT COUNT(*) c FROM opportunities WHERE org_id=$1 AND status='open'`),
  };

  const goals = {};
  for (const gl of fund.goals || []) goals[gl.name] = {
    raised: N(gl.raised), giftRaised: N(gl.giftRaised), grantAwarded: N(gl.grantAwarded),
    pledged: N(gl.pledged), pledgeCount: N(gl.pledgeCount), donorCount: N(gl.donorCount),
  };
  const officers = {};
  for (const o of off.officers || []) officers[o.email] = { count: N(o.portfolio_count), giving: N(o.portfolio_giving) };
  const households = {};
  for (const h of hh || []) households[h.name] = { members: N(h.member_count), combined: N(h.combined_giving) };
  const grantsByStatus = {};
  for (const gr of (Array.isArray(grants) ? grants : [])) {
    const st = gr.status || "unknown";
    grantsByStatus[st] = grantsByStatus[st] || { count: 0, amount: 0 };
    grantsByStatus[st].count++; grantsByStatus[st].amount = N(grantsByStatus[st].amount + Number(gr.amount || 0));
  }
  const retention = {};
  for (const r of ret.rows || []) retention[r.label] = { rate: N(r.retentionRate), dollarRate: N(r.dollarRetentionRate) };
  const topLifetime = {};
  for (const r of top.rows || []) topLifetime[r.name] = N(r.total);
  const solByOfficer = {};
  for (const o of sol.byOfficer || []) solByOfficer[o.name] = {
    openAsks: N(o.openAsks), openAskAmount: N(o.openAskAmount),
    asksMade: N(o.asksMade), giftsClosed: N(o.giftsClosed), giftsClosedAmount: N(o.giftsClosedAmount),
  };
  const taskList = Array.isArray(tasks) ? tasks : [];
  const threeYearTotals = (three.orgTotals || three.org || []).map ? (three.orgTotals || three.org || []).map(N) : null;

  return {
    fundraising: {
      rollup: { totalRaised: N(fund.rollup?.totalRaised), totalGoal: N(fund.rollup?.totalGoal), activeGoalCount: N(fund.rollup?.activeGoalCount) },
      goals,
      period: { raised: N(fund.period?.raised), giftCount: N(fund.period?.giftCount), donorCount: N(fund.period?.donorCount) },
      thisWeek: { raised: N(fund.thisWeek?.raised), giftCount: N(fund.thisWeek?.giftCount) },
    },
    reports: {
      summaryFY: { total: N(sum.total), giftCount: N(sum.giftCount), uniqueDonors: N(sum.uniqueDonors), newDonors: N(sum.newDonors), returningDonors: N(sum.returningDonors), onlineTotal: N(sum.onlineTotal), onlineCount: N(sum.onlineCount) },
      lybunt: { count: N((ly.rows || []).length), priorTotal: N((ly.rows || []).reduce((a, r) => a + Number(r.priorYearTotal || 0), 0)) },
      sybunt: { count: N((sy.rows || []).length) },
      retention,
      topLifetime,
      annual: { total: N(ann.total), giftCount: N(ann.giftCount), uniqueDonors: N(ann.uniqueDonors), growthPct: N(ann.growthPct), newDonors: N(ann.newDonors) },
      solicitations: { open: N(sol.forecast?.open), weighted: N(sol.forecast?.weighted), openPledges: N(sol.openPledges?.count), openPledgeTotal: N(sol.openPledges?.total), byOfficer: solByOfficer },
      threeYearTotals,
    },
    donors: {
      count: donorRows.filter(r => !r.deleted).length,
      trashed: donorRows.filter(r => r.deleted).length,
      totalGiving: N(donorRows.filter(r => !r.deleted).reduce((a, r) => a + Number(r.total_giving || 0), 0)),
      giftCount: N(donorRows.filter(r => !r.deleted).reduce((a, r) => a + Number(r.gift_count || 0), 0)),
      perDonor,
    },
    households,
    officers,
    pipeline: { counts: pipe.counts || {}, total: N(pipe.total), forecastOpen: N(pipe.forecast?.open), forecastWeighted: N(pipe.forecast?.weighted) },
    finance: {
      cashOnHand: N(fin.cashOnHand), ytdRevenue: N(fin.ytdRevenue), ytdExpenses: N(fin.ytdExpenses),
      // the fiscal lens exists to pin the ledger DATE sync: /finance/summary
      // defaults to CALENDAR, where a within-year date move is invisible
      fyYtdRevenue: N(finFY.ytdRevenue),
      giftHistoryTotal: N(fin.giftHistoryTotal), fundBalancesTotal: N((fin.fundBalances || []).reduce((a, f) => a + Number(f.balance || 0), 0)),
    },
    grants: grantsByStatus,
    tasks: { open: taskList.filter(t => !t.done).length, done: taskList.filter(t => !!t.done).length },
    recurring: { active: N(rec.activeCount), atRisk: N(rec.atRiskCount), mrrAtRisk: N(rec.mrrAtRisk) },
    wir: {
      giftCount: N(wir.sections?.totals?.giftCount), giftTotal: N(wir.sections?.totals?.giftTotal),
      askCount: N(wir.sections?.totals?.askCount), askTotal: N(wir.sections?.totals?.askTotal),
      moveCount: N(wir.sections?.totals?.moveCount), pastDueCount: N(wir.sections?.totals?.pastDueCount),
    },
    counts,
  };
}

// ── flatten + diff ─────────────────────────────────────────────────────────
function flatten(obj, prefix = "", out = {}) {
  if (obj === null || typeof obj !== "object") { out[prefix] = obj; return out; }
  if (Array.isArray(obj)) { out[prefix] = JSON.stringify(obj); return out; }
  for (const k of Object.keys(obj)) flatten(obj[k], prefix ? prefix + "." + k : k, out);
  return out;
}
function diffState(a, b) {
  const fa = flatten(a), fb = flatten(b), d = {};
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (!Object.is(fa[k], fb[k])) d[k] = { from: fa[k] ?? null, to: fb[k] ?? null };
  }
  return d;
}

// ── manifest assertion ─────────────────────────────────────────────────────
function assertManifest(name, diff, manifest) {
  if (DISCOVER) {
    console.log(`\n===== DISCOVER ${name} — raw diff (${Object.keys(diff).length} paths) =====`);
    for (const [k, v] of Object.entries(diff)) console.log(`  ${k}: ${JSON.stringify(v.from)} -> ${JSON.stringify(v.to)}`);
    return;
  }
  const allow = (manifest.allow || []).map(r => new RegExp(r));
  const expect = manifest.expect || {};
  const unexplained = [], wrong = [], missing = [];
  for (const [p, v] of Object.entries(diff)) {
    const e = expect[p];
    if (e !== undefined) {
      if (e === "any") continue;
      if (typeof e === "object" && "d" in e) {
        const actual = Math.round(((Number(v.to) || 0) - (Number(v.from) || 0)) * 100) / 100;
        if (actual !== e.d) wrong.push(`${p}: expected Δ${e.d}, got Δ${actual} (${v.from}->${v.to})`);
      } else if (typeof e === "object" && "to" in e) {
        if (!Object.is(v.to, e.to)) wrong.push(`${p}: expected ->${JSON.stringify(e.to)}, got ->${JSON.stringify(v.to)}`);
      }
    } else if (!allow.some(r => r.test(p))) {
      unexplained.push(`${p}: ${JSON.stringify(v.from)} -> ${JSON.stringify(v.to)}`);
    }
  }
  for (const p of Object.keys(expect)) {
    const e = expect[p];
    if (e === "any") continue;
    if (typeof e === "object" && e.d === 0) continue; // d:0 = "must NOT move" — absence IS the pass (presence fails above)
    if (!(p in diff)) missing.push(`${p}: expected to change (Δ${e.d ?? JSON.stringify(e)}), did not`);
  }
  ok(`${name}: no UNEXPECTED delta anywhere in the org`, unexplained.length === 0, unexplained.slice(0, 8));
  ok(`${name}: every expected delta is exact`, wrong.length === 0, wrong.slice(0, 8));
  ok(`${name}: nothing that should have moved stayed still`, missing.length === 0, missing.slice(0, 8));
}

function assertReversal(name, baseline, after, excludes) {
  if (DISCOVER) {
    const d = diffState(baseline, after);
    console.log(`\n===== DISCOVER ${name} REVERSAL — residual vs baseline (${Object.keys(d).length} paths) =====`);
    for (const [k, v] of Object.entries(d)) console.log(`  ${k}: ${JSON.stringify(v.from)} -> ${JSON.stringify(v.to)}`);
    return;
  }
  const ex = (excludes || []).map(r => new RegExp(r));
  const d = diffState(baseline, after);
  const residual = Object.entries(d).filter(([p]) => !ex.some(r => r.test(p)))
    .map(([p, v]) => `${p}: ${JSON.stringify(v.from)} -> ${JSON.stringify(v.to)}`);
  ok(`${name}: REVERSAL returns to baseline byte-for-byte (minus declared append-only)`, residual.length === 0, residual.slice(0, 8));
}

// ── fixture build ──────────────────────────────────────────────────────────
async function reset() {
  for (const t of ["notification_sends", "digest_sends", "workflow_runs", "workflows", "payment_recovery_events",
    "recurring_subscriptions", "receipts", "pledges", "opportunities", "moves", "milestone_drafts", "note_reminders",
    "sequence_enrollments", "sequences", "tasks", "interactions", "fin_transactions", "fin_funds", "fin_budgets",
    "fin_accounts", "accounts", "financials", "funds", "fundraising_goals", "impact_metrics", "metric_snapshots",
    "custom_field_values", "custom_fields", "email_suppressions", "event_attendees", "events", "volunteers",
    "board_members", "email_opens", "campaign_recipients", "gifts",
    "grant_interactions", "grants", "campaigns", "giving_pages", "households", "donors", "invites", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
}

async function buildFixture() {
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,stripe_account_id,
             legal_name,ein,receipt_address,receipts_enabled,recurring_dunning_enabled)
           VALUES ($1,'WAP Fixture Org','wap-fixture',1,'team','active',$2,
             'WAP Fixture Org Inc','12-3456789','1 Fixture Way, Testville, AL 35401',true,false)`, [ORG, ACCT]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wap Admin','admin')`, [ADMIN_ID, ORG, ADMIN, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wap Officer','staff')`, [OFFICER_ID, ORG, OFFICER, hash]);
  const token = await login(ADMIN);
  // seed the structural chart of accounts + default fund (seedOrgData): the
  // gift→ledger auto-stamp requires the '4010' revenue account — without it
  // every stamp silently no-ops and finance never moves.
  await api("POST", "/onboarding/complete", token, {});

  // campaign FIRST so name-attributed import gifts roll up from the start
  const camp = await api("POST", "/fundraising/campaigns", token, { name: FIX.CAMPAIGN, goalAmount: 250000, startDate: "2025-07-01", endDate: "2027-06-30" });
  if (camp.status !== 200 && camp.status !== 201) throw new Error("campaign create failed: " + JSON.stringify(camp.body));
  const campaignId = camp.body.id || camp.body.campaign?.id;

  // the big import: 1,530 donors / 5,738 gifts in 4 chunks
  const fixture = makeFixture();
  for (let i = 0; i < fixture.length; i += 500) {
    const chunk = fixture.slice(i, i + 500);
    const donors = chunk.map(d => ({ name: d.name, email: d.email }));
    const gifts = [];
    chunk.forEach((d, idx) => d.gifts.forEach(g => gifts.push({ donorIndex: idx, amount: g.amount, date: g.date, campaign: g.campaign || undefined })));
    const r = await api("POST", "/donors/import-combined", token, { donors, gifts });
    if (r.status !== 200) throw new Error("import chunk failed: " + JSON.stringify(r.body).slice(0, 200));
  }
  const idRows = await q(`SELECT id,email FROM donors WHERE org_id=$1`, [ORG]);
  const idByEmail = {}; for (const r of idRows) idByEmail[r.email] = r.id;

  // household of the first two donors
  await api("POST", "/households", token, { name: FIX.HOUSEHOLD, memberIds: [idByEmail[em(0)], idByEmail[em(1)]], primaryDonorId: idByEmail[em(0)] });
  // portfolios: donors 10..49 → officer, 50..89 → admin (assignment = board membership)
  const officerIds = [], adminIds = [];
  for (let i = 10; i < 50; i++) officerIds.push(idByEmail[em(i)]);
  for (let i = 50; i < 90; i++) adminIds.push(idByEmail[em(i)]);
  await api("PATCH", "/donors/bulk-assign", token, { ids: officerIds, assignedTo: OFFICER_ID });
  await api("PATCH", "/donors/bulk-assign", token, { ids: adminIds, assignedTo: ADMIN_ID });
  // a grant in the works + one open task
  await api("POST", "/grants", token, { funder: "Fixture Foundation", program: "General", amount: 60000, status: "applied", deadline: "2026-11-01" });
  await api("POST", "/tasks", token, { title: "Baseline fixture task", due: "2026-09-01", priority: "medium" });
  // workflows: provision + turn ON instant_gift_thanks (the notification wire)
  const wf = await api("GET", "/workflows", token);
  const igt = (wf.body.workflows || wf.body || []).find?.(w => w.recipe_key === "instant_gift_thanks");
  if (igt) await api("PUT", `/workflows/${igt.id}`, token, { enabled: true });
  // pre-reserve this org's digest periods NOW so the background 5-min tick
  // can never land digest_sends rows in the middle of a snapshot pair
  await api("POST", "/digests/run", token, {});

  return { token, idByEmail, campaignId, fixture };
}
const em = i => `wap+${String(i).padStart(4, "0")}@example.org`;

// signed connect webhook
async function fireWebhook(type, object, evtId) {
  const payload = JSON.stringify({ id: evtId, type, account: ACCT, data: { object } });
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// ── the run ────────────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  const ctx = await buildFixture();
  const { token, idByEmail, campaignId, fixture } = ctx;
  console.log(`fixture: ${FIX.N_DONORS} donors / ${FIX.N_GIFTS} gifts built in ${Math.round((Date.now() - t0) / 1000)}s\n`);
  const M = buildManifests({ ...ctx, em });

  let base = await snapshotOrgState(token);
  const settle = () => new Promise(r => setTimeout(r, 400)); // fire-and-forget workflow/notify writes

  // A1 — log a manual gift ($500, today, campaign-attributed)
  {
    const donorId = idByEmail[em(FIX.A1.donor)];
    const r = await api("POST", `/donors/${donorId}/gifts`, token, { amount: FIX.A1.amount, date: FIX.TODAY, type: "one-time", campaignId, notes: "state-diff A1" });
    ok("A1 manual gift: 200", r.status === 200 || r.status === 201, r.status);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A1 manual-gift", diffState(base, after), M.A1);
    // reverse: delete the gift through the product path
    const gid = (await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2 AND date=$3 AND amount=$4`, [ORG, donorId, FIX.TODAY, FIX.A1.amount]))[0].id;
    const dr = await api("DELETE", `/gifts/${gid}`, token);
    ok("A1 reverse (delete gift): 200", dr.status === 200, dr.status);
    await settle();
    assertReversal("A1 manual-gift", base, await snapshotOrgState(token), M.A1.reversalExclude);
    base = await snapshotOrgState(token); // new baseline carries append-only residue
  }

  // A2 — import a donor file with gift history (3 donors / 5 historical gifts)
  {
    const r = await api("POST", "/donors/import-combined", token, {
      donors: FIX.A2.donors.map(d => ({ name: d.name, email: d.email })),
      gifts: FIX.A2.gifts,
    });
    ok("A2 import: 200", r.status === 200, r.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A2 import-with-history", diffState(base, after), M.A2);
    // reverse: soft-delete the imported donors, then purge trash (their gifts go with them;
    // historical gifts never stamped the ledger, so finance reverts too)
    const ids = [];
    for (const d of FIX.A2.donors) ids.push((await q(`SELECT id FROM donors WHERE org_id=$1 AND email=$2`, [ORG, d.email]))[0].id);
    await api("POST", "/donors/bulk-delete", token, { ids });
    const pr = await api("POST", "/donors/purge-trash", token);
    ok("A2 reverse (trash + purge): 200", pr.status === 200, pr.body);
    await settle();
    assertReversal("A2 import-with-history", base, await snapshotOrgState(token), M.A2.reversalExclude);
    base = await snapshotOrgState(token);
  }

  // A3 — online gift via signed Stripe webhook (new donor, $120)
  {
    const r = await fireWebhook("payment_intent.succeeded",
      { id: FIX.A3.pi, amount_received: FIX.A3.amount * 100, receipt_email: FIX.A3.email, metadata: { donor_name: FIX.A3.name, campaign_id: campaignId } },
      "evt_wap_a3");
    ok("A3 online gift webhook: 200", r.status === 200, r.body);
    await settle(); await settle(); // receipt render + workflow fire
    const after = await snapshotOrgState(token);
    assertManifest("A3 online-gift", diffState(base, after), M.A3);
    base = after; // A5 (refund) reverses this — asserted there
  }

  // A4 — recurring gift charge, then a failed card
  {
    const sub = { id: FIX.A4.sub, customer: "cus_wap_a4", metadata: { donor_email: FIX.A3.email } };
    const s1 = await fireWebhook("checkout.session.completed",
      { id: "cs_wap_a4", mode: "subscription", subscription: FIX.A4.sub, customer: "cus_wap_a4", amount_total: FIX.A4.monthly * 100,
        customer_email: FIX.A3.email,   // the handler resolves the donor by THIS
        metadata: { donor_name: FIX.A3.name, frequency: "monthly" } }, "evt_wap_a4a");
    ok("A4 subscription created webhook: 200", s1.status === 200, s1.body);
    await settle();
    const mid = await snapshotOrgState(token);
    assertManifest("A4a recurring-created", diffState(base, mid), M.A4a);
    const s2 = await fireWebhook("invoice.payment_failed",
      { id: "in_wap_a4", subscription: FIX.A4.sub, customer: "cus_wap_a4", amount_due: FIX.A4.monthly * 100 }, "evt_wap_a4b");
    ok("A4 failed-card webhook: 200", s2.status === 200, s2.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A4b failed-card", diffState(mid, after), M.A4b);
    base = after;
  }

  // A5 — full refund of the A3 online gift, then a partial refund of a second one
  {
    const r = await fireWebhook("charge.refunded",
      { id: "ch_wap_a3", payment_intent: FIX.A3.pi, amount: FIX.A3.amount * 100, amount_refunded: FIX.A3.amount * 100 }, "evt_wap_a5a");
    ok("A5 full refund webhook: 200", r.status === 200, r.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A5a full-refund", diffState(base, after), M.A5a);
    base = after;

    // second online gift, then PARTIAL refund ($200 → keeps $80)
    await fireWebhook("payment_intent.succeeded",
      { id: FIX.A5.pi, amount_received: FIX.A5.amount * 100, receipt_email: FIX.A3.email, metadata: { donor_name: FIX.A3.name } }, "evt_wap_a5b");
    await settle(); await settle();
    const mid = await snapshotOrgState(token);
    const pr = await fireWebhook("charge.refunded",
      { id: "ch_wap_a5", payment_intent: FIX.A5.pi, amount: FIX.A5.amount * 100, amount_refunded: FIX.A5.refund * 100 }, "evt_wap_a5c");
    ok("A5 partial refund webhook: 200", pr.status === 200, pr.body);
    await settle();
    const after2 = await snapshotOrgState(token);
    assertManifest("A5b partial-refund", diffState(mid, after2), M.A5b);
    base = after2;
  }

  // A6 — edit a gift's amount, then its date, then its campaign (each reversed)
  {
    const donorId = idByEmail[em(FIX.A6.donor)];
    await api("POST", `/donors/${donorId}/gifts`, token, { amount: FIX.A6.amount, date: FIX.TODAY, type: "one-time", notes: "state-diff A6" });
    await settle();
    base = await snapshotOrgState(token);
    // select by the note — an amount-only match collided with one of the
    // donor's IMPORT gifts (a discovery-run lesson: always target scratch
    // objects by an unambiguous key)
    const gid = (await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2 AND notes=$3`, [ORG, donorId, "state-diff A6"]))[0].id;

    // amount 300 → 750, back
    await api("PUT", `/gifts/${gid}`, token, { amount: FIX.A6.newAmount });
    await settle();
    let after = await snapshotOrgState(token);
    assertManifest("A6a edit-amount", diffState(base, after), M.A6a);
    await api("PUT", `/gifts/${gid}`, token, { amount: FIX.A6.amount });
    await settle();
    assertReversal("A6a edit-amount", base, await snapshotOrgState(token), M.A6a.reversalExclude);
    base = await snapshotOrgState(token);

    // date today → prior fiscal year, back
    await api("PUT", `/gifts/${gid}`, token, { date: FIX.A6.oldDate });
    await settle();
    after = await snapshotOrgState(token);
    assertManifest("A6b edit-date", diffState(base, after), M.A6b);
    await api("PUT", `/gifts/${gid}`, token, { date: FIX.TODAY });
    await settle();
    assertReversal("A6b edit-date", base, await snapshotOrgState(token), M.A6b.reversalExclude);
    base = await snapshotOrgState(token);

    // campaign none → Annual Fund, back
    await api("PUT", `/gifts/${gid}`, token, { campaignId });
    await settle();
    after = await snapshotOrgState(token);
    assertManifest("A6c edit-campaign", diffState(base, after), M.A6c);
    await api("PUT", `/gifts/${gid}`, token, { campaignId: "" });
    await settle();
    assertReversal("A6c edit-campaign", base, await snapshotOrgState(token), M.A6c.reversalExclude);
    // clean up the A6 scratch gift so later baselines stay tidy
    await api("DELETE", `/gifts/${gid}`, token);
    await settle();
    base = await snapshotOrgState(token);
  }

  // A7 — reassign a donor between officers, then back
  {
    const donorId = idByEmail[em(FIX.A7.donor)]; // assigned to OFFICER in fixture
    const r = await api("PATCH", `/donors/${donorId}/assign`, token, { assignedTo: ADMIN_ID });
    ok("A7 reassign: 200", r.status === 200, r.body);
    const after = await snapshotOrgState(token);
    assertManifest("A7 reassign-officer", diffState(base, after), M.A7);
    await api("PATCH", `/donors/${donorId}/assign`, token, { assignedTo: OFFICER_ID });
    assertReversal("A7 reassign-officer", base, await snapshotOrgState(token), M.A7.reversalExclude);
    base = await snapshotOrgState(token);
  }

  // A8 — advance a move stage + log an ask
  {
    const donorId = idByEmail[em(FIX.A8.donor)];
    const st = (await q(`SELECT stage FROM donors WHERE id=$1`, [donorId]))[0].stage;
    const to = st === "cultivate" ? "solicit" : "cultivate";
    const mv = await api("POST", `/pipeline/${donorId}/move`, token, { toStage: to, description: "state-diff A8 move" });
    ok("A8 move: 200/201", mv.status === 200 || mv.status === 201, { status: mv.status, body: mv.body });
    const ask = await api("POST", `/donors/${donorId}/opportunities`, token, { name: "State-diff Ask", targetAmount: FIX.A8.ask });
    ok("A8 ask: 200/201", ask.status === 200 || ask.status === 201, ask.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A8 move+ask", diffState(base, after), M.A8(st, to));
    // reverse: move back + delete the ask
    await api("POST", `/pipeline/${donorId}/move`, token, { toStage: st, description: "state-diff A8 reverse" });
    const oid = (await q(`SELECT id FROM opportunities WHERE org_id=$1 AND donor_id=$2`, [ORG, donorId]))[0].id;
    await api("DELETE", `/opportunities/${oid}`, token);
    await settle();
    assertReversal("A8 move+ask", base, await snapshotOrgState(token), M.A8(st, to).reversalExclude);
    base = await snapshotOrgState(token);
  }

  // A9 — record a pledge, then a payment against it
  {
    const donorId = idByEmail[em(FIX.A9.donor)];
    const pl = await api("POST", `/donors/${donorId}/pledges`, token, { amount: FIX.A9.pledge, dueDate: "2026-12-01", campaignId });
    ok("A9 pledge: 200/201", pl.status === 200 || pl.status === 201, pl.body);
    await settle();
    const mid = await snapshotOrgState(token);
    assertManifest("A9a pledge", diffState(base, mid), M.A9a);
    const pid = (await q(`SELECT id FROM pledges WHERE org_id=$1 AND donor_id=$2`, [ORG, donorId]))[0].id;
    const pay = await api("POST", `/donors/${donorId}/gifts`, token, { amount: FIX.A9.payment, date: FIX.TODAY, type: "one-time", pledgeId: pid });
    ok("A9 payment: 200/201", pay.status === 200 || pay.status === 201, pay.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A9b pledge-payment", diffState(mid, after), M.A9b);
    // reverse: delete the payment gift (reopens the pledge), then the pledge
    const gid = (await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2 AND amount=$3 AND date=$4`, [ORG, donorId, FIX.A9.payment, FIX.TODAY]))[0].id;
    await api("DELETE", `/gifts/${gid}`, token);
    await api("DELETE", `/pledges/${pid}`, token);
    await settle();
    assertReversal("A9 pledge+payment", base, await snapshotOrgState(token), M.A9b.reversalExclude);
    base = await snapshotOrgState(token);
  }

  // A10 — delete (soft) a donor who has gifts. NO reversal: the product has no
  // restore-from-trash route (documented gap — see CLAUDE.md / BLOCKED files).
  {
    const donorId = idByEmail[em(FIX.A10.donor)];
    const r = await api("DELETE", `/donors/${donorId}`, token);
    ok("A10 delete donor: 200", r.status === 200, r.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A10 delete-donor", diffState(base, after), M.A10);
  }

  console.log(`\ntotal runtime ${Math.round((Date.now() - t0) / 1000)}s`);
  if (!DISCOVER) summary(); else process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
