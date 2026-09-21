// BUILD-89S 89b — PAYPAL. Run: node tests/build89s-paypal.test.js
//
// One adapter file, one test, and the test is the thing that says Steward is
// only ever READING somebody's PayPal account.
//
//   §1  THE SHAPE. A real transaction_details entry becomes a contract row:
//       the gross, the fee as a positive number beside it, the payer, the day.
//   §2  WHAT IS NOT A GIFT. A bank transfer, an auto-sweep and a fee line are
//       dropped ON THE SIGN, with the reason named — not on a list of event
//       codes somebody has to keep up to date.
//   §3  THE RECURRING SIGNAL. PayPal's own subscription id when it gives one,
//       and NO invented one when it does not.
//   §4  THE WALK. Three 31-day windows backwards, paged, stopping cleanly on
//       an empty run and on a refused range.
//   §5  EVERY REQUEST IS A GET AFTER THE TOKEN. The whole conversation is
//       audited; a second POST anywhere would fail this.
//   §6  THE CONNECT SCREEN. Test reads seven days and writes nothing.
//
// Fixture responses are shaped from PayPal's published reference (checked
// 2026-09-20; the codes and statuses are recorded in sources/paypal.js). No
// network: the read-only handle is given an injected fetch and every request
// it makes is recorded and asserted.

const { ok, summary } = require("./helpers");
const reg = require("../sources");
const pp = require("../sources/paypal.js");

const CREDS = { clientId: "AQ_test_client", clientSecret: "EL_test_secret", sandbox: true };
const TOKEN_PATH = "/v1/oauth2/token";

// ── THE RECORDED SHAPES ────────────────────────────────────────────────────
// One ordinary gift, one subscription payment carrying PayPal's own
// subscription id, one subscription payment with NO usable reference, one
// reversed (refunded) transaction, one withdrawal to the bank, one auto-sweep,
// one fee line, one pending payment.
const TX = {
  gift: {
    transaction_info: {
      transaction_id: "8XN12345AB678901C", transaction_event_code: "T0006",
      transaction_initiation_date: "2026-08-14T15:02:31+0000",
      transaction_amount: { currency_code: "USD", value: "250.00" },
      fee_amount: { currency_code: "USD", value: "-7.55" },
      transaction_status: "S", transaction_note: "Building fund",
    },
    payer_info: { email_address: "Marta.Quill@example.org", payer_name: { given_name: "Marta", surname: "Quill" } },
  },
  subscriber: {
    transaction_info: {
      transaction_id: "SUBPAY0001", transaction_event_code: "T0002",
      transaction_initiation_date: "2026-08-03T09:00:00+0000",
      transaction_amount: { currency_code: "USD", value: "40.00" },
      fee_amount: { currency_code: "USD", value: "-1.46" },
      transaction_status: "S",
      paypal_reference_id: "I-BW452GLLEP1G", paypal_reference_id_type: "SUB",
    },
    payer_info: { email_address: "dana@example.org", payer_name: { alternate_full_name: "Dana Reyes" } },
  },
  subscriberNoRef: {
    transaction_info: {
      transaction_id: "SUBPAY0002", transaction_event_code: "T0002",
      transaction_initiation_date: "2026-08-05T09:00:00+0000",
      transaction_amount: { currency_code: "USD", value: "15.00" },
      fee_amount: { currency_code: "USD", value: "-0.74" },
      transaction_status: "S",
    },
    payer_info: { email_address: "quiet@example.org", payer_name: { given_name: "Quiet", surname: "Sustainer" } },
  },
  reversed: {
    transaction_info: {
      transaction_id: "REVERSED001", transaction_event_code: "T0006",
      transaction_initiation_date: "2026-08-09T12:00:00+0000",
      transaction_amount: { currency_code: "USD", value: "100.00" },
      fee_amount: { currency_code: "USD", value: "-3.20" },
      transaction_status: "V",
    },
    payer_info: { email_address: "returned@example.org", payer_name: { given_name: "Ret", surname: "Urned" } },
  },
  bankTransfer: {
    transaction_info: {
      transaction_id: "WITHDRAW001", transaction_event_code: "T0400",
      transaction_initiation_date: "2026-08-15T02:00:00+0000",
      transaction_amount: { currency_code: "USD", value: "-4500.00" },
      transaction_status: "S",
    },
    payer_info: {},
  },
  autoSweep: {
    transaction_info: {
      transaction_id: "SWEEP0001", transaction_event_code: "T0401",
      transaction_initiation_date: "2026-08-16T02:00:00+0000",
      transaction_amount: { currency_code: "USD", value: "-1200.00" },
      transaction_status: "S",
    },
    payer_info: {},
  },
  feeLine: {
    transaction_info: {
      transaction_id: "FEELINE001", transaction_event_code: "T1107",
      transaction_initiation_date: "2026-08-17T02:00:00+0000",
      transaction_amount: { currency_code: "USD", value: "-3.20" },
      transaction_status: "S",
    },
    payer_info: {},
  },
  pending: {
    transaction_info: {
      transaction_id: "PENDING001", transaction_event_code: "T0006",
      transaction_initiation_date: "2026-08-18T02:00:00+0000",
      transaction_amount: { currency_code: "USD", value: "75.00" },
      transaction_status: "P",
    },
    payer_info: { email_address: "later@example.org", payer_name: { given_name: "Not", surname: "Yet" } },
  },
};

// A fake PayPal that answers from a window->pages table, records every request,
// and refuses a range older than `earliest` exactly as the real one does.
function fakePayPal({ windows = {}, earliest = "2026-01-01", failToken = false } = {}) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ method: (init.method || "GET").toUpperCase(), url: String(url) });
    if (String(url).includes(TOKEN_PATH)) {
      if (failToken) {
        return new Response(JSON.stringify({ error: "invalid_client", error_description: "Client Authentication failed" }),
          { status: 401 });
      }
      return new Response(JSON.stringify({ access_token: "A21AA_test_token", expires_in: 32400 }), { status: 200 });
    }
    const u = new URL(String(url));
    const start = u.searchParams.get("start_date").slice(0, 10);
    const page = Number(u.searchParams.get("page"));
    if (start < earliest) {
      return new Response(JSON.stringify({
        name: "INVALID_REQUEST",
        message: "The start date must be less than 3 years old. Please correct the date range.",
      }), { status: 400 });
    }
    const pages = windows[start] || [[]];
    // REVIEWED CONTRACT CHANGE (BUILD-93 Part 3). `page` is ONE-INDEXED:
    // PayPal documents a minimum of 1 and a default of 1, and the adapter's
    // header comment claiming "pages 0-indexed" is what sent page=0 and earned
    // a 400 INVALID_REQUEST on every production sync. This table stays
    // zero-based (it is a JS array); the REQUEST is what moved, so the index
    // is translated here rather than the fixture being renumbered.
    const details = pages[page - 1] || [];
    return new Response(JSON.stringify({
      transaction_details: details,
      page: page, total_items: details.length, total_pages: pages.length,
    }), { status: 200 });
  };
  return { fetchImpl, seen };
}

const http = f => reg.readOnlyHttp("paypal", { fetchImpl: f });

(async () => {
  // ══ §1 · THE SHAPE ═══════════════════════════════════════════════════════
  console.log("\n— §1 · a PayPal transaction becomes a contract row —");
  const g = pp.mapTransaction(TX.gift);
  ok("the gross is the amount, in cents", g.row?.amountCents === 25000, g.row);
  ok("PayPal reports a fee as NEGATIVE; it is stored positive beside the gift",
    g.row.feeCents === 755, g.row.feeCents);
  ok("the date is the civil day the transaction was initiated",
    g.row.occurredAt === "2026-08-14", g.row.occurredAt);
  ok("the payer's name is assembled from given name and surname",
    g.row.donorName === "Marta Quill", g.row.donorName);
  ok("an alternate full name is preferred when PayPal gives one",
    pp.mapTransaction(TX.subscriber).row.donorName === "Dana Reyes");
  ok("the transaction id is the dedupe key", g.row.externalId === "8XN12345AB678901C");
  ok("status S is completed", g.row.status === "completed");
  ok("status V is refunded, not a gift that quietly stands",
    pp.mapTransaction(TX.reversed).row.status === "refunded");

  // The contract module has to accept what this adapter produces, or the two
  // halves agree only in this file.
  const lib = await import("../shared/givingSources.js");
  const norm = lib.normalizeRow(g.row, { provider: "paypal" });
  ok("and the 89a contract accepts it", norm.ok && norm.row.amountCents === 25000, norm);

  // ══ §2 · WHAT IS NOT A GIFT ══════════════════════════════════════════════
  console.log("\n— §2 · a withdrawal is not a gift, and the sign is the rule —");
  ok("a bank withdrawal is dropped, and named as one",
    pp.mapTransaction(TX.bankTransfer).drop === "bank_transfer");
  ok("an auto-sweep is dropped the same way",
    pp.mapTransaction(TX.autoSweep).drop === "bank_transfer");
  ok("a refund posted as its own negative line is dropped as a refund line",
    pp.mapTransaction(TX.feeLine).drop === "refund_line");
  ok("a pending payment is not written, and is not an error either",
    pp.mapTransaction(TX.pending).drop === "pending");
  // THE PROPERTY, not the list: an event code nobody here has heard of still
  // goes the right way, because the decision is made on the sign.
  const unknownNegative = JSON.parse(JSON.stringify(TX.bankTransfer));
  unknownNegative.transaction_info.transaction_event_code = "T9999";
  ok("an event code Steward has never seen, carrying negative money, is still dropped",
    pp.mapTransaction(unknownNegative).drop === "not_money_in",
    pp.mapTransaction(unknownNegative));
  const unknownPositive = JSON.parse(JSON.stringify(TX.gift));
  unknownPositive.transaction_info.transaction_event_code = "T9999";
  unknownPositive.transaction_info.transaction_id = "UNKNOWNCODE1";
  ok("...and one carrying money IN is still a gift", !!pp.mapTransaction(unknownPositive).row);

  // ══ §3 · THE RECURRING SIGNAL ════════════════════════════════════════════
  console.log("\n— §3 · PayPal's own word, and no invented substitute —");
  ok("a subscription payment carries PayPal's subscription id",
    pp.mapTransaction(TX.subscriber).row.recurringRef === "I-BW452GLLEP1G");
  ok("a subscription payment with no usable reference gets NO invented id",
    pp.mapTransaction(TX.subscriberNoRef).row.recurringRef === null,
    pp.mapTransaction(TX.subscriberNoRef).row.recurringRef);
  ok("an ordinary one-off gift carries no recurring reference",
    pp.mapTransaction(TX.gift).row.recurringRef === null);

  // ══ §4 · THE WALK ════════════════════════════════════════════════════════
  console.log("\n— §4 · three windows backwards, paged, stopping cleanly —");
  // Aug window: two pages. Jul window: one gift. Jun window: empty. May: empty.
  // Apr: empty -> three empties in a row ends the walk.
  const pp4 = fakePayPal({
    earliest: "2026-01-01",
    windows: {
      "2026-07-21": [
        [TX.gift, TX.subscriber, TX.bankTransfer],
        [TX.subscriberNoRef, TX.pending, TX.autoSweep],
      ],
      "2026-06-20": [[TX.reversed]],
      "2026-05-20": [[]],
      "2026-04-19": [[]],
      "2026-03-19": [[]],
    },
  });
  const h4 = http(pp4.fetchImpl);
  let cursor = null, done = false, guard = 0;
  const all = [], notices = [];
  while (!done && guard++ < 20) {
    const out = await pp.fetchRows({
      credentials: CREDS, since: null, until: "2026-08-20", cursor, http: h4,
      today: "2026-08-20", backfill: true,
    });
    all.push(...out.rows); notices.push(...out.notices);
    cursor = out.cursor; done = out.done;
  }
  ok("the walk ends by itself", done && guard < 20, { guard, done });
  ok("four gifts came back across three windows and two pages",
    all.length === 4, all.map(r => r.externalId));
  ok("the second page of a window is read (it is not lost at the page boundary)",
    all.some(r => r.externalId === "SUBPAY0002"), all.map(r => r.externalId));
  ok("the withdrawal, the sweep and the pending row never became gifts",
    !all.some(r => ["WITHDRAW001", "SWEEP0001", "PENDING001"].includes(r.externalId)));
  ok("the reversed transaction came back as refunded, for 89a to count and name",
    all.find(r => r.externalId === "REVERSED001")?.status === "refunded");
  ok("the drops are REPORTED, not silent",
    notices.some(n => /bank transfer/.test(n)) && notices.some(n => /pending/.test(n)), notices);
  ok("three empty windows stop the walk rather than three years of requests",
    guard <= 8, guard);

  // A refused range is the OTHER clean stop.
  const pp4b = fakePayPal({ earliest: "2026-08-01", windows: { "2026-07-21": [[TX.gift]] } });
  const h4b = http(pp4b.fetchImpl);
  let c2 = null, d2 = false, g2 = 0, n2 = [];
  while (!d2 && g2++ < 20) {
    const out = await pp.fetchRows({
      credentials: CREDS, until: "2026-08-20", cursor: c2, http: h4b, today: "2026-08-20", backfill: true,
    });
    c2 = out.cursor; d2 = out.done; n2.push(...out.notices);
  }
  ok("a refused range ends the backfill cleanly and says where history starts",
    d2 && g2 < 20 && n2.some(n => /would not return transactions before/.test(n)), { g2, n2 });

  // An incremental read is ONE window, clamped to PayPal's 31 days.
  const pp4c = fakePayPal({ windows: { "2026-08-14": [[TX.gift]] } });
  const h4c = http(pp4c.fetchImpl);
  const inc = await pp.fetchRows({
    credentials: CREDS, since: "2026-08-14", until: "2026-08-20", cursor: null,
    http: h4c, today: "2026-08-20", backfill: false,
  });
  ok("an incremental sync reads its window and stops", inc.done && inc.rows.length === 1, inc.rows.length);
  const wide = await pp.fetchRows({
    credentials: CREDS, since: "2025-01-01", until: "2026-08-20", cursor: null,
    http: http(fakePayPal({ windows: {} }).fetchImpl), today: "2026-08-20", backfill: false,
  });
  ok("a window wider than PayPal's 31-day maximum is clamped, not refused", wide.done === true);

  // ══ §5 · READ ONLY, AND THE WHOLE CONVERSATION IS THE EVIDENCE ═══════════
  console.log("\n— §5 · one POST to mint a token; everything else is a GET —");
  const posts = pp4.seen.filter(r => r.method !== "GET");
  ok("every request that was not a GET was a token request",
    posts.length > 0 && posts.every(r => r.method === "POST" && r.url.includes(TOKEN_PATH)),
    posts.map(r => `${r.method} ${r.url.split("?")[0]}`));
  ok("and every other request was a GET",
    pp4.seen.filter(r => !r.url.includes(TOKEN_PATH)).every(r => r.method === "GET"));
  ok("nothing was sent to a payouts, refund or order endpoint",
    !pp4.seen.some(r => /payout|refund|\/v2\/checkout|billing\/subscriptions\/.*\/(cancel|suspend)/i.test(r.url)),
    pp4.seen.map(r => r.url));
  // The handle itself is the guarantee, not this adapter's good behaviour.
  let refused = "allowed";
  try { await h4("https://api-m.sandbox.paypal.com/v1/payments/payouts", { method: "POST" }); }
  catch (e) { refused = e.code; }
  ok("and the handle would refuse a payout even if an adapter asked for one",
    refused === "PROVIDER_WRITE_REFUSED", refused);

  // ══ §6 · THE CONNECT SCREEN ══════════════════════════════════════════════
  console.log("\n— §6 · Test reads seven days and writes nothing —");
  const pp6 = fakePayPal({ windows: { "2026-08-13": [[TX.gift, TX.subscriber, TX.bankTransfer]] } });
  const h6 = http(pp6.fetchImpl);
  const t = await pp.testCredentials({ credentials: CREDS, http: h6, today: "2026-08-20" });
  ok("it reports the count and the total of what actually came in",
    t.ok && t.count === 2 && t.totalCents === 29000, t);
  ok("it asked for exactly seven days",
    pp6.seen.some(r => r.url.includes("start_date=2026-08-13")), pp6.seen.map(r => r.url));
  ok("a quiet week is reported as a quiet week, not as a broken connection",
    (await pp.testCredentials({ credentials: CREDS, http: http(fakePayPal({}).fetchImpl), today: "2026-08-20" }))
      .message?.includes("not a problem with the connection"));

  // A refused credential is a refusal, never an empty week.
  let credErr = null;
  try {
    await pp.testCredentials({ credentials: CREDS, http: http(fakePayPal({ failToken: true }).fetchImpl), today: "2026-08-20" });
  } catch (e) { credErr = e; }
  ok("bad credentials THROW rather than reporting zero gifts",
    !!credErr && /refused the credentials/.test(credErr.message), credErr?.message);
  // The newly-enabled-permission case reads like a credential failure, which
  // is exactly why 89a's connect screen carries PayPal's own delay warning
  // rather than telling an administrator their key is wrong.
  const { PROVIDERS } = lib;
  ok("PayPal's provider entry carries the up-to-a-day warning the connect screen shows",
    /up to a day/i.test(PROVIDERS.paypal.delay || ""), PROVIDERS.paypal.delay);

  summary();
})();
