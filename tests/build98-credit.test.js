// BUILD-98 Part 1 — SOFT CREDITS, TRIBUTES AND MATCHING GIFTS.
//
// The rule is one sentence: A GIFT IS COUNTED ONCE, ON THE PERSON WHOSE MONEY
// IT WAS. Every assertion below is a way that sentence could quietly stop
// being true:
//   §1  a DAF grant soft-credited to its recommender — hard stays on the fund,
//       the ledger posts once, the recommender is $0 hard and $1,000 with soft;
//   §2  a soft credit that cannot be right is refused, and refusing it
//       refuses the gift (nothing half-written);
//   §3  an in-memory gift drafts a notice to the family that names no amount;
//   §4  a matched gift's pledge closes in cents when the employer's cheque
//       arrives, and is never chased by a pledge reminder;
//   §5  the import mapper carries all three from a file;
//   §6  another org can read none of it.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b98c", OTHER = "org_b98c2";
const ME = "b98c@example.org", THEM = "b98c-other@example.org";
const PW = "loadtest1234";

async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of ["tribute_notices", "gift_soft_credits", "pledge_installments", "fin_transactions", "interactions",
                     "thank_you_drafts", "threads", "tasks", "workflow_runs", "gifts", "pledges", "donors",
                     "imports", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = (id, name) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address)
   VALUES ($1,$2,$3,1,'team','active','1 Main St, Lexington, KY 40507')`, [id, name, id.replace(/_/g, "-")]);
const mkUser = (id, org, email) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Barnett','admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4)]);
const mkDonor = (id, org, name, kind = "person") => q(
  `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count) VALUES ($1,$2,$3,$4,$5,'cultivate',0,0)`,
  [id, org, name, id + "@example.org", kind]);
const cents = v => Math.round(Number(v) * 100);

(async () => {
  console.log("build98-credit");
  await reset();
  await mkOrg(ORG, "Barn Buddies"); await mkOrg(OTHER, "Somebody Else");
  await mkUser("u_b98c", ORG, ME); await mkUser("u_b98c2", OTHER, THEM);
  await mkDonor("d98_schwab", ORG, "Schwab Charitable", "organisation");
  await mkDonor("d98_marg", ORG, "Margaret Ruiz");
  await mkDonor("d98_emp", ORG, "Tom Worker");
  await mkDonor("d98_acme", ORG, "Acme Manufacturing", "organisation");
  await mkDonor("d98_giver", ORG, "Grace Giver");
  await mkDonor("d98_ann", ORG, "Ann Lee");
  await mkDonor("d98_other", OTHER, "Not Yours");
  const tok = await login(ME), tok2 = await login(THEM);

  // ── pure module ─────────────────────────────────────────────────────────
  const GC = await import("../shared/giftCredit.js");
  ok("'In Memory Of' reads as memory", GC.normaliseTributeType("In Memory Of") === "memory");
  ok("'In Honor Of' reads as honour", GC.normaliseTributeType("In Honor Of") === "honor");
  ok("an unknown tribute word is not guessed", GC.normaliseTributeType("Gala") === null);
  ok("50% of $250 is $125 in cents", GC.softCreditCents(25000, { pct: 50 }).cents === 12500);
  ok("a soft credit larger than the gift is refused", !!GC.softCreditCents(25000, { amount: 300 }).error);
  ok("the family notice is never handed an amount, so it holds no dollar sign",
     !GC.tributeNoticeBody({ notifyName: "the Lee family", donorName: "Grace", honoureeName: "Ann Lee", type: "memory", orgName: "Barn Buddies" }).includes("$"));

  // ── §1 THE DAF GRANT ──────────────────────────────────────────────────────
  const r1 = await api("POST", "/donors/d98_schwab/gifts", tok, {
    amount: 1000, date: "2026-09-01", type: "daf", idempotencyKey: "b98c-daf-1",
    softCredits: [{ donorId: "d98_marg", role: "recommender" }],
  });
  ok("§1 the DAF gift is written", r1.status === 201 || r1.status === 200, JSON.stringify(r1.body).slice(0, 200));
  const dafId = r1.body?.gift?.id;
  const [schwab] = await q("SELECT total_giving FROM donors WHERE id='d98_schwab'");
  const [marg] = await q("SELECT total_giving FROM donors WHERE id='d98_marg'");
  ok("§1 Schwab's lifetime is $1,000 hard", cents(schwab.total_giving) === 100000);
  ok("§1 Margaret's lifetime is $0 hard", cents(marg.total_giving) === 0);
  const sc = await api("GET", "/donors/d98_marg/soft-credit", tok);
  ok("§1 Margaret is $0 hard on her credit view", cents(sc.body.hardCredit) === 0);
  ok("§1 and $1,000 with soft", cents(sc.body.hardPlusGiftSoft) === 100000, JSON.stringify(sc.body));
  ok("§1 the soft credit lists the giver it came from", sc.body.giftSoftCredits?.[0]?.giverName === "Schwab Charitable");
  const ledger = await q("SELECT amount FROM fin_transactions WHERE org_id=$1 AND gift_id=$2", [ORG, dafId]);
  ok("§1 the ledger posts ONCE", ledger.length === 1 && cents(ledger[0].amount) === 100000);
  const [gtot] = await q("SELECT COALESCE(SUM(amount),0) AS t FROM gifts WHERE org_id=$1", [ORG]);
  ok("§1 the org's gift total is the one $1,000, not $2,000", cents(gtot.t) === 100000);
  const td = await api("GET", "/reports/top-donors?scope=lifetime", tok);
  ok("§1 reports are hard credit unless asked — no soft column by default",
     Array.isArray(td.body.rows) && td.body.rows.every(r => r.softCredit === undefined));
  const tdSoft = await api("GET", "/reports/top-donors?scope=lifetime&credit=soft", tok);
  const schwabRow = (tdSoft.body.rows || []).find(r => r.id === "d98_schwab");
  ok("§1 asked, the soft column appears and the hard total does not move",
     schwabRow && cents(schwabRow.total) === 100000 && schwabRow.softCredit === 0);

  // ── §2 REFUSALS REFUSE THE GIFT ──────────────────────────────────────────
  const before = (await q("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1", [ORG]))[0].n;
  const self = await api("POST", "/donors/d98_marg/gifts", tok, { amount: 50, date: "2026-09-02", idempotencyKey: "b98c-self",
    softCredits: [{ donorId: "d98_marg" }] });
  ok("§2 soft-crediting the giver themselves is refused", self.status === 400);
  const over = await api("POST", "/donors/d98_giver/gifts", tok, { amount: 50, date: "2026-09-02", idempotencyKey: "b98c-over",
    softCredits: [{ donorId: "d98_marg", amount: 75 }] });
  ok("§2 a soft credit bigger than the gift is refused", over.status === 400);
  const foreign = await api("POST", "/donors/d98_giver/gifts", tok, { amount: 50, date: "2026-09-02", idempotencyKey: "b98c-foreign",
    softCredits: [{ donorId: "d98_other" }] });
  ok("§2 another org's person answers 404", foreign.status === 404);
  const after = (await q("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1", [ORG]))[0].n;
  ok("§2 and none of the three refused requests wrote a gift", after === before);

  // ── §3 IN MEMORY ──────────────────────────────────────────────────────────
  const r3 = await api("POST", "/donors/d98_giver/gifts", tok, {
    amount: 300, date: "2026-09-03", idempotencyKey: "b98c-mem",
    tribute: { type: "memory", donorId: "d98_ann", notifyName: "the Lee family", notifyEmail: "lees@example.org" },
  });
  const memId = r3.body?.gift?.id;
  ok("§3 the tribute gift is written", !!memId);
  const [mg] = await q("SELECT tribute_type, tribute_name, amount FROM gifts WHERE id=$1", [memId]);
  ok("§3 the gift carries the tribute and the honouree's name", mg.tribute_type === "memory" && mg.tribute_name === "Ann Lee");
  const notices = await api("GET", "/tribute-notices", tok);
  const n = (notices.body.notices || []).find(x => x.gift_id === memId);
  ok("§3 a notice to the family is waiting", !!n && n.status === "waiting");
  ok("§3 it is addressed to the family", n && n.body.startsWith("Dear the Lee family,"));
  ok("§3 it says in memory of the honouree", n && n.body.includes("in memory of Ann Lee"));
  ok("§3 it names NO amount", n && !n.body.includes("$") && !/\b300\b/.test(n.body));
  const [ann] = await q("SELECT total_giving FROM donors WHERE id='d98_ann'");
  ok("§3 the honouree gets no credit of any kind", cents(ann.total_giving) === 0);
  const other3 = await api("GET", "/tribute-notices", tok2);
  ok("§3 another org sees none of it", !(other3.body.notices || []).some(x => x.gift_id === memId));
  const x3 = await api("POST", `/tribute-notices/${n.id}/sent`, tok2);
  ok("§3 another org cannot mark it sent", x3.status === 404);
  const s3 = await api("POST", `/tribute-notices/${n.id}/sent`, tok);
  ok("§3 marking it sent takes it off the queue", s3.status === 200 &&
     !((await api("GET", "/tribute-notices", tok)).body.notices || []).some(x => x.gift_id === memId));

  // ── §4 THE MATCH ──────────────────────────────────────────────────────────
  const r4 = await api("POST", "/donors/d98_emp/gifts", tok, {
    amount: 250, date: "2026-09-04", idempotencyKey: "b98c-emp", match: { employerId: "d98_acme" },
  });
  const empId = r4.body?.gift?.id;
  const [pl] = await q("SELECT id, amount, status, is_match FROM pledges WHERE matches_gift_id=$1", [empId]);
  ok("§4 the expected match is a pledge on the EMPLOYER's record", pl && pl.is_match === true && cents(pl.amount) === 25000);
  const ex4 = await api("GET", `/gifts/${empId}/extras`, tok);
  ok("§4 the gift shows who will match it", ex4.body.match?.employerName === "Acme Manufacturing" && cents(ex4.body.match.expected) === 25000);
  const [acme0] = await q("SELECT total_giving FROM donors WHERE id='d98_acme'");
  ok("§4 a promise is not money — Acme's giving is still $0", cents(acme0.total_giving) === 0);
  // A second match on the same gift is refused by the DATABASE.
  const dup = await api("PUT", `/gifts/${empId}/extras`, tok, { match: { employerId: "d98_acme" } });
  const pls = await q("SELECT COUNT(*)::int AS n FROM pledges WHERE matches_gift_id=$1", [empId]);
  ok("§4 asking twice leaves exactly one match pledge", dup.status === 200 && pls[0].n === 1);
  // Past its due date, it is never counted late and never chased.
  await q("UPDATE pledges SET due_date='2026-01-01' WHERE id=$1", [pl.id]);
  await q("UPDATE pledge_installments SET due_date='2026-01-01' WHERE pledge_id=$1", [pl.id]);
  const home = await api("GET", "/dashboard/home", tok);
  ok("§4 the home screen still loads with an overdue match on file", home.status === 200);
  const late = await q(
    `SELECT COUNT(*)::int AS n FROM pledge_installments i JOIN pledges p ON p.id=i.pledge_id
      WHERE i.org_id=$1 AND i.paid_gift_id IS NULL AND p.status='open'
        AND COALESCE(p.is_shell,false)=false AND COALESCE(p.is_match,false)=false`, [ORG]);
  ok("§4 an overdue match is not a late pledge", late[0].n === 0);
  // The cheque arrives, through the ordinary gift form.
  const r4b = await api("POST", "/donors/d98_acme/gifts", tok, { amount: 250, date: "2026-09-20", idempotencyKey: "b98c-acme" });
  ok("§4 the employer's gift is written", !!r4b.body?.gift?.id);
  const [pl2] = await q("SELECT status FROM pledges WHERE id=$1", [pl.id]);
  const [inst] = await q("SELECT paid_gift_id FROM pledge_installments WHERE pledge_id=$1", [pl.id]);
  ok("§4 the match pledge closes", pl2.status === "fulfilled");
  ok("§4 on exactly the employer's gift", inst.paid_gift_id === r4b.body.gift.id);
  const [acme1] = await q("SELECT total_giving FROM donors WHERE id='d98_acme'");
  const [tom] = await q("SELECT total_giving FROM donors WHERE id='d98_emp'");
  ok("§4 in cents: Acme $250 hard, Tom $250 hard, nothing counted twice",
     cents(acme1.total_giving) === 25000 && cents(tom.total_giving) === 25000);

  // ── §5 THE IMPORT CARRIES ALL THREE ──────────────────────────────────────
  const IS = await import("../shared/importShape.js");
  const headers = ["Donor Name", "Amount", "Date", "Soft Credit", "Tribute", "Tribute Type", "Notification Recipient", "Matching Gift Company"];
  const map = IS.autoDetectTxMapping(headers, [{ Amount: "100" }]);
  // The generic mapper OFFERS these and claims none of them by header: a
  // "Matching Employer" column on a donor file is a fact about the donor, and
  // auto-mapping it would write promised money on every gift they made.
  ok("§5 the mapper offers all six targets", ["softCreditName","softCreditAmount","tributeName","tributeType","tributeNotify","matchEmployer"].every(k => k in map));
  ok("§5 …and claims none of them by header alone", ["softCreditName","softCreditAmount","tributeName","tributeType","tributeNotify","matchEmployer"].every(k => map[k] === ""));
  const chosen = { ...map, softCreditName: "Soft Credit", tributeName: "Tribute", tributeType: "Tribute Type", tributeNotify: "Notification Recipient", matchEmployer: "Matching Gift Company" };
  const fromRow = IS.giftCreditFromRow({ "Soft Credit": "Nora Newperson", "Tribute": "Pat Remembered", "Tribute Type": "In Memory Of", "Notification Recipient": "Pat's sister", "Matching Gift Company": "Acme Manufacturing" }, chosen);
  ok("§5 once a person maps them, a row carries all three as names",
     fromRow.softCredit?.name === "Nora Newperson" && fromRow.tribute?.type === "In Memory Of" && fromRow.matchEmployer === "Acme Manufacturing");
  const NP = await import("../shared/npspPreset.js");
  ok("§5 the NPSP preset maps NPSP's own tribute and matching fields by their API names",
     NP.NPSP_OPPORTUNITY_COLUMNS.tributeType.includes("npsp__tribute_type__c") && NP.NPSP_OPPORTUNITY_COLUMNS.matchEmployer.includes("npsp__matching_gift_account__c"));
  const imp = await api("POST", "/donors/import-combined", tok, {
    donors: [{ name: "Ira Importer", email: "ira@example.org" }],
    gifts: [{ donorIndex: 0, amount: 120, date: "2026-08-15", type: "cash", campaign: "",
      softCredit: { name: "Nora Newperson" },
      tribute: { name: "Pat Remembered", type: "In Memory Of", notifyName: "Pat's sister" },
      matchEmployer: "Acme Manufacturing" }],
    sourceFileName: "b98c.csv",
  });
  ok("§5 the import succeeds", imp.status === 200, JSON.stringify(imp.body).slice(0, 300));
  const gc = imp.body.giftCredit || {};
  ok("§5 it wrote the soft credit, the tribute and the match", gc.softCredits === 1 && gc.tributes === 1 && gc.matches === 1, JSON.stringify(gc));
  const [nora] = await q("SELECT id, total_giving FROM donors WHERE org_id=$1 AND name='Nora Newperson'", [ORG]);
  ok("§5 the soft-credited person was created, with $0 hard", nora && cents(nora.total_giving) === 0);
  const [pat] = await q("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND name='Pat Remembered'", [ORG]);
  ok("§5 the honouree stays a NAME — no record invented for them", pat.n === 0);
  const [acmeCount] = await q("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND name='Acme Manufacturing'", [ORG]);
  ok("§5 the employer was found, not created twice", acmeCount.n === 1);

  // ── §6 THE WALL ───────────────────────────────────────────────────────────
  const w1 = await api("GET", `/gifts/${dafId}/extras`, tok2);
  ok("§6 another org cannot read a gift's extras", w1.status === 404);
  const w2 = await api("PUT", `/gifts/${dafId}/extras`, tok2, { softCredits: [] });
  ok("§6 another org cannot change them", w2.status === 404);
  const [still] = await q("SELECT COUNT(*)::int AS n FROM gift_soft_credits WHERE gift_id=$1", [dafId]);
  ok("§6 and the soft credit is still there", still.n === 1);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
