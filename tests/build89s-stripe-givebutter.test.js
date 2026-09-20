// BUILD-89S 89e — STRIPE (THEIR OWN) AND GIVEBUTTER.
// Run: node tests/build89s-stripe-givebutter.test.js
//
//   §1  STRIPE IS NOT STEWARD'S STRIPE. Asserted structurally: this adapter
//       names none of Steward's keys, clients or the SDK, so it cannot share a
//       code path with donations or with platform billing.
//   §2  THE CHARGE. Minor units already, the real fee off the balance
//       transaction, refunded and failed read correctly.
//   §3  THE SUBSCRIPTION ID ACROSS TWO API GENERATIONS — BUILD-57's finding,
//       which cost a whole drill to learn once.
//   §4  A FAILED INVOICE RAISES THE THREAD THE SAME DAY, not after five.
//       Driven through the REAL runner, not a parallel implementation.
//   §5  GIVEBUTTER: the field table, the transactions, and a stopped PLAN
//       travelling down the one contract rather than a second channel.
//   §6  GET ONLY, both providers.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const fs = require("fs");
const reg = require("../sources");
const st = require("../sources/stripeSource.js");
const gb = require("../sources/givebutter.js");

const A = "org_b89eA";
const http = (p, f) => reg.readOnlyHttp(p, { fetchImpl: f });

function recorder(handler) {
  const seen = [];
  return {
    seen,
    fetchImpl: async (url, init = {}) => {
      seen.push({ method: (init.method || "GET").toUpperCase(), url: String(url), auth: init.headers?.Authorization });
      return handler(String(url), init) || new Response("{}", { status: 200 });
    },
  };
}

const CHARGE = {
  id: "ch_3Qx1", object: "charge", amount: 7500, amount_refunded: 0, refunded: false,
  created: Math.floor(Date.parse("2026-08-14T12:00:00Z") / 1000),
  currency: "usd", status: "succeeded",
  balance_transaction: { id: "txn_1", fee: 248, net: 7252 },
  billing_details: { name: "Owen Marsh", email: "Owen@Example.org" },
  description: "Donation",
};

const CHILD = ["giving_recurring", "giving_sources", "thank_you_drafts", "pledge_installments", "threads",
  "imports", "fin_transactions", "gifts", "interactions", "donors", "fin_funds", "accounts", "users"];

async function seed(org, slug) {
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [org, "B89e " + slug, slug]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Ada Admin','admin')`,
    [`u_${org}`, org, `${slug}@t.local`, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active)
           VALUES ($1,$2,'4010','Individual Contributions','revenue','contributions',true)`, [`acct_${org}`, org]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`,
    [`ffgen_${org}`, org]);
}

(async () => {
  // ══ §1 · STRIPE IS NOT STEWARD'S STRIPE ══════════════════════════════════
  console.log("\n— §1 · the org's own Stripe shares no code path with Steward's —");
  // A COMMENT IS NOT A CODE PATH. The file EXPLAINS what it must not touch, by
  // name, which is the whole reason the rule is legible — so the guard reads
  // the code with comments stripped. (CLAUDE.md's own recurring lesson: three
  // separate guards had to be taught that a comment is not a screen.)
  const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const src = stripComments(fs.readFileSync(require.resolve("../sources/stripeSource.js"), "utf8"));
  const forbidden = [
    ["stripeKeys", /require\(["'].*stripeKeys/],
    ["the Stripe SDK", /require\(["']stripe["']\)/],
    ["STRIPE_SECRET_KEY", /STRIPE_SECRET_KEY/],
    ["STRIPE_BILLING_SECRET_KEY", /STRIPE_BILLING_SECRET_KEY/],
    ["donationStripeKey", /donationStripeKey/],
    ["billingStripe", /billingStripe/],
    ["server.js", /require\(["']\.\.\/server/],
  ];
  const leaked = forbidden.filter(([, re]) => re.test(src)).map(([n]) => n);
  ok("it names none of Steward's own Stripe keys, clients, or the SDK", leaked.length === 0, leaked);
  // The SDK is the point: an SDK object would hand anything holding it a
  // .refunds.create(), and the read-only handle could not see it happen.
  ok("it talks to Stripe over the read-only handle, not an SDK client",
    /http\.json\(/.test(src) && !/new Stripe\(/.test(src));

  // ══ §2 · THE CHARGE ══════════════════════════════════════════════════════
  console.log("\n— §2 · a charge becomes a contract row —");
  const c = st.mapCharge(CHARGE);
  ok("Stripe already speaks in minor units, so nothing is multiplied",
    c.row?.amountCents === 7500, c.row?.amountCents);
  ok("the fee is the REAL fee off the balance transaction", c.row.feeCents === 248);
  ok("the date is the civil day of the unix timestamp", c.row.occurredAt === "2026-08-14", c.row.occurredAt);
  ok("the donor comes off billing details", c.row.donorName === "Owen Marsh" && c.row.donorEmail === "Owen@Example.org");
  ok("a receipt_email is preferred when Stripe has one",
    st.mapCharge({ ...CHARGE, receipt_email: "receipts@example.org" }).row.donorEmail === "receipts@example.org");
  ok("a refunded charge comes back refunded, for 89a to count and name",
    st.mapCharge({ ...CHARGE, refunded: true }).row.status === "refunded");
  ok("...and so does a partially refunded one",
    st.mapCharge({ ...CHARGE, amount_refunded: 500 }).row.status === "refunded");
  ok("a failed charge is failed", st.mapCharge({ ...CHARGE, status: "failed" }).row.status === "failed");
  ok("a pending charge is held for the next sync", st.mapCharge({ ...CHARGE, status: "pending" }).drop === "pending");
  ok("a zero or negative charge is not money in", st.mapCharge({ ...CHARGE, amount: 0 }).drop === "not_money_in");
  ok("an unexpanded balance transaction means a fee of zero, never a guessed one",
    st.mapCharge({ ...CHARGE, balance_transaction: "txn_1" }).row.feeCents === 0);

  // ══ §3 · TWO API GENERATIONS ═════════════════════════════════════════════
  console.log("\n— §3 · where a subscription id lives depends on the API version —");
  ok("the legacy shape: invoice.subscription",
    st.subscriptionIdOf({ id: "in_1", subscription: "sub_legacy" }) === "sub_legacy");
  ok("the 2025+ shape: invoice.parent.subscription_details.subscription",
    st.subscriptionIdOf({ id: "in_1", parent: { subscription_details: { subscription: "sub_modern" } } }) === "sub_modern");
  ok("an expanded subscription OBJECT resolves to its id either way",
    st.subscriptionIdOf({ subscription: { id: "sub_obj" } }) === "sub_obj"
    && st.subscriptionIdOf({ parent: { subscription_details: { subscription: { id: "sub_obj2" } } } }) === "sub_obj2");
  ok("an invoice with no subscription resolves to nothing, not to a guess",
    st.subscriptionIdOf({ id: "in_1" }) === null && st.subscriptionIdOf(null) === null);
  ok("a one-off charge carries no recurring reference", st.mapCharge(CHARGE).row.recurringRef === null);
  ok("a subscription charge carries the subscription id",
    st.mapCharge({ ...CHARGE, invoice: { id: "in_9", subscription: "sub_xyz" } }).row.recurringRef === "sub_xyz");

  // Paging + the request the adapter actually forms.
  const pages = {
    "": { data: [CHARGE, { ...CHARGE, id: "ch_3Qx2" }], has_more: true },
    ch_3Qx2: { data: [{ ...CHARGE, id: "ch_3Qx3" }], has_more: false },
  };
  const rec = recorder(url => {
    const after = new URL(url).searchParams.get("starting_after") || "";
    return new Response(JSON.stringify(pages[after] || { data: [], has_more: false }), { status: 200 });
  });
  const h = http("stripe", rec.fetchImpl);
  let cur = null, done = false, guard = 0; const ids = [];
  while (!done && guard++ < 10) {
    const out = await st.fetchRows({ credentials: { apiKey: "rk_test_x" }, cursor: cur, http: h, today: "2026-08-20", backfill: true });
    ids.push(...out.rows.map(r => r.externalId)); cur = out.cursor; done = out.done;
  }
  ok("charges page with starting_after and every charge arrives once",
    done && ids.length === 3 && new Set(ids).size === 3, ids);
  ok("the fee and the subscription are EXPANDED, or neither would ever be read",
    rec.seen[0].url.includes("expand") && decodeURIComponent(rec.seen[0].url).includes("data.balance_transaction")
    && decodeURIComponent(rec.seen[0].url).includes("data.invoice"), rec.seen[0].url);
  ok("the restricted key rides the Authorization header, never the query string",
    rec.seen.every(r => r.auth === "Bearer rk_test_x" && !r.url.includes("rk_test_x")));

  // ══ §4 · A FAILED INVOICE RAISES THE THREAD THE SAME DAY ═════════════════
  console.log("\n— §4 · the provider telling us beats the absence of a payment —");
  await seed(A, "b89ea");
  const tok = await login("b89ea@t.local");
  const connected = await api("POST", "/giving-sources", tok, {
    provider: "stripe", credentials: { apiKey: "rk_test_restricted" },
  });
  const SRC = connected.body.id;
  ok("the org's own Stripe connects as a source", connected.status === 200 && !!SRC, connected.body);

  // Three monthly gifts Stripe NAMED as one subscription, so the commitment
  // is recognised with provider confidence rather than inferred.
  const sub = (i, d) => ({
    externalId: `ch_sub_${i}`, occurredAt: d, amountCents: 4000, feeCents: 146,
    currency: "USD", donorName: "Priya Raman", donorEmail: "priya@example.org",
    recurringRef: "sub_priya", status: "completed", memo: "Monthly",
  });
  const run1 = await api("POST", `/giving-sources/${SRC}/sync-fixture`, tok, {
    rows: [sub(1, "2026-06-10"), sub(2, "2026-07-10"), sub(3, "2026-08-10")],
    today: "2026-08-20",
  });
  ok("three subscription charges become three gifts", run1.body.giftsCreated === 3, run1.body);
  const rec1 = await api("GET", "/giving-recurring", tok);
  const priya = rec1.body.recurring.find(r => r.donorName === "Priya Raman");
  ok("and Stripe's own subscription id makes it a stated fact, not a guess",
    priya?.confidence === "provider" && priya.expectedNext === "2026-09-10", priya);

  await q(`DELETE FROM threads WHERE org_id=$1`, [A]);
  // The September payment FAILS, and Stripe says so. It is not late: it did
  // not happen. The grace period must not apply.
  const failed = await api("POST", `/giving-sources/${SRC}/sync-fixture`, tok, {
    rows: [{
      externalId: "ch_sub_4_failed", occurredAt: "2026-09-10", amountCents: 4000,
      currency: "USD", donorName: "Priya Raman", donorEmail: "priya@example.org",
      recurringRef: "sub_priya", status: "failed", memo: "Your card was declined",
    }],
    today: "2026-09-10",
  });
  const threads = await q(`SELECT t.next_step_label, t.due_date FROM threads t
                             JOIN donors d ON d.id=t.donor_id
                            WHERE t.org_id=$1 AND d.email='priya@example.org' AND t.closed_at IS NULL`, [A]);
  ok("a failed payment is not written as a gift", failed.body.giftsCreated === 0 && failed.body.failedSkipped === 1, failed.body);
  ok("the Thread is opened THE SAME DAY, not after the five-day grace",
    threads.length === 1, threads);
  ok("and it says the money, the cadence and the source",
    /Priya's monthly \$40 through Stripe/.test(threads[0]?.next_step_label || ""), threads[0]?.next_step_label);

  // The ordinary sweep must not then raise a SECOND thread for the same month.
  const sweep = await api("POST", "/giving-recurring/sweep", tok, { today: "2026-09-25" });
  const [after] = await q(`SELECT COUNT(*)::int n FROM threads t JOIN donors d ON d.id=t.donor_id
                            WHERE t.org_id=$1 AND d.email='priya@example.org'`, [A]);
  ok("the five-day sweep does not then raise a second Thread about the same month",
    after.n === 1, { swept: sweep.body, threads: after.n });

  // ══ §5 · GIVEBUTTER ══════════════════════════════════════════════════════
  console.log("\n— §5 · Givebutter, and a stopped plan on the one contract —");
  const GTX = {
    id: "gb_tx_1", created_at: "2026-08-14T09:00:00Z", amount: 60, fee: 1.94,
    currency: "USD", status: "succeeded",
    first_name: "Noor", last_name: "Haddad", email: "noor@example.org",
    plan_id: "plan_77", campaign_title: "Spring drive",
  };
  const g = gb.mapTransaction(GTX);
  ok("a Givebutter transaction becomes a contract row",
    g.row?.amountCents === 6000 && g.row.feeCents === 194, g.row);
  ok("the donor's name is joined and the plan is the recurring reference",
    g.row.donorName === "Noor Haddad" && g.row.recurringRef === "plan_77");
  ok("money out is refused", gb.mapTransaction({ ...GTX, amount: -5 }).drop === "not_money_in");
  ok("a refunded transaction is marked refunded",
    gb.mapTransaction({ ...GTX, status: "refunded" }).row.status === "refunded");
  ok("a pending transaction is held for the next sync",
    gb.mapTransaction({ ...GTX, status: "pending" }).drop === "pending");

  // The field table is real, not decoration.
  let proven = 0, missed = [];
  for (const spelling of gb.FIELD_MAP.donorEmail) {
    const t = { id: "x", created_at: "2026-08-14", amount: 10 };
    let cur2 = t;
    const parts = spelling.split(".");
    for (let i = 0; i < parts.length - 1; i++) cur2 = (cur2[parts[i]] ||= {});
    cur2[parts[parts.length - 1]] = "who@example.org";
    if (gb.mapTransaction(t).row?.donorEmail === "who@example.org") proven++; else missed.push(spelling);
  }
  ok(`every declared email spelling is actually read (${proven})`, missed.length === 0, missed);

  // THE THREE PLAN STATES THE BRIEF NAMES, AND NOTHING ELSE.
  for (const s of ["failed", "canceled", "paused"]) {
    const out = gb.mapStoppedPlan({ id: "plan_77", status: s, amount: 60, email: "noor@example.org", updated_at: "2026-09-02" },
      { today: "2026-09-05" });
    ok(`a ${s} plan becomes a failed row naming the plan`,
      out.row?.status === "failed" && out.row.recurringRef === "plan_77", out);
  }
  ok("an ACTIVE plan raises nothing — silence is not a signal",
    gb.mapStoppedPlan({ id: "p", status: "active", amount: 60 }, { today: "2026-09-05" }).drop === "plan_active");
  ok("a plan row's id is namespaced so it can never collide with a transaction id",
    gb.mapStoppedPlan({ id: "gb_tx_1", status: "failed", amount: 60 }, { today: "2026-09-05" })
      .row.externalId.startsWith("plan:gb_tx_1:"));

  // Transactions page, then plans are read ONCE at the end of the walk.
  const gPages = {
    1: { data: [GTX, { ...GTX, id: "gb_tx_2" }], meta: { last_page: 2 } },
    2: { data: [{ ...GTX, id: "gb_tx_3" }], meta: { last_page: 2 } },
  };
  const gRec = recorder(url => {
    if (url.includes("/plans")) {
      return new Response(JSON.stringify({
        data: [
          { id: "plan_77", status: "failed", amount: 60, email: "noor@example.org", updated_at: "2026-09-02" },
          { id: "plan_88", status: "active", amount: 25, email: "fine@example.org" },
        ],
      }), { status: 200 });
    }
    const page = new URL(url).searchParams.get("page") || "1";
    return new Response(JSON.stringify(gPages[page] || { data: [], meta: { last_page: 2 } }), { status: 200 });
  });
  const gh = http("givebutter", gRec.fetchImpl);
  let gc = null, gd = false, gg = 0; const grows = []; const gnotices = [];
  while (!gd && gg++ < 10) {
    const out = await gb.fetchRows({ credentials: { apiKey: "gb_key" }, cursor: gc, http: gh, today: "2026-09-05" });
    grows.push(...out.rows); gnotices.push(...out.notices); gc = out.cursor; gd = out.done;
  }
  ok("both transaction pages are read", grows.filter(r => r.status === "completed").length === 3, grows.length);
  ok("the stopped plan arrives as a failed row on the SAME contract",
    grows.filter(r => r.status === "failed" && r.recurringRef === "plan_77").length === 1, grows);
  ok("the active plan does not", !grows.some(r => r.recurringRef === "plan_88"));
  ok("plans are read ONCE, at the end of the walk, not once per page",
    gRec.seen.filter(r => r.url.includes("/plans")).length === 1,
    gRec.seen.map(r => r.url.split("?")[0]));
  ok("and the stopped plan is reported in words", gnotices.some(n => /1 recurring plan that stopped/.test(n)), gnotices);

  // A plans read that fails must not lose the transactions already read.
  const gRec2 = recorder(url => url.includes("/plans")
    ? new Response(JSON.stringify({ message: "nope" }), { status: 500 })
    : new Response(JSON.stringify({ data: [GTX], meta: { last_page: 1 } }), { status: 200 }));
  const out2 = await gb.fetchRows({ credentials: { apiKey: "k" }, cursor: null, http: http("givebutter", gRec2.fetchImpl), today: "2026-09-05" });
  ok("a plans read that fails keeps the gifts and says what was missed",
    out2.rows.length === 1 && out2.notices.some(n => /plans could not be read/.test(n)), out2);

  // ══ §6 · GET ONLY ════════════════════════════════════════════════════════
  console.log("\n— §6 · both providers, read only —");
  const every = [...rec.seen, ...gRec.seen, ...gRec2.seen];
  ok("every request either adapter made was a GET",
    every.length > 0 && every.every(r => r.method === "GET"),
    every.filter(r => r.method !== "GET").map(r => `${r.method} ${r.url}`));
  ok("nothing was sent to a refund, payout or subscription-cancel endpoint",
    !every.some(r => /refund|payout|\/cancel|\/pause/i.test(r.url)), every.map(r => r.url.split("?")[0]));
  let sWrite = "allowed";
  try { await h("https://api.stripe.com/v1/refunds", { method: "POST" }); } catch (e) { sWrite = e.code; }
  ok("a refund POST on the org's own Stripe is refused by the handle",
    sWrite === "PROVIDER_WRITE_REFUSED", sWrite);

  await closeDb();
  summary();
})();
