// BUILD-43/44 — shared machinery for the state-diff wiring suites.
// TEST CODE ONLY (BUILD-44 hard rule: no product code changes ride with this).
//
// Exports the full-org snapshotter, the flatten/diff core, the manifest and
// reversal assertions, the deterministic WAP-scale fixture builder, and the
// signed-webhook helper — parameterized by org so tests/state-diff.test.js
// (org_wap, the A-series) and tests/state-diff2.test.js (org_wap2, the
// BUILD-44 B-series) can run independently in the same run-all pass.

const bcrypt = require("bcryptjs");
const path = require("path");
const stripeLib = require(path.join(__dirname, "..", "node_modules", "stripe"))("sk_test_dummy");
const { api, q, login, SINK_PORT } = require("./helpers");

const BASE = process.env.BASE || "http://localhost:5601";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const DISCOVER = process.env.DISCOVER === "1";
// current fiscal year (July-1 boundary)
const _now = new Date();
const FY = _now.getMonth() >= 6 ? _now.getFullYear() + 1 : _now.getFullYear();

const N = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : v == null ? null : String(v); };

// ── snapshotOrgState: every number the product shows, keyed STABLY ─────────
function makeSnapshotter(ORG) {
  return async function snapshotOrgState(token) {
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
      ledgerGrantLinked: await one(`SELECT COUNT(*) c FROM fin_transactions WHERE org_id=$1 AND grant_id IS NOT NULL`),
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
      subsCanceled: await one(`SELECT COUNT(*) c FROM recurring_subscriptions WHERE org_id=$1 AND status='canceled'`),
      opportunitiesOpen: await one(`SELECT COUNT(*) c FROM opportunities WHERE org_id=$1 AND status='open'`),
      designations: await one(`SELECT COUNT(*) c FROM donor_designations WHERE org_id=$1`),
      plannedGifts: await one(`SELECT COUNT(*) c FROM planned_gifts WHERE org_id=$1`),
      tags: await one(`SELECT COALESCE(SUM(jsonb_array_length(COALESCE(tags::jsonb,'[]'::jsonb))),0) c FROM donors WHERE org_id=$1`),
    };

    const goals = {};
    for (const gl of fund.goals || []) goals[gl.name] = {
      raised: N(gl.raised), giftRaised: N(gl.giftRaised), grantAwarded: N(gl.grantAwarded),
      pledged: N(gl.pledged), pledgeCount: N(gl.pledgeCount), donorCount: N(gl.donorCount),
      goalAmount: N(gl.goalAmount),
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
        fyYtdRevenue: N(finFY.ytdRevenue),
        giftHistoryTotal: N(fin.giftHistoryTotal),
        fundBalancesTotal: N((fin.fundBalances || []).reduce((a, f) => a + Number(f.balance || 0), 0)),
        restrictedTotal: N((fin.fundBalances || []).filter(f => f.restricted).reduce((a, f) => a + Number(f.balance || 0), 0)),
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

// ── manifest + reversal assertions (bound to a suite's ok()) ───────────────
function makeAsserters(ok) {
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
      if (typeof e === "object" && e.d === 0) continue; // d:0 = "must NOT move" — absence IS the pass
      if (!(p in diff)) missing.push(`${p}: expected to change (Δ${e.d ?? JSON.stringify(e)}), did not`);
    }
    ok(`${name}: no UNEXPECTED delta anywhere in the org`, unexplained.length === 0, unexplained.slice(0, 8));
    ok(`${name}: every expected delta is exact`, wrong.length === 0, wrong.slice(0, 8));
    ok(`${name}: nothing that should have moved stayed still`, missing.length === 0, missing.slice(0, 8));
  }

  function assertReversal(name, baseline, after, excludes) {
    const d = diffState(baseline, after);
    if (DISCOVER) {
      console.log(`\n===== DISCOVER ${name} REVERSAL — residual vs baseline (${Object.keys(d).length} paths) =====`);
      for (const [k, v] of Object.entries(d)) console.log(`  ${k}: ${JSON.stringify(v.from)} -> ${JSON.stringify(v.to)}`);
      return;
    }
    const ex = (excludes || []).map(r => new RegExp(r));
    const residual = Object.entries(d).filter(([p]) => !ex.some(r => r.test(p)))
      .map(([p, v]) => `${p}: ${JSON.stringify(v.from)} -> ${JSON.stringify(v.to)}`);
    ok(`${name}: REVERSAL returns to baseline byte-for-byte (minus declared append-only)`, residual.length === 0, residual.slice(0, 8));
  }
  return { assertManifest, assertReversal };
}

// ── deterministic fixture (seeded LCG — identical every run) ───────────────
function makeFixture(FIX) {
  let s = 42;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const donors = [];
  for (let i = 0; i < FIX.N_DONORS; i++) {
    donors.push({ name: `Wap Donor ${String(i).padStart(4, "0")}`, email: `wap+${String(i).padStart(4, "0")}@example.org`, gifts: [] });
  }
  const base = Math.floor(FIX.N_GIFTS / FIX.N_DONORS);
  const extra = FIX.N_GIFTS - base * FIX.N_DONORS;
  let total = 0;
  for (let i = 0; i < FIX.N_DONORS; i++) {
    const n = base + (i < extra ? 1 : 0);
    for (let g = 0; g < n; g++) {
      const year = 2020 + Math.floor(rnd() * 5.49);
      const month = year === 2025 ? 1 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 12);
      const amount = 25 + Math.floor(rnd() * 40) * 25;
      const campaign = rnd() < 1 / 3 ? FIX.CAMPAIGN : null;
      // day varies per gift (determinism; since BUILD-45 §1.2 the import no longer collapses identical (donor,amount,date) rows)
      donors[i].gifts.push({ amount, date: `${year}-${String(month).padStart(2, "0")}-${10 + g}`, campaign });
      total++;
    }
  }
  if (total !== FIX.N_GIFTS) throw new Error("fixture gift count drifted: " + total);
  for (let i = 0; i < 100; i++) donors[i].gifts[donors[i].gifts.length - 1].date = "2026-05-15";
  return donors;
}

// ── fixture org build (parameterized) ──────────────────────────────────────
const RESET_TABLES = ["notification_sends", "digest_sends", "workflow_runs", "workflows", "payment_recovery_events",
  "recurring_subscriptions", "receipts", "pledges", "opportunities", "moves", "milestone_drafts", "note_reminders",
  "sequence_enrollments", "sequences", "tasks", "interactions", "fin_transactions", "fin_funds", "fin_budgets",
  "fin_accounts", "accounts", "financials", "funds", "fundraising_goals", "impact_metrics", "metric_snapshots",
  "custom_field_values", "custom_fields", "email_suppressions", "event_attendees", "events", "volunteers",
  "board_members", "email_opens", "campaign_recipients", "donor_designations", "planned_gifts", "donor_materials",
  "donor_relationships", "gifts", "grant_interactions", "grants", "campaigns", "giving_pages", "households",
  "fin_audit_log", "ai_log", "board_reports", "stripe_donations", "stripe_subscriptions",
  "gmail_connections", "gmail_sync_exclusions", "password_reset_tokens",
  "donors", "invites", "users"];

async function buildFixtureOrg({ ORG, ACCT, ADMIN_ID, ADMIN, OFFICER_ID, OFFICER, FIX, enableGiftThanks = true }) {
  for (const t of RESET_TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,stripe_account_id,
             legal_name,ein,receipt_address,receipts_enabled,recurring_dunning_enabled)
           VALUES ($1,$2,$3,1,'team','active',$4,
             'WAP Fixture Org Inc','12-3456789','1 Fixture Way, Testville, AL 35401',true,false)`,
    [ORG, `WAP Fixture ${ORG}`, `wap-${ORG}`, ACCT]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wap Admin','admin')`, [ADMIN_ID, ORG, ADMIN, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wap Officer','staff')`, [OFFICER_ID, ORG, OFFICER, hash]);
  const token = await login(ADMIN);
  await api("POST", "/onboarding/complete", token, {}); // seeds accounts ('4010' — ledger stamps no-op without it) + General fund

  const camp = await api("POST", "/fundraising/campaigns", token, { name: FIX.CAMPAIGN, goalAmount: 250000, startDate: "2025-07-01", endDate: "2027-06-30" });
  if (camp.status !== 200 && camp.status !== 201) throw new Error("campaign create failed: " + JSON.stringify(camp.body));
  const campaignId = camp.body.id || camp.body.campaign?.id;

  const fixture = makeFixture(FIX);
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

  const em = i => `wap+${String(i).padStart(4, "0")}@example.org`;
  await api("POST", "/households", token, { name: FIX.HOUSEHOLD, memberIds: [idByEmail[em(0)], idByEmail[em(1)]], primaryDonorId: idByEmail[em(0)] });
  const officerIds = [], adminIds = [];
  for (let i = 10; i < 50; i++) officerIds.push(idByEmail[em(i)]);
  for (let i = 50; i < 90; i++) adminIds.push(idByEmail[em(i)]);
  await api("PATCH", "/donors/bulk-assign", token, { ids: officerIds, assignedTo: OFFICER_ID });
  await api("PATCH", "/donors/bulk-assign", token, { ids: adminIds, assignedTo: ADMIN_ID });
  await api("POST", "/grants", token, { funder: "Fixture Foundation", program: "General", amount: 60000, status: "applied", deadline: "2026-11-01" });
  await api("POST", "/tasks", token, { title: "Baseline fixture task", due: "2026-09-01", priority: "medium" });
  const wf = await api("GET", "/workflows", token);
  const recipes = wf.body.workflows || wf.body || [];
  if (enableGiftThanks) {
    const igt = recipes.find?.(w => w.recipe_key === "instant_gift_thanks");
    if (igt) await api("PUT", `/workflows/${igt.id}`, token, { enabled: true });
  }
  await api("POST", "/digests/run", token, {}); // pre-reserve digest periods (5-min tick can't land mid-run)

  return { token, idByEmail, campaignId, fixture, em, recipes };
}

// signed connect webhook
function makeWebhookFirer(ACCT) {
  return async function fireWebhook(type, object, evtId) {
    const payload = JSON.stringify({ id: evtId, type, account: ACCT, data: { object } });
    const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const r = await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}

const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));

// A minimal capture sink on :5602 (the server's RESEND_BASE_URL). Internal
// notifications now report real success/failure (BUILD-45 / F-2), so a suite
// that expects notification_sends to increment must have a sink ACCEPTING the
// sends — otherwise they legitimately fail against the unbound port, release
// their reservation, and queue for retry (correct product behavior, but it
// would break a manifest that counts the send). Start this at suite top,
// close it at the end.
const http = require("http");
function startMailSink(port = SINK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ id: "sunk" })); });
    });
    srv.on("error", () => resolve(null)); // a sink already running (e.g. vite/another suite) — fine
    srv.listen(port, () => resolve(srv));
  });
}

module.exports = { N, FY, DISCOVER, makeSnapshotter, flatten, diffState, makeAsserters, makeFixture, buildFixtureOrg, makeWebhookFirer, settle, startMailSink };
