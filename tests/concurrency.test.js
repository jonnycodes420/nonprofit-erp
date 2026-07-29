// BUILD-27 Part C — concurrency & multi-user battle test.
// Local scratch server + Postgres (tests/README.md) + STRIPE_WEBHOOK_SECRET.
//
// Real parallel requests (Promise.all / concurrent workers), each scenario run N
// times because races are probabilistic. Seeds 3 orgs (A,B,C) and 3 users in org A
// (admin + 2 officers). Proves the DB-level guarantees hold under a genuine race:
//   1. same donor, two officers            — no lost update/corruption; moves logged
//   2. concurrent gift writes (top stakes) — parallel webhook redelivery = exactly one
//   3. parallel imports                    — email dedupe holds, gifts attach once
//   4. pipeline contention                 — one coherent final stage, both moves logged
//   5. workflow + digest races             — dedup keys prevent double-sends in parallel
//   6. cross-org isolation under load      — isolation holds when the DB is busy
//   7. pool/deadlock behavior              — no unhandled deadlock, no hung request

const bcrypt = require("bcryptjs");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const A = "org_cc_a", B = "org_cc_b", C = "org_cc_c";
const ACCT_A = "acct_cc_a";
const N = 8;                              // iterations per probabilistic scenario
const today = new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const num = v => (v == null || v === "" || isNaN(Number(v)) ? 0 : Number(v));

const WIPE = ["workflow_runs", "workflows", "digest_sends", "moves", "opportunities",
  "recurring_subscriptions", "payment_recovery_events", "fin_transactions", "gifts",
  "interactions", "tasks", "donors", "accounts", "fin_funds", "users"];
async function wipe(org) {
  for (const t of WIPE) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}
async function seedOrg(org, slug, acct) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id)
           VALUES ($1,$2,$3,1,'active','growth',$4)`, [org, "CC " + slug, slug, acct]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'4010','Contributions','revenue',true)`, [`acc_${org}`, org]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ff_${org}`, org]);
}
async function addUser(org, id, email, name, role) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, org, email, bcrypt.hashSync("loadtest1234", 10), name, role]);
}
async function seedDonor(org, id, name, o = {}) {
  const { stage = "cultivate", inPipeline = true, owner = null, total = 0, giftCount = 0 } = o;
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,in_pipeline,assigned_to,tags)
           VALUES ($1,$2,$3,$4,'mid',$5,$6,$7,$8,$9,'[]')`,
    [id, org, name, `${id}@cc.local`, stage, total, giftCount, inPipeline, owner]);
}
async function fireWebhook(evtId, piId, cents, email, name) {
  const payload = JSON.stringify({
    id: evtId, type: "payment_intent.succeeded", account: ACCT_A,
    data: { object: { id: piId, amount_received: cents, receipt_email: email, metadata: { donor_name: name } } } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const giftsForPi = pi => q(`SELECT id FROM gifts WHERE stripe_payment_id=$1`, [pi]);
const donorTotal = id => q(`SELECT total_giving, gift_count FROM donors WHERE id=$1`, [id]).then(r => r[0]);
const movesFor = id => q(`SELECT id, from_stage, to_stage FROM moves WHERE donor_id=$1`, [id]);

(async () => {
  await wipe(A); await wipe(B); await wipe(C);
  await seedOrg(A, "cc-a", ACCT_A);
  await seedOrg(B, "cc-b", "acct_cc_b");
  await seedOrg(C, "cc-c", "acct_cc_c");
  await addUser(A, "u_a_admin", "a-admin@cc.local", "Admin A", "admin");
  await addUser(A, "u_a_off1", "a-off1@cc.local", "Officer One", "staff");
  await addUser(A, "u_a_off2", "a-off2@cc.local", "Officer Two", "staff");
  await addUser(B, "u_b_admin", "b-admin@cc.local", "Admin B", "admin");
  await addUser(C, "u_c_admin", "c-admin@cc.local", "Admin C", "admin");
  const tAdmin = await login("a-admin@cc.local");
  const tOff1 = await login("a-off1@cc.local");
  const tOff2 = await login("a-off2@cc.local");
  const tB = await login("b-admin@cc.local");
  const tC = await login("c-admin@cc.local");

  // ═══ Scenario 1 — same donor, two officers, simultaneous updates ═══
  console.log("\n── 1. same donor, two officers (simultaneous stage/owner/notes) ──");
  let ownerLost = false, notesLost = false, corrupt = false, missingMove = false;
  for (let i = 0; i < N; i++) {
    const id = `cc1_${i}`;
    await seedDonor(A, id, `Donor One ${i}`, { stage: "cultivate", owner: "u_a_off1" });
    // Three concurrent writers on ONE donor: officer1 moves stage (SET stage),
    // admin re-assigns the owner (SET assigned_to — a column no one else writes),
    // admin edits the donor form incl. notes (full-row PUT). All in parallel.
    const res = await Promise.all([
      api("POST", `/pipeline/${id}/move`, tOff1, { toStage: "solicit", description: `off1 move ${i}` }),
      api("PATCH", `/donors/${id}/assign`, tAdmin, { assignedTo: "u_a_off2", assignedToName: "Officer Two" }),
      api("PUT", `/donors/${id}`, tAdmin, { name: `Donor One ${i}`, notes: `admin note ${i}`, stage: "cultivate", status: "mid", tags: [] }),
    ]);
    const d = (await q(`SELECT stage, notes, assigned_to, total_giving FROM donors WHERE id=$1`, [id]))[0];
    // Owner (assign) and notes (PUT) write DISJOINT columns → NEITHER may be lost.
    if (res[1].status === 200 && d.assigned_to !== "u_a_off2") ownerLost = true;
    if (res[2].status === 200 && d.notes !== `admin note ${i}`) notesLost = true;
    // Stage is contended between the move and the PUT → coherent (one submitted
    // value), never corrupt/blank.
    if (!["solicit", "cultivate"].includes(d.stage)) corrupt = true;
    // Every move that returned 201 must be in the append-only moves log, truthfully.
    const okMoves = res.filter((r, k) => k === 0 && r.status === 201).length;
    const logged = (await movesFor(id)).length;
    if (logged !== okMoves) missingMove = true;
  }
  ok("1: owner re-assignment never lost under concurrent edits (disjoint column)", !ownerLost);
  ok("1: notes write never lost under concurrent edits (disjoint column)", !notesLost);
  ok("1: no corruption — final stage is always a coherent submitted value", !corrupt);
  ok("1: every accepted move is truthfully recorded in the moves log (append-only)", !missingMove);

  // ═══ Scenario 2 — concurrent gift writes (highest stakes) ═══
  console.log("\n── 2. concurrent gift writes — parallel webhook redelivery = exactly once ──");
  let dblGift = false, badTotal = false, dblLedger = false;
  for (let i = 0; i < N; i++) {
    const pi = `pi_cc2_${i}`, evt = `evt_cc2_${i}`, email = `cc2_${i}@cc.local`;
    // Fire the SAME payment_intent event FIVE times in parallel (redelivery storm).
    await Promise.all(Array.from({ length: 5 }, () => fireWebhook(evt, pi, 5000, email, `Web Donor ${i}`)));
    const gifts = await giftsForPi(pi);
    if (gifts.length !== 1) dblGift = true;
    const donor = (await q(`SELECT id, total_giving, gift_count FROM donors WHERE org_id=$1 AND email ILIKE $2`, [A, email]))[0];
    if (!donor || num(donor.total_giving) !== 50 || num(donor.gift_count) !== 1) badTotal = true;
    const ledger = await q(`SELECT COUNT(*)::int n FROM fin_transactions WHERE gift_id=$1`, [gifts[0]?.id]);
    if (gifts[0] && ledger[0].n !== 1) dblLedger = true;
  }
  ok("2: parallel webhook redelivery → EXACTLY one gift row per payment_intent", !dblGift);
  ok("2: donor total/gift_count reconcile (charged once, not N times)", !badTotal);
  ok("2: exactly one ledger row per gift (no double-stamp under race)", !dblLedger);

  // Mixed race: a profile-logged gift AND a webhook gift for the same donor in
  // parallel are DISTINCT gifts (different keys) and BOTH must land, totals summing.
  {
    await seedDonor(A, "cc2_mix", "Mixed Donor", { stage: "steward" });
    await Promise.all([
      api("POST", `/donors/cc2_mix/gifts`, tAdmin, { amount: 100, date: today }),
      fireWebhook("evt_cc2_mix", "pi_cc2_mix", 20000, "cc2_mix@cc.local", "Mixed Donor"),
    ]);
    await new Promise(r => setTimeout(r, 300));
    const g = await q(`SELECT COALESCE(SUM(amount),0) s, COUNT(*)::int n FROM gifts WHERE donor_id='cc2_mix'`, []);
    ok("2: profile-log + webhook in parallel → two distinct gifts, totals sum ($300)", num(g[0].s) === 300 && g[0].n === 2, g[0]);
  }

  // ═══ Scenario 3 — parallel imports, overlapping files ═══
  console.log("\n── 3. parallel imports — overlapping emails dedupe, gifts attach once ──");
  const { groupTransactions } = await import("../client/src/lib/importShape.js");
  let importDupe = false, importErr = false, giftDupe = false;
  for (let i = 0; i < N; i++) {
    const shared = `cc3_shared_${i}@cc.local`;
    const mk = uniq => groupTransactions([
      { key: shared, donor: { name: `Shared ${i}`, email: shared }, gift: { amount: 100, date: daysAgo(10) } },
      { key: uniq, donor: { name: `Uniq ${uniq}`, email: uniq }, gift: { amount: 50, date: daysAgo(10) } },
    ]);
    const [r1, r2] = await Promise.all([
      api("POST", "/donors/import-combined", tOff1, mk(`cc3_u1_${i}@cc.local`)),
      api("POST", "/donors/import-combined", tOff2, mk(`cc3_u2_${i}@cc.local`)),
    ]);
    if (r1.status !== 200 || r2.status !== 200) importErr = true;
    const dCount = (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND email=$2 AND deleted_at IS NULL`, [A, shared]))[0].n;
    if (dCount !== 1) importDupe = true;
    // The shared donor's gift must attach once, not once-per-import.
    const shId = (await q(`SELECT id FROM donors WHERE org_id=$1 AND email=$2 AND deleted_at IS NULL LIMIT 1`, [A, shared]))[0]?.id;
    const gCount = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE donor_id=$1`, [shId]))[0].n;
    if (gCount !== 1) giftDupe = true;
  }
  ok("3: both parallel imports complete cleanly (no deadlock/500)", !importErr);
  ok("3: an overlapping email yields EXACTLY one donor (dedupe held under race)", !importDupe);
  ok("3: the shared donor's gift attaches exactly once", !giftDupe);

  // ═══ Scenario 4 — pipeline contention ═══
  console.log("\n── 4. pipeline contention — two officers move the same prospect ──");
  let orphan = false, incoherent = false;
  for (let i = 0; i < N; i++) {
    const id = `cc4_${i}`;
    await seedDonor(A, id, `Prospect ${i}`, { stage: "qualify", owner: "u_a_off1" });
    const stages = ["cultivate", "solicit", "steward", "prospect"];
    const res = await Promise.all(stages.map((s, k) =>
      api("POST", `/pipeline/${id}/move`, k % 2 ? tOff2 : tOff1, { toStage: s, description: `race ${s}` })));
    const d = (await q(`SELECT stage FROM donors WHERE id=$1`, [id]))[0];
    if (!stages.includes(d.stage)) incoherent = true;             // final stage is one coherent value
    const accepted = res.filter(r => r.status === 201).length;
    if ((await movesFor(id)).length !== accepted) orphan = true;   // no orphan/missing move rows
  }
  ok("4: final stage is one coherent value after contended moves", !incoherent);
  ok("4: every accepted move logged, none orphaned", !orphan);

  // ═══ Scenario 5 — workflow + digest races ═══
  console.log("\n── 5. workflow + digest races — dedup keys prevent double-sends ──");
  // 5a. workflow: same event fired by 6 parallel workers → exactly one run.
  const wfList = await api("GET", "/workflows", tAdmin).then(r => r.body);
  const wfNew = wfList.find(w => w.recipe_key === "new_donor_welcome");
  await api("PUT", `/workflows/${wfNew.id}`, tAdmin, { enabled: true });
  let wfDouble = false;
  for (let i = 0; i < N; i++) {
    const id = `cc5_${i}`;
    await seedDonor(A, id, `WF Donor ${i}`, { inPipeline: false });
    const dk = `gift:cc5_${i}`;
    await Promise.all(Array.from({ length: 6 }, () =>
      api("POST", "/workflows/simulate", tAdmin, { trigger: "gift_received", donorId: id, amount: 40, isFirstGift: true, dedupKey: dk })));
    const runs = (await q(`SELECT COUNT(*)::int n FROM workflow_runs WHERE workflow_id=$1 AND dedup_key=$2`, [wfNew.id, dk]))[0].n;
    if (runs !== 1) wfDouble = true;
  }
  ok("5a: 6 parallel identical fires → exactly one workflow_runs row (unique dedup key held)", !wfDouble);
  await api("PUT", `/workflows/${wfNew.id}`, tAdmin, { enabled: false });
  // 5b. digest: two parallel /digests/run → no duplicate (org,type,period,recipient) rows.
  await Promise.all([api("POST", "/digests/run", tAdmin, {}), api("POST", "/digests/run", tAdmin, {})]);
  const dupDigest = await q(
    `SELECT org_id, digest_type, period_key, recipient_user_id, COUNT(*)::int n
       FROM digest_sends WHERE org_id=$1 GROUP BY 1,2,3,4 HAVING COUNT(*)>1`, [A]);
  ok("5b: parallel digest runs never double-send (unique reservation held)", dupDigest.length === 0, dupDigest);

  // ═══ Scenario 6 — cross-org isolation under load ═══
  console.log("\n── 6. cross-org isolation under load (3 orgs writing at once) ──");
  await seedDonor(B, "cc6_b", "Org B Donor", { stage: "cultivate" });
  await seedDonor(C, "cc6_c", "Org C Donor", { stage: "cultivate" });
  let leaked = false, isoErr = false;
  for (let i = 0; i < N; i++) {
    const [ra, rb, rc, cross1, cross2] = await Promise.all([
      api("POST", `/donors/cc4_0/gifts`, tAdmin, { amount: 10, date: today }),   // A writes (donor from scn 4)
      api("POST", `/donors/cc6_b/gifts`, tB, { amount: 20, date: today }),        // B writes
      api("POST", `/donors/cc6_c/gifts`, tC, { amount: 30, date: today }),        // C writes
      api("POST", `/donors/cc6_b/gifts`, tC, { amount: 999, date: today }),       // C tries B's donor → 404
      api("GET", `/donors/cc6_c`, tB),                                            // B reads C's donor → 404
    ]);
    if (cross1.status !== 404 || cross2.status !== 404) leaked = true;
    if ([ra, rb, rc].some(r => r.status >= 500)) isoErr = true;
  }
  ok("6: cross-org write/read attempts always 404 under load (no leak)", !leaked);
  ok("6: legitimate concurrent writes across orgs never 500", !isoErr);
  // B/C donor totals reflect ONLY their own writes.
  ok("6: org B donor total == only B's writes", num((await donorTotal("cc6_b")).total_giving) === 20 * N, (await donorTotal("cc6_b")).total_giving);
  ok("6: org C donor total == only C's writes", num((await donorTotal("cc6_c")).total_giving) === 30 * N, (await donorTotal("cc6_c")).total_giving);

  // ═══ Scenario 7 — pool / deadlock behavior ═══
  console.log("\n── 7. pool/deadlock — heavy mixed parallel load, clean errors not corruption ──");
  await seedDonor(A, "cc7", "Pool Donor", { stage: "cultivate", owner: "u_a_off1" });
  const load = [];
  for (let i = 0; i < 40; i++) {
    const pick = i % 5;
    if (pick === 0) load.push(api("GET", "/donors?limit=20", tAdmin));
    else if (pick === 1) load.push(api("POST", `/donors/cc7/gifts`, tAdmin, { amount: 5, date: today }));
    else if (pick === 2) load.push(api("GET", "/finance/summary", tAdmin));
    else if (pick === 3) load.push(api("POST", `/pipeline/cc7/move`, tOff1, { toStage: i % 2 ? "solicit" : "cultivate", description: `load ${i}` }));
    else load.push(api("GET", "/reports/giving-summary", tAdmin));
  }
  const t0 = Date.now();
  const settled = await Promise.allSettled(load);
  const elapsed = Date.now() - t0;
  const rejected = settled.filter(s => s.status === "rejected").length;
  const server5xx = settled.filter(s => s.status === "fulfilled" && s.value.status >= 500).length;
  ok("7: no request rejected/hung under 40-way parallel load", rejected === 0, rejected);
  ok("7: no 5xx under heavy pool contention (clean errors only)", server5xx === 0, server5xx);
  ok("7: the whole 40-way burst completed promptly (< 20s, no deadlock stall)", elapsed < 20000, elapsed + "ms");
  // Totals still reconcile after the storm — no corruption.
  const cc7 = await donorTotal("cc7");
  const cc7gifts = (await q(`SELECT COALESCE(SUM(amount),0) s, COUNT(*)::int n FROM gifts WHERE donor_id='cc7'`, []))[0];
  ok("7: donor total reconciles with its gifts after the storm (no corruption)", num(cc7.total_giving) === num(cc7gifts.s) && num(cc7.gift_count) === cc7gifts.n, { cc7, cc7gifts });

  await wipe(A); await wipe(B); await wipe(C);
  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); await closeDb().catch(() => {}); process.exit(1); });
