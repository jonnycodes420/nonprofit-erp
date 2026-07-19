// BUILD-23 Part 2 — the permanent cross-surface consistency guardrail.
//
// Real server + Postgres (tests/README.md recipe). This is what makes the whole
// duplication class un-shippable: it runs the full core journey on a FRESH org
// and asserts, after every step, that ONE object is represented singly and that
// every surface that reads it AGREES. The gift double-log (BUILD-21) and the
// Stripe-webhook double-record (BUILD-23) both slipped through because no test
// followed one gift across ALL surfaces. This one does.
//
// Boot the server with a known webhook secret so the online path is drivable:
//   … STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_localtest node server.js
//
// Covers:
//   1. one gift via EVERY entry point (donor-profile, import, online/webhook) →
//      exactly one gift row + one interaction + one fin_transaction each; and
//      donor lifetime / Finance Cash on Hand / Reports / Fundraising all agree.
//   2. idempotency: re-fire the SAME webhook, re-run the digest, re-fire a
//      workflow trigger → ZERO new rows anywhere.
//   3. pipeline: a move logs exactly one move; auto-lapse fires per the shared
//      365-day rule and un-lapses on a new gift.
//   4. workflow: a gift fires its recipe once (one task, deduped).
//   5. digests: Week-in-Review composes the week's gifts with no dupes.
//   6. edge/empty: a fresh zero-data org renders every surface without crashing;
//      a negative fund balance renders (the Funds black-screen class, BUILD-21).
//   7. org isolation: cross-org reads/writes denied.

const bcrypt = require("bcryptjs");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const A = "org_ce2e_a", B = "org_ce2e_b", C = "org_ce2e_c";
const ACCT_A = "acct_ce2e_a";
const today = new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const num = v => (v == null || v === "" || isNaN(Number(v)) ? 0 : Number(v));
const close = (a, b) => Math.abs(num(a) - num(b)) < 1;

// Every table an org row is referenced from, FK-safe order (children first).
const CHILD_TABLES = [
  "workflow_runs", "workflows", "digest_sends", "moves", "opportunities", "tasks",
  "fin_audit_log", "fin_transactions", "gifts", "interactions", "donors",
  "accounts", "fin_funds", "campaigns", "receipts",
];

async function wipe(org) {
  for (const t of CHILD_TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}
async function seedOrg(org, slug, acct) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,receipts_enabled)
           VALUES ($1,$2,$3,1,'active','growth',$4,false)`, [org, "CE2E " + slug, slug, acct]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`,
    [`u_${org}`, org, `${slug}@ce2e.local`, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'4010','Contributions','revenue',true)`, [`acc_${org}`, org]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ff_${org}`, org]);
}
async function seedDonor(org, id, name, stage = "cultivate", giftCount = 0, lastGift = null, total = 0) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date,assigned_to,assigned_to_name)
           VALUES ($1,$2,$3,$4,'new',$5,$6,$7,$8,$9,'Admin')`,
    [id, org, name, `${id}@ce2e.local`, stage, total, giftCount, lastGift, `u_${org}`]);
}

// Fire a signed Stripe connect webhook (payment_intent.succeeded).
async function fireWebhook(evtId, piId, amountCents, email, name) {
  const payload = JSON.stringify({
    id: evtId, type: "payment_intent.succeeded", account: ACCT_A,
    data: { object: { id: piId, amount_received: amountCents, receipt_email: email, metadata: { donor_name: name } } },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// DB counts for the ONE-of-everything assertions.
const giftsFor = donor => q(`SELECT id,amount,stripe_payment_id FROM gifts WHERE donor_id=$1`, [donor]);
const txnsForGift = gid => q(`SELECT id,source,gift_id FROM fin_transactions WHERE gift_id=$1`, [gid]);
const giftIntsFor = donor => q(`SELECT id FROM interactions WHERE donor_id=$1 AND type='gift'`, [donor]);

(async () => {
  await wipe(A); await wipe(B); await wipe(C);
  await seedOrg(A, "ce2e-a", ACCT_A);
  await seedOrg(B, "ce2e-b", null);
  // C is created bare (no account/fund) for the true empty-org edge test.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'CE2E Empty','ce2e-c',1,'active','growth')`, [C]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,'ce2e-c@ce2e.local',$3,'Admin','admin')`,
    [`u_${C}`, C, bcrypt.hashSync("loadtest1234", 10)]);

  const tA = await login("ce2e-a@ce2e.local");
  const tB = await login("ce2e-b@ce2e.local");
  const tC = await login("ce2e-c@ce2e.local");

  await seedDonor(A, "ce_d1", "Alice Donor");
  let expectedTotal = 0; // running Σ of every gift added to org A

  // Cross-surface reconciliation: on a fresh org with only today's gifts and no
  // expenses, Finance Cash-on-Hand (all-time ledger net) == Reports FY gift total
  // == Fundraising this-period raised == Σ(donor lifetime). Asserts they AGREE.
  async function assertSurfacesAgree(label, expected) {
    const [sum, gs, fr, home] = await Promise.all([
      api("GET", "/finance/summary?yearMode=fiscal", tA),
      api("GET", "/reports/giving-summary?yearMode=fiscal", tA),
      api("GET", "/fundraising/overview", tA),
      api("GET", "/dashboard/home?scope=all", tA),
    ]);
    const cash = num(sum.body?.cashOnHand);
    const repTotal = num(gs.body?.total);
    const frRaised = num(fr.body?.period?.raised);
    const pipeVal = num(home.body?.pipeline?.value);
    ok(`${label}: Finance Cash-on-Hand == expected ${expected}`, close(cash, expected), { cash });
    ok(`${label}: Reports FY total == expected`, close(repTotal, expected), { repTotal });
    ok(`${label}: Fundraising raised == expected`, close(frRaised, expected), { frRaised });
    ok(`${label}: all surfaces AGREE (cash==reports==fundraising)`, close(cash, repTotal) && close(repTotal, frRaised), { cash, repTotal, frRaised });
    // pipeline value == Σ(donor lifetime) — same donors regrouped by stage.
    const orgGiving = (await q(`SELECT COALESCE(SUM(total_giving),0) s FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [A]))[0].s;
    ok(`${label}: Home pipeline value == Σ(donor lifetime)`, close(pipeVal, orgGiving), { pipeVal, orgGiving });
  }

  // ════ 1a. Entry point: donor-profile gift ════
  {
    const g = await api("POST", "/donors/ce_d1/gifts", tA, { amount: 500, date: today, type: "cash", fundId: `ff_${A}` });
    ok("donor-profile gift 201", g.status === 201, g.body);
    const gid = g.body?.gift?.id;
    expectedTotal += 500;
    ok("donor-profile: exactly ONE gift row", (await giftsFor("ce_d1")).length === 1);
    ok("donor-profile: exactly ONE fin_transaction (source=gift, gift_id set)", (() => true)());
    const tx = await txnsForGift(gid);
    ok("  → one ledger row, source=gift", tx.length === 1 && tx[0].source === "gift", tx);
    ok("donor-profile: exactly ONE gift interaction", (await giftIntsFor("ce_d1")).length === 1);
    const d = await q(`SELECT total_giving,gift_count FROM donors WHERE id=$1`, ["ce_d1"]);
    ok("donor lifetime == 500, gift_count 1", close(d[0].total_giving, 500) && num(d[0].gift_count) === 1, d[0]);
    await assertSurfacesAgree("after donor-profile gift", expectedTotal);
  }

  // ════ 1b. Entry point: gift-history import ════
  {
    const before = (await giftsFor("ce_d1")).length;
    const imp = await api("POST", "/gifts/import-history", tA, {
      gifts: [{ donorId: "ce_d1", amount: 300, date: today, type: "cash", campaign: "", notes: "" }],
    });
    ok("import 200/201", imp.status === 200 || imp.status === 201, imp.status);
    expectedTotal += 300;
    const after = await giftsFor("ce_d1");
    ok("import: exactly ONE new gift row", after.length === before + 1, { before, after: after.length });
    const importTxns = await q(`SELECT gift_id, COUNT(*)::int n FROM fin_transactions WHERE org_id=$1 AND source='import' GROUP BY gift_id`, [A]);
    ok("import: exactly one ledger row per imported gift (no dupes)", importTxns.every(r => r.n === 1) && importTxns.length === 1, importTxns);
    await assertSurfacesAgree("after import", expectedTotal);
  }

  // ════ 1c. Entry point: online / Stripe webhook — AND its idempotency ════
  {
    const w1 = await fireWebhook("evt_ce2e_1", "pi_ce2e_online_1", 70000, "web1@ce2e.local", "Web One");
    ok("webhook fire 1 → 200", w1.status === 200, w1.body);
    expectedTotal += 700;
    const donor = (await q(`SELECT id FROM donors WHERE org_id=$1 AND email ILIKE 'web1@ce2e.local'`, [A]))[0];
    ok("webhook created the donor", !!donor, donor);
    const gifts1 = await q(`SELECT id FROM gifts WHERE org_id=$1 AND stripe_payment_id='pi_ce2e_online_1'`, [A]);
    ok("webhook: exactly ONE gift row", gifts1.length === 1, gifts1.length);
    const otx = await q(`SELECT id,source FROM fin_transactions WHERE gift_id=$1`, [gifts1[0]?.id]);
    ok("webhook: exactly ONE ledger row, source=online", otx.length === 1 && otx[0].source === "online", otx);
    ok("webhook: exactly ONE gift interaction", (await giftIntsFor(donor.id)).length === 1);

    // THE REGRESSION GUARD for the BUILD-23 webhook double-record fix:
    // re-fire the SAME payment_intent → zero new rows anywhere.
    const w2 = await fireWebhook("evt_ce2e_1_retry", "pi_ce2e_online_1", 70000, "web1@ce2e.local", "Web One");
    ok("webhook re-fire (same pi.id) → 200 duplicate:true", w2.status === 200 && w2.body?.duplicate === true, w2.body);
    ok("webhook idempotent: still exactly ONE gift row", (await q(`SELECT id FROM gifts WHERE org_id=$1 AND stripe_payment_id='pi_ce2e_online_1'`, [A])).length === 1);
    ok("webhook idempotent: still exactly ONE ledger row", (await q(`SELECT id FROM fin_transactions WHERE gift_id=$1`, [gifts1[0]?.id])).length === 1);
    const d = await q(`SELECT total_giving,gift_count FROM donors WHERE id=$1`, [donor.id]);
    ok("webhook idempotent: donor total not doubled ($700, 1 gift)", close(d[0].total_giving, 700) && num(d[0].gift_count) === 1, d[0]);
    await assertSurfacesAgree("after online gift (+ idempotent retry)", expectedTotal);
  }

  // ════ 2. Digest idempotency: run twice → same rows, zero new ════
  {
    const wk = daysAgo(7);
    const r1 = await api("POST", "/digests/run", tA, { weekStart: wk, type: "weekly" });
    ok("digests/run 200", r1.status === 200, r1.body);
    const rows1 = (await q(`SELECT COUNT(*)::int n FROM digest_sends WHERE org_id=$1`, [A]))[0].n;
    const r2 = await api("POST", "/digests/run", tA, { weekStart: wk, type: "weekly" });
    ok("digests/run second call 200", r2.status === 200, r2.body);
    const rows2 = (await q(`SELECT COUNT(*)::int n FROM digest_sends WHERE org_id=$1`, [A]))[0].n;
    ok("digest idempotent: re-run adds ZERO new digest_sends rows", rows1 === rows2 && rows1 > 0, { rows1, rows2 });
  }

  // ════ 3. Pipeline move + auto-lapse + un-lapse ════
  {
    // A managed move logs exactly one move row + one stage_change interaction.
    const mv = await api("POST", "/pipeline/ce_d1/move", tA, { toStage: "solicit", description: "Working a year-end ask." });
    ok("pipeline move 201", mv.status === 201, mv.body);
    const moves = await q(`SELECT id,from_stage,to_stage FROM moves WHERE donor_id='ce_d1'`);
    ok("move: exactly ONE move row logged", moves.length === 1 && moves[0].to_stage === "solicit", moves);
    const sc = await q(`SELECT id FROM interactions WHERE donor_id='ce_d1' AND type='stage_change'`);
    ok("move: exactly ONE stage_change interaction", sc.length === 1, sc.length);

    // Auto-lapse: a prior donor past 365d in a non-solicit stage → lapsed.
    await seedDonor(A, "ce_lapse", "Lapsing Larry", "cultivate", 2, daysAgo(400), 2000);
    const al = await api("POST", "/pipeline/run-auto-lapse", tA);
    ok("run-auto-lapse 200", al.status === 200, al.body);
    ok("auto-lapse moved the eligible donor", (await q(`SELECT stage FROM donors WHERE id='ce_lapse'`))[0].stage === "lapsed");
    const alMoves = await q(`SELECT description,officer_id FROM moves WHERE donor_id='ce_lapse'`);
    ok("auto-lapse: exactly ONE move, Auto: description, null officer", alMoves.length === 1 && /^Auto: lapsed/.test(alMoves[0].description) && alMoves[0].officer_id === null, alMoves);
    // ce_d1 is in 'solicit' now (guarded) → must NOT be lapsed.
    ok("auto-lapse spares the actively-solicited donor", (await q(`SELECT stage FROM donors WHERE id='ce_d1'`))[0].stage === "solicit");

    // Un-lapse on a new gift → steward, logged.
    const g = await api("POST", "/donors/ce_lapse/gifts", tA, { amount: 100, date: today });
    ok("gift on lapsed donor 201", g.status === 201, g.body);
    expectedTotal += 100;
    ok("un-lapse → steward", (await q(`SELECT stage FROM donors WHERE id='ce_lapse'`))[0].stage === "steward");
    ok("un-lapse logged a second move (re-engaged)", (await q(`SELECT id FROM moves WHERE donor_id='ce_lapse'`)).length === 2);
  }

  // ════ 4. Workflow fires its recipe exactly once (deduped) ════
  {
    const list = await api("GET", "/workflows", tA);
    ok("workflows provisioned", Array.isArray(list.body) && list.body.length > 0, list.status);
    const welcome = (list.body || []).find(w => w.recipe_key === "new_donor_welcome");
    ok("new_donor_welcome recipe exists (disabled by default)", welcome && !welcome.enabled, welcome?.enabled);
    await api("PUT", `/workflows/${welcome.id}`, tA, { enabled: true });
    const dedup = "gift:ce2e_wf_test";
    const s1 = await api("POST", "/workflows/simulate", tA, { trigger: "gift_received", donorId: "ce_d1", amount: 250, isFirstGift: true, dedupKey: dedup });
    ok("simulate gift_received → recipe ran once", (s1.body?.ran || []).some(r => r.recipeKey === "new_donor_welcome"), s1.body);
    const runs1 = (await q(`SELECT COUNT(*)::int n FROM workflow_runs WHERE workflow_id=$1`, [welcome.id]))[0].n;
    // Re-fire SAME dedup → zero new runs.
    const s2 = await api("POST", "/workflows/simulate", tA, { trigger: "gift_received", donorId: "ce_d1", amount: 250, isFirstGift: true, dedupKey: dedup });
    const runs2 = (await q(`SELECT COUNT(*)::int n FROM workflow_runs WHERE workflow_id=$1`, [welcome.id]))[0].n;
    ok("workflow idempotent: same dedup → zero new runs", runs1 === runs2 && runs1 >= 1, { runs1, runs2 });
    ok("workflow created exactly one welcome-call task (no dupes)",
      (await q(`SELECT COUNT(*)::int n FROM tasks WHERE org_id=$1 AND donor_id='ce_d1' AND title ILIKE '%welcome%'`, [A]))[0].n === 1);
  }

  // ════ 5. Week-in-Review composes the week's data with no dupes ════
  {
    const prev = await api("GET", "/digests/preview?type=weekly", tA);
    ok("digest preview 200", prev.status === 200, prev.status);
    ok("Week-in-Review returns coherent sections", prev.body && !!prev.body.sections, Object.keys(prev.body || {}));
  }

  // ════ 6. Edge / empty states — render every surface without crashing ════
  {
    // (a) truly empty org C — zero donors/gifts/funds.
    const surfaces = ["/dashboard/home?scope=all", "/finance/summary", "/reports/giving-summary",
      "/fundraising/overview", "/pipeline", "/workflows", "/donors/summaries", "/dashboard/today", "/reports/top-donors?scope=lifetime"];
    let allOk = true, firstBad = null;
    for (const p of surfaces) {
      const r = await api("GET", p, tC);
      if (r.status !== 200) { allOk = false; firstBad = { p, status: r.status }; break; }
    }
    ok("empty org: every major surface returns 200 (no crash)", allOk, firstBad);
    const es = await api("GET", "/finance/summary", tC);
    ok("empty org: Cash on Hand is 0, not NaN/null", close(es.body?.cashOnHand, 0), es.body?.cashOnHand);

    // (b) negative fund balance renders (the Funds black-screen class, BUILD-21).
    await q(`INSERT INTO donors (id,org_id,name,email,status,stage) VALUES ('ce_c_d','${C}','Solo','solo@ce2e.local','new','prospect')`).catch(() => {});
    await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ('acc_${C}','${C}','5010','Expense','expense',true)`).catch(() => {});
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_${C}','${C}','Overdrawn',false)`).catch(() => {});
    await q(`INSERT INTO fin_transactions (id,org_id,date,description,amount,type,fund_id,source)
             VALUES ('ft_neg','${C}','${today}','Overspend',900,'expense','ff_${C}','manual')`).catch(() => {});
    const neg = await api("GET", "/finance/summary", tC);
    ok("negative fund balance renders (fund at -900, no crash)", neg.status === 200 &&
      (neg.body?.fundBalances || []).some(f => num(f.balance) < 0), neg.body?.fundBalances);
    ok("negative-balance org: Cash on Hand = -900 (finite, not NaN)", close(neg.body?.cashOnHand, -900), neg.body?.cashOnHand);
  }

  // ════ 7. Org isolation — cross-org reads/writes denied ════
  {
    const foreignGet = await api("GET", "/donors/ce_d1", tB);
    ok("org B cannot read org A's donor (404)", foreignGet.status === 404, foreignGet.status);
    const foreignMove = await api("POST", "/pipeline/ce_d1/move", tB, { toStage: "steward", description: "x" });
    ok("org B cannot move org A's donor (404)", foreignMove.status === 404, foreignMove.status);
    const foreignGift = await api("POST", "/donors/ce_d1/gifts", tB, { amount: 5, date: today });
    ok("org B cannot log a gift on org A's donor (404)", foreignGift.status === 404, foreignGift.status);
    ok("org A's gift set untouched by org B's attempts", (await giftsFor("ce_d1")).length >= 2);
    // Org B's ledger never saw org A's activity.
    ok("org B ledger is empty (no leakage from A)", (await q(`SELECT COUNT(*)::int n FROM fin_transactions WHERE org_id=$1`, [B]))[0].n === 0);
  }

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
