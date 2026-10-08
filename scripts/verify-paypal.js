#!/usr/bin/env node
// INT-PROD-1 · verify-paypal (READ-ONLY, prod-flagged).
//
// Proves the live "Steward" PayPal REST app on Railway can do the two things
// Steward needs of it: get a client-credentials token from the LIVE base, and
// read Transaction Search for the last 30 days. It prints counts and totals
// only: no name, no email, no transaction id, no secret.
//
//   node scripts/verify-paypal.js
//       → says what it would do and contacts nobody.
//   railway run node scripts/verify-paypal.js --i-know-this-is-prod
//       → reads PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET from the environment
//         (names only are ever printed), takes one token, and reads.
//
// The one POST is PayPal's token call (grant_type=client_credentials). Every
// other call is a GET. Nothing is charged, refunded, created or changed.
// Classified PROD_READONLY in tests/script-guards.test.js.

const paypal = require("../sources/paypal");

const PROD = process.argv.includes("--i-know-this-is-prod");
const DAYS = 30;
const NEEDED = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"];

// The adapter's http shape: { status, body }.
const http = {
  async json(url, opts = {}) {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
    let body = null;
    try { body = await r.json(); } catch { /* an empty or non-JSON answer */ }
    return { status: r.status, body };
  },
};

const iso = d => d.toISOString().slice(0, 10);
const money = cents => (cents < 0 ? "-" : "") + "$" + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// PayPal answers a missing Transaction Search permission with 403
// NOT_AUTHORIZED / PERMISSION_DENIED. Said plainly, with the setting.
function permissionSentence() {
  return [
    "PayPal refused Transaction Search: this REST app does not have that permission.",
    "To turn it on: developer.paypal.com > Apps & Credentials > Live > the Steward app >",
    "Features (or 'Other features') > tick 'Transaction search' > Save. PayPal can take",
    "up to a few hours to apply it; run this script again after that.",
  ].join("\n  ");
}

(async () => {
  console.log("verify-paypal: the live PayPal REST app, read only\n");
  if (!PROD) {
    console.log(`  Would take one client-credentials token from ${paypal.apiBase({}, process.env)} using ${NEEDED.join(" and ")},`);
    console.log(`  then read the last ${DAYS} days of /v1/reporting/transactions and print counts and totals.`);
    console.log("  Refusing to contact PayPal without --i-know-this-is-prod. Run it as:");
    console.log("    railway run node scripts/verify-paypal.js --i-know-this-is-prod");
    process.exit(0);
  }

  const missing = NEEDED.filter(n => !process.env[n]);
  if (missing.length) { console.log(`  FAIL  not set in this environment: ${missing.join(", ")}`); process.exit(1); }
  const base = paypal.apiBase({}, process.env);
  console.log(`  base           ${base}${base === "https://api-m.paypal.com" ? " (live)" : "  << NOT the live base: PAYPAL_API_BASE is set"}`);
  console.log(`  credentials    ${NEEDED.join(", ")} (values not printed)`);
  console.log(`  webhook id     PAYPAL_WEBHOOK_ID is ${process.env.PAYPAL_WEBHOOK_ID ? "set" : "NOT set"}`);

  let token;
  try {
    token = await paypal.accessToken({ credentials: { clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET }, http, env: process.env });
    console.log("  token          ok (client credentials accepted)");
  } catch (e) {
    console.log(`  token          FAIL  PayPal refused the client id and secret (${e.providerCode || "HTTP " + (e.status || "?")}).`);
    console.log("  Check that PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are the LIVE pair of the same app, not the sandbox pair.");
    process.exit(1);
  }

  // Transaction Search: 31 days at most per request, 500 rows per page.
  const end = new Date();
  const start = new Date(end.getTime() - DAYS * 86400000);
  let page = 1, pages = 1, rows = [];
  while (page <= pages) {
    const qs = new URLSearchParams({ start_date: `${iso(start)}T00:00:00Z`, end_date: `${iso(end)}T23:59:59Z`,
      fields: "transaction_info", page_size: String(paypal.PAGE_SIZE), page: String(page) });
    const r = await http.json(`${base}/v1/reporting/transactions?${qs}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (r.status === 403 || /NOT_AUTHORIZED|PERMISSION_DENIED/.test(String(r.body && r.body.name))) {
      console.log("  transactions   FAIL");
      console.log("  " + permissionSentence());
      process.exit(2);
    }
    if (r.status !== 200) {
      console.log(`  transactions   FAIL  HTTP ${r.status} ${(r.body && (r.body.name || r.body.error)) || ""}`.trimEnd());
      if (r.body && r.body.message) console.log(`  PayPal said: ${r.body.message}`);
      process.exit(1);
    }
    rows = rows.concat((r.body && r.body.transaction_details) || []);
    pages = Number((r.body && r.body.total_pages) || 1);
    page += 1;
  }

  // Counts and totals only, by currency, money in and money out kept apart.
  const by = new Map();
  for (const t of rows) {
    const a = (t.transaction_info || {}).transaction_amount || {};
    const cur = a.currency_code || "?";
    const cents = Math.round(Number(a.value || 0) * 100);
    const s = by.get(cur) || { inN: 0, inC: 0, outN: 0, outC: 0 };
    if (cents >= 0) { s.inN++; s.inC += cents; } else { s.outN++; s.outC += cents; }
    by.set(cur, s);
  }
  console.log(`  transactions   ok  ${rows.length} in the last ${DAYS} days (${iso(start)} to ${iso(end)})`);
  for (const [cur, s] of by) {
    console.log(`    ${cur}  in: ${s.inN} totalling ${money(s.inC)}  ·  out: ${s.outN} totalling ${money(s.outC)}  ·  net ${money(s.inC + s.outC)}`);
  }
  if (!rows.length) console.log("    (none; PayPal can take up to three hours to list a new transaction)");
  console.log("\n  Done. Read only: one token, then GETs. Nothing was created or changed at PayPal.");
})().catch(e => { console.error(`  FAIL  ${e.message}`); process.exit(1); });
