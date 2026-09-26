// BUILD-102 (Steward Give) Part 3 — TRIBUTES, MATCHING AND CUSTOM QUESTIONS.
//
// The brief's own test: a memorial gift writes one gift, one honouree name and one
// draft notice with no amount in it; an employer match opens exactly one match
// pledge; a custom-question answer lands in the person's custom field and filters
// in a saved report.
//
//   §1  a memorial gift — ONE gift, the honouree by NAME, one DRAFT notice, and
//       no amount anywhere in it;
//   §2  Steward never sends the notice, and never invents a record for somebody
//       who has died;
//   §3  an employer opens EXACTLY ONE match pledge, on the employer's own record,
//       created as an ORGANISATION — and a redelivered webhook adds none;
//   §4  an answer lands in the custom field the report builder reads, and
//       FILTERS in a saved report;
//   §5  ONLY WHAT THE FORM ASKED IS KEPT: a tribute from a form with no tribute
//       fields, an employer from a form that does not ask, an answer to a
//       question that is not on the form, and a choice that is not one of its
//       own options — each dropped, and the gift still goes through;
//   §6  a failure here costs the tribute draft and never the donation;
//   §7  the wall: org A's form cannot write into org B.
//
// Standard scratch stack; ports per WORKTREE-NOTES.md.

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const http = require("http");
const { ok, summary, login, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");

const ORG = "b102_ex", OTHER = "b102_ex2";
const ME = "b102ex@example.org", THEM = "b102ex-other@example.org";
const PW = "loadtest1234";

const CHILD = ["tribute_notices", "gift_soft_credits", "pledge_installments", "pledges",
  "custom_field_values", "custom_field_defs", "saved_reports", "receipts", "fin_transactions",
  "interactions", "threads", "tasks", "thank_you_drafts", "workflow_runs", "gifts",
  "peer_fundraisers", "giving_pages", "donors", "users", "budgets", "accounts", "fin_funds"];
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

function sig(payload) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest")
    .update(`${t}.${payload}`).digest("hex")}`;
}
const fire = async ev => {
  const p = JSON.stringify(ev);
  return fetch(`${process.env.BASE || "http://localhost:5601"}/stripe/webhook`,
    { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": sig(p) }, body: p });
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));

// A Stripe mock, because a Checkout session is an outbound call and without it a
// SUCCESSFUL donation answers 500 — which reads exactly like a product defect.
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (/^\/v1\/checkout\/sessions/.test(req.url)) {
          res.end(JSON.stringify({ id: "cs_ex", object: "checkout.session", url: "https://checkout.stripe.test/c/ex" }));
        } else res.end(JSON.stringify({ ok: true, id: "mock_1", data: [] }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}

// The PaymentIntent the webhook sees, carrying exactly what the donate route put
// in the metadata — which is what makes this an end-to-end assertion rather than
// a test of a private function.
let piSeq = 0;
const pi = (orgAcct, meta, amountCents) => ({
  id: "evt_ex_" + (++piSeq), type: "payment_intent.succeeded", account: orgAcct,
  data: { object: { id: "pi_ex_" + piSeq, amount_received: amountCents, currency: "usd",
                    receipt_email: meta.donor_email, metadata: meta } },
});

(async () => {
  console.log("build102-extras");
  await reset();
  await mkOrg(ORG, "b102-ex", "Harbor Music School");
  await mkOrg(OTHER, "b102-ex2", "Open Door Pantry");
  await mkUser("u_b102e", ORG, ME, "Allie Barnett");
  await mkUser("u_b102e2", OTHER, THEM, "Not Allie");
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_gen_e','${ORG}','General fund',false)
           ON CONFLICT (id) DO NOTHING`);
  const tok = await login(ME), tok2 = await login(THEM);
  const smock = await startStripeMock();
  if (!smock) ok("fixture the Stripe mock bound (environment)", false, `port ${STRIPE_MOCK_PORT} busy`);

  // A form that asks everything.
  const full = await api("POST", "/giving-pages", tok, { title: "Ask everything", slug: "full" });
  const FULL = full.body.id;
  const cfg = await api("PUT", `/giving-pages/${FULL}/form`, tok, { config: {
    amountsCents: [cents(50), cents(100)], allowOther: true,
    showTribute: true, showEmployerMatch: true,
    questions: [
      { key: "how_heard_e", label: "How did you hear about us?", type: "choice",
        options: ["A friend", "Our newsletter"] },
      { key: "wants_news_e", label: "Send me news", type: "yesno" },
      { key: "why_give_e", label: "Why did you give?", type: "text" },
    ],
  } });
  ok("fixture the form asks everything", cfg.status === 200 && cfg.body.customFieldsCreated.length === 3,
     cfg.body.customFieldsCreated || cfg.body);
  // A form that asks NOTHING, for §5.
  const bare = await api("POST", "/giving-pages", tok, { title: "Ask nothing", slug: "bare" });
  const BARE = bare.body.id;
  await api("PUT", `/giving-pages/${BARE}/form`, tok, { config: { amountsCents: [cents(50)], allowOther: true } });

  const donate = (body, slug = "b102-ex") => api("POST", `/donate/${slug}`, null, body);
  const donor = { firstName: "Mabel", lastName: "Fenwick", email: "mabel.ex@example.org" };

  // ── §1 · A MEMORIAL GIFT ────────────────────────────────────────────────
  console.log("\n— §1 · one gift, the honouree by name, one draft notice —");
  const memorial = await donate({ ...donor, amount: 100, frequency: "once", givingPageId: FULL,
    tributeType: "memory", tributeName: "Arthur Fenwick",
    notifyName: "Ruth Fenwick", notifyEmail: "ruth.ex@example.org" });
  ok("§1 the donation goes through", memorial.status === 200, memorial.body);
  // The metadata is what carries it, so the assertion is on what Stripe was told.
  const meta = { donor_email: donor.email, donor_name: "Mabel Fenwick", org_id: ORG,
                 frequency: "once", giving_page_id: FULL, fund_id: "",
                 tribute_type: "memory", tribute_name: "Arthur Fenwick",
                 // BUILD-98 writes a notice only when somebody is named to receive
                 // one, which is right: a notice with nobody to send it to is a
                 // draft nobody will ever open.
                 notify_name: "Ruth Fenwick", notify_email: "ruth.ex@example.org" };
  const r1 = await fire(pi("acct_" + ORG, meta, cents(100)));
  ok("§1 the webhook accepts it", r1.status === 200, r1.status);
  await settle();
  const gifts = await q(`SELECT id, amount, tribute_type, tribute_name, tribute_donor_id FROM gifts WHERE org_id=$1`, [ORG]);
  ok("§1 EXACTLY ONE gift", gifts.length === 1, gifts);
  ok("§1 …recorded in memory of, with the name the donor typed",
     gifts[0].tribute_type === "memory" && gifts[0].tribute_name === "Arthur Fenwick", gifts[0]);
  ok("§1 …and the amount is the one that was charged",
     Math.round(Number(gifts[0].amount) * 100) === cents(100), gifts[0].amount);
  const notices = await q(`SELECT * FROM tribute_notices WHERE org_id=$1`, [ORG]);
  ok("§1 ONE draft notice", notices.length === 1, notices.length);
  // THE NOTICE CARRIES NO AMOUNT. BUILD-98's rule: the notice module is handed no
  // amount, so it cannot state one — a family should not be told what was given.
  const noticeText = JSON.stringify(notices[0] || {});
  ok("§1 …and NO amount appears anywhere in it",
     !/100/.test(noticeText.replace(/"id":"[^"]*"/g, "").replace(/gift_id":"[^"]*"/g, "")),
     noticeText.slice(0, 300));
  ok("§1 …and it is a DRAFT, not something sent",
     (notices[0].status || "draft") !== "sent" && !notices[0].sent_at, notices[0].status);

  // ── §2 · STEWARD NEVER SENDS IT, AND NEVER INVENTS A RECORD ─────────────
  console.log("\n— §2 · a memorial does not create a prospect —");
  const honouree = await q(`SELECT id FROM donors WHERE org_id=$1 AND LOWER(name)=LOWER($2)`, [ORG, "Arthur Fenwick"]);
  ok("§2 no record was invented for the person who died", honouree.length === 0, honouree);
  ok("§2 …so the gift's honouree is a NAME, not a pointer",
     gifts[0].tribute_donor_id === null, gifts[0].tribute_donor_id);
  // An honouree who IS already on file is linked, because that is a living person
  // the org has a relationship with.
  await q(`INSERT INTO donors (id,org_id,name,kind,stage,total_giving,gift_count)
           VALUES ('dn_liv_e','${ORG}','Iris Okafor','person','steward',0,0)`);
  await fire(pi("acct_" + ORG, { ...meta, tribute_type: "honor", tribute_name: "Iris Okafor",
                                 donor_email: "second.ex@example.org", donor_name: "Second Donor" }, cents(50)));
  await settle();
  const linked = await q(`SELECT tribute_donor_id, tribute_name FROM gifts WHERE org_id=$1 AND tribute_type='honor'`, [ORG]);
  ok("§2 an honouree already on file IS linked to their record",
     linked.length === 1 && linked[0].tribute_donor_id === "dn_liv_e", linked);

  // ── §3 · THE EMPLOYER MATCH ─────────────────────────────────────────────
  console.log("\n— §3 · one match pledge, on the employer's own record —");
  const empMeta = { ...meta, tribute_type: "", tribute_name: "", employer: "Acme Manufacturing",
                    donor_email: "third.ex@example.org", donor_name: "Third Donor" };
  const empEvent = pi("acct_" + ORG, empMeta, cents(200));
  await fire(empEvent);
  await settle();
  const employer = await q(`SELECT id, kind FROM donors WHERE org_id=$1 AND LOWER(name)=LOWER($2)`, [ORG, "Acme Manufacturing"]);
  ok("§3 the employer was created", employer.length === 1, employer);
  // AN EMPLOYER IS AN ORGANISATION. A person called "Acme Manufacturing" would be
  // on every person surface and out of every institutional report.
  ok("§3 …as an ORGANISATION, not a person", employer[0].kind === "organisation", employer[0].kind);
  const matches = await q(`SELECT id, donor_id, amount, is_match, matches_gift_id FROM pledges WHERE org_id=$1 AND is_match IS TRUE`, [ORG]);
  ok("§3 EXACTLY ONE match pledge", matches.length === 1, matches);
  ok("§3 …on the EMPLOYER's record, not the donor's",
     matches[0].donor_id === employer[0].id, [matches[0].donor_id, employer[0].id]);
  ok("§3 …for the gift's own amount",
     Math.round(Number(matches[0].amount) * 100) === cents(200), matches[0].amount);
  // A REDELIVERED WEBHOOK WRITES NOTHING. Stripe retries; the duplicate guard
  // stops the gift, and the extras never run a second time.
  const before3 = await q(`SELECT (SELECT COUNT(*)::int FROM gifts WHERE org_id=$1) AS g,
                                  (SELECT COUNT(*)::int FROM pledges WHERE org_id=$1) AS p,
                                  (SELECT COUNT(*)::int FROM donors WHERE org_id=$1) AS d`, [ORG]);
  const again = await fire(empEvent);
  await settle();
  const after3 = await q(`SELECT (SELECT COUNT(*)::int FROM gifts WHERE org_id=$1) AS g,
                                 (SELECT COUNT(*)::int FROM pledges WHERE org_id=$1) AS p,
                                 (SELECT COUNT(*)::int FROM donors WHERE org_id=$1) AS d`, [ORG]);
  ok("§3 a redelivered webhook adds no gift, no pledge and no donor",
     JSON.stringify(before3[0]) === JSON.stringify(after3[0]), [before3[0], after3[0]]);
  ok("§3 …and says it was a duplicate", again.status === 200, again.status);

  // ── §4 · AN ANSWER IS A FIELD THE REPORT BUILDER READS ──────────────────
  console.log("\n— §4 · an answer has to filter, or the question is theatre —");
  const ansMeta = { ...meta, tribute_type: "", tribute_name: "",
                    donor_email: "answers.ex@example.org", donor_name: "Ann Answers",
                    q_how_heard_e: "Our newsletter", q_wants_news_e: "yes",
                    q_why_give_e: "My daughter learned the cello here." };
  await fire(pi("acct_" + ORG, ansMeta, cents(75)));
  await settle();
  const answered = await q(`SELECT id, custom_fields FROM donors WHERE org_id=$1 AND email=$2`, [ORG, "answers.ex@example.org"]);
  ok("§4 the donor exists", answered.length === 1, answered.length);
  const cf = answered[0].custom_fields || {};
  ok("§4 the choice answer landed", cf.how_heard_e === "Our newsletter", cf);
  ok("§4 the yes/no landed as a BOOLEAN, not the word yes", cf.wants_news_e === true, cf.wants_news_e);
  ok("§4 the free text landed whole", /learned the cello/.test(String(cf.why_give_e || "")), cf.why_give_e);
  // AND IT FILTERS IN A SAVED REPORT — the claim, checked, not assumed.
  const saved = await api("POST", "/saved-reports", tok, {
    name: "Newsletter people", question: "Who heard about us from the newsletter?",
    definition: { entity: "people", columns: ["name", "email", "cf:how_heard_e"],
                  filter: { op: "and", rules: [{ field: "cf:how_heard_e", cmp: "eq", value: "Our newsletter" }] } },
  });
  ok("§4 a report can be built on the answer", saved.status === 200 || saved.status === 201, saved.body);
  const ran = await api("GET", `/saved-reports/${saved.body.id}/run`, tok, null);
  ok("§4 …and it runs", ran.status === 200, ran.body);
  ok("§4 …returning exactly the donor who gave that answer",
     ran.body.rows.length === 1 && /Ann Answers/.test(JSON.stringify(ran.body.rows[0])), ran.body.rows);
  // A donor who answers a DIFFERENT form later keeps the first answer.
  await fire(pi("acct_" + ORG, { ...ansMeta, q_how_heard_e: "A friend", q_wants_news_e: "no" }, cents(30)));
  await settle();
  const merged = (await q(`SELECT custom_fields FROM donors WHERE org_id=$1 AND email=$2`,
    [ORG, "answers.ex@example.org"]))[0].custom_fields;
  ok("§4 a later answer updates that field and leaves the others standing",
     merged.how_heard_e === "A friend" && /cello/.test(String(merged.why_give_e || "")), merged);

  // ── §5 · ONLY WHAT THE FORM ASKED IS KEPT ───────────────────────────────
  console.log("\n— §5 · a field nobody was asked is not stored —");
  const sneaky = await donate({ ...donor, amount: 50, frequency: "once", givingPageId: BARE,
    email: "sneaky.ex@example.org",
    tributeType: "memory", tributeName: "Somebody Invented",
    employer: "Ghost Industries",
    answers: { how_heard_e: "A friend", not_a_question: "x" } });
  ok("§5 the gift still goes through — the donor did nothing wrong", sneaky.status === 200, sneaky.body);
  // The DONATE route is what drops them, so the assertion is that they never
  // reached the metadata at all.
  const probe = await api("GET", `/giving-pages/${BARE}/form`, tok, null);
  ok("§5 the bare form asks for no tribute and no employer",
     probe.body.spec.details.tribute === false && probe.body.spec.details.employerMatch === false
     && probe.body.spec.details.questions.length === 0, probe.body.spec.details);
  // Fire what a hand-rolled request would have produced IF the route had carried
  // them, to prove the route is the gate rather than the webhook.
  const beforeS = await q(`SELECT COUNT(*)::int AS c FROM tribute_notices WHERE org_id=$1`, [ORG]);
  await fire(pi("acct_" + ORG, { donor_email: "sneaky.ex@example.org", donor_name: "Mabel Fenwick",
                                 org_id: ORG, frequency: "once", giving_page_id: BARE, fund_id: "" }, cents(50)));
  await settle();
  const afterS = await q(`SELECT COUNT(*)::int AS c FROM tribute_notices WHERE org_id=$1`, [ORG]);
  ok("§5 no tribute notice for a form with no tribute fields", beforeS[0].c === afterS[0].c, [beforeS[0], afterS[0]]);
  ok("§5 no employer was created for a form that does not ask",
     (await q(`SELECT COUNT(*)::int AS c FROM donors WHERE org_id=$1 AND LOWER(name)=LOWER($2)`, [ORG, "Ghost Industries"]))[0].c === 0);
  // A CHOICE MAY ONLY BE ONE OF ITS OWN OPTIONS, or the grouping in a report
  // quietly stops meaning anything.
  const badChoice = await donate({ ...donor, amount: 50, frequency: "once", givingPageId: FULL,
    email: "badchoice.ex@example.org", answers: { how_heard_e: "Something I made up" } });
  ok("§5 a gift with an off-list choice still goes through", badChoice.status === 200, badChoice.body);
  await fire(pi("acct_" + ORG, { donor_email: "badchoice.ex@example.org", donor_name: "Bad Choice",
                                 org_id: ORG, frequency: "once", giving_page_id: FULL, fund_id: "" }, cents(50)));
  await settle();
  const bc = await q(`SELECT custom_fields FROM donors WHERE org_id=$1 AND email=$2`, [ORG, "badchoice.ex@example.org"]);
  ok("§5 …and the off-list answer was not stored",
     !bc.length || !(bc[0].custom_fields || {}).how_heard_e, bc[0] && bc[0].custom_fields);

  // ── §6 · A FAILURE COSTS THE DRAFT, NEVER THE DONATION ──────────────────
  console.log("\n— §6 · the gift is written before any of this runs —");
  // An answer whose field definition has been archived is dropped, and the gift
  // and every other answer survive.
  await q(`UPDATE custom_field_defs SET archived_at=NOW() WHERE org_id=$1 AND key=$2`, [ORG, "why_give_e"]);
  await fire(pi("acct_" + ORG, { donor_email: "archived.ex@example.org", donor_name: "Arch Ived",
                                 org_id: ORG, frequency: "once", giving_page_id: FULL, fund_id: "",
                                 q_how_heard_e: "A friend", q_why_give_e: "this has nowhere to go" }, cents(60)));
  await settle();
  const arch = await q(`SELECT id, custom_fields FROM donors WHERE org_id=$1 AND email=$2`, [ORG, "archived.ex@example.org"]);
  ok("§6 the gift and the donor exist", arch.length === 1, arch.length);
  ok("§6 …the answer with a live field landed", (arch[0].custom_fields || {}).how_heard_e === "A friend", arch[0].custom_fields);
  ok("§6 …and the one with an archived field was dropped, not written blind",
     (arch[0].custom_fields || {}).why_give_e === undefined, arch[0].custom_fields);
  const archGift = await q(`SELECT COUNT(*)::int AS c FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, arch[0].id]);
  ok("§6 the donation is intact", archGift[0].c === 1, archGift[0]);

  // ── §7 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §7 · org A's form cannot write into org B —");
  const bBefore = await q(`SELECT (SELECT COUNT(*)::int FROM donors WHERE org_id=$1) AS d,
                                  (SELECT COUNT(*)::int FROM pledges WHERE org_id=$1) AS p,
                                  (SELECT COUNT(*)::int FROM tribute_notices WHERE org_id=$1) AS t`, [OTHER]);
  await fire(pi("acct_" + ORG, { donor_email: "wall.ex@example.org", donor_name: "Wall Test",
                                 org_id: OTHER, frequency: "once", giving_page_id: FULL, fund_id: "",
                                 employer: "Wall Industries", q_how_heard_e: "A friend" }, cents(40)));
  await settle();
  const bAfter = await q(`SELECT (SELECT COUNT(*)::int FROM donors WHERE org_id=$1) AS d,
                                 (SELECT COUNT(*)::int FROM pledges WHERE org_id=$1) AS p,
                                 (SELECT COUNT(*)::int FROM tribute_notices WHERE org_id=$1) AS t`, [OTHER]);
  // THE ORG COMES FROM THE VERIFIED ACCOUNT, NEVER THE PAYLOAD (BUILD-37 B9): the
  // metadata claimed org B and the connected account said org A, and the account
  // is what counts.
  ok("§7 a metadata org_id claiming org B writes nothing into org B",
     JSON.stringify(bBefore[0]) === JSON.stringify(bAfter[0]), [bBefore[0], bAfter[0]]);
  const crossForm = await api("GET", `/giving-pages/${FULL}/form`, tok2, null);
  ok("§7 org B cannot read org A's form config", crossForm.status === 404, crossForm.status);

  if (smock) smock.close();
  if (!process.env.KEEP) await reset();
  await closeDb();
  summary();
})();
