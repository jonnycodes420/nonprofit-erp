// TRANS-1 — KEEP YOUR OLD SYSTEM WHILE YOU SETTLE IN.
//
// THE ONE TEST this build earns, and it guards money and donor data: an org
// that is still running DonorPerfect re-exports every week during the move.
// The brief's sentence is the assertion:
//
//   importing the same export twice, and then an updated export with five new
//   gifts, leaves exactly the original gifts plus five, with totals equal to
//   the file to the cent.
//
// WHY IT EXISTS. Until this build the importer matched a person by EMAIL and
// nothing else, while `external_donor_id` was written on the way in and never
// read again. So the one thing a fundraiser actually does mid-move — correct a
// typo'd address in the old system, then export again — produced a SECOND
// record, because the only key Steward matched on was the one she had just
// changed. §3 is that exact story, and it is the reason the match order now
// puts the source system's own id first.
//
// WHAT WOULD MAKE IT FAIL (the CLAUDE.md rule that a guard must be proven
// able to fail): reverting the match order in /donors/import-combined so email
// is tried first makes §3 red, because Ivy Chen arrives with a new address and
// becomes a seventh donor carrying her own copy of the history. Dropping the
// gift external-id guard makes §2 red with 24 gifts instead of 12. Both were
// planted and watched go red before this suite was trusted.
//
// Every figure below is hand-computed from the fixture rows in cents, never
// read back from Steward and then asserted against itself.
//
// Local scratch server + Postgres (tests/README.md recipe).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_trans1re";

// ── THE FILE, and its answer key ───────────────────────────────────────────
//
// A DonorPerfect-shaped gift export: a stable donor_id per person, a unique
// gift_id per gift. Amounts carry cents on purpose — a total that is right to
// the dollar and wrong to the cent is the failure this build is selling
// against.
//
//   Ann Rivers   4001: 100.00 + 250.50             =  350.50
//   Ben Ortiz    4002:  75.25 +  15.00             =   90.25
//   Dan Lee      4003:  40.00 + 1200.00            = 1240.00
//   Carla Diaz   4004: 500.01 + 114.00             =  614.01
//   Ivy Chen     4005:  33.33 +  66.67 +  10.00    =  110.00
//   Hal Moss     4006: 925.75                      =  925.75
//                                          12 rows, ─────────
//                                                    3330.51
const RUN1 = [
  ["4001", "Ann",   "Rivers", "ann.rivers@trans1.test",  "9001", "2025-01-15", 10000],
  ["4001", "Ann",   "Rivers", "ann.rivers@trans1.test",  "9002", "2025-03-02", 25050],
  ["4002", "Ben",   "Ortiz",  "ben.ortiz@trans1.test",   "9003", "2025-02-10",  7525],
  ["4003", "Dan",   "Lee",    "dan.lee@trans1.test",     "9004", "2025-04-20",  4000],
  ["4003", "Dan",   "Lee",    "dan.lee@trans1.test",     "9005", "2025-06-01", 120000],
  ["4004", "Carla", "Diaz",   "carla.diaz@trans1.test",  "9006", "2025-05-05", 50001],
  ["4005", "Ivy",   "Chen",   "ivy.chen@trans1.test",    "9007", "2025-07-11",  3333],
  ["4005", "Ivy",   "Chen",   "ivy.chen@trans1.test",    "9008", "2025-08-19",  6667],
  ["4005", "Ivy",   "Chen",   "ivy.chen@trans1.test",    "9009", "2025-09-01",  1000],
  ["4006", "Hal",   "Moss",   "hal.moss@trans1.test",    "9010", "2025-10-30", 92575],
  ["4002", "Ben",   "Ortiz",  "ben.ortiz@trans1.test",   "9011", "2025-11-14",  1500],
  ["4004", "Carla", "Diaz",   "carla.diaz@trans1.test",  "9012", "2025-12-24", 11400],
];
// Hand-added, not summed by the code under test.
const RUN1_GIFTS = 12;
const RUN1_CENTS = 10000 + 25050 + 7525 + 4000 + 120000 + 50001
                 + 3333 + 6667 + 1000 + 92575 + 1500 + 11400;   // 333,051

// THE FIVE NEW GIFTS in the updated export. Ivy Chen's e-mail is ALSO
// corrected in the old system between exports (ivy.chen@ → i.chen@), which is
// the whole point: she must match on donor_id 4005 and stay ONE person.
const NEW5 = [
  ["4001", "Ann",   "Rivers", "ann.rivers@trans1.test",  "9013", "2026-01-05", 20000],
  ["4005", "Ivy",   "Chen",   "i.chen@trans1.test",      "9014", "2026-01-09",  4444],
  ["4006", "Hal",   "Moss",   "hal.moss@trans1.test",    "9015", "2026-01-12", 75025],
  ["4002", "Ben",   "Ortiz",  "ben.ortiz@trans1.test",   "9016", "2026-01-20",  9999],
  ["4003", "Dan",   "Lee",    "dan.lee@trans1.test",     "9017", "2026-01-28",   250],
];
const NEW5_CENTS = 20000 + 4444 + 75025 + 9999 + 250;   // 109,718

const PEOPLE = 6;

// The payload the mapper builds for a transaction-shaped file: one donor entry
// per row with its source id, and one gift per row pointing at that entry.
// Deliberately NOT pre-grouped, because the un-grouped shape is what exposes
// whether the SERVER matches on the id.
function payload(rows) {
  const donors = rows.map(([extId, first, last, email]) => ({
    name: `${first} ${last}`, email, externalDonorId: extId, stage: "prospect",
  }));
  const gifts = rows.map(([, , , , giftId, date, cents], i) => ({
    donorIndex: i, externalId: giftId, date,
    amount: cents / 100, type: "cash", campaign: "", notes: "",
  }));
  return { donors, gifts };
}

async function reset() {
  const CHILD = ["workflow_runs","workflows","digest_sends","moves","opportunities","tasks",
    "payment_recovery_events","recurring_subscriptions","receipts","pledges","fin_audit_log",
    "fin_transactions","gifts","interactions","notification_sends","import_merges","imports"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors","campaigns","fin_funds","accounts","budgets","users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'TRANS-1 Re-import','trans1-reimport',1,'active','growth')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_trans1re',$1,'trans1re@test.local',$2,'Move Admin','admin')`,
          [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type)
           VALUES ('acct_trans1re',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted)
           VALUES ('fund_trans1re',$1,'General',false)`, [ORG]);
}

// Totals in CENTS, from the database, so the comparison is integer-exact and
// never a float that "looks like" the file.
const totals = async () => (await q(
  `SELECT COUNT(*)::int gifts, COALESCE(SUM(ROUND(amount*100)),0)::bigint cents
     FROM gifts WHERE org_id=$1`, [ORG]))[0];
const peopleCount = async () => Number((await q(
  `SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]))[0].n);

(async () => {
  await reset();
  const tok = await login("trans1re@test.local");

  // Sanity on the answer key itself: a fixture whose own arithmetic is wrong
  // proves nothing about the product.
  ok(`the file is ${RUN1_GIFTS} rows and $3,330.51 by hand`,
     RUN1.length === RUN1_GIFTS && RUN1_CENTS === 333051, { rows: RUN1.length, cents: RUN1_CENTS });
  ok("the updated export adds 5 rows and $1,097.18 by hand",
     NEW5.length === 5 && NEW5_CENTS === 109718, { rows: NEW5.length, cents: NEW5_CENTS });

  // ── §1 · the first import ────────────────────────────────────────────────
  console.log("\n— §1 · the first import lands the whole file —");
  const r1 = await api("POST", "/donors/import-combined", tok, payload(RUN1));
  ok("import 200", r1.status === 200, r1.body);
  const t1 = await totals();
  ok(`${RUN1_GIFTS} gifts on file`, t1.gifts === RUN1_GIFTS, t1);
  ok("the total equals the file TO THE CENT", Number(t1.cents) === RUN1_CENTS,
     { held: Number(t1.cents), file: RUN1_CENTS });
  ok(`${PEOPLE} people, one per donor_id`, (await peopleCount()) === PEOPLE, await peopleCount());
  ok("the reconciliation balanced", r1.body.reconciliation && r1.body.reconciliation.balanced === true,
     r1.body.reconciliation);

  // ── §2 · the SAME export again — nothing is duplicated ───────────────────
  console.log("\n— §2 · the same export a second time changes nothing —");
  const r2 = await api("POST", "/donors/import-combined", tok, payload(RUN1));
  ok("import 200", r2.status === 200, r2.body);
  const t2 = await totals();
  ok(`still exactly ${RUN1_GIFTS} gifts — not ${RUN1_GIFTS * 2}`, t2.gifts === RUN1_GIFTS, t2);
  ok("the total is unchanged, to the cent", Number(t2.cents) === RUN1_CENTS,
     { held: Number(t2.cents), file: RUN1_CENTS });
  ok(`still ${PEOPLE} people`, (await peopleCount()) === PEOPLE, await peopleCount());
  ok(`all ${RUN1_GIFTS} gifts were recognised as already imported`,
     r2.body.externalIdDupes === RUN1_GIFTS, { externalIdDupes: r2.body.externalIdDupes });
  ok("every person was matched by the old system's own id, not by email",
     r2.body.matchedByExternalId === RUN1.length && r2.body.matchedByEmail === 0,
     { byId: r2.body.matchedByExternalId, byEmail: r2.body.matchedByEmail });

  // ── §3 · the updated export: 5 new gifts, and a corrected address ────────
  console.log("\n— §3 · an updated export adds exactly five gifts —");
  const r3 = await api("POST", "/donors/import-combined", tok, payload([...RUN1, ...NEW5]));
  ok("import 200", r3.status === 200, r3.body);
  const t3 = await totals();
  ok(`exactly ${RUN1_GIFTS} + 5 = ${RUN1_GIFTS + 5} gifts`, t3.gifts === RUN1_GIFTS + 5, t3);
  ok("the total equals the file TO THE CENT",
     Number(t3.cents) === RUN1_CENTS + NEW5_CENTS,
     { held: Number(t3.cents), file: RUN1_CENTS + NEW5_CENTS });
  ok(`still ${PEOPLE} people — a corrected e-mail did NOT mint a seventh`,
     (await peopleCount()) === PEOPLE, await peopleCount());

  // Ivy is the story: her address changed in the old system between exports.
  const ivy = await q(
    `SELECT d.id, d.email, COUNT(g.*)::int gifts, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint cents
       FROM donors d LEFT JOIN gifts g ON g.donor_id=d.id
      WHERE d.org_id=$1 AND d.external_donor_id='4005' AND d.deleted_at IS NULL
      GROUP BY d.id, d.email`, [ORG]);
  ok("Ivy Chen is ONE record, matched on donor_id 4005", ivy.length === 1, ivy);
  ok("Ivy's four gifts are all on that one record — $154.44",
     ivy.length === 1 && ivy[0].gifts === 4 && Number(ivy[0].cents) === 3333 + 6667 + 1000 + 4444,
     ivy[0]);

  // And the file's own total, footed one last time against every gift row.
  const perPerson = await q(
    `SELECT d.external_donor_id ext, COUNT(g.*)::int gifts, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint cents
       FROM donors d JOIN gifts g ON g.donor_id=d.id
      WHERE d.org_id=$1 AND d.deleted_at IS NULL
      GROUP BY d.external_donor_id ORDER BY d.external_donor_id`, [ORG]);
  const expected = { "4001": [3, 10000 + 25050 + 20000], "4002": [3, 7525 + 1500 + 9999],
                     "4003": [3, 4000 + 120000 + 250],   "4004": [2, 50001 + 11400],
                     "4005": [4, 3333 + 6667 + 1000 + 4444], "4006": [2, 92575 + 75025] };
  let allMatch = perPerson.length === PEOPLE;
  for (const r of perPerson) {
    const e = expected[r.ext];
    if (!e || r.gifts !== e[0] || Number(r.cents) !== e[1]) allMatch = false;
  }
  ok("every donor_id's own rows and cents match the file",
     allMatch, perPerson.map(r => `${r.ext}: ${r.gifts}/${r.cents}`).join(" "));
  const footed = perPerson.reduce((s, r) => s + Number(r.cents), 0);
  ok("the per-person totals FOOT to the file total",
     footed === RUN1_CENTS + NEW5_CENTS, { footed, file: RUN1_CENTS + NEW5_CENTS });

  // ── §4 · the sentence the org reads afterwards ───────────────────────────
  console.log("\n— §4 · 'since last time' says what the run actually did —");
  const { buildSinceLastTime } = await import("../shared/movePlan.js");
  const since = buildSinceLastTime({
    giftsCreated: 5, centsCreated: NEW5_CENTS, peopleCreated: 0,
    giftsAlreadyHeld: RUN1_GIFTS, peopleMatched: PEOPLE,
  });
  ok("it leads with the five new gifts and their exact total",
     since.sentence.includes("5 new gifts, $1,097.18"), since.sentence);
  ok("it says the rest were already on file, and were not imported again",
     since.sentence.includes("12 gifts were already on file"), since.sentence);

  summary();
  await closeDb();
})().catch(e => { console.error(e); process.exit(1); });
