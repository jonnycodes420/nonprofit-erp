// BUILD-92 A3 — THE SAME GIFT FROM TWO PLACES (was BUILD-91 91a).
//
// De-duplication is per source, by the provider's own id, and that is the
// right key: forty $100 Sunday gifts are forty gifts, and only the provider
// can say which two of its rows are one payment.
//
// But Donorbox runs on the ORGANISATION'S OWN Stripe and PayPal. Connect all
// three and the same money arrives three times under three ids. Nothing in the
// product was watching for it, so every figure - the donor's lifetime giving,
// the campaign thermometer, the bookkeeper's export - trebled.
//
// The rule, and what this suite proves:
//   · a row from source B matching a gift already on file from a DIFFERENT
//     source on the amount to the cent, the date within two days, and the
//     donor, is NOT written. It becomes ONE LINE that asks.
//   · never silently dropped: the provider's whole row is kept, and
//     "Keep both" writes it.
//   · never silently doubled: "Same gift" puts the second id on the gift that
//     is already there, so the question never returns on any future sync.
//   · ONE SHORTCUT, per source: "sits on top of" resolves every match between
//     two sources without asking.
//   · CROSS-SOURCE ONLY. Two genuine same-day $50 gifts from one donor inside
//     ONE source are two gifts, and this rule cannot see them.
//
// THE SHAPE OF THE PROOF: twenty gifts through two fake adapters.
//   without the shortcut -> 20 gifts and 20 questions
//   with the shortcut    -> 20 gifts and ZERO questions
//   totals exact in cents in both.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_b92dupA", B = "org_b92dupB";

// Dates are PINNED. Nothing here asks the server what day it is.
const DAY0 = "2026-06-10";
const TODAY = "2026-06-30";

const CHILD = ["gift_duplicate_questions", "giving_recurring", "giving_sources", "thank_you_drafts",
  "pledge_installments", "threads", "digest_sends", "notification_sends", "workflow_runs", "workflows",
  "moves", "opportunities", "tasks", "receipts", "pledges", "fin_audit_log", "metric_snapshots",
  "imports", "import_merges", "donor_relationships", "recurring_subscriptions", "fundraising_goals",
  "fin_transactions", "gifts", "interactions", "donors", "campaigns", "budgets", "accounts",
  "fin_funds", "users"];

async function seed(org, slug) {
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => { });
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => { });
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, "B92dup " + slug, slug]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Ada Admin','admin')`,
    [`u_${org}`, org, `${slug}@t.local`, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active)
           VALUES ($1,$2,'4010','Individual Contributions','revenue','contributions',true)`, [`acct_${org}`, org]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, [`ffgen_${org}`, org]);
}

const addDays = (d, n) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const x = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

// TWENTY donors, twenty distinct amounts, twenty distinct days. Distinct
// amounts on purpose: if the matcher were sloppy about the amount it would
// match the wrong row and the cents would still add up, which would be a test
// that cannot fail.
const N = 20;
const people = Array.from({ length: N }, (_, i) => ({
  name: `Donor ${String(i + 1).padStart(2, "0")}`,
  email: `d${i + 1}@b92dup.test`,
  cents: 2500 + i * 137,                     // $25.00, $26.37, $27.74, …
  date: addDays(DAY0, i % 5),                // spread over five days
}));
const TOTAL_CENTS = people.reduce((s, p) => s + p.cents, 0);

// Source A's rows: the truth, as PayPal reported it.
const rowsA = () => people.map((p, i) => ({
  externalId: `pp_${i}`, occurredAt: p.date, amountCents: p.cents, feeCents: 0,
  currency: "USD", donorName: p.name, donorEmail: p.email, status: "completed", memo: "",
}));
// Source B's rows: THE SAME MONEY, under Donorbox's own ids, and reported one
// day later - which is the realistic case and the reason the window exists.
const rowsB = () => people.map((p, i) => ({
  externalId: `db_${i}`, occurredAt: addDays(p.date, 1), amountCents: p.cents, feeCents: 0,
  currency: "USD", donorName: p.name, donorEmail: p.email, status: "completed", memo: "",
}));

async function connect(tok, provider, displayName) {
  const r = await api("POST", "/giving-sources", tok, {
    provider, displayName, credentials: provider === "paypal"
      ? { clientId: "id_" + provider, clientSecret: "secret_" + provider }
      : { apiKey: "key_" + provider },
  });
  return r.body?.id;
}
const centsOf = async org => {
  const [r] = await q(`SELECT COALESCE(ROUND(SUM(amount*100)),0)::int AS c, COUNT(*)::int AS n
                         FROM gifts WHERE org_id=$1`, [org]);
  return { cents: r.c, n: r.n };
};

(async () => {
  console.log("BUILD-92 A3 — the same gift from two places\n");

  // ══ §1 · WITHOUT the shortcut: 20 gifts and 20 questions ═════════════════
  console.log("— §1 · two sources, one set of gifts, twenty questions —");
  await seed(A, "b92dupa");
  const tok = await login("b92dupa@t.local");

  const SRC_A = await connect(tok, "paypal", "PayPal");
  const SRC_B = await connect(tok, "givebutter", "Donorbox");
  ok("two sources connect", !!SRC_A && !!SRC_B, { SRC_A, SRC_B });

  const runA = await api("POST", `/giving-sources/${SRC_A}/sync-fixture`, tok, { rows: rowsA(), today: TODAY });
  ok("the first source writes twenty gifts", runA.body?.giftsCreated === N, runA.body);
  const afterA = await centsOf(A);
  ok("...and the cents are exact", afterA.cents === TOTAL_CENTS, { got: afterA.cents, want: TOTAL_CENTS });

  const runB = await api("POST", `/giving-sources/${SRC_B}/sync-fixture`, tok, { rows: rowsB(), today: TODAY });
  ok("the second source writes NOTHING — the money is already here", runB.body?.giftsCreated === 0, runB.body);
  ok("...and says so as twenty questions, counted on its own axis",
    runB.body?.duplicateQuestions === N, runB.body?.duplicateQuestions);
  const afterB = await centsOf(A);
  ok("TWENTY gifts, not forty", afterB.n === N, afterB);
  ok("...and the cents did not move by one", afterB.cents === TOTAL_CENTS, { got: afterB.cents, want: TOTAL_CENTS });

  const listed = await api("GET", "/giving-sources/duplicates", tok);
  ok("the questions are on the list, one per gift", (listed.body?.questions || []).length === N, listed.body?.questions?.length);

  // The sentence is the one a person reads, and it names the money and the
  // place it already came from.
  const first = (listed.body?.questions || []).find(x => x.amountCents === 2500);
  ok("the line reads as one sentence naming the money and the source",
    first && first.sentence === "Looks like the same $25 gift already here from PayPal on June 10.", first?.sentence);
  ok("...and it carries the donor's name, not just an id", !!first?.donorName, first);

  // NOTHING WAS LOST. The provider's row is on the question, which is what
  // makes "Keep both" possible without going back to the provider.
  const [kept] = await q(`SELECT candidate FROM gift_duplicate_questions WHERE org_id=$1 AND external_key LIKE '%db_0'`, [A]);
  const cand = typeof kept.candidate === "string" ? JSON.parse(kept.candidate) : kept.candidate;
  ok("the provider's whole row was kept, so nothing is lost", cand?.externalId === "db_0" && cand?.amountCents === 2500, cand);

  // ══ §2 · the two answers ═════════════════════════════════════════════════
  console.log("\n— §2 · Same gift, and Keep both —");
  const qs = listed.body.questions;
  const same = await api("POST", `/giving-sources/duplicates/${qs[0].id}/same-gift`, tok, {});
  ok("\"Same gift\" answers the question", same.status === 200 && same.body?.status === "same_gift", same.body);
  const bothAns = await api("POST", `/giving-sources/duplicates/${qs[1].id}/keep-both`, tok, {});
  ok("\"Keep both\" writes the gift that was held", bothAns.status === 200 && !!bothAns.body?.giftId, bothAns.body);
  const afterAnswers = await centsOf(A);
  ok("...so there are twenty-one gifts now, and only the one she chose",
    afterAnswers.n === N + 1, afterAnswers);
  ok("...and the cents rose by exactly that gift",
    afterAnswers.cents === TOTAL_CENTS + qs[1].amountCents,
    { got: afterAnswers.cents, want: TOTAL_CENTS + qs[1].amountCents });

  const openNow = await api("GET", "/giving-sources/duplicates", tok);
  ok("both answered questions leave the list", (openNow.body?.questions || []).length === N - 2, openNow.body?.questions?.length);

  // THE QUESTION NEVER RETURNS. This is the property that matters: a source is
  // re-read every six hours, so an answer that did not stick would put the
  // same line back on her screen forever.
  const runB2 = await api("POST", `/giving-sources/${SRC_B}/sync-fixture`, tok, { rows: rowsB(), today: TODAY });
  ok("re-syncing the second source creates nothing", runB2.body?.giftsCreated === 0, runB2.body);
  const openAgain = await api("GET", "/giving-sources/duplicates", tok);
  ok("...and asks nothing new — the answered questions do not come back",
    (openAgain.body?.questions || []).length === N - 2, openAgain.body?.questions?.length);
  const afterResync = await centsOf(A);
  ok("...and the money did not move", afterResync.cents === afterAnswers.cents && afterResync.n === afterAnswers.n, afterResync);

  const [merged] = await q(`SELECT also_external_ids::text AS a FROM gifts WHERE id=$1`, [qs[0].existingGiftId]);
  ok("\"Same gift\" put the second id ON the gift that was already here",
    String(merged.a).includes("givebutter:db_0"), merged.a);

  // ══ §3 · THE SHORTCUT: the same run, with nothing to answer ══════════════
  console.log("\n— §3 · one source sits on top of another —");
  await seed(B, "b92dupb");
  const tokB = await login("b92dupb@t.local");
  const S1 = await connect(tokB, "paypal", "PayPal");
  const S2 = await connect(tokB, "givebutter", "Donorbox");
  const marked = await api("PATCH", `/giving-sources/${S2}`, tokB, { sitsOnTopOf: S1 });
  ok("Donorbox can be marked as sitting on top of PayPal", marked.status === 200 && marked.body?.sitsOnTopOf === S1, marked.body);

  const r1 = await api("POST", `/giving-sources/${S1}/sync-fixture`, tokB, { rows: rowsA(), today: TODAY });
  const r2 = await api("POST", `/giving-sources/${S2}/sync-fixture`, tokB, { rows: rowsB(), today: TODAY });
  ok("the first source writes twenty", r1.body?.giftsCreated === N, r1.body);
  ok("the second writes none, and asks NOTHING", r2.body?.giftsCreated === 0 && r2.body?.duplicateQuestions === 0, r2.body);
  ok("...it says twenty rode on top instead, on its own counter", r2.body?.ridesOnTop === N, r2.body?.ridesOnTop);
  const bTotals = await centsOf(B);
  ok("twenty gifts, cents exact", bTotals.n === N && bTotals.cents === TOTAL_CENTS, { got: bTotals, want: TOTAL_CENTS });
  const bQs = await api("GET", "/giving-sources/duplicates", tokB);
  ok("ZERO questions with the shortcut", (bQs.body?.questions || []).length === 0, bQs.body?.questions?.length);

  // And re-running it is still silent.
  const r2b = await api("POST", `/giving-sources/${S2}/sync-fixture`, tokB, { rows: rowsB(), today: TODAY });
  const bTotals2 = await centsOf(B);
  ok("re-running the riding source changes nothing at all",
    r2b.body?.giftsCreated === 0 && bTotals2.n === N && bTotals2.cents === TOTAL_CENTS, { r: r2b.body, t: bTotals2 });

  // ══ §4 · THE RULE IS CROSS-SOURCE ONLY ═══════════════════════════════════
  console.log("\n— §4 · two real same-day gifts inside ONE source are two gifts —");
  const twin = d => ({
    externalId: `pp_twin_${d}`, occurredAt: DAY0, amountCents: 5000, feeCents: 0,
    currency: "USD", donorName: "Twin Giver", donorEmail: "twin@b92dup.test",
    status: "completed", memo: "",
  });
  const twins = await api("POST", `/giving-sources/${S1}/sync-fixture`, tokB,
    { rows: [twin("a"), twin("b")], today: TODAY });
  ok("two genuine same-day $50 gifts from one donor in ONE source are BOTH written",
    twins.body?.giftsCreated === 2, twins.body);
  ok("...and neither became a question", twins.body?.duplicateQuestions === 0, twins.body?.duplicateQuestions);
  const [twinRow] = await q(
    `SELECT COUNT(*)::int n, COALESCE(ROUND(SUM(amount*100)),0)::int c FROM gifts g
      JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND d.email='twin@b92dup.test'`, [B]);
  ok("...the donor has two gifts and $100, to the cent", twinRow.n === 2 && twinRow.c === 10000, twinRow);

  // The window is TWO DAYS. A row three days out is a different gift.
  console.log("\n— §5 · the window is two days, and it is a boundary —");
  const far = {
    externalId: "db_far", occurredAt: addDays(DAY0, 3), amountCents: 5000, feeCents: 0,
    currency: "USD", donorName: "Twin Giver", donorEmail: "twin@b92dup.test", status: "completed", memo: "",
  };
  const near = {
    externalId: "db_near", occurredAt: addDays(DAY0, 2), amountCents: 5000, feeCents: 0,
    currency: "USD", donorName: "Twin Giver", donorEmail: "twin@b92dup.test", status: "completed", memo: "",
  };
  // S2 rides on S1, so a MATCH here resolves silently - which is exactly what
  // makes this a clean read of the window: a write means no match was found.
  const farRun = await api("POST", `/giving-sources/${S2}/sync-fixture`, tokB, { rows: [far], today: TODAY });
  ok("three days out is NOT the same gift — it is written", farRun.body?.giftsCreated === 1, farRun.body);
  const nearRun = await api("POST", `/giving-sources/${S2}/sync-fixture`, tokB, { rows: [near], today: TODAY });
  ok("two days out IS inside the window — it is not written", nearRun.body?.giftsCreated === 0, nearRun.body);
  ok("...and it rode on top rather than being dropped", nearRun.body?.ridesOnTop === 1, nearRun.body);

  // ══ §6 · a source cannot ride on itself, and org walls hold ══════════════
  console.log("\n— §6 · the shortcut cannot be turned against the org —");
  const selfRef = await api("PATCH", `/giving-sources/${S2}`, tokB, { sitsOnTopOf: S2 });
  ok("a source may not sit on top of itself", selfRef.status === 400 && selfRef.body?.error === "self_reference", selfRef.body);
  const foreign = await api("PATCH", `/giving-sources/${S2}`, tokB, { sitsOnTopOf: SRC_A });
  ok("...nor on another ORG's source", foreign.status === 404, { status: foreign.status, body: foreign.body });
  const [stillMine] = await q(`SELECT sits_on_top_of FROM giving_sources WHERE id=$1`, [S2]);
  ok("...and the refusal planted nothing", stillMine.sits_on_top_of === S1, stillMine);

  const crossList = await api("GET", "/giving-sources/duplicates", tokB);
  ok("org B sees only its own questions (it has none)", (crossList.body?.questions || []).length === 0);
  const crossAnswer = await api("POST", `/giving-sources/duplicates/${qs[2].id}/same-gift`, tokB, {});
  ok("org B cannot answer org A's question", crossAnswer.status === 404, { status: crossAnswer.status });
  const [aStill] = await q(`SELECT status FROM gift_duplicate_questions WHERE id=$1`, [qs[2].id]);
  ok("...and org A's question is untouched", aStill.status === "open", aStill);

  for (const t of CHILD) { await q(`DELETE FROM ${t} WHERE org_id=$1`, [A]).catch(() => { }); await q(`DELETE FROM ${t} WHERE org_id=$1`, [B]).catch(() => { }); }
  await q(`DELETE FROM orgs WHERE id IN ($1,$2)`, [A, B]).catch(() => { });
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
