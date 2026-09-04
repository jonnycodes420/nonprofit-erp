// BUILD-76 — MAKE DRIFT REAL, AND PROVE IT.
//
// Every named case from the build brief's fixture table, driven through the
// REAL import path (/donors/import-combined, the same route the client posts
// parsed spreadsheets to — the server never sees raw CSV bytes; the client
// parses, exactly as import-reconciliation.test.js established). The fixture
// is CONSTRUCTED RELATIVE TO TODAY because drift is a function of today — a
// committed static CSV would rot into different states as the calendar moves
// (the "quarterly, three intervals late" donor becomes "lapsed" all by
// himself in six months).
//
//   §1  the fixture file through the real import path + the BUILD-72
//       reconciliation invariant still balances
//   §2  every named case asserted BY NAME (state + confidence)
//   §3  the exclusion FAMILY — deceased/do-not-contact/recurring/pledge,
//       each crossed with "past cadence", plus deceased×seasonal
//   §4  the badge and the list read from ONE computation (same payloads),
//       and a child server with a different DRIFT_DRIFT_THRESHOLD moves
//       BOTH together
//   §5  a manual gift clears drift; double-tap Save (same idempotency key)
//       produces one clear, not two
//   §6  a (mock-signed) webhook gift clears drift and the headline drops by
//       the right amount; a FULL REFUND brings the donor back — no stale flag
//   §7  Part 4 — the logging loop: done-with-a-line → interaction (right
//       type, right actor, visible recency), skip → recorded as skipped,
//       double-tap deduped, the list stops resurfacing, log_capture_rate
//   §8  the cap: 11 on the home list, see-all lifts it
//   §9  reasons are sentences a fundraiser would say — no system language
//
// The LIVE-Stripe leg (real test-mode webhooks, no mocks) is
// scripts/build76-drift-drill.js — this suite is the deterministic battery.
//
// Local scratch server + Postgres (tests/README.md recipe).

const bcrypt = require("bcryptjs");
const http = require("http");
const { spawn } = require("child_process");
const Stripe = require("stripe");
const { BASE, ok, summary, login, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");
const driftEngine = require("../drift");

const ORG = "org_b76drift", ACCT = "acct_b76drift";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");

// ── date construction, relative to today ────────────────────────────────────
// Day-level UTC arithmetic; every fixture leaves WEEKS of slack around its
// thresholds so the local-vs-UTC evening skew (±1 day) can never flip a case.
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * 86400000);
const TODAY = daysAgo(0);

// The cluster month for the seasonal donor: the month ~14 months back, so the
// expected window (that month, THIS-or-last year) closed months ago whatever
// the run date. Six years of gifts in that month, on the 10th.
function seasonalDates() {
  const anchor = new Date(Date.now() - 426 * 86400000); // ~14 months ago
  const y = anchor.getUTCFullYear(), m = anchor.getUTCMonth() + 1;
  const dates = [];
  for (let i = 5; i >= 0; i--) dates.push(`${y - i}-${String(m).padStart(2, "0")}-10`);
  return dates;
}
// A seasonal donor still INSIDE their window: gave in the current month, every
// year for five years (window not remotely closed).
function seasonalCurrentDates() {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const dates = [];
  // day 01, not 05: a current-month gift dated even one day ahead of today
  // is now a future-date ERROR (BUILD-77 Part 2c), so the in-window donor's
  // latest gift must already have happened whatever today's day-of-month is.
  for (let i = 4; i >= 0; i--) dates.push(`${y - i}-${String(m).padStart(2, "0")}-01`);
  return dates;
}
const quarterlyEnding = (endDaysAgo, n = 5) => {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(daysAgo(endDaysAgo + i * 91));
  return out;
};
const yearlyEnding = (endDaysAgo, n = 3) => {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(daysAgo(endDaysAgo + i * 365));
  return out;
};

// ── THE FIXTURE — every donor is a named case ───────────────────────────────
// [email-local-part, display name, [gift dates], amount, extra donor fields]
const CASES = [
  // brief: Seasonal — gave every <month> for 6 years, nothing since → drifting, high, seasonal reasoning
  ["seasonal", "Season Sarah", seasonalDates(), 2000, {}],
  // brief: seasonal donor still inside their month → NOT drifting
  ["seasonal-current", "Window Wendy", seasonalCurrentDates(), 1500, {}],
  // brief: Declining — steady quarterly, then one, then none (~2.2× cadence out) → drifting, high
  ["declining", "Declan Decline", [...quarterlyEnding(566, 5), daysAgo(200)], 250, {}],
  // brief: Regular quarterly, one interval late (≈1.1×) → NOT drifting, inside threshold
  ["quarterly-late", "Quinn Quarterly", quarterlyEnding(100), 500, {}],
  // brief: Regular quarterly, clearly past (≈2×) → drifting
  ["quarterly-past", "Paula Pastdue", quarterlyEnding(182), 500, {}],
  // brief: Five years silent → lapsed, NOT drifting
  ["silent", "Silas Silent", yearlyEnding(1270), 1000, {}],
  // brief: Single gift, two years ago → not eligible (no cadence exists)
  ["single", "Solo Sam", [daysAgo(730)], 50, {}],
  // brief: Two gifts, wide interval → medium confidence, not surfaced by default
  ["two-wide", "Wide Wanda", [daysAgo(975), daysAgo(550)], 400, {}],
  // brief: Erratic (intervals 943d, 574d) → medium AT MOST; high confidence here is a bug
  ["erratic", "Eric Erratic", [daysAgo(1917), daysAgo(974), daysAgo(400)], 100, {}],
  // brief: Deceased, past cadence → EXCLUDED (the worst possible false positive)
  ["deceased", "Dora Deceased", yearlyEnding(500), 800, { deceased: true }],
  // brief (family): deceased AND seasonal AND past cadence → still excluded
  ["deceased-seasonal", "Denise Deceased", seasonalDates(), 900, { deceased: true }],
  // brief: Do-not-solicit, past cadence → excluded
  ["dns", "Norman Nosolicit", yearlyEnding(500), 700, { do_not_contact: true }],
  // brief: Active recurring, past nominal cadence → excluded, lives in the failed-payment path
  ["recurring", "Rita Recurring", quarterlyEnding(182), 100, {}],
  // brief: Current pledge, past cadence → excluded (contractual cadence)
  ["pledge", "Petra Pledge", yearlyEnding(500), 600, {}],
];

const email = key => `${key}@b76.test`;

async function reset() {
  // BUILD-58 fixture rule: orgs with a chart of accounts need fin_* cleared
  // before the org row, or the FK trips.
  const CHILD = ["workflow_runs", "workflows", "digest_sends", "moves", "opportunities", "tasks",
    "payment_recovery_events", "recurring_subscriptions", "receipts", "pledges", "fin_audit_log",
    "fin_transactions", "gifts", "interactions", "notification_sends", "milestone_drafts",
    "note_reminders", "metric_snapshots"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "budgets", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id)
           VALUES ($1,'B76 Drift Org','b76-drift',1,'active','growth',$2)`, [ORG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b76drift',$1,'b76drift@test.local',$2,'Drift Admin','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_b76d4010',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_b76d',$1,'General',false)`, [ORG]);
}

// The same CSV shape the client parses (import-reconciliation idiom): one row
// per gift, donor columns repeated — then shaped by the client's own
// groupTransactions and posted to the REAL route.
function buildCsvRows() {
  const rows = [];
  for (const [key, name, dates, amount, extra] of CASES)
    for (const d of dates)
      rows.push({ "Donor Name": name, "Email": email(key), "Amount": String(amount), "Gift Date": d, ...extra });
  return rows;
}

const getDrift = (tok, qs = "") => api("GET", "/drift" + qs, tok).then(r => r.body);
const donorsByEmail = async tok => {
  const r = await api("GET", "/donors?limit=200", tok);
  const map = {};
  for (const d of r.body.donors) map[(d.email || "").toLowerCase()] = d;
  return map;
};

function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      const cu = req.url.match(/^\/v1\/customers\/([^/?]+)/);
      if (req.method === "GET" && cu) return res.end(JSON.stringify({ id: cu[1], object: "customer", email: null }));
      const ch = req.url.match(/^\/v1\/charges\/([^/?]+)/);
      if (req.method === "GET" && ch) return res.end(JSON.stringify({ id: ch[1], object: "charge" }));
      res.end(JSON.stringify({ ok: true }));
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}

async function fire(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));

(async () => {
  await reset();
  const tok = await login("b76drift@test.local");
  const { groupTransactions } = await import("../client/src/lib/importShape.js");
  const stripeMock = await startStripeMock();

  // ── §1 · the fixture, through the REAL import path ───────────────────────
  console.log("\n— §1 · the fixture through the real import path —");
  const rows = buildCsvRows();
  const dollarsIn = rows.reduce((s, r) => s + Number(r.Amount), 0);
  const items = rows.map(r => ({
    key: r["Email"].toLowerCase(),
    donor: {
      name: r["Donor Name"], email: r["Email"], stage: "steward",
      deceased: r.deceased === true, doNotContact: r.do_not_contact === true,
    },
    gift: { amount: Math.round(Number(r["Amount"])), date: r["Gift Date"], type: "cash", campaign: "", notes: "" },
  }));
  const { donors, gifts } = groupTransactions(items);
  const imp = await api("POST", "/donors/import-combined", tok, { donors, gifts });
  ok("import 200", imp.status === 200, imp.body);
  const rec = imp.body.reconciliation;
  ok("BUILD-72 invariant still balances on this file (rows)", rec && rec.rows.inFile === rec.rows.created + rec.rows.skipped + rec.rows.errored, rec && rec.rows);
  ok("…and on dollars", rec && Math.abs(rec.dollars.inFile - (rec.dollars.created + rec.dollars.skipped + rec.dollars.errored)) < 0.005, rec && rec.dollars);
  ok(`every row landed (${rows.length} gifts / $${dollarsIn})`, rec && rec.rows.created === rows.length && rec.dollars.created === dollarsIn, rec);

  // The two flags must survive the import (BUILD-58 mapping) — the exclusion
  // family in §3 is only real if the real import path set them.
  const deceasedRow = await q(`SELECT deceased FROM donors WHERE org_id=$1 AND email=$2`, [ORG, email("deceased")]);
  const dnsRow = await q(`SELECT do_not_contact FROM donors WHERE org_id=$1 AND email=$2`, [ORG, email("dns")]);
  ok("deceased flag survived the import", deceasedRow[0]?.deceased === true, deceasedRow);
  ok("do-not-contact flag survived the import", dnsRow[0]?.do_not_contact === true, dnsRow);

  // The recurring + pledge exclusions ride their own REAL entry points:
  // an active subscription row (the webhook-owned table) and the pledge API.
  const donorIdOf = async key => (await q(`SELECT id FROM donors WHERE org_id=$1 AND email=$2`, [ORG, email(key)]))[0]?.id;
  const recurringDonor = await donorIdOf("recurring");
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,failure_count)
           VALUES ('rs_b76d',$1,$2,'sub_b76drift',25,'month','past_due',2)`, [ORG, recurringDonor]);
  const pledgeDonor = await donorIdOf("pledge");
  const pl = await api("POST", `/donors/${pledgeDonor}/pledges`, tok, { amount: 1200, dueDate: daysAgo(-60) });
  ok("pledge created via the API", pl.status === 201 || pl.status === 200, pl.body);

  // ── §2 · every named case, by name ───────────────────────────────────────
  console.log("\n— §2 · the named cases —");
  const full = await getDrift(tok, "?all=1&includeMedium=1");
  const byId = {};
  for (const r of full.list) byId[r.donorId] = r;
  const stateOf = async key => {
    const id = await donorIdOf(key);
    return byId[id] || null;
  };

  const sSarah = await stateOf("seasonal");
  ok("SEASONAL: drifting, high confidence", sSarah && sSarah.confidence === "high", sSarah);
  ok("SEASONAL: the reasoning is seasonal (month-aware, not interval math)", sSarah && sSarah.seasonal === true && sSarah.basis === "seasonal", sSarah);
  ok("SEASONAL: the reason is her own pattern ($2,000 every <Month> since <year>)",
    sSarah && /^\$2,000 every [A-Z][a-z]+ since \d{4}\./.test(sSarah.reason), sSarah && sSarah.reason);

  ok("SEASONAL-IN-WINDOW: not drifting (month-aware — her month hasn't closed)", (await stateOf("seasonal-current")) === null);

  const declan = await stateOf("declining");
  ok("DECLINING: drifting, high confidence", declan && declan.confidence === "high", declan);

  ok("QUARTERLY ONE-LATE: not drifting — inside threshold", (await stateOf("quarterly-late")) === null);

  const paula = await stateOf("quarterly-past");
  ok("QUARTERLY CLEARLY-PAST: drifting", !!paula, paula);

  ok("FIVE-YEARS-SILENT: not drifting (lapsed is a different state)", (await stateOf("silent")) === null);
  ok("FIVE-YEARS-SILENT: counted as lapsed", full.counts.lapsed >= 1, full.counts);

  ok("SINGLE-GIFT: not eligible — no cadence exists", (await stateOf("single")) === null);

  const wanda = await stateOf("two-wide");
  ok("TWO-GIFTS-WIDE: medium confidence", wanda && wanda.confidence === "medium", wanda);
  const defaultList = await getDrift(tok, "?all=1");
  ok("TWO-GIFTS-WIDE: NOT surfaced by default (medium is behind the toggle)",
    !defaultList.list.some(r => r.donorId === wanda?.donorId), defaultList.list.map(r => r.donorName));
  ok("…and every default-list row is labelled high — medium is never presented as high",
    defaultList.list.every(r => r.confidence === "high"), defaultList.list.map(r => [r.donorName, r.confidence]));

  // Erratic: whatever the state, confidence must NOT be high (assert through
  // the engine directly too, so the claim isn't hostage to today's state).
  const erratic = await stateOf("erratic");
  ok("ERRATIC: medium at most (list)", !erratic || erratic.confidence !== "high", erratic);
  const eAssess = driftEngine.assessDrift(
    [{ date: daysAgo(1917), amount: 100 }, { date: daysAgo(974), amount: 100 }, { date: daysAgo(400), amount: 100 }], TODAY);
  ok("ERRATIC: medium at most (engine) — high confidence here is a bug", eAssess.confidence !== "high", eAssess);

  // ── §3 · the exclusion FAMILY ────────────────────────────────────────────
  console.log("\n— §3 · exclusions: what a real file is full of —");
  for (const [key, label] of [
    ["deceased", "deceased + past cadence"],
    ["deceased-seasonal", "deceased + SEASONAL + past cadence"],
    ["dns", "do-not-solicit + past cadence"],
    ["recurring", "active recurring + past nominal cadence"],
    ["pledge", "open pledge + past cadence"],
  ]) {
    ok(`EXCLUDED: ${label} never appears as drifting`, (await stateOf(key)) === null);
  }
  const failedSub = await q(`SELECT status FROM recurring_subscriptions WHERE org_id=$1 AND donor_id=$2`, [ORG, recurringDonor]);
  ok("…the recurring donor lives in the failed-payment path instead", failedSub[0]?.status === "past_due", failedSub);

  // ── §4 · one computation: the badge and the list agree, and move together ─
  console.log("\n— §4 · badge == list, one computation —");
  const dmap = await donorsByEmail(tok);
  const listIds = new Set(full.list.map(r => r.donorId));
  for (const [key] of CASES) {
    const d = dmap[email(key)];
    const badged = !!(d && d.drift);
    ok(`badge agrees with list for ${key} (${badged ? "badged" : "no badge"})`,
      badged === listIds.has(d?.id), { key, badged, inList: listIds.has(d?.id) });
  }
  // The badge carries the same reason text the list shows.
  ok("badge carries the same reason sentence as the list",
    dmap[email("seasonal")].drift.reason === sSarah.reason,
    { badge: dmap[email("seasonal")].drift.reason, list: sSarah.reason });
  // Donor record header reads the same computation.
  const profile = await api("GET", `/donors/${sSarah.donorId}`, tok);
  ok("the donor record carries the same drift object", profile.body.drift && profile.body.drift.reason === sSarah.reason, profile.body.drift);

  // A child server with a prohibitive threshold: NOTHING drifts — the list
  // empties AND every badge clears, from one env change. This is the "change
  // the threshold and both move together" proof.
  const child = spawn("node", ["server.js"], {
    cwd: __dirname + "/..",
    env: {
      ...process.env, PORT: "5631",
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest",
      DB_SSL: "disable", DISABLE_BACKGROUND_TICKS: "1",
      JWT_SECRET: "local-test-secret", TEST_MODE: "1", SESSION_CACHE_TTL_MS: "0",
      RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: "http://localhost:5602",
      STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_API_BASE: `http://localhost:${STRIPE_MOCK_PORT}`,
      // Nobody is 50× past cadence (interval math) or 99,999 days past their
      // seasonal window — one env change, every drift surface must move.
      DRIFT_DRIFT_THRESHOLD: "50", DRIFT_SEASONAL_GRACE_DAYS: "99999",
    },
    stdio: "ignore",
  });
  let childUp = false;
  for (let i = 0; i < 60; i++) {
    await settle(500);
    try { const h = await fetch("http://localhost:5631/health"); if (h.ok) { childUp = true; break; } } catch { }
  }
  ok("threshold-override child server boots", childUp);
  if (childUp) {
    const clogin = await fetch("http://localhost:5631/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "b76drift@test.local", password: "loadtest1234" }),
    }).then(r => r.json());
    const cHeaders = { Authorization: "Bearer " + clogin.token };
    const cDrift = await fetch("http://localhost:5631/drift?all=1&includeMedium=1", { headers: cHeaders }).then(r => r.json());
    const cDonors = await fetch("http://localhost:5631/donors?limit=200", { headers: cHeaders }).then(r => r.json());
    const cBadges = cDonors.donors.filter(d => d.drift);
    ok("threshold 50×: the LIST is empty", cDrift.list.length === 0 && cDrift.counts.driftingHigh === 0, cDrift.counts);
    ok("threshold 50×: every BADGE cleared with it — one computation, one truth", cBadges.length === 0, cBadges.map(d => d.name));
  }
  child.kill();

  // ── §5 · manual entry clears drift; double-tap Save clears ONCE ─────────
  console.log("\n— §5 · manual entry —");
  const paulaId = paula.donorId;
  const headBefore = (await getDrift(tok)).atRiskAmount;
  const idem = "b76-manual-" + Date.now();
  const g1 = await api("POST", `/donors/${paulaId}/gifts`, tok, { amount: 500, date: TODAY, idempotencyKey: idem });
  const g2 = await api("POST", `/donors/${paulaId}/gifts`, tok, { amount: 500, date: TODAY, idempotencyKey: idem });
  ok("manual gift lands (and the double-tap is deduped)", (g1.status === 201 || g1.status === 200) && [200, 201, 409].includes(g2.status), { g1: g1.status, g2: g2.status });
  const paulaGifts = await q(`SELECT COUNT(*)::int n FROM gifts WHERE donor_id=$1 AND date=$2`, [paulaId, TODAY]);
  ok("exactly ONE gift row from two Saves", paulaGifts[0].n === 1, paulaGifts);
  const afterManual = await getDrift(tok, "?all=1&includeMedium=1");
  ok("she LEFT the drift list the moment the gift landed (computed on read)",
    !afterManual.list.some(r => r.donorId === paulaId), afterManual.list.map(r => r.donorName));
  const dmap2 = await donorsByEmail(tok);
  ok("her badge cleared in the same moment", dmap2[email("quarterly-past")].drift === null);
  const headAfter = (await getDrift(tok)).atRiskAmount;
  ok("the at-risk headline decreased by her value at risk",
    Math.abs(headAfter - (headBefore - paula.valueAtRisk)) < 0.01,
    { before: headBefore, after: headAfter, hers: paula.valueAtRisk });

  // ── §6 · webhook gift clears; full refund brings it BACK ────────────────
  console.log("\n— §6 · webhook in, refund back out —");
  const declanId = declan.donorId;
  const piId = "pi_b76drift_" + Date.now();
  await fire({
    id: "evt_b76_" + Date.now(), type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: piId, amount_received: 25000, receipt_email: email("declining"), metadata: { donor_name: "Declan Decline" }, latest_charge: "ch_b76drift" } },
  });
  await settle();
  const wGift = await q(`SELECT id, donor_id FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [ORG, piId]);
  ok("webhook gift landed on the drifting donor (email resolve)", wGift.length === 1 && wGift[0].donor_id === declanId, wGift);
  const afterHook = await getDrift(tok, "?all=1&includeMedium=1");
  ok("the webhook gift cleared his drift", !afterHook.list.some(r => r.donorId === declanId), afterHook.list.map(r => r.donorName));
  // Full refund → the gift reverses → drift recomputes: he is BACK, not stale.
  await fire({
    id: "evt_b76r_" + Date.now(), type: "charge.refunded", account: ACCT,
    data: { object: { id: "ch_b76drift", payment_intent: piId, amount: 25000, amount_refunded: 25000 } },
  });
  await settle();
  const afterRefund = await getDrift(tok, "?all=1&includeMedium=1");
  ok("a FULL REFUND recomputes drift — he is back on the list, no stale flag",
    afterRefund.list.some(r => r.donorId === declanId), afterRefund.list.map(r => r.donorName));

  // ── §7 · Part 4: the logging loop ────────────────────────────────────────
  console.log("\n— §7 · logging as a byproduct —");
  const sarahId = sSarah.donorId;
  const done1 = await api("POST", `/drift/${sarahId}/done`, tok, { note: "Spoke with Sarah — she wants the spring impact report before deciding." });
  ok("done-with-a-line: 201 + not skipped", done1.status === 201 && done1.body.skipped === false, done1);
  const intRow = await q(`SELECT type, note, created_by, logged_by_name, metadata FROM interactions
                          WHERE org_id=$1 AND donor_id=$2 AND metadata->>'via'='drift_done'`, [ORG, sarahId]);
  ok("ONE interaction row, right type, the line as the note", intRow.length === 1 && intRow[0].type === "call" && /spring impact report/.test(intRow[0].note), intRow);
  ok("the actor is stamped automatically (BUILD-75 C.1)", intRow[0].created_by === "u_b76drift" && intRow[0].logged_by_name === "Drift Admin", intRow[0]);
  const done1b = await api("POST", `/drift/${sarahId}/done`, tok, { note: "dupe tap" });
  ok("double-tap Done is deduped — still one row", done1b.body.deduped === true &&
    (await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND donor_id=$2 AND metadata->>'via'='drift_done'`, [ORG, sarahId]))[0].n === 1);
  const afterDone = await getDrift(tok);
  ok("the list stops resurfacing someone already handled", !afterDone.list.some(r => r.donorId === sarahId), afterDone.list.map(r => r.donorName));
  ok("…but she is still counted handled/drifting (money still at risk, badge stays)",
    afterDone.counts.handled >= 1 && (await donorsByEmail(tok))[email("seasonal")].drift !== null, afterDone.counts);

  // Skip: recorded as skipped, never as nothing.
  const wandaId = wanda.donorId;
  const skip = await api("POST", `/drift/${wandaId}/done`, tok, {});
  ok("skip: 201 + skipped recorded", skip.status === 201 && skip.body.skipped === true, skip);
  const skipRow = await q(`SELECT metadata->>'skipped' AS s FROM interactions WHERE org_id=$1 AND donor_id=$2 AND metadata->>'via'='drift_done'`, [ORG, wandaId]);
  ok("the skip is a ROW with skipped=true", skipRow[0]?.s === "true", skipRow);

  // Foreign/unknown donor: 404, indistinguishably (tenant-matrix will also probe this).
  const foreign = await api("POST", "/drift/d_not_ours/done", tok, { note: "x" });
  ok("done on a foreign/unknown donor id → 404", foreign.status === 404, foreign.status);

  // log_capture_rate: 2 completions, 1 with a line → 50, snapshotted.
  await api("POST", "/metrics/reset-baselines", tok);
  const snap = await q(`SELECT value FROM metric_snapshots WHERE org_id=$1 AND metric_key='log_capture_rate'`, [ORG]);
  ok("log_capture_rate snapshots honestly (1 line / 2 completions = 50)", Number(snap[0]?.value) === 50, snap);

  // ── §8 · the cap ─────────────────────────────────────────────────────────
  console.log("\n— §8 · the cap: a short list, not a report —");
  const capDonors = [], capGifts = [];
  for (let i = 0; i < 14; i++) {
    capDonors.push({ name: `Cap Filler ${i}`, email: `capfill${i}@b76.test`, stage: "steward" });
    for (const d of yearlyEnding(500, 3)) capGifts.push({ donorIndex: i, amount: 10000 + i, date: d, type: "cash" });
  }
  const impCap = await api("POST", "/donors/import-combined", tok, { donors: capDonors, gifts: capGifts });
  ok("cap-fill import lands", impCap.status === 200, impCap.body && impCap.body.reconciliation);
  const capped = await getDrift(tok);
  const uncapped = await getDrift(tok, "?all=1");
  ok(`the home list caps at ${driftEngine.DRIFT.HOME_LIST_CAP}`, capped.list.length === driftEngine.DRIFT.HOME_LIST_CAP, capped.list.length);
  ok("…ranked by value at risk, descending", capped.list.every((r, i) => i === 0 || capped.list[i - 1].valueAtRisk >= r.valueAtRisk));
  ok("see-all lifts the cap", uncapped.list.length > driftEngine.DRIFT.HOME_LIST_CAP, uncapped.list.length);
  ok("the payload says what it clipped (total vs cap)", capped.total === uncapped.list.length, { total: capped.total, shown: capped.list.length });

  // ── §9 · reasons are sentences, not system output ────────────────────────
  console.log("\n— §9 · the reason reads out loud —");
  const everyReason = uncapped.list.map(r => r.reason);
  ok("every reason is a complete sentence (capital start, closing period)",
    everyReason.every(r => /^[A-Z$]/.test(r) && /\.$/.test(r)), everyReason.slice(0, 5));
  ok("no system language — no ratios, no raw day counts, no snake_case",
    everyReason.every(r => !/ratio|overdue|[0-9]{3,} ?days|_/i.test(r)), everyReason.filter(r => /ratio|overdue|[0-9]{3,} ?days|_/i.test(r)));

  // ── §10 · the zero that shows its work (BUILD-76 follow-up) ──────────────
  // GET /drift carries evaluation transparency: how many donors were looked
  // at, how many are on their own pattern, and exactly why the rest can
  // never drift. Without these an empty list is indistinguishable from a
  // silently failed import.
  console.log("\n— §10 · evaluation transparency —");
  const trans = await getDrift(tok, "?includeMedium=1");
  const [donorCount] = await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
  ok("evaluated == every non-deleted donor", trans.evaluated === donorCount.n, { evaluated: trans.evaluated, donors: donorCount.n });
  ok("the exclusion tally names each family: 2 deceased, 1 do-not-contact, 1 active recurring, 1 pledge cadence",
    trans.excluded.deceased === 2 && trans.excluded.doNotContact === 1
    && trans.excluded.activeRecurring === 1 && trans.excluded.pledgeCadence === 1, trans.excluded);
  ok("single-gift donors are counted (no pattern yet)", trans.excluded.singleGift >= 1, trans.excluded.singleGift);
  const exSum = Object.values(trans.excluded).reduce((a, b) => a + b, 0);
  ok("the arithmetic closes: evaluated = onPattern + drifting + lapsed + excluded",
    trans.evaluated === trans.onPattern + trans.counts.driftingHigh + trans.counts.driftingMedium + trans.counts.lapsed + exSum,
    { evaluated: trans.evaluated, onPattern: trans.onPattern, counts: trans.counts, exSum });

  stripeMock && stripeMock.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
