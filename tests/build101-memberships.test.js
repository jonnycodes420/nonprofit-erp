// BUILD-101 Part 1 — LEVELS AND MEMBERSHIPS.
//
// The brief's one test, and the edges that make it true:
//   §1  a level whose fair-market value exceeds its price is refused at the
//       route AND by the database's own CHECK;
//   §2  a $100 membership with $25 FMV writes ONE gift of $100, ONE ledger
//       row, and a receipt saying $75 is deductible, with ONE active membership;
//   §3  a second current membership for the same person is refused BY THE
//       DATABASE (the partial unique index), and the refusal writes no money;
//   §4  a retried payment (same idempotency key) returns the same membership
//       and writes no second gift;
//   §5  org A cannot read, list or cancel org B's members;
//   §6  staff cannot set prices; expiry is worked out on the civil calendar.
//
// Standard scratch stack (tests/README.md). Fixture orgs are b101_.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "b101_org_a", B = "b101_org_b";
const PW = "loadtest1234";

async function reset() {
  for (const o of [A, B]) {
    for (const t of ["memberships", "receipts", "fin_transactions", "interactions", "thank_you_drafts", "threads", "tasks", "workflow_runs",
                     "gifts", "membership_levels", "donors", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  console.log("build101-memberships");
  await reset();
  for (const [id, name] of [[A, "Riverside Arts Center"], [B, "Other Museum"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,legal_name,ein,receipt_address,receipts_enabled)
             VALUES ($1,$2,$3,1,'team','active',$2,'12-3456789','1 Main St, Lexington, KY 40507',TRUE)`, [id, name, id.replace(/_/g, "-")]);
  const hash = bcrypt.hashSync(PW, 4);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101a',$1,'b101-admin@example.org',$2,'Rita Admin','admin')`, [A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101s',$1,'b101-staff@example.org',$2,'Sam Staff','staff')`, [A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101b',$1,'b101-other@example.org',$2,'Otto','admin')`, [B, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage) VALUES ('b101_maya',$1,'Maya Chen','maya@example.org','prospect')`, [A]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage) VALUES ('b101_bea',$1,'Bea Other','bea@example.org','prospect')`, [B]);
  // The gift path needs the chart of accounts every real org is born with.
  const tok = await login("b101-admin@example.org"), staff = await login("b101-staff@example.org"), tokB = await login("b101-other@example.org");
  await api("POST", "/onboarding/complete", tok, {});

  // ── §1 · FMV may not exceed the price ──────────────────────────────────────
  const tooRich = await api("POST", "/membership-levels", tok, { name: "Bad", price: 50, fmv: 60, term: "12_months" });
  ok("§1 the route refuses FMV above price", tooRich.status === 400 && /negative/.test(tooRich.body.error || ""), tooRich.body);
  let dbRefused = false;
  try { await q(`INSERT INTO membership_levels (id,org_id,name,price,fmv,term) VALUES ('mbl_bad',$1,'Bad',50,60,'12_months')`, [A]); }
  catch (e) { dbRefused = /check/i.test(e.message); }
  ok("§1 …and so does the database's CHECK", dbRefused);
  ok("§6 staff cannot set a price", (await api("POST", "/membership-levels", staff, { name: "X", price: 10, term: "12_months" })).status === 403);
  const lv = await api("POST", "/membership-levels", tok, { name: "Family", price: 100, fmv: 25, term: "12_months", scope: "household",
    benefits: ["Free admission for two adults", "Members' preview night"] });
  ok("§1 a $100 level with $25 of benefits is created, and says what receipts will say",
     lv.status === 201 && /\$75 is deductible/.test(lv.body.sentence || ""), lv.body);
  const levelId = lv.body.id;

  // ── §2 · one gift, one ledger row, the deductible split ────────────────────
  const giftsBefore = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [A]))[0].n;
  const join = await api("POST", "/donors/b101_maya/memberships", tok, { levelId, paymentMethod: "check", idempotencyKey: "b101-join-1" });
  ok("§2 Maya joins", join.status === 201 && join.body.membership && join.body.giftId, join.body);
  const [g] = await q(`SELECT amount, deductible_amount, quid_pro_quo_value, quid_pro_quo_desc FROM gifts WHERE id=$1`, [join.body.giftId]);
  ok("§2 ONE gift of $100", (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [A]))[0].n === giftsBefore + 1 && Number(g.amount) === 100, g);
  ok("§2 …carrying $25 of benefits and $75 deductible", Number(g.quid_pro_quo_value) === 25 && Number(g.deductible_amount) === 75, g);
  ok("§2 …described as the membership's benefits", /Family membership benefits/.test(g.quid_pro_quo_desc || ""), g.quid_pro_quo_desc);
  const ledger = await q(`SELECT COUNT(*)::int n, SUM(amount)::numeric s FROM fin_transactions WHERE gift_id=$1`, [join.body.giftId]);
  ok("§2 ONE ledger row for $100 (membership money and donation money are the same rows)",
     ledger[0].n === 1 && Number(ledger[0].s) === 100, ledger[0]);
  const rc = await api("POST", `/gifts/${join.body.giftId}/receipt`, tok, { send: false });
  const [rec] = await q(`SELECT amount, deductible_amount FROM receipts WHERE gift_id=$1 AND voided_at IS NULL`, [join.body.giftId]);
  ok("§2 the RECEIPT says $75 is deductible", rc.status < 300 && rec && Number(rec.amount) === 100 && Number(rec.deductible_amount) === 75, { status: rc.status, rec });
  const cur = await api("GET", "/donors/b101_maya/memberships", tok);
  ok("§2 ONE active membership, on the Family level", cur.body.current && cur.body.current.level_name === "Family" && cur.body.current.status === "active"
     && cur.body.memberships.length === 1, cur.body);
  const [dn] = await q(`SELECT total_giving FROM donors WHERE id='b101_maya'`);
  ok("§2 her giving total counts the $100 once", Number(dn.total_giving) === 100, dn);

  // ── §3 · the database refuses a second current membership ──────────────────
  const giftsMid = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [A]))[0].n;
  const second = await api("POST", "/donors/b101_maya/memberships", tok, { levelId, paymentMethod: "check" });
  ok("§3 a second membership is refused, and says to renew instead",
     second.status === 409 && second.body.error === "membership_current" && /Renew it/.test(second.body.message || ""), second.body);
  ok("§3 …and the refusal wrote no money", (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [A]))[0].n === giftsMid);
  let uniq = false;
  try { await q(`INSERT INTO memberships (id,org_id,donor_id,level_id,joined_on,starts_on,expires_on,status) VALUES ('mb_raw',$1,'b101_maya',$2,'2026-01-01','2026-01-01','2026-12-31','active')`, [A, levelId]); }
  catch (e) { uniq = e.code === "23505"; }
  ok("§3 the refusal is the DATABASE's: a raw second insert breaks the unique index", uniq);

  // ── §4 · a retried payment ─────────────────────────────────────────────────
  const retry = await api("POST", "/donors/b101_maya/memberships", tok, { levelId, paymentMethod: "check", idempotencyKey: "b101-join-1" });
  ok("§4 the same idempotency key returns the same membership", retry.status === 200 && retry.body.duplicate && retry.body.membership.id === join.body.membership.id, retry.body);
  ok("§4 …and writes no second gift", (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [A]))[0].n === giftsMid);

  // ── §5 · the wall ──────────────────────────────────────────────────────────
  ok("§5 org B cannot read A's member's memberships", (await api("GET", "/donors/b101_maya/memberships", tokB)).status === 404);
  const listB = await api("GET", "/memberships", tokB);
  ok("§5 org B's Members list holds none of A's", listB.status === 200 && listB.body.members.every(m => m.donor_id !== "b101_maya"));
  ok("§5 org B cannot cancel A's membership", (await api("POST", `/memberships/${join.body.membership.id}/cancel`, tokB)).status === 404);
  ok("§5 org B cannot see or edit A's levels",
     (await api("GET", "/membership-levels", tokB)).body.levels.every(l => l.id !== levelId)
     && (await api("PUT", `/membership-levels/${levelId}`, tokB, { price: 1 })).status === 404);
  ok("§5 org B cannot enroll its person on A's level", (await api("POST", "/donors/b101_bea/memberships", tokB, { levelId })).status === 404);

  // ── Members screen ─────────────────────────────────────────────────────────
  const list = await api("GET", "/memberships", tok);
  ok("the Members list shows Maya, counted once, active", list.body.members.length === 1 && list.body.byStatus.active === 1 && !!list.body.sentence, list.body);

  // ── §6 · civil-calendar expiry ─────────────────────────────────────────────
  const M = await import("../shared/membership.js");
  ok("§6 12 months from 15 March runs through 14 March", M.expiryFor({ term: "12_months", startsOn: "2026-03-15" }) === "2027-03-14");
  ok("§6 a calendar-year membership ends 31 December", M.expiryFor({ term: "calendar_year", startsOn: "2026-06-01" }) === "2026-12-31");
  ok("§6 a lifetime membership has no expiry", M.expiryFor({ term: "lifetime", startsOn: "2026-06-01" }) === null);
  ok("§6 29 February + 12 months ends 27 February", M.expiryFor({ term: "12_months", startsOn: "2028-02-29" }) === "2029-02-27");
  ok("§6 an FMV of $0 is said out loud", /whole \$100 deductible/.test(M.fmvSentence({ priceCents: 10000, fmvCents: 0 })));

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
