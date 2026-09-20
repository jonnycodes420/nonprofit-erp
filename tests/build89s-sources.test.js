// BUILD-89S 89a — GIVING SOURCES: THE PIPE.
// Run: node tests/build89s-sources.test.js
//
// THE SENTENCE THIS BUILD HAS TO MAKE TRUE:
//   "Keep PayPal. Keep Zeffy. Steward reads them. It never holds or moves a
//    dollar."
//
// So this suite is organised around the ways that sentence could quietly stop
// being true, and every section is one of them.
//
//   §1  THE SEALER. A provider key is a key to somebody else's money. There is
//       no plaintext path, an envelope is bound to its tenant, and the
//       DATABASE refuses a column value that is not sealed — not just the
//       route, because routes can be bypassed and a CHECK cannot.
//   §2  THE CONTRACT. One shape crosses the line. Money in only: a payout, a
//       transfer and a fee-as-its-own-row are refused at the boundary, so no
//       part of the runner ever has to know what a payout is.
//   §3  READ ONLY, PROVABLY. Zeffy's API can delete a payment; Stripe's can
//       refund. The adapters cannot form a write, and the one exception
//       (PayPal's token POST) does not let a PayPal PAYOUT through.
//   §4  THE RUN. Forty rows twice into a fresh org: forty gifts, the total
//       exact in cents, and the second run writes NOTHING.
//   §5  THE DONOR. Exact email attaches. No match creates. A NAME that matches
//       never merges — it is reported, and the one-tap merge is already there.
//   §6  THE MONEY. The gift is the GROSS, the fee sits beside it, the fund is
//       a question rather than a guess, and the bookkeeper's row says "PayPal".
//   §7  THE LEDGER. The first read is import history and never posts (BUILD-83).
//       What arrives afterwards is a live gift and does.
//   §8  RECURRING. What the provider says, and what Steward infers and says it
//       inferred. "Looks monthly" until a person taps once.
//   §9  THE MISSED PAYMENT. One Thread, with the money and the date in it.
//       ONE — not one per day, which is the failure mode that makes a product
//       like this stop being read.
//   §10 THE WALL. Org A cannot see, sync, or disconnect org B's source.
//
// Local scratch server + Postgres (tests/README.md recipe). The server must be
// booted with STEWARD_CREDENTIAL_KEY set, or §1 correctly reports the feature
// as unavailable and the rest of the suite has nothing to read.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_b89sA", B = "org_b89sB";
const c = n => Math.round(Number(n) * 100);

// Dates are PINNED, never read off the wall clock (BUILD-84's rule for
// clock-dependent behaviour: pin the clock, never synchronise the assertion to
// it). A suite that computes "today" the same way the product does cannot fail
// when the product's idea of today is wrong.
const D = {
  may: "2026-05-14", jun: "2026-06-14", jul: "2026-07-14", aug: "2026-08-14",
  expected: "2026-09-14",          // the fifth month, which never arrives
  beforeGrace: "2026-09-18",       // four days late — still inside the grace
  afterGrace: "2026-09-20",        // six days late — this is a missed payment
};

const CHILD = ["giving_recurring", "giving_sources", "thank_you_drafts", "pledge_installments", "threads",
  "digest_sends", "notification_sends", "workflow_runs", "workflows", "moves", "opportunities", "tasks",
  "receipts", "pledges", "fin_audit_log", "metric_snapshots", "imports", "import_merges",
  "donor_relationships", "recurring_subscriptions", "fundraising_goals", "fin_transactions", "gifts",
  "interactions", "donors", "campaigns", "budgets", "accounts", "fin_funds", "users"];

async function seed(org, slug) {
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, "B89s " + slug, slug]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Ada Admin','admin')`,
    [`u_${org}`, org, `${slug}@t.local`, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active)
           VALUES ($1,$2,'4010','Individual Contributions','revenue','contributions',true)`, [`acct_${org}`, org]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES
             ($1,$2,'General Operating',false), ($3,$2,'Building Fund',true)`,
    [`ffgen_${org}`, org, `ffbld_${org}`]);
  await q(`UPDATE orgs SET default_fund_id=$2 WHERE id=$1`, [org, `ffgen_${org}`]);
}

// ── THE FIXTURE ────────────────────────────────────────────────────────────
// Forty rows that ARE money coming in, plus the four kinds of row a provider
// also returns and Steward must not turn into a gift.
//
// Inside the forty:
//   · Dana Reyes gives $50 on the 14th, four months running, and NOBODY told
//     Steward it was a subscription — this is the inference case, and the one
//     whose fifth month is withheld in §9.
//   · Marcus Bell's gifts carry PayPal's own subscription id — the provider
//     said so, and Steward states it rather than guessing it.
//   · Sarah Whitfield already exists on file under a DIFFERENT email — the
//     name collision that must never merge itself.
//   · one gift carries a fee, so §6 can prove the gross is the gift.
function fixtureRows() {
  const rows = [];
  // 4 — the inferred monthly pattern
  for (const [i, d] of [D.may, D.jun, D.jul, D.aug].entries()) {
    rows.push({ externalId: `DANA-${i}`, occurredAt: d, amountCents: 5000, feeCents: 175,
                currency: "USD", donorName: "Dana Reyes", donorEmail: "dana@example.org",
                status: "completed", memo: "Monthly gift" });
  }
  // 3 — the provider NAMED this subscription
  for (const [i, d] of [D.jun, D.jul, D.aug].entries()) {
    rows.push({ externalId: `MARC-${i}`, occurredAt: d, amountCents: 2500, feeCents: 103,
                currency: "USD", donorName: "Marcus Bell", donorEmail: "marcus@example.org",
                recurringRef: "I-SUB-MARCUS", status: "completed", memo: "Sustainer" });
  }
  // 1 — the name collision. Same name as a donor already on file, other email.
  rows.push({ externalId: "SARAH-1", occurredAt: D.aug, amountCents: 20000, feeCents: 610,
              currency: "USD", donorName: "Sarah Whitfield", donorEmail: "sarah.w.new@example.org",
              status: "completed", memo: "Annual" });
  // 32 more, one donor each, so the totals are unambiguous
  for (let i = 0; i < 32; i++) {
    rows.push({ externalId: `GIFT-${i}`, occurredAt: D.aug, amountCents: 1000 + i * 137,
                feeCents: 0, currency: "USD", donorName: `Donor ${i} Reed`,
                donorEmail: `donor${i}@example.org`, status: "completed", memo: "" });
  }
  return rows;                                  // exactly 40
}

// The rows a provider also returns, and not one of them is a gift.
const NOT_GIFTS = [
  { externalId: "XFER-1", occurredAt: D.aug, amountCents: -450000, currency: "USD",
    donorName: "", status: "completed", memo: "Transfer to bank" },
  { externalId: "PAYOUT-1", occurredAt: D.aug, amountCents: -120000, currency: "USD",
    status: "completed", memo: "Payout" },
  { externalId: "FEE-1", occurredAt: D.aug, amountCents: -320, currency: "USD",
    status: "completed", memo: "Monthly fee" },
  { externalId: "FAILED-1", occurredAt: D.aug, amountCents: 5000, currency: "USD",
    donorName: "Lapsed Card", donorEmail: "lapsed@example.org", status: "failed", memo: "" },
  { externalId: "REFUNDED-NEVER-SEEN", occurredAt: D.aug, amountCents: 7500, currency: "USD",
    donorName: "Returned Gift", donorEmail: "returned@example.org", status: "refunded", memo: "" },
];

const FIXTURE_TOTAL_CENTS = fixtureRows().reduce((s, r) => s + r.amountCents, 0);
const FIXTURE_FEE_CENTS = fixtureRows().reduce((s, r) => s + (r.feeCents || 0), 0);

(async () => {
  await seed(A, "b89sa");
  await seed(B, "b89sb");
  const tok = await login("b89sa@t.local");
  const tokB = await login("b89sb@t.local");

  const box = await import("../shared/secretBox.js");
  const lib = await import("../shared/givingSources.js");
  const reg = require("../sources");

  // ══ §1 · THE SEALER ══════════════════════════════════════════════════════
  console.log("\n— §1 · a provider key is a key to somebody else's money —");
  const KEY = "suite-master-key-0123456789abcdef";

  const env1 = box.seal("sk_live_secret_value", { aad: A, key: KEY });
  ok("a sealed envelope is a v1 envelope and does not contain its plaintext",
    box.isSealed(env1) && !env1.includes("sk_live_secret_value"), env1.slice(0, 24));
  ok("it opens back to exactly what went in",
    box.open(env1, { aad: A, key: KEY }) === "sk_live_secret_value");

  // The binding is the tenant. This is the assertion that matters: a sealed
  // blob copied from one org's row into another's must be useless.
  let crossOrg = "opened";
  try { box.open(env1, { aad: B, key: KEY }); } catch (e) { crossOrg = e.code; }
  ok("org B cannot open org A's envelope (AAD is the org id)", crossOrg === "SEALED_OPEN_FAILED", crossOrg);

  let wrongKey = "opened";
  try { box.open(env1, { aad: A, key: "a-different-master-key-0123456789" }); } catch (e) { wrongKey = e.code; }
  ok("a different master key cannot open it", wrongKey === "SEALED_OPEN_FAILED", wrongKey);

  // Tamper with the ciphertext: GCM must refuse, not return garbage.
  const parts = env1.split(".");
  const flipped = [parts[0], parts[1], parts[2], parts[3], parts[4].slice(0, -2) + (parts[4].slice(-2) === "AA" ? "AB" : "AA")].join(".");
  let tampered = "opened";
  try { box.open(flipped, { aad: A, key: KEY }); } catch (e) { tampered = e.code; }
  ok("a tampered envelope is refused, never partially decoded", tampered === "SEALED_OPEN_FAILED", tampered);

  ok("two sealings of the same secret share no bytes (per-envelope salt + iv)",
    box.seal("same", { aad: A, key: KEY }) !== box.seal("same", { aad: A, key: KEY }));

  // THE RULE: no plaintext path. Not a warning, not a fallback — a throw.
  let noKey = "sealed anyway";
  try { box.seal("secret", { env: {} }); } catch (e) { noKey = e.code; }
  ok("with no credential key configured, seal() THROWS rather than falling back",
    noKey === "CREDENTIAL_KEY_MISSING", noKey);
  ok("a short master is treated as unset, and says which problem it is",
    box.credentialsConfigured({ STEWARD_CREDENTIAL_KEY: "short" }) === false
    && box.credentialKeyProblem({ STEWARD_CREDENTIAL_KEY: "short" }) === "too_short"
    && box.credentialKeyProblem({}) === "unset");
  ok("a hint shows four characters and never the key",
    box.hint("sk_live_abcdefgh1234") === "••••1234" && box.hint("tiny") === "••••");

  // THE DATABASE REFUSES PLAINTEXT. This is the assertion that survives a
  // future code path forgetting to seal.
  let dbRefused = "accepted";
  try {
    await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,credentials_sealed)
             VALUES ($1,$2,'paypal','Plaintext','sk_live_this_is_a_readable_key')`, [`gs_bad_${A}`, A]);
  } catch (e) { dbRefused = /giving_sources_sealed_only/.test(e.message) ? "refused" : e.message; }
  ok("the DATABASE refuses a credentials column that is not a sealed envelope",
    dbRefused === "refused", dbRefused);
  await q(`DELETE FROM giving_sources WHERE id=$1`, [`gs_bad_${A}`]).catch(() => {});

  // ══ §2 · THE CONTRACT ════════════════════════════════════════════════════
  console.log("\n— §2 · one shape crosses the line, and it is money coming in —");
  const good = lib.normalizeRow({ externalId: " 8XN123 ", occurredAt: "2026-08-14T10:02:00Z",
    amountCents: 5000, feeCents: 175, currency: "usd", donorName: "  Dana Reyes ",
    donorEmail: "Dana@Example.ORG", status: "completed", memo: "x" }, { provider: "paypal" });
  ok("a good row normalizes: id trimmed, date sliced to a civil day, email folded",
    good.ok && good.row.externalId === "8XN123" && good.row.occurredAt === "2026-08-14"
    && good.row.donorEmail === "dana@example.org" && good.row.currency === "USD", good);

  for (const [why, row] of [
    ["a transfer to the bank", { externalId: "t", occurredAt: D.aug, amountCents: -450000 }],
    ["a payout", { externalId: "p", occurredAt: D.aug, amountCents: -1 }],
    ["a zero-amount line", { externalId: "z", occurredAt: D.aug, amountCents: 0 }],
  ]) {
    const n = lib.normalizeRow(row);
    ok(`${why} is refused as not-money-in`, !n.ok && n.reason === "not_money_in", n);
  }
  ok("a row with no provider id is refused — it could never de-duplicate",
    lib.normalizeRow({ occurredAt: D.aug, amountCents: 100 }).reason === "no_external_id");
  ok("an unparseable date is refused, never coerced (a guess is the wrong tax year)",
    lib.normalizeRow({ externalId: "x", occurredAt: "14/08/2026", amountCents: 100 }).reason === "bad_date");
  ok("a fee larger than the gift is refused — the adapter mapped net and gross the wrong way round",
    lib.normalizeRow({ externalId: "x", occurredAt: D.aug, amountCents: 100, feeCents: 500 }).reason === "fee_exceeds_gross");
  ok("the dedupe key is namespaced by provider, so a PayPal CSV and the PayPal API agree",
    lib.externalKey("paypal", "8XN") === "paypal:8XN" && lib.externalKey("zeffy", "8XN") !== lib.externalKey("paypal", "8XN"));

  // ══ §3 · READ ONLY, PROVABLY ═════════════════════════════════════════════
  console.log("\n— §3 · Steward reads a provider; it cannot write to one —");
  const seen = [];
  const fakeFetch = async (url, init) => { seen.push(`${init.method} ${url}`); return new Response("{}", { status: 200 }); };

  const zHttp = reg.readOnlyHttp("zeffy", { fetchImpl: fakeFetch });
  await zHttp.json("https://api.zeffy.com/api/v1/payments");
  let zWrite = "allowed";
  try { await zHttp("https://api.zeffy.com/api/v1/payments", { method: "POST" }); } catch (e) { zWrite = e.code; }
  ok("Zeffy's API can record and delete payments; Steward cannot form the request",
    zWrite === "PROVIDER_WRITE_REFUSED", zWrite);
  let zDelete = "allowed";
  try { await zHttp("https://api.zeffy.com/api/v1/payments/p_1", { method: "DELETE" }); } catch (e) { zDelete = e.code; }
  ok("a DELETE to a provider is refused too", zDelete === "PROVIDER_WRITE_REFUSED", zDelete);

  const pHttp = reg.readOnlyHttp("paypal", { fetchImpl: fakeFetch });
  const token = await pHttp.json("https://api-m.paypal.com/v1/oauth2/token", { method: "POST" });
  ok("PayPal's OAuth token POST is the one exception, and it works", token.status === 200);
  let payout = "allowed";
  try { await pHttp("https://api-m.paypal.com/v1/payments/payouts", { method: "POST" }); } catch (e) { payout = e.code; }
  ok("the exception is the TOKEN endpoint, not PayPal — a payout POST is still refused",
    payout === "PROVIDER_WRITE_REFUSED", payout);
  ok("every attempted request is recorded, so a suite can audit the whole conversation",
    zHttp.requests.length === 3 && pHttp.requests.length === 2,
    { z: zHttp.requests.length, p: pHttp.requests.length });
  ok("only the allowed requests actually reached the network",
    seen.length === 2 && seen[1].startsWith("POST https://api-m.paypal.com/v1/oauth2/token"), seen);

  // ══ §4 · THE RUN ═════════════════════════════════════════════════════════
  console.log("\n— §4 · forty rows, twice, into a fresh org —");

  // Sarah is already on file, under a DIFFERENT email. This is what makes §5's
  // collision a real collision rather than a contrivance.
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage)
           VALUES ($1,$2,'Sarah Whitfield','sarah.whitfield@oldmail.example','new','steward')`,
    [`d_sarah_${A}`, A]);

  // THE SERVER MUST BE BOOTED WITH A CREDENTIAL KEY, and when it is not, this
  // says so in one line instead of failing forty lines later on a TypeError.
  // The refusal itself is correct behaviour (there is no plaintext path), so
  // the fault is the BOOT, and the message names the variable to set.
  const ready = await api("GET", "/giving-sources/providers", tok);
  ok("the server was booted with a credential key (tests/README.md boot recipe)",
    ready.body?.credentialsReady === true,
    `STEWARD_CREDENTIAL_KEY is ${ready.body?.credentialsProblem || "missing"} on the server under test`);
  if (ready.body?.credentialsReady !== true) {
    console.log("\n  STOPPING: without STEWARD_CREDENTIAL_KEY the connect path correctly refuses, so nothing below can run.");
    await closeDb();
    summary();
    return;
  }

  const connected = await api("POST", "/giving-sources", tok, {
    provider: "paypal",
    credentials: { clientId: "pp_client_id_value", clientSecret: "pp_client_secret_value" },
  });
  ok("connecting a source stores a SEALED credential bag and nothing readable",
    connected.status === 200 && !!connected.body.id, connected.body);
  const SRC = connected.body.id;
  const [stored] = await q(`SELECT credentials_sealed FROM giving_sources WHERE id=$1`, [SRC]);
  ok("what landed in the column is a v1 envelope, not a key",
    box.isSealed(stored.credentials_sealed) && !stored.credentials_sealed.includes("pp_client_secret"),
    stored.credentials_sealed.slice(0, 16));

  const rows = fixtureRows();
  ok("the fixture is forty rows of money coming in", rows.length === 40);

  const run1 = await api("POST", `/giving-sources/${SRC}/sync-fixture`, tok,
    { rows: [...rows, ...NOT_GIFTS], today: D.beforeGrace });
  ok("the first run reports itself as a backfill", run1.body.isBackfill === true, run1.body);
  ok("forty gifts were created", run1.body.giftsCreated === 40, run1.body.giftsCreated);
  ok("the dollars created equal the fixture exactly, in cents",
    run1.body.centsCreated === FIXTURE_TOTAL_CENTS, { got: run1.body.centsCreated, want: FIXTURE_TOTAL_CENTS });
  ok("a transfer, a payout and a fee row were dropped as not-money-in",
    run1.body.dropped?.not_money_in === 3, run1.body.dropped);
  ok("a failed payment is not a gift, and is counted", run1.body.failedSkipped === 1, run1.body.failedSkipped);
  ok("a row that arrives already refunded is not written, and is counted",
    run1.body.refundsSkipped === 1, run1.body.refundsSkipped);

  const [after1] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(round(amount::numeric*100)),0)::bigint cents
                              FROM gifts WHERE org_id=$1 AND giving_source_id=$2`, [A, SRC]);
  ok("the database agrees: forty gift rows, total exact in cents",
    after1.n === 40 && Number(after1.cents) === FIXTURE_TOTAL_CENTS, after1);

  // THE ASSERTION THE WHOLE DEDUPE DESIGN EXISTS FOR.
  const run2 = await api("POST", `/giving-sources/${SRC}/sync-fixture`, tok,
    { rows: [...rows, ...NOT_GIFTS], today: D.beforeGrace });
  ok("running the same sync again creates NOTHING", run2.body.giftsCreated === 0, run2.body.giftsCreated);
  ok("and says so: forty duplicates, recognised by the provider's own id",
    run2.body.duplicates === 40, run2.body.duplicates);
  const [after2] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(round(amount::numeric*100)),0)::bigint cents
                              FROM gifts WHERE org_id=$1 AND giving_source_id=$2`, [A, SRC]);
  ok("the totals did not move on the second run",
    after2.n === 40 && Number(after2.cents) === FIXTURE_TOTAL_CENTS, after2);

  const [donorSum] = await q(`SELECT COALESCE(SUM(round(total_giving::numeric*100)),0)::bigint cents
                                FROM donors WHERE org_id=$1`, [A]);
  ok("no donor total was double-counted by the second run",
    Number(donorSum.cents) === FIXTURE_TOTAL_CENTS, { got: Number(donorSum.cents), want: FIXTURE_TOTAL_CENTS });

  // The run lands on the Imports page beside the file imports.
  const imports = await api("GET", "/imports", tok);
  const sourceRuns = (imports.body.imports || []).filter(i => i.shape === "source");
  ok("each run writes ONE row to the imports history, shape='source'",
    sourceRuns.length === 2, sourceRuns.length);
  ok("and it names the provider and what it did",
    /PayPal/.test(sourceRuns[0].name) && sourceRuns[1].giftsCreated === 40, sourceRuns.map(r => r.name));

  // ══ §5 · THE DONOR ═══════════════════════════════════════════════════════
  console.log("\n— §5 · a guessed merge is a lost donor —");
  ok("the run reported exactly one name collision", run1.body.nameCollisions?.length === 1, run1.body.nameCollisions);
  const sarahs = await q(`SELECT id,name,email,total_giving FROM donors WHERE org_id=$1 AND name='Sarah Whitfield' ORDER BY email`, [A]);
  ok("there are now TWO Sarah Whitfields — nothing merged itself", sarahs.length === 2, sarahs.map(s => s.email));
  ok("the gift landed on the NEW record, and the existing one was not touched",
    Number(sarahs.find(s => s.email === "sarah.whitfield@oldmail.example").total_giving) === 0
    && Number(sarahs.find(s => s.email === "sarah.w.new@example.org").total_giving) === 200,
    sarahs.map(s => [s.email, s.total_giving]));

  // ONE TAP, NEVER ZERO: the pair is already offered as a merge on the surface
  // that exists for exactly this, so "reported" is not a synonym for "lost".
  const dupes = await api("GET", "/donors/duplicates", tok);
  const sarahGroup = (dupes.body.groups || []).find(g =>
    g.tier === "name" && g.donors.some(d => d.name === "Sarah Whitfield"));
  ok("the collision is waiting as a one-tap merge in the duplicate review",
    !!sarahGroup && sarahGroup.donors.length === 2, sarahGroup?.reason);

  // An email that DOES match attaches rather than creating.
  const danaRows = await q(`SELECT id FROM donors WHERE org_id=$1 AND email='dana@example.org'`, [A]);
  ok("Dana's four gifts attached to ONE donor, matched on email", danaRows.length === 1, danaRows.length);
  const [danaGifts] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND donor_id=$2`, [A, danaRows[0].id]);
  ok("and all four are on her record", danaGifts.n === 4, danaGifts);

  // ══ §6 · THE MONEY ═══════════════════════════════════════════════════════
  console.log("\n— §6 · the donor gave the gross —");
  const [danaGift] = await q(`SELECT amount, processor_fee_amount, payment_method, fund_id, external_id
                                FROM gifts WHERE org_id=$1 AND external_id='paypal:DANA-0'`, [A]);
  ok("the gift amount is the GROSS, not the net", c(danaGift.amount) === 5000, danaGift.amount);
  ok("the fee is stored beside it, never as the gift", c(danaGift.processor_fee_amount) === 175, danaGift.processor_fee_amount);
  ok("the payment method is the source's name, so the bookkeeper's row says PayPal",
    danaGift.payment_method === "PayPal", danaGift.payment_method);
  ok("with no default fund set, the fund is a QUESTION and never a guess from the memo",
    danaGift.fund_id === null, danaGift.fund_id);
  ok("the external id is namespaced by provider", danaGift.external_id === "paypal:DANA-0", danaGift.external_id);
  const [feeSum] = await q(`SELECT COALESCE(SUM(round(processor_fee_amount::numeric*100)),0)::bigint cents
                              FROM gifts WHERE org_id=$1 AND giving_source_id=$2`, [A, SRC]);
  ok("every fee is accounted for, in cents", Number(feeSum.cents) === FIXTURE_FEE_CENTS,
    { got: Number(feeSum.cents), want: FIXTURE_FEE_CENTS });

  // A default fund an admin SET is honoured — that is a decision, not a guess.
  await api("PATCH", `/giving-sources/${SRC}`, tok, { defaultFundId: `ffbld_${A}` });
  const laterRows = [{ externalId: "LATE-1", occurredAt: D.expected, amountCents: 9900, feeCents: 317,
                       currency: "USD", donorName: "Nina Post", donorEmail: "nina@example.org", status: "completed" }];
  const run3 = await api("POST", `/giving-sources/${SRC}/sync-fixture`, tok, { rows: laterRows, today: D.beforeGrace });
  const [ninaGift] = await q(`SELECT fund_id FROM gifts WHERE org_id=$1 AND external_id='paypal:LATE-1'`, [A]);
  ok("once an admin names a default fund, later gifts take it",
    run3.body.giftsCreated === 1 && ninaGift.fund_id === `ffbld_${A}`, ninaGift);

  // ══ §7 · THE LEDGER ══════════════════════════════════════════════════════
  console.log("\n— §7 · the first read is history; what comes after is news —");
  const [posted1] = await q(`SELECT COUNT(*)::int n FROM fin_transactions t
                               JOIN gifts g ON g.id = t.gift_id
                              WHERE t.org_id=$1 AND g.giving_source_id=$2 AND g.external_id LIKE 'paypal:DANA%'`, [A, SRC]);
  ok("BUILD-83: the backfill posted nothing to the ledger", posted1.n === 0, posted1);
  const [posted2] = await q(`SELECT COUNT(*)::int n FROM fin_transactions WHERE org_id=$1 AND gift_id=
                              (SELECT id FROM gifts WHERE org_id=$1 AND external_id='paypal:LATE-1')`, [A]);
  ok("a gift arriving on a LATER sync is a live gift, and posts", posted2.n === 1, posted2);

  // ══ §8 · RECURRING ═══════════════════════════════════════════════════════
  console.log("\n— §8 · what the provider says, and what Steward inferred —");
  const rec = await api("GET", "/giving-recurring", tok);
  const danaRec = (rec.body.recurring || []).find(r => r.donorName === "Dana Reyes");
  const marcusRec = (rec.body.recurring || []).find(r => r.donorName === "Marcus Bell");

  ok("Marcus is monthly because PayPal SAID so", marcusRec?.confidence === "provider", marcusRec);
  ok("and his phrase states it as a fact",
    marcusRec?.phrase === "Gives $25 monthly through PayPal", marcusRec?.phrase);
  ok("Dana is monthly because Steward saw four gifts 27 to 34 days apart",
    danaRec?.confidence === "inferred" && danaRec?.giftCount === 4, danaRec);
  ok("and her phrase says Steward is GUESSING until somebody confirms it",
    danaRec?.phrase === "Looks like $50 monthly through PayPal", danaRec?.phrase);
  ok("both carry an expected next date", danaRec?.expectedNext === D.expected, danaRec?.expectedNext);
  ok("no number without a definition: the dashboard carries its own",
    /27 to 34 days/.test(rec.body.definition?.looksMonthly || "")
    && /5 days late/.test(rec.body.definition?.missed || ""), rec.body.definition);

  // 32 one-off donors must NOT look like sustainers.
  ok("a donor with one gift is not a recurring commitment",
    !(rec.body.recurring || []).some(r => /Donor \d+ Reed/.test(r.donorName)),
    (rec.body.recurring || []).map(r => r.donorName));

  const confirm = await api("POST", `/giving-recurring/${danaRec.id}/confirm`, tok, {});
  const rec2 = await api("GET", "/giving-recurring", tok);
  ok("one tap turns 'looks monthly' into a confirmed fact",
    confirm.status === 200 && rec2.body.recurring.find(r => r.id === danaRec.id).confirmed === true);

  // The pure layer's own boundaries, where the runner cannot reach them.
  const three = [
    { externalId: "a", occurredAt: "2026-06-01", amountCents: 5000, status: "completed" },
    { externalId: "b", occurredAt: "2026-07-01", amountCents: 5000, status: "completed" },
    { externalId: "c", occurredAt: "2026-08-01", amountCents: 5000, status: "completed" },
  ];
  ok("three gifts a month apart is the floor for an inference",
    lib.detectCommitments(three, { today: D.aug }).length === 1);
  ok("two is a coincidence, not a commitment",
    lib.detectCommitments(three.slice(0, 2), { today: D.aug }).length === 0);
  ok("a changed amount starts its own run — a donor who changes their gift made a decision",
    lib.detectCommitments([...three, { externalId: "d", occurredAt: "2026-09-01", amountCents: 7500, status: "completed" }],
      { today: "2026-09-01" }).length === 1);
  ok("40 days apart is not monthly",
    lib.detectCommitments(three.map((r, i) => ({ ...r, occurredAt: ["2026-06-01", "2026-07-11", "2026-08-21"][i] })),
      { today: D.aug }).length === 0);
  ok("February does not look like a missed payment: the 31st becomes the 28th",
    lib.addCivilMonths("2026-01-31", 1) === "2026-02-28");
  ok("a refunded gift is not evidence of a commitment",
    lib.detectCommitments(three.map((r, i) => (i === 1 ? { ...r, status: "refunded" } : r)), { today: D.aug }).length === 0);

  // ══ §9 · THE MISSED PAYMENT ══════════════════════════════════════════════
  console.log("\n— §9 · the follow-up that was meant and never happened —");
  await q(`DELETE FROM threads WHERE org_id=$1`, [A]);

  const early = await api("POST", "/giving-recurring/sweep", tok, { today: D.beforeGrace });
  const [threadsEarly] = await q(`SELECT COUNT(*)::int n FROM threads WHERE org_id=$1`, [A]);
  ok("four days late is LATE, not gone — the grace period is doing its job",
    early.body.opened === 0 && threadsEarly.n === 0, { early: early.body, threadsEarly });

  const late = await api("POST", "/giving-recurring/sweep", tok, { today: D.afterGrace });
  const threads = await q(`SELECT t.next_step_label, t.due_date, d.name FROM threads t
                             JOIN donors d ON d.id=t.donor_id WHERE t.org_id=$1 AND t.closed_at IS NULL`, [A]);
  ok("six days late opens a Thread", late.body.opened >= 1, late.body);
  const danaThread = threads.find(t => t.name === "Dana Reyes");
  ok("it is Dana's, and it says the money, the cadence, the source and the day",
    danaThread?.next_step_label === "Dana's monthly $50 through PayPal did not arrive on the 14th",
    danaThread?.next_step_label);
  ok("it is due TODAY — the payment is already five days past the date it was expected",
    danaThread?.due_date === D.afterGrace, danaThread?.due_date);

  // THE ASSERTION THAT KEEPS THIS PRODUCT READABLE. A follow-up list that
  // regrows every morning is a follow-up list nobody opens.
  const againSame = await api("POST", "/giving-recurring/sweep", tok, { today: D.afterGrace });
  const againLater = await api("POST", "/giving-recurring/sweep", tok, { today: "2026-09-25" });
  const [threadCount] = await q(`SELECT COUNT(*)::int n FROM threads WHERE org_id=$1 AND donor_id=
                                   (SELECT id FROM donors WHERE org_id=$1 AND email='dana@example.org')`, [A]);
  ok("ONE thread per missed payment, never one per day — three sweeps, one thread",
    againSame.body.opened === 0 && againLater.body.opened === 0 && threadCount.n === 1,
    { againSame: againSame.body.opened, againLater: againLater.body.opened, threads: threadCount.n });

  // And when the money finally arrives, the expectation moves on.
  const caughtUp = await api("POST", `/giving-sources/${SRC}/sync-fixture`, tok, {
    rows: [{ externalId: "DANA-4", occurredAt: "2026-09-22", amountCents: 5000, feeCents: 175,
             currency: "USD", donorName: "Dana Reyes", donorEmail: "dana@example.org", status: "completed" }],
    today: "2026-09-22",
  });
  const [danaAfter] = await q(`SELECT status, expected_next, missed_for FROM giving_recurring
                                 WHERE org_id=$1 AND donor_id=(SELECT id FROM donors WHERE org_id=$1 AND email='dana@example.org')`, [A]);
  ok("a payment that arrives late makes the commitment active again and moves the expectation",
    caughtUp.body.giftsCreated === 1 && danaAfter.status === "active"
    && danaAfter.expected_next === "2026-10-22" && danaAfter.missed_for === null, danaAfter);

  // ══ §10 · THE WALL ═══════════════════════════════════════════════════════
  console.log("\n— §10 · org A's source is invisible to org B —");
  const bList = await api("GET", "/giving-sources", tokB);
  ok("org B's list of sources is empty", (bList.body.sources || []).length === 0, bList.body);
  const bSync = await api("POST", `/giving-sources/${SRC}/sync`, tokB, {});
  ok("org B cannot sync org A's source", bSync.status === 404, bSync.status);
  const bDisconnect = await api("DELETE", `/giving-sources/${SRC}`, tokB);
  ok("org B cannot disconnect it either", bDisconnect.status === 404, bDisconnect.status);
  const bRec = await api("GET", "/giving-recurring", tokB);
  ok("and org B's recurring dashboard shows none of org A's donors",
    (bRec.body.recurring || []).length === 0, bRec.body.recurring);
  const [bGifts] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [B]);
  ok("not one gift crossed the wall", bGifts.n === 0, bGifts);

  // Disconnect keeps every gift. The money DID come in this way.
  const disc = await api("DELETE", `/giving-sources/${SRC}`, tok);
  const [keptGifts] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND giving_source_id=$2`, [A, SRC]);
  const [discRow] = await q(`SELECT status, credentials_sealed FROM giving_sources WHERE id=$1`, [SRC]);
  ok("disconnecting stops the syncing and keeps every gift",
    disc.status === 200 && disc.body.giftsKept === 42 && keptGifts.n === 42, { disc: disc.body, kept: keptGifts.n });
  ok("and the stored credential is destroyed on the way out",
    discRow.status === "disconnected" && discRow.credentials_sealed === null, discRow);
  const afterDisc = await api("POST", `/giving-sources/${SRC}/sync`, tok, {});
  ok("a disconnected source does not sync", afterDisc.body.error === "source_disconnected", afterDisc.body);

  await closeDb();
  summary();
})();
