// BUILD-102 (Steward Give) Part 6 — ANALYTICS, AND A SIMPLE A/B.
//
// The brief's own test: ten fixture views, six starts and three completions read
// back exactly; the funnel counts never exceed each other; a variant under 100
// views shows no winner.
//
//   §1  five figures, each with its one-sentence definition — and the registry
//       has teeth;
//   §2  ten views, six starts, three completions, read back EXACTLY;
//   §3  THE FUNNEL CANNOT GO BACKWARDS, and a clamped figure says so;
//   §4  nothing about WHO: the table has nowhere to put a person, asserted on the
//       schema rather than promised in a comment;
//   §5  a completion is counted from the GIFT, not from the page — and a
//       redelivered webhook counts none;
//   §6  the A/B may change the amounts or the headline and NOTHING else;
//   §7  under 100 views per variant there is NO winner, and the sentence says how
//       many more are needed;
//   §8  the wall.
//
// Standard scratch stack; ports per WORKTREE-NOTES.md.

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const http = require("http");
const { ok, summary, login, api, q, closeDb, STRIPE_MOCK_PORT, civilPlusDays } = require("./helpers");

const ORG = "b102_fun", OTHER = "b102_fun2";
const ME = "b102fun@example.org", THEM = "b102fun-other@example.org";
const PW = "loadtest1234";

const CHILD = ["form_events", "receipts", "fin_transactions", "interactions", "threads", "tasks",
  "thank_you_drafts", "workflow_runs", "gifts", "giving_pages", "campaigns", "donors", "users",
  "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = (id, slug, name) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at,
                     stripe_account_id,stripe_connected,cover_fees_enabled)
   VALUES ($1,$2,$3,1,'team','active','America/New_York',NOW(),$4,TRUE,TRUE)
   ON CONFLICT (id) DO UPDATE SET stripe_account_id=$4, stripe_connected=TRUE`,
  [id, name, slug, "acct_" + id]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);
const cents = v => Math.round(Number(v) * 100);
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
const BASE = process.env.BASE || "http://localhost:5601";

function sig(payload) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest")
    .update(`${t}.${payload}`).digest("hex")}`;
}
const fire = async ev => {
  const p = JSON.stringify(ev);
  return fetch(`${BASE}/stripe/webhook`,
    { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": sig(p) }, body: p });
};
let seq = 0;
const pi = (acct, meta, amountCents) => ({
  id: "evt_fun_" + (++seq), type: "payment_intent.succeeded", account: acct,
  data: { object: { id: "pi_fun_" + seq, amount_received: amountCents, currency: "usd",
                    receipt_email: meta.donor_email, metadata: meta } },
});
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (/^\/v1\/checkout\/sessions/.test(req.url)) {
          res.end(JSON.stringify({ id: "cs_fun", url: "https://checkout.stripe.test/c/fun" }));
        } else res.end(JSON.stringify({ ok: true, id: "mock", data: [] }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
// The PUBLIC counter, called the way the page calls it.
const count = (formId, kind, variant) => fetch(`${BASE}/forms/${formId}/event`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ kind, variant }),
});

(async () => {
  console.log("build102-funnel");
  await reset();
  await mkOrg(ORG, "b102-fun", "Harbor Music School");
  await mkOrg(OTHER, "b102-fun2", "Open Door Pantry");
  await mkUser("u_b102f2", ORG, ME, "Allie Barnett");
  await mkUser("u_b102f3", OTHER, THEM, "Not Allie");
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_gen_f','${ORG}','General fund',false)
           ON CONFLICT (id) DO NOTHING`);
  const tok = await login(ME), tok2 = await login(THEM);
  const F = await import("../shared/formConfig.js");
  const smock = await startStripeMock();
  if (!smock) ok("fixture the Stripe mock bound (environment)", false, `port ${STRIPE_MOCK_PORT} busy`);

  const page = await api("POST", "/giving-pages", tok, { title: "Funnel form", slug: "funnel" });
  const PAGE = page.body.id;
  await api("PUT", `/giving-pages/${PAGE}/form`, tok, { config: {
    headline: "Give a child a year of lessons", amountsCents: [cents(25), cents(50)], allowOther: true } });
  ok("fixture a form exists", page.status === 201);

  // ── §1 · FIVE FIGURES, EACH DEFINED ─────────────────────────────────────
  console.log("\n— §1 · a funnel is where a number without a definition gets over-read —");
  ok("§1 every figure has a definition", F.funnelDefinitionProblems().length === 0, F.funnelDefinitionProblems());
  ok("§1 five figures, named",
     F.FUNNEL_METRIC_KEYS.join(",") === "views,starts,completions,completionRate,averageGift",
     F.FUNNEL_METRIC_KEYS);
  // THE DEFINITIONS SAY THE UNCOMFORTABLE THING. A view is not a person, and a
  // completion rate on a donation form is low everywhere.
  ok("§1 the views definition says it is not people",
     /Not people/.test(F.funnelDefinition("views")), F.funnelDefinition("views"));
  ok("§1 the completion-rate definition does not flatter",
     /low on every donation form/.test(F.funnelDefinition("completionRate")),
     F.funnelDefinition("completionRate"));
  ok("§1 the completions definition says where the number comes from",
     /from the gift itself/.test(F.funnelDefinition("completions")), F.funnelDefinition("completions"));

  // ── §2 · THE BRIEF'S NUMBERS, EXACTLY ───────────────────────────────────
  console.log("\n— §2 · ten views, six starts, three completions —");
  for (let i = 0; i < 10; i++) { const r = await count(PAGE, "view"); if (i === 0) ok("§2 a view counts, with no body in the answer", r.status === 204, r.status); }
  for (let i = 0; i < 6; i++) await count(PAGE, "start");
  // THE COMPLETIONS COME FROM GIFTS, which is the whole point of §5.
  for (let i = 0; i < 3; i++) {
    await fire(pi("acct_" + ORG, { donor_email: `f${i}.fun@example.org`, donor_name: `Giver ${i}`,
                                   org_id: ORG, giving_page_id: PAGE, frequency: "once", fund_id: "" },
                  cents(30 + i * 10)));
  }
  await settle(700);
  const fun = await api("GET", `/giving-pages/${PAGE}/funnel`, tok, null);
  ok("§2 the funnel reads back", fun.status === 200, fun.body);
  ok("§2 TEN views", fun.body.funnel.views === 10, fun.body.funnel);
  ok("§2 SIX starts", fun.body.funnel.starts === 6, fun.body.funnel);
  ok("§2 THREE completions", fun.body.funnel.completions === 3, fun.body.funnel);
  ok("§2 the completion rate is three in ten", fun.body.funnel.completionRate === 30, fun.body.funnel);
  // 30 + 40 + 50 = 120, so the average is 40.
  ok("§2 the average gift is the money over the gifts",
     fun.body.funnel.averageGiftCents === cents(40), fun.body.funnel);
  ok("§2 …and the money is stated in dollars too", fun.body.money.completed === 120, fun.body.money);
  ok("§2 every figure carries its definition to the screen",
     Object.keys(fun.body.definitions).length === 5, Object.keys(fun.body.definitions));
  ok("§2 …and the screen says what Steward does NOT record",
     /records nothing about who/.test(fun.body.privacyNote), fun.body.privacyNote);
  // ONE ROW PER FORM PER DAY, so ten views are one row rather than ten.
  const rows = await q(`SELECT COUNT(*)::int AS c FROM form_events WHERE org_id=$1 AND form_id=$2`, [ORG, PAGE]);
  ok("§2 ten views are ONE row, not ten", rows[0].c === 1, rows[0]);

  // ── §3 · THE FUNNEL CANNOT GO BACKWARDS ─────────────────────────────────
  console.log("\n— §3 · a completion rate over 100% would be worse than no figure —");
  const clamped = F.funnelFor({ views: 10, starts: 20, completions: 30 });
  ok("§3 starts cannot exceed views and completions cannot exceed starts",
     clamped.starts === 10 && clamped.completions === 10, clamped);
  ok("§3 …and the clamping is SAID rather than hidden", clamped.clamped === true);
  ok("§3 a form nobody has opened has no rate at all, not zero",
     F.funnelFor({}).completionRate === null && F.funnelFor({}).averageGiftCents === null, F.funnelFor({}));
  // Drive it through the real route: more completions than views.
  const odd = await api("POST", "/giving-pages", tok, { title: "Odd", slug: "odd" });
  // CI #297 — THE ORG'S CIVIL DAY, not UTC's. `form_events.day` is written by
  // `bumpFormEvent` from `orgToday`, and the funnel route reads a window of the
  // org's own civil days — so a row stamped with the UTC date lands OUTSIDE that
  // window every evening after 8pm Eastern, the route returns all zeros, and the
  // clamping this section exists to check is never exercised. That is exactly how
  // it failed on CI: not a wrong figure, a row the query could not see.
  await q(`INSERT INTO form_events (id,org_id,form_id,day,views,starts,completions,completed_cents)
           VALUES ('fe_odd','${ORG}',$1,$2,1,9,9,900)`, [odd.body.id, civilPlusDays(0)]);
  const oddF = await api("GET", `/giving-pages/${odd.body.id}/funnel`, tok, null);
  ok("§3 the route clamps too, and names it",
     oddF.body.funnel.starts === 1 && oddF.body.funnel.completions === 1
     && /a floor rather than an exact figure/.test(oddF.body.note || ""), [oddF.body.funnel, oddF.body.note]);

  // ── §4 · NOTHING ABOUT WHO ──────────────────────────────────────────────
  console.log("\n— §4 · the schema is the guarantee, not the policy —");
  const cols = (await q(
    `SELECT column_name FROM information_schema.columns WHERE table_name='form_events'`)).map(r => r.column_name);
  const forbidden = cols.filter(c => /donor|person|user|email|ip|agent|session|cookie|fingerprint|referer/i.test(c));
  ok("§4 form_events has NO column that could identify anybody", forbidden.length === 0, forbidden);
  ok("§4 …and the columns it does have are counts and a day",
     cols.sort().join(",") === "completed_cents,completions,day,form_id,id,org_id,starts,updated_at,variant,views",
     cols.sort());
  // THE PUBLIC COUNTER ANSWERS NOTHING, so nobody can read an existence check out
  // of it — an unknown id and an archived form answer exactly as a real one does.
  const unknown = await count("gp_nope", "view");
  ok("§4 an unknown form id answers 204, the same as a real one", unknown.status === 204, unknown.status);
  await api("PUT", `/giving-pages/${odd.body.id}`, tok, { status: "archived" });
  const arch = await count(odd.body.id, "view");
  ok("§4 an archived form answers 204 too, and counts nothing", arch.status === 204, arch.status);
  const archRows = await q(`SELECT views FROM form_events WHERE form_id=$1`, [odd.body.id]);
  ok("§4 …nothing was counted for it", archRows[0].views === 1, archRows[0]);
  const bad = await count(PAGE, "completion");
  ok("§4 a PAGE cannot report a completion — only a gift can", bad.status === 400, bad.status);

  // ── §5 · A COMPLETION COMES FROM THE GIFT ───────────────────────────────
  console.log("\n— §5 · a page cannot be trusted to know money moved —");
  const beforeC = (await api("GET", `/giving-pages/${PAGE}/funnel`, tok, null)).body.funnel.completions;
  const dup = pi("acct_" + ORG, { donor_email: "dup.fun@example.org", donor_name: "Dup Giver",
                                  org_id: ORG, giving_page_id: PAGE, frequency: "once", fund_id: "" }, cents(80));
  await fire(dup); await settle();
  const once = (await api("GET", `/giving-pages/${PAGE}/funnel`, tok, null)).body.funnel.completions;
  ok("§5 a gift counts one completion", once === beforeC + 1, [beforeC, once]);
  await fire(dup); await settle();
  const twice = (await api("GET", `/giving-pages/${PAGE}/funnel`, tok, null)).body.funnel.completions;
  ok("§5 a REDELIVERED webhook counts none", twice === once, [once, twice]);

  // ── §6 · WHAT AN A/B MAY CHANGE ─────────────────────────────────────────
  console.log("\n— §6 · two versions of one form, not two forms —");
  ok("§6 only the amounts and the headline", F.AB_FIELDS.join(",") === "amountsCents,headline", F.AB_FIELDS);
  const strayTest = await api("PUT", `/giving-pages/${PAGE}/ab-test`, tok,
    { abTest: { b: { showTribute: true } } });
  ok("§6 a test that would change the questions is refused",
     strayTest.status === 400 && /two different forms sharing one set of numbers/.test(strayTest.body.error),
     strayTest.body);
  const emptyTest = await api("PUT", `/giving-pages/${PAGE}/ab-test`, tok, { abTest: { b: {} } });
  ok("§6 a variant B that differs in nothing is refused", emptyTest.status === 400, emptyTest.body);
  const goodTest = await api("PUT", `/giving-pages/${PAGE}/ab-test`, tok,
    { abTest: { running: true, b: { amountsCents: [cents(40), cents(75)], headline: "Fund a term of lessons" } } });
  ok("§6 a test on the amounts and the headline is accepted", goodTest.status === 200, goodTest.body);
  // AND EACH VARIANT IS A LEGAL FORM ON ITS OWN.
  const illegalB = await api("PUT", `/giving-pages/${PAGE}/ab-test`, tok,
    { abTest: { b: { amountsCents: [0] } } });
  ok("§6 a variant B that is not a legal form is refused", illegalB.status === 400, illegalB.body);
  await api("PUT", `/giving-pages/${PAGE}/ab-test`, tok,
    { abTest: { running: true, b: { amountsCents: [cents(40), cents(75)], headline: "Fund a term of lessons" } } });
  // ONE FUNCTION SERVES BOTH SIDES, so they cannot drift.
  const pubA = await api("GET", `/org/b102-fun/giving-page/funnel/public?v=a`, null, null);
  const pubB = await api("GET", `/org/b102-fun/giving-page/funnel/public?v=b`, null, null);
  ok("§6 A is the form as it stands",
     pubA.body.givingPage.form.amount.amountsCents.join(",") === [cents(25), cents(50)].join(",")
     && pubA.body.givingPage.form.variant === "a", pubA.body.givingPage.form.amount);
  ok("§6 B is A with the test's overrides on top",
     pubB.body.givingPage.form.amount.amountsCents.join(",") === [cents(40), cents(75)].join(",")
     && pubB.body.givingPage.form.headline === "Fund a term of lessons"
     && pubB.body.givingPage.form.variant === "b", pubB.body.givingPage.form);
  ok("§6 …and everything the test did NOT change is identical",
     JSON.stringify(pubA.body.givingPage.form.designation) === JSON.stringify(pubB.body.givingPage.form.designation)
     && JSON.stringify(pubA.body.givingPage.form.details) === JSON.stringify(pubB.body.givingPage.form.details),
     [pubA.body.givingPage.form.details, pubB.body.givingPage.form.details]);
  ok("§6 the page is told a test is running, so it only sets a cookie when there is one",
     pubA.body.givingPage.abRunning === true, pubA.body.givingPage.abRunning);
  const stopped = await api("PUT", `/giving-pages/${PAGE}/ab-test`, tok, { abTest: null });
  ok("§6 a test can be stopped", stopped.status === 200 && stopped.body.abTest === null, stopped.body);
  const noTest = await api("GET", `/org/b102-fun/giving-page/funnel/public?v=b`, null, null);
  ok("§6 …and then even ?v=b serves A", noTest.body.givingPage.form.variant === "a"
     && noTest.body.givingPage.abRunning === false, noTest.body.givingPage.form.variant);

  // ── §7 · NO WINNER UNDER A HUNDRED VIEWS ────────────────────────────────
  console.log("\n— §7 · below the floor, the screen says so —");
  ok("§7 the floor is a hundred views per side", F.AB_MIN_VIEWS === 100);
  const early = F.abVerdict(F.funnelFor({ views: 40, starts: 20, completions: 5 }),
                            F.funnelFor({ views: 10, starts: 5, completions: 3 }));
  ok("§7 under the floor there is NO winner", early.winner === null && early.callable === false, early);
  ok("§7 …and the sentence says how many more each side needs",
     /60 more on A/.test(early.sentence) && /90 more on B/.test(early.sentence), early.sentence);
  ok("§7 …and never shows a percentage to act on", !/%/.test(early.sentence), early.sentence);
  const over = F.abVerdict(F.funnelFor({ views: 200, starts: 100, completions: 10 }),
                           F.funnelFor({ views: 200, starts: 120, completions: 20 }));
  ok("§7 above the floor it names the leader", over.winner === "b" && over.callable === true, over);
  // IT SAYS "AHEAD", NOT "WINS". Steward is not running a significance test and
  // must not imply that it is.
  ok("§7 …as AHEAD, not as a winner", /is ahead/.test(over.sentence) && !/\bwin/i.test(over.sentence), over.sentence);
  // The LEADER is stated first, then the other — so both sets of counts are on the
  // screen and a reader can check the arithmetic rather than trusting the verdict.
  ok("§7 …and states both sets of counts, leader first",
     /20 gifts from 200 views \(10%\)/.test(over.sentence) && /10 from 200 \(5%\)/.test(over.sentence),
     over.sentence);
  const tied = F.abVerdict(F.funnelFor({ views: 200, completions: 0 }), F.funnelFor({ views: 200, completions: 0 }));
  ok("§7 a tie is a tie", tied.winner === null && /Nothing to choose/.test(tied.sentence), tied.sentence);
  // Through the real route, with a live test and real counts on each side.
  await api("PUT", `/giving-pages/${PAGE}/ab-test`, tok,
    { abTest: { running: true, b: { headline: "Fund a term of lessons" } } });
  await count(PAGE, "view", "a"); await count(PAGE, "view", "b");
  const live = await api("GET", `/giving-pages/${PAGE}/funnel`, tok, null);
  ok("§7 the route reports the test with both sides",
     !!live.body.abTest && live.body.abTest.a.views === 1 && live.body.abTest.bFunnel.views === 1,
     live.body.abTest);
  ok("§7 …and refuses to call it at one view each",
     live.body.abTest.verdict.winner === null && /Too early to tell/.test(live.body.abTest.verdict.sentence),
     live.body.abTest.verdict);
  ok("§7 the whole-form funnel is every variant together",
     live.body.funnel.views >= 12, live.body.funnel.views);

  // ── §8 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §8 · a funnel is org data —");
  const crossFun = await api("GET", `/giving-pages/${PAGE}/funnel`, tok2, null);
  ok("§8 org B cannot read org A's funnel", crossFun.status === 404, crossFun.status);
  const crossAb = await api("PUT", `/giving-pages/${PAGE}/ab-test`, tok2, { abTest: null });
  ok("§8 org B cannot stop org A's test", crossAb.status === 404, crossAb.status);
  const stillRunning = await q(`SELECT ab_test IS NOT NULL AS has FROM giving_pages WHERE id=$1`, [PAGE]);
  ok("§8 …and org A's test is untouched", stillRunning[0].has === true, stillRunning[0]);
  const bEvents = await q(`SELECT COUNT(*)::int AS c FROM form_events WHERE org_id=$1`, [OTHER]);
  ok("§8 org B has no events from org A's form", bEvents[0].c === 0, bEvents[0]);

  if (smock) smock.close();
  if (!process.env.KEEP) await reset();
  await closeDb();
  summary();
})();
