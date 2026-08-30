// BUILD-45 (donor portal) §1 — the prerequisite money-path fixes.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// F-3 (was OPEN since BUILD-44): gift idempotency enforced at the DATABASE.
//   - same idempotencyKey twice sequentially → 1 gift, second returns
//     duplicate:true with the original gift and runs ZERO side effects
//   - same key 50× CONCURRENTLY → exactly 1 gift / 1 ledger stamp /
//     1 interaction / donor total moved once
//   - different keys → different gifts (a deliberate second identical gift works)
//   - no key → legacy behavior (each call inserts; the client always sends one)
// F-4: imports never dedupe on (donor, amount, date) alone.
//   - import-combined: two same-day/same-amount gifts BOTH import;
//     duplicateCandidates reports them for human review
//   - external-ID rows: dedup on the ID, re-run is a cross-run no-op at the DB
//   - import-history: a no-ID row colliding with an EXISTING gift is HELD for
//     review (never silently dropped, never silently inserted);
//     includeDuplicates:true imports it after the human decides
// F-5: pledge payments apply the PAID amount against the pledge balance.
//   - $400 against a $1,000 pledge → pledge stays OPEN, balance $600
//   - fundraising "pledged" figures read the REMAINING balance, not face
//   - second $600 payment → fulfilled
//   - deleting a payment reopens only if paid falls below the amount

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG_A = "org_gi_a";
const ORG_B = "org_gi_b";
const iso = d => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());

async function fixture() {
  const CHILD = [
    "workflow_runs", "workflows", "digest_sends", "moves", "opportunities", "tasks",
    "payment_recovery_events", "recurring_subscriptions", "receipts", "pledges",
    "fin_audit_log", "fin_transactions", "gifts", "interactions", "notification_sends",
  ];
  for (const org of [ORG_A, ORG_B]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["donors", "campaigns", "fin_funds", "accounts", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Idem A','gi-a',1,'active','growth')`, [ORG_A]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_gi_a',$1,'gi-a@test.local',$2,'GI A','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_gi_a1',$1,'Ida Idem','ida.gi@test.local','mid','cultivate',0,0)`, [ORG_A]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_gi_a2',$1,'Paul Pledge','paul.gi@test.local','mid','cultivate',0,0)`, [ORG_A]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount) VALUES ('c_gi_1',$1,'Roof Fund','appeal','draft',20000)`, [ORG_A]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_gi_rev',$1,'4010','Contributions','revenue')`, [ORG_A]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_gi_gen',$1,'General',false)`, [ORG_A]);

  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Idem B','gi-b',1,'active','growth')`, [ORG_B]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_gi_b',$1,'gi-b@test.local',$2,'GI B','admin')`, [ORG_B, hash]);
}

async function counts(donorId) {
  const [g] = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS total FROM gifts WHERE donor_id=$1`, [donorId]);
  const [ft] = await q(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE donor_id=$1 AND gift_id IS NOT NULL`, [donorId]);
  const [i] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE donor_id=$1 AND type='gift'`, [donorId]);
  const [d] = await q(`SELECT total_giving::float AS tg, gift_count::int AS gc FROM donors WHERE id=$1`, [donorId]);
  return { gifts: g.n, giftTotal: g.total, ledger: ft.n, interactions: i.n, donorTotal: d.tg, donorCount: d.gc };
}

(async () => {
  await fixture();
  const tok = await login("gi-a@test.local");
  const tokB = await login("gi-b@test.local");

  // ── F-3: sequential replay ────────────────────────────────────────────────
  console.log("\n— F-3 · sequential replay —");
  const key1 = crypto.randomUUID();
  const r1 = await api("POST", "/donors/d_gi_a1/gifts", tok, { amount: 250, date: TODAY, idempotencyKey: key1 });
  ok("first create 201", r1.status === 201, r1.body);
  const r2 = await api("POST", "/donors/d_gi_a1/gifts", tok, { amount: 250, date: TODAY, idempotencyKey: key1 });
  ok("replay 200 + duplicate:true", r2.status === 200 && r2.body.duplicate === true, r2.body);
  ok("replay returns the ORIGINAL gift id", r2.body.gift && r2.body.gift.id === r1.body.gift.id, r2.body.gift);
  let c = await counts("d_gi_a1");
  ok("exactly 1 gift row", c.gifts === 1, c);
  ok("exactly 1 ledger stamp", c.ledger === 1, c);
  ok("exactly 1 gift interaction", c.interactions === 1, c);
  ok("donor total moved ONCE ($250)", c.donorTotal === 250 && c.donorCount === 1, c);

  // Different key → a deliberate second identical gift is a new gift.
  const r3 = await api("POST", "/donors/d_gi_a1/gifts", tok, { amount: 250, date: TODAY, idempotencyKey: crypto.randomUUID() });
  ok("different key → second gift created", r3.status === 201 && r3.body.gift.id !== r1.body.gift.id, r3.body);
  c = await counts("d_gi_a1");
  ok("2 gifts / 2 stamps / total $500", c.gifts === 2 && c.ledger === 2 && c.donorTotal === 500, c);

  // A key from org A must not block org B (constraint is org-scoped).
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_gi_b1',$1,'Bea B','bea.gi@test.local','new','cultivate',0,0)`, [ORG_B]).catch(() => {});
  const rB = await api("POST", "/donors/d_gi_b1/gifts", tokB, { amount: 99, date: TODAY, idempotencyKey: key1 });
  ok("same key in ANOTHER org creates normally (org-scoped unique)", rB.status === 201, rB.body);

  // ── F-3: 50× concurrent ──────────────────────────────────────────────────
  console.log("\n— F-3 · 50× concurrent —");
  const key50 = crypto.randomUUID();
  const before = await counts("d_gi_a1");
  const burst = await Promise.all(Array.from({ length: 50 }, () =>
    api("POST", "/donors/d_gi_a1/gifts", tok, { amount: 777, date: TODAY, idempotencyKey: key50 })));
  const created = burst.filter(r => r.status === 201).length;
  const dups = burst.filter(r => r.status === 200 && r.body && r.body.duplicate === true).length;
  ok("50 parallel submits → exactly 1 created", created === 1, { created, dups, statuses: [...new Set(burst.map(b => b.status))] });
  ok("the other 49 all answered duplicate (no 5xx)", dups === 49, { created, dups });
  c = await counts("d_gi_a1");
  ok("exactly 1 new gift row from the burst", c.gifts === before.gifts + 1, { before, after: c });
  ok("exactly 1 new ledger stamp from the burst", c.ledger === before.ledger + 1, { before, after: c });
  ok("donor total moved once (+$777)", c.donorTotal === before.donorTotal + 777, { before, after: c });
  const wf = await q(`SELECT COUNT(*)::int AS n FROM workflow_runs WHERE org_id=$1`, [ORG_A]);
  ok("no duplicate workflow fires from the burst (dedup key holds)", wf[0].n <= 3, wf);

  // ── F-5: partial pledge payments ─────────────────────────────────────────
  console.log("\n— F-5 · partial pledge payments —");
  const pl = await api("POST", "/donors/d_gi_a2/pledges", tok, { amount: 1000, dueDate: "2026-12-31", notes: "F-5 pledge" });
  ok("pledge created open", pl.status === 201 || pl.status === 200, pl.body);
  const pledgeId = (pl.body && (pl.body.id || (pl.body.pledge && pl.body.pledge.id)));
  ok("pledge id present", !!pledgeId, pl.body);

  const pay1 = await api("POST", "/donors/d_gi_a2/gifts", tok, { amount: 400, date: TODAY, pledgeId, idempotencyKey: crypto.randomUUID() });
  ok("partial $400 payment accepted", pay1.status === 201, pay1.body);
  ok("pledge stays OPEN after partial", pay1.body.pledge && pay1.body.pledge.status === "open", pay1.body.pledge);
  ok("pledge paid_amount 400 / balance 600",
    pay1.body.pledge && Number(pay1.body.pledge.paid_amount) === 400 && Number(pay1.body.pledge.balance) === 600, pay1.body.pledge);

  const list1 = await api("GET", "/donors/d_gi_a2/pledges", tok);
  const lp = (list1.body || []).find(p => p.id === pledgeId);
  ok("pledge read carries paid/balance", lp && Number(lp.paid_amount) === 400 && Number(lp.balance) === 600, lp);

  // Fundraising/solicitations "pledged" figures read the REMAINING balance.
  const sol = await api("GET", "/reports/solicitations", tok);
  ok("solicitations openPledges total = remaining $600 (not face $1,000)",
    sol.status === 200 && sol.body.openPledges && Number(sol.body.openPledges.total) === 600,
    sol.body && sol.body.openPledges);

  const pay2 = await api("POST", "/donors/d_gi_a2/gifts", tok, { amount: 600, date: TODAY, pledgeId, idempotencyKey: crypto.randomUUID() });
  ok("second $600 payment fulfills", pay2.status === 201 && pay2.body.pledge && pay2.body.pledge.status === "fulfilled", pay2.body.pledge);
  ok("fulfilled balance 0", Number(pay2.body.pledge.balance) === 0, pay2.body.pledge);

  // Deleting the $400 payment drops paid to $600 < $1,000 → reopens honestly.
  const g400 = await q(`SELECT id FROM gifts WHERE donor_id='d_gi_a2' AND amount=400 AND pledge_id=$1`, [pledgeId]);
  const del = await api("DELETE", "/gifts/" + g400[0].id, tok);
  ok("payment delete ok", del.status === 200, del.body);
  const afterDel = await q(`SELECT status, fulfilled_gift_id FROM pledges WHERE id=$1`, [pledgeId]);
  ok("pledge REOPENS when payments fall below amount", afterDel[0].status === "open", afterDel[0]);

  // Over-payment: a $500 payment against the $400 remaining fulfills; balance 0.
  const pay3 = await api("POST", "/donors/d_gi_a2/gifts", tok, { amount: 500, date: TODAY, pledgeId, idempotencyKey: crypto.randomUUID() });
  ok("over-payment fulfills, balance clamps to 0",
    pay3.body.pledge && pay3.body.pledge.status === "fulfilled" && Number(pay3.body.pledge.balance) === 0, pay3.body.pledge);

  // ── F-4: import-combined — twins import, never collapse ──────────────────
  console.log("\n— F-4 · import-combined twins —");
  const imp = await api("POST", "/donors/import-combined", tok, {
    donors: [{ name: "Sunday Giver", email: "sunday.gi@test.local" }],
    gifts: [
      { donorIndex: 0, amount: 100, date: "2026-08-02", type: "cash" },
      { donorIndex: 0, amount: 100, date: "2026-08-02", type: "cash" },
      { donorIndex: 0, amount: 100, date: "2026-08-02", type: "cash" },
    ],
  });
  ok("import 200", imp.status === 200, imp.body);
  ok("ALL THREE same-day/same-amount gifts imported (no silent collapse)", imp.body.giftsInserted === 3, imp.body);
  ok("duplicateCandidates reports 2 twins for review", imp.body.duplicateCandidates && imp.body.duplicateCandidates.withinFile === 2, imp.body.duplicateCandidates);
  const sg = await q(`SELECT id FROM donors WHERE org_id=$1 AND email='sunday.gi@test.local'`, [ORG_A]);
  const sgGifts = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS t FROM gifts WHERE donor_id=$1`, [sg[0].id]);
  ok("donor holds $300 across 3 rows", sgGifts[0].n === 3 && sgGifts[0].t === 300, sgGifts[0]);

  // External-ID rows: dedup on the ID within-file AND cross-run at the DB.
  const impId = await api("POST", "/donors/import-combined", tok, {
    donors: [{ name: "Ext Id Donor", email: "extid.gi@test.local" }],
    gifts: [
      { donorIndex: 0, amount: 50, date: "2026-08-01", externalId: "TXN-001" },
      { donorIndex: 0, amount: 50, date: "2026-08-01", externalId: "TXN-002" },
      { donorIndex: 0, amount: 50, date: "2026-08-01", externalId: "TXN-001" }, // within-file dup
    ],
  });
  ok("external-ID: 2 distinct IDs import, within-file dup dropped",
    impId.body.giftsInserted === 2 && impId.body.externalIdDupes === 1, impId.body);

  // ── F-4: import-history — held for review, external-ID idempotent ────────
  console.log("\n— F-4 · import-history held-for-review —");
  const ed = await q(`SELECT id FROM donors WHERE org_id=$1 AND email='extid.gi@test.local'`, [ORG_A]);
  const edId = ed[0].id;
  // Re-run the same external IDs against the (now existing) donor → cross-run no-op.
  const rerun = await api("POST", "/gifts/import-history", tok, {
    gifts: [
      { donorId: edId, amount: 50, date: "2026-08-01", externalId: "TXN-001" },
      { donorId: edId, amount: 50, date: "2026-08-01", externalId: "TXN-002" },
    ],
  });
  ok("external-ID re-run inserts ZERO (DB-level cross-run idempotency)",
    rerun.status === 200 && rerun.body.inserted === 0 && rerun.body.externalIdDupes === 2, rerun.body);

  // BUILD-72 Part 1 — REVIEWED MONEY-CONTRACT CHANGE. A no-ID row matching an
  // existing gift used to be HELD and NOT inserted unless the caller re-sent
  // with includeDuplicates:true — i.e. the DEFAULT WAS SKIP. Steward cannot
  // tell two gala tickets from a doubled file, so a default of skip loses real
  // money every time it guesses wrong. The default is now KEEP ALL: the row is
  // imported and its group is surfaced for review.
  const held = await api("POST", "/gifts/import-history", tok, {
    gifts: [
      { donorId: edId, amount: 50, date: "2026-08-01" },          // collides with TXN-001's (donor,date,amount)
      { donorId: edId, amount: 75, date: "2026-08-03" },          // clean row
    ],
  });
  ok("BOTH rows import — the colliding one is never held back",
    held.body.inserted === 2, held.body);
  ok("nothing is held (the field survives, always empty)",
    Array.isArray(held.body.heldForReview) && held.body.heldForReview.length === 0, held.body.heldForReview);
  ok("the collision is SURFACED as a matches_existing group",
    held.body.matchesExistingCount === 1
    && held.body.duplicateGroups.some(g => g.kind === "matches_existing" && g.amount === 50 && g.date === "2026-08-01"),
    held.body.duplicateGroups);
  ok("import-history reconciles: 2 in, 2 created, 0 lost",
    held.body.reconciliation.balanced === true
    && held.body.reconciliation.rows.inFile === 2
    && held.body.reconciliation.rows.created === 2, held.body.reconciliation);

  // Deselecting is the user's EXPLICIT act, by rowKey — and it is counted.
  const deselected = await api("POST", "/gifts/import-history", tok, {
    skipRowKeys: [`${edId}|2026-08-05|60`],
    gifts: [
      { donorId: edId, amount: 60, date: "2026-08-05" },   // user deselected this one
      { donorId: edId, amount: 70, date: "2026-08-05" },   // kept
    ],
  });
  ok("a deselected row is skipped, and COUNTED as user_deselected",
    deselected.body.inserted === 1
    && deselected.body.reconciliation.skippedReasons.user_deselected?.rows === 1
    && deselected.body.reconciliation.skippedReasons.user_deselected?.dollars === 60,
    deselected.body.reconciliation);
  ok("an import with a deliberate skip still reconciles",
    deselected.body.reconciliation.balanced === true
    && deselected.body.reconciliation.rows.inFile === 2
    && deselected.body.reconciliation.rows.created === 1
    && deselected.body.reconciliation.rows.skipped === 1, deselected.body.reconciliation);

  const edGifts = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE donor_id=$1`, [edId]);
  ok("donor ends with 5 gifts (2 ext-ID + $75 + kept $50 + kept $70)", edGifts[0].n === 5, edGifts[0]);

  // Two same-day/same-amount rows WITHIN one history file both import.
  const twins = await api("POST", "/gifts/import-history", tok, {
    gifts: [
      { donorId: edId, amount: 20, date: "2026-08-04" },
      { donorId: edId, amount: 20, date: "2026-08-04" },
    ],
  });
  ok("within-file twins in history BOTH import + reported",
    twins.body.inserted === 2 && twins.body.duplicateCandidates.withinFile === 1, twins.body);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
