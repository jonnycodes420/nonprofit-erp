// FIX-1 E — FINANCE THAT EARNS ITS PLACE.
//
// The 25 September walk (claude/FIX-1.md Part 0 §8): Finance showed a payout
// of "$-1.33", "Available $0" beside "Cash on hand $400.4k" with nothing saying
// why, and no way to see which gifts made up a payout. Finance now answers
// three questions, and this suite holds each one to the cent:
//
//   §1  WHICH GIFTS MADE UP THIS PAYOUT (pure). shared/payoutReconcile.js takes
//       a payout and the balance transactions Stripe says made it up. A fixture
//       payout of three charges, one refund and a fee expands to EXACTLY those
//       five rows (never the payout's own transaction), each charge and the
//       refund linked to its gift, and reconciles to the cent. The same lines
//       against a payout $1.00 larger do not reconcile, and the sentence names
//       the difference.
//   §2  THE SAME THING THROUGH THE ROUTE. GET /finance/payout-lines?payout=
//       against a local Stripe mock (STRIPE_API_BASE), in an org this suite
//       creates, with gifts recorded through POST /donors/:id/gifts. The route
//       asks Stripe as the caller's OWN connected account, so another org
//       (no account, or its own account) gets a 404 for the same payout id.
//   §3  A $0 STRIPE BALANCE IS EXPLAINED. /finance/stripe-summary says why it
//       is $0 when the balance is empty, and cash on hand has its sentence.
//   §4  NO "$-" ANYWHERE (source). No client source writes a literal "$-", and
//       no render site prepends its own sign to fmtFull any more.
//   §5  THE CUT (source). The manual Accounts tab and the AI "6-Month
//       Forecast" / "Risk Analysis" buttons are gone; Restricted leads.
//   §6  THE BROWSER, at 1440 and 390: Restricted is the first thing Finance
//       shows; an expanded payout lists exactly its five lines with the donor
//       links and the reconcile sentence; the negative payout reads "-$1.33";
//       the $0 balance and cash on hand each carry their sentence; the monthly
//       close foots; and no Finance view renders "$-" anywhere — with a
//       negative fund balance, budget variance and payout on screen to catch it.
//
// Screenshots: FIX1_E_SHOTS=docs/fix-1/E writes the Finance views there.

const fs = require("fs");
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");

const BASE = process.env.BASE || "http://localhost:5601";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const SHOTS = process.env.FIX1_E_SHOTS || "";
const root = path.join(__dirname, "..");
const haveBrowser = () => {
  try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; }
  return fs.existsSync(path.join(root, "client", "dist", "index.html"));
};

// A fresh suffix per run: the payout and stripe-summary routes cache per org
// for five minutes in the server's memory, and the scratch server outlives runs.
const RUN = Date.now().toString(36).slice(-6);
const ORG = "org_f1e_" + RUN;           // connected to acct_f1e
const ORG_OTHER = "org_f1e_o" + RUN;    // connected to ANOTHER account
const ORG_NONE = "org_f1e_n" + RUN;     // not connected
const ACCT = "acct_f1e_fixture";
const ME = `fix1e-${RUN}@example.org`;
const PW = "loadtest1234";

const CHILD = ["fin_audit_log", "gift_soft_credits", "receipts", "thank_you_drafts", "threads", "tasks", "interactions",
  "fin_transactions", "gifts", "donors", "budgets", "accounts", "fin_funds", "users"];
async function reset(org) {
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
}
async function resetAll() {
  // Earlier runs' orgs too: each run's ids carry its own suffix.
  const old = await q(`SELECT id FROM orgs WHERE id LIKE 'org_f1e_%'`);
  for (const r of old) await reset(r.id);
}

// ── The fixture payout, in Stripe's own shapes ─────────────────────────────
// Three charges, one refund (a partial refund of the first charge) and one
// standalone Stripe fee. Every amount is integer cents, as Stripe sends them.
const PI = { a: "pi_f1e_ada", b: "pi_f1e_bo", c: "pi_f1e_cy" };
const LINES = [
  { id: "txn_f1e_c1", type: "charge", amount: 10000, fee: 320, net: 9680, source: { id: "ch_f1e_1", object: "charge", payment_intent: PI.a } },
  { id: "txn_f1e_c2", type: "charge", amount: 5000, fee: 175, net: 4825, source: { id: "ch_f1e_2", object: "charge", payment_intent: PI.b } },
  { id: "txn_f1e_c3", type: "charge", amount: 2550, fee: 104, net: 2446, source: { id: "ch_f1e_3", object: "charge", payment_intent: PI.c } },
  { id: "txn_f1e_r1", type: "refund", amount: -2000, fee: 0, net: -2000, source: { id: "re_f1e_1", object: "refund", payment_intent: PI.a } },
  { id: "txn_f1e_f1", type: "stripe_fee", amount: -200, fee: 0, net: -200, description: "Radar screening", source: null },
];
// The payout's OWN balance transaction — the money leaving for the bank. It is
// what is being explained, never one of its parts.
const SELF = { id: "txn_f1e_po", type: "payout", amount: -14751, fee: 0, net: -14751, source: "po_f1e_ok" };
const NET = LINES.reduce((s, l) => s + l.net, 0);              // 14751
const FEES = 320 + 175 + 104 + 200;                              // 799
const PAYOUTS = {
  po_f1e_ok:  { id: "po_f1e_ok", object: "payout", amount: NET, status: "paid", arrival_date: 1758800000 },
  po_f1e_off: { id: "po_f1e_off", object: "payout", amount: NET + 100, status: "paid", arrival_date: 1758700000 },
  // The walk's own payout: a fee-only negative payout, "$-1.33" on screen.
  po_f1e_neg: { id: "po_f1e_neg", object: "payout", amount: -133, status: "paid", arrival_date: 1758600000 },
};
const TXNS = {
  po_f1e_ok: [...LINES, SELF],
  po_f1e_off: [...LINES, { ...SELF, id: "txn_f1e_po2", amount: -(NET + 100), net: -(NET + 100) }],
  po_f1e_neg: [{ id: "txn_f1e_f2", type: "stripe_fee", amount: -133, fee: 0, net: -133, description: "Account fee", source: null },
               { id: "txn_f1e_po3", type: "payout", amount: 133, fee: 0, net: 133, source: "po_f1e_neg" }],
};

function startMock() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push({ url: req.url, account: req.headers["stripe-account"] || null });
    res.setHeader("content-type", "application/json");
    const acct = req.headers["stripe-account"];
    const u = new URL(req.url, "http://x");
    const notFound = () => { res.statusCode = 404; res.end(JSON.stringify({ error: { type: "invalid_request_error", code: "resource_missing", message: "No such payout" } })); };
    if (u.pathname === "/v1/balance") {
      return res.end(JSON.stringify({ object: "balance", available: [{ amount: 0, currency: "usd" }], pending: [{ amount: 0, currency: "usd" }] }));
    }
    if (u.pathname === "/v1/payouts") {
      if (acct !== ACCT) return res.end(JSON.stringify({ object: "list", data: [], has_more: false }));
      return res.end(JSON.stringify({ object: "list", data: Object.values(PAYOUTS), has_more: false }));
    }
    const m = /^\/v1\/payouts\/([^/]+)$/.exec(u.pathname);
    if (m) {
      // A payout id is only ever found on the account that owns it.
      if (acct !== ACCT || !PAYOUTS[m[1]]) return notFound();
      return res.end(JSON.stringify(PAYOUTS[m[1]]));
    }
    if (u.pathname === "/v1/balance_transactions") {
      const po = u.searchParams.get("payout");
      if (acct !== ACCT || !TXNS[po]) return notFound();
      return res.end(JSON.stringify({ object: "list", data: TXNS[po], has_more: false }));
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: { message: "mock: unexpected " + req.url } }));
  });
  return new Promise(r => { srv.on("error", () => r(null)); srv.listen(STRIPE_MOCK_PORT, () => r({ srv, seen })); });
}

const walkDir = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walkDir(path.join(dir, e.name)) : /\.(jsx?|tsx?)$/.test(e.name) ? [path.join(dir, e.name)] : []);
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

(async () => {
  console.log("fix1-finance");

  // ── §1 · the reconciliation, pure ────────────────────────────────────────
  console.log("\n— §1 · which gifts made up this payout (pure) —");
  let R = null;
  try { R = await import("../shared/payoutReconcile.js"); } catch (e) { ok("§1 shared/payoutReconcile.js exists", false, e.message); }
  if (R) {
    const gifts = { [PI.a]: { giftId: "g_a", donorId: "d_a", donorName: "Ada Park", amountCents: 10000 },
                    [PI.b]: { giftId: "g_b", donorId: "d_b", donorName: "Bo Lind", amountCents: 5000 },
                    [PI.c]: { giftId: "g_c", donorId: "d_c", donorName: "Cy Moreno", amountCents: 2550 } };
    const rec = R.reconcilePayout(PAYOUTS.po_f1e_ok, TXNS.po_f1e_ok, gifts);
    ok("§1 the payout expands to exactly its five lines (the payout's own transaction is not one)",
       rec.rows.length === 5 && rec.rows.map(r => r.id).join() === LINES.map(l => l.id).join(), rec.rows.map(r => r.id));
    ok("§1 three charges, one refund, one fee", rec.rows.filter(r => r.kind === "charge").length === 3
       && rec.rows.filter(r => r.kind === "refund").length === 1 && rec.rows.filter(r => r.kind === "fee").length === 1,
       rec.rows.map(r => r.kind));
    ok("§1 each charge is linked to its gift and donor",
       rec.rows.filter(r => r.kind === "charge").map(r => r.giftId + ":" + r.donorId).join() === "g_a:d_a,g_b:d_b,g_c:d_c");
    ok("§1 the refund is linked to the gift it gave money back on", rec.rows.find(r => r.kind === "refund").giftId === "g_a");
    ok("§1 it reconciles to the cent", rec.reconciled === true && rec.differenceCents === 0 && rec.sumNetCents === NET && rec.payoutCents === NET,
       { reconciled: rec.reconciled, diff: rec.differenceCents, sum: rec.sumNetCents });
    ok("§1 fees are every cent Stripe kept (per-charge fees + the standalone fee)", rec.feesCents === FEES, rec.feesCents);
    ok("§1 the sentence says it adds up to the cent", /to the cent/.test(rec.sentence) && rec.sentence.includes("$147.51"), rec.sentence);

    const off = R.reconcilePayout(PAYOUTS.po_f1e_off, TXNS.po_f1e_off, gifts);
    ok("§1 a payout $1.00 larger does NOT reconcile", off.reconciled === false && off.differenceCents === 100, off.differenceCents);
    ok("§1 …and its sentence names the difference", /does not reconcile/.test(off.sentence) && off.sentence.includes("$1.00"), off.sentence);
    const under = R.reconcilePayout({ ...PAYOUTS.po_f1e_ok, amount: NET - 7 }, TXNS.po_f1e_ok, gifts);
    ok("§1 a short payout names its difference the other way", under.differenceCents === -7 && under.sentence.includes("$0.07 less than"), under.sentence);
    const neg = R.reconcilePayout(PAYOUTS.po_f1e_neg, TXNS.po_f1e_neg, {});
    ok("§1 the walk's negative payout reconciles and reads sign-first", neg.reconciled && neg.sentence.includes("-$1.33") && !neg.sentence.includes("$-"), neg.sentence);
    const bare = R.reconcilePayout(PAYOUTS.po_f1e_ok, TXNS.po_f1e_ok.map(t => t.source && typeof t.source === "object" ? { ...t, source: t.source.id } : t), gifts);
    ok("§1 an unexpanded source links nothing and says so (never guessed)", bare.rows.every(r => !r.giftId) && bare.unmatchedCount === 4, bare.unmatchedCount);
    ok("§1 the cash-on-hand sentence exists", typeof R.CASH_ON_HAND_SENTENCE === "string" && R.CASH_ON_HAND_SENTENCE.length > 40);
    const zero = R.stripeBalanceSentence({ availableCents: 0, pendingCents: 0, cashOnHandText: "$400.4k" });
    ok("§1 a $0 Stripe balance is explained, beside cash on hand", /\$0/.test(zero) && zero.includes("$400.4k") && /bank/.test(zero), zero);
  }

  // ── fixture ──────────────────────────────────────────────────────────────
  await resetAll();
  const hash = bcrypt.hashSync(PW, 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,timezone,timezone_confirmed_at)
           VALUES ($1,'Harbour Lights Choir',$1,1,'active','team',$2,'America/New_York',NOW())`, [ORG, ACCT]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id)
           VALUES ($1,'Other Org',$1,1,'active','team','acct_f1e_someone_else')`, [ORG_OTHER]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Unconnected Org',$1,1,'active','team')`, [ORG_NONE]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Maren Holt','admin')`, ["u_" + ORG, ORG, ME, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Other Admin','admin')`, ["u_" + ORG_OTHER, ORG_OTHER, `o-${ME}`, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'None Admin','admin')`, ["u_" + ORG_NONE, ORG_NONE, `n-${ME}`, hash]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'4010','Individual Contributions','revenue',true)`, ["acc_i_" + RUN, ORG]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,active) VALUES ($1,$2,'6010','Program Supplies','expense',true)`, ["acc_e_" + RUN, ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, ["ff_gen_" + RUN, ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'Music Library',false)`, ["ff_lib_" + RUN, ORG]);
  const D = { a: "d_f1e_ada_" + RUN, b: "d_f1e_bo_" + RUN, c: "d_f1e_cy_" + RUN };
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES
           ($1,$4,'Ada Park','ada-${RUN}@example.org','new','cultivate',0,0),
           ($2,$4,'Bo Lind','bo-${RUN}@example.org','new','cultivate',0,0),
           ($3,$4,'Cy Moreno','cy-${RUN}@example.org','new','cultivate',0,0)`, [D.a, D.b, D.c, ORG]);
  const tok = await login(ME);
  const tokOther = await login(`o-${ME}`);
  const tokNone = await login(`n-${ME}`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const giftIds = {};
  for (const [k, amount] of [["a", 100], ["b", 50], ["c", 25.5]]) {
    const r = await api("POST", `/donors/${D[k]}/gifts`, tok, { amount, date: today, type: "cash", idempotencyKey: `f1e-${RUN}-${k}` });
    giftIds[k] = r.body && (r.body.id || r.body.gift?.id);
    // The Stripe payment intent is what the donation webhook stamps on an
    // online gift; the fixture stamps it on the gift recordGift just wrote.
    if (giftIds[k]) await q(`UPDATE gifts SET stripe_payment_id=$1 WHERE id=$2 AND org_id=$3`, [PI[k], giftIds[k], ORG]);
  }
  ok("§0 the three fixture gifts were recorded through the gift route", Object.values(giftIds).every(Boolean), giftIds);
  // A NEGATIVE balance on screen, so the "$-" legs have something to catch:
  // a fund that has only spent, and a budget it has overrun.
  await api("POST", "/finance/transactions", tok, { date: today, description: "Sheet music", amount: 300, type: "expense",
    accountId: "acc_e_" + RUN, fundId: "ff_lib_" + RUN, vendorDonor: "Harbour Music Supply" });
  await api("POST", "/finance/budgets", tok, { accountId: "acc_e_" + RUN, year: Number(today.slice(0, 4)), amount: 100 });

  const mock = await startMock();
  if (!mock) {
    ok(`§2 the Stripe mock can bind :${STRIPE_MOCK_PORT}`, false, "port busy");
  } else {
    // ── §2 · the route ─────────────────────────────────────────────────────
    console.log("\n— §2 · GET /finance/payout-lines, through the real route —");
    const r = await api("GET", "/finance/payout-lines?payout=po_f1e_ok", tok);
    if (!mock.seen.length) {
      ok("§2 the server was booted with STRIPE_API_BASE on the mock port (it asked the mock nothing)", false, r.status);
    }
    const b = r.body || {};
    ok("§2 200 for the org's own payout", r.status === 200, [r.status, r.text && r.text.slice(0, 200)]);
    ok("§2 exactly the five lines, in Stripe's order", Array.isArray(b.rows) && b.rows.map(x => x.id).join() === LINES.map(l => l.id).join(),
       b.rows && b.rows.map(x => x.id));
    ok("§2 each charge links to the gift recordGift wrote, and its donor",
       Array.isArray(b.rows) && ["a", "b", "c"].every((k, i) => b.rows[i].giftId === giftIds[k] && b.rows[i].donorId === D[k]),
       b.rows && b.rows.map(x => [x.giftId, x.donorId]));
    ok("§2 …by name", Array.isArray(b.rows) && b.rows.slice(0, 3).map(x => x.donorName).join() === "Ada Park,Bo Lind,Cy Moreno");
    ok("§2 the refund links to Ada's gift", Array.isArray(b.rows) && b.rows[3].kind === "refund" && b.rows[3].giftId === giftIds.a);
    ok("§2 reconciles to the cent", b.reconciled === true && b.differenceCents === 0 && b.payoutCents === NET && b.sumNetCents === NET,
       { reconciled: b.reconciled, diff: b.differenceCents });
    ok("§2 fees in cents", b.feesCents === FEES, b.feesCents);
    ok("§2 the route asked Stripe AS the org's own account", (() => { const hit = mock.seen.filter(s => /\/v1\/(payouts\/|balance_transactions)/.test(s.url)); return hit.length >= 2 && hit.every(s => s.account === ACCT); })(), mock.seen);

    const off = await api("GET", "/finance/payout-lines?payout=po_f1e_off", tok);
    ok("§2 a non-reconciling payout says so, by 100 cents", off.status === 200 && off.body.reconciled === false && off.body.differenceCents === 100, off.body && off.body.differenceCents);
    ok("§2 …in a sentence naming $1.00", off.body && /does not reconcile/.test(off.body.sentence) && off.body.sentence.includes("$1.00"), off.body && off.body.sentence);

    const other = await api("GET", "/finance/payout-lines?payout=po_f1e_ok", tokOther);
    ok("§2 another org (its own Stripe account) gets 404 for this payout", other.status === 404, other.status);
    const none = await api("GET", "/finance/payout-lines?payout=po_f1e_ok", tokNone);
    ok("§2 an unconnected org gets 404", none.status === 404, none.status);
    const junk = await api("GET", "/finance/payout-lines?payout=" + encodeURIComponent("../balance"), tok);
    ok("§2 a malformed payout id is a 404, never a Stripe call", junk.status === 404, junk.status);
    const anon = await api("GET", "/finance/payout-lines?payout=po_f1e_ok");
    ok("§2 no token → 401", anon.status === 401, anon.status);

    // ── §3 · the $0 balance ────────────────────────────────────────────────
    console.log("\n— §3 · a $0 Stripe balance is explained —");
    const s = await api("GET", "/finance/stripe-summary", tok);
    ok("§3 stripe-summary: connected, $0 available and pending", s.body && s.body.connected === true && s.body.balance.available === 0 && s.body.balance.pending === 0, s.body);
    ok("§3 …and it says why it is $0", s.body && typeof s.body.balanceSentence === "string" && /paid .* out to your bank/.test(s.body.balanceSentence), s.body && s.body.balanceSentence);
    ok("§3 recent payouts stay five or fewer (the BUILD-09 shape)", s.body && Array.isArray(s.body.payouts) && s.body.payouts.length <= 5);
  }

  // ── §4 · no "$-" in any client source ────────────────────────────────────
  console.log("\n— §4 · sign-first everywhere (source) —");
  const clientFiles = walkDir(path.join(root, "client", "src"));
  const literal = clientFiles.filter(f => /"\$-|'\$-|`\$-/.test(stripComments(fs.readFileSync(f, "utf8"))));
  ok("§4 no client source writes a literal \"$-\"", literal.length === 0, literal.map(f => path.relative(root, f)));
  const prepend = clientFiles.filter(f => /<\s*0\s*&&\s*["'`][-−]["'`]\s*\}\s*\{\s*fmt(Full)?\(\s*Math\.abs/.test(stripComments(fs.readFileSync(f, "utf8"))));
  ok("§4 no render site prepends its own minus to fmtFull(Math.abs(...))", prepend.length === 0, prepend.map(f => path.relative(root, f)));
  const M = await import(path.join(root, "client/src/lib/money.js"));
  ok("§4 fmtFull(-1.33) is -$1.33", M.fmtFull(-1.33) === "-$1.33", M.fmtFull(-1.33));

  // ── §5 · the cut ─────────────────────────────────────────────────────────
  console.log("\n— §5 · what was removed, and what leads —");
  const fin = fs.readFileSync(path.join(root, "client/src/components/Finance.jsx"), "utf8");
  const finCode = stripComments(fin);
  const tabs = (/const SUBTABS = \[([\s\S]*?)\];/.exec(finCode) || [])[1] || "";
  const tabIds = [...tabs.matchAll(/id:\s*"([^"]+)"/g)].map(m => m[1]);
  ok("§5 Restricted is the first Finance tab", tabIds[0] === "restricted", tabIds);
  ok("§5 …and the one Finance opens on", /useState\("restricted"\)/.test(finCode));
  ok("§5 Payouts and Monthly close are Finance tabs", tabIds.includes("payouts") && tabIds.includes("close"), tabIds);
  ok("§5 the manual Accounts tab is gone", !tabIds.includes("accounts") && !/subtab === "accounts"/.test(finCode) && !/AccountModal/.test(finCode), tabIds);
  ok("§5 the \"6-Month Forecast\" button is gone", !/6-Month Forecast/.test(finCode));
  ok("§5 the \"Risk Analysis\" button is gone", !/Risk Analysis/.test(finCode));
  ok("§5 Finance asks no model anything", !/askClaude|AIBtn|AIPanel/.test(finCode));
  ok("§5 the old \"reconciliation is coming\" promise is gone", !/reconciliation is coming/.test(finCode));
  ok("§5 E-NOTES lists what was removed", fs.existsSync(path.join(root, "docs/fix-1/E-NOTES.md"))
     && /Accounts/.test(fs.readFileSync(path.join(root, "docs/fix-1/E-NOTES.md"), "utf8"))
     && /Risk Analysis/.test(fs.readFileSync(path.join(root, "docs/fix-1/E-NOTES.md"), "utf8")));

  // ── §6 · the browser ─────────────────────────────────────────────────────
  if (!mock) { /* reported above */ }
  else if (!haveBrowser()) {
    console.log("  SKIP — no Playwright or client/dist (browser leg)");
  } else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    if (SHOTS) fs.mkdirSync(path.join(root, SHOTS), { recursive: true });
    for (const W of [1440, 390]) {
      console.log(`\n— §6 · the browser at ${W}px —`);
      const full = W === 1440;
      const ctx = await browser.newContext({ viewport: { width: W, height: full ? 1000 : 844 }, ...(full ? {} : { isMobile: true, hasTouch: true }) });
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", e => { const t = String(e.message); if (!/Stream failed: 503/.test(t)) errs.push(t); });
      page.on("console", m => { const t = m.text(); if (m.type() === "error" && !/_vercel|Failed to load resource|Stream failed: 503/.test(t)) errs.push(t); });
      const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(root, SHOTS, `${name}-${W}.png`), fullPage: true }); };
      const body = () => page.locator("body").innerText();
      const noDollarDash = async where => {
        const t = await body();
        ok(`§6 ${where} renders no "$-" (${W})`, !t.includes("$-"), (t.match(/.{0,30}\$-.{0,20}/g) || []).slice(0, 4));
      };
      const noSideways = async where => ok(`§6 ${where} does not scroll sideways (${W})`,
        !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)),
        await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
      const goTab = async label => {
        const direct = page.locator("button:visible", { hasText: new RegExp("^\\s*[^A-Za-z]*\\s*" + label + "\\s*$") }).first();
        if (await direct.count()) { await direct.click(); }
        else {
          await page.locator("button:visible", { hasText: /^\s*[^A-Za-z]*\s*More\s*$/ }).first().click();
          await page.waitForTimeout(400);
          await page.locator("button:visible", { hasText: new RegExp(label) }).first().click();
        }
        await page.waitForTimeout(1500);
      };
      const subTab = async label => {
        await page.locator(".finance-tabbar button:visible", { hasText: new RegExp("^\\s*" + label + "\\s*$") }).first().click();
        await page.waitForTimeout(1200);
      };

      const lj = await (await page.request.post(BASE + "/auth/login", { data: { email: ME, password: PW } })).json();
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await page.evaluate(x => { localStorage.setItem("npe_token", x.token); localStorage.setItem("npe_user", JSON.stringify(x.user)); localStorage.setItem("npe_org", JSON.stringify(x.org)); }, lj);
      await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await goTab("Finance");

      // Restricted leads.
      const tabTexts = (await page.locator(".finance-tabbar button").allInnerTexts()).map(t => t.trim());
      ok(`§6 the first Finance tab is Restricted (${W})`, tabTexts[0] === "Restricted", tabTexts);
      ok(`§6 Finance opens on Restricted (${W})`, await page.locator('[data-testid="restricted-view"]').count() === 1);
      ok(`§6 no Accounts tab (${W})`, !tabTexts.includes("Accounts"), tabTexts);
      const t0 = await body();
      ok(`§6 no AI forecast or risk buttons anywhere in Finance (${W})`, !/6-Month Forecast|Risk Analysis/.test(t0));
      await noDollarDash("Restricted");
      await shot("finance-restricted");

      // Payouts: the list, then one expanded.
      await subTab("Payouts");
      ok(`§6 the payouts list shows the three payouts (${W})`, await page.locator('[data-testid="payout-row"]').count() === 3);
      const listText = await body();
      ok(`§6 the walk's payout reads "-$1.33" (${W})`, listText.includes("-$1.33"), (listText.match(/.{0,20}1\.33.{0,10}/g) || []));
      await noDollarDash("Payouts");
      await shot("finance-payouts");
      await page.locator('[data-testid="payout-row"]').first().click();
      await page.waitForTimeout(1500);
      ok(`§6 the expanded payout lists exactly its five lines (${W})`, await page.locator('[data-testid="payout-line"]').count() === 5);
      const sent = await page.locator('[data-testid="payout-sentence"]').innerText().catch(() => "");
      ok(`§6 …and says it adds up to the cent (${W})`, /to the cent/.test(sent) && sent.includes("$147.51"), sent);
      const donorLinks = await page.locator('[data-testid="payout-line"] [data-testid="payout-donor"]').allInnerTexts();
      ok(`§6 each gift line names its donor, the refund too (${W})`, donorLinks.join("|") === "Ada Park|Bo Lind|Cy Moreno|Ada Park", donorLinks);
      await noDollarDash("an expanded payout");
      await noSideways("an expanded payout");
      await shot("finance-payout-expanded");
      if (full) {
        await page.locator('[data-testid="payout-line"] [data-testid="payout-donor"]').first().click();
        await page.waitForTimeout(1500);
        ok("§6 a donor on a payout line opens that donor (Finance gives way to her record)",
           await page.locator(".finance-tabbar").count() === 0 && /Ada Park/.test(await body()) && /\$100/.test(await body()),
           (await body()).slice(0, 300));
        await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1200);
        await goTab("Finance");
        await subTab("Payouts");
      } else {
        await page.locator("button:visible", { hasText: /All payouts/ }).first().click();
        await page.waitForTimeout(600);
      }
      await page.locator('[data-testid="payout-row"]').nth(1).click().catch(() => {});
      await page.waitForTimeout(1500);
      const offSent = await page.locator('[data-testid="payout-sentence"]').innerText().catch(() => "");
      ok(`§6 the non-reconciling payout names its difference on screen (${W})`, /does not reconcile/.test(offSent) && offSent.includes("$1.00"), offSent);
      if (full) await shot("finance-payout-unreconciled");

      // Monthly close — this month holds the three fixture gifts.
      await subTab("Monthly close");
      await page.locator('input[type="month"]').fill(today.slice(0, 7));
      await page.waitForTimeout(1500);
      const close = await page.locator('[data-testid="close-sentence"]').innerText().catch(() => "");
      ok(`§6 the monthly close foots: 3 gifts, $175.50 (${W})`, /3 gifts/.test(close) && close.includes("$175.50") && /foots/.test(close), close);
      ok(`§6 …and offers the bookkeeper's file (${W})`, await page.locator("button:visible", { hasText: /for the bookkeeper/ }).count() === 1);
      await noDollarDash("Monthly close");
      await noSideways("Monthly close");
      await shot("finance-monthly-close");

      // Overview: cash on hand + the $0 Stripe balance, each with a sentence.
      await subTab("Overview");
      const ov = await body();
      ok(`§6 cash on hand carries its sentence (${W})`, ov.includes((await import("../shared/payoutReconcile.js")).CASH_ON_HAND_SENTENCE));
      const bal = await page.locator('[data-testid="stripe-balance-sentence"]').innerText().catch(() => "");
      ok(`§6 the $0 Stripe balance is explained beside cash on hand (${W})`, /\$0/.test(bal) && /bank/.test(bal) && /cash on hand/i.test(bal), bal);
      await noDollarDash("Overview");
      await noSideways("Overview");
      await shot("finance-overview");

      for (const label of ["Transactions", "Funds", "Budgets", "Audit Log"]) {
        await subTab(label);
        await noDollarDash(label);
      }
      const fundsText = await (async () => { await subTab("Funds"); return body(); })();
      ok(`§6 the overspent fund shows sign-first (-$300) — the "$-" legs have a negative to catch (${W})`, fundsText.includes("-$300"), (fundsText.match(/.{0,20}300.{0,10}/g) || []).slice(0, 3));
      ok(`§6 no page error on Finance (${W})`, errs.length === 0, errs.slice(0, 3));
      await ctx.close();
    }
    await browser.close();
  }

  if (mock) mock.srv.close();
  await resetAll();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
