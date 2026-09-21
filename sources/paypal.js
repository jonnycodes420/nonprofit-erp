// sources/paypal.js — BUILD-89S 89b. READING AN ORGANISATION'S OWN PAYPAL.
//
// Auth is a client id and secret from a REST app in the ORG'S OWN PayPal
// account, with Transaction Search switched on in the app's settings. Steward
// holds a read credential on somebody else's money and does nothing else with
// it: one POST to mint the token, and every request after that is a GET,
// enforced by the read-only handle this adapter is given (sources/index.js).
//
// ── WHAT WAS CONFIRMED AGAINST PAYPAL'S OWN REFERENCE, NOT REMEMBERED ──────
// 89b's brief said to check the event codes rather than trust its memory of
// them. Checked 20 September 2026 against developer.paypal.com:
//
//   transaction_status   S = completed · P = pending · D = denied
//                        V = a successful transaction was REVERSED (refunded)
//   T0002                subscription payment  (the recurring signal)
//   T1107 / T1100        payment refund / general reversal
//   T0400 / T0401 / T0403  withdrawal to the account holder's bank
//   Windows              31 days maximum per request
//   Paging               page_size default 100, MAXIMUM 500, page MINIMUM 1
//                        (re-checked 20 September 2026 against PayPal's own
//                        reference: `page` minimum 1, default 1. The line
//                        here used to say 0-indexed, which is what sent
//                        page=0 and earned a 400 on every single sync.)
//   Latency              "a maximum of three hours for executed transactions
//                        to appear in the list transactions call"
//
// That last line is why every incremental sync RE-READS the last few days and
// lets de-duplication absorb the overlap: a sync that only ever asked for
// "since I last looked" would permanently miss everything PayPal had not
// published yet at the moment it looked.
//
// ── WHAT IS NOT A GIFT ─────────────────────────────────────────────────────
// A withdrawal to the bank, an auto-sweep, a payout, a fee billed as its own
// line and a refund posted as its own transaction all arrive here. Every one
// of them carries a NEGATIVE amount from the account's point of view, so the
// sign is the guarantee and the event-code list is only the explanation: rows
// are dropped on the amount, counted by reason, and normalizeRow refuses a
// non-positive amount a second time downstream. That ordering is deliberate —
// if PayPal adds a T-code tomorrow that nobody here has heard of, the money
// still goes the right way.

const LIVE_BASE = "https://api-m.paypal.com";
const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

// Confirmed codes, used to EXPLAIN a drop and to read the recurring signal —
// never as the inclusion gate. See the note above.
const EVENT = {
  SUBSCRIPTION: "T0002",
  PREAPPROVED: "T0003",
  REFUND: "T1107",
  GENERAL_REVERSAL: "T1100",
};
const WITHDRAWAL_PREFIX = "T04";          // T0400 bank · T0401 auto-sweep · T0403 manual

const PAGE_SIZE = 500;                    // PayPal's documented maximum
const WINDOW_DAYS = 31;                   // PayPal's documented maximum
const FIRST_PAGE = 1;                     // PayPal: page minimum 1, default 1
// Transaction Search reaches about three years back. Walking further is a
// guaranteed refusal, so the walk stops itself rather than collecting errors.
// PayPal: "This call lists transaction for the previous three years." 38
// windows of 31 days is 1,178 days - beyond that limit, so the last windows
// could only ever be refused. 35 windows is 1,085 days, inside it.
const MAX_BACKFILL_WINDOWS = 35;
// Three consecutive empty months is where a backfill stops. A single quiet
// month is a quiet month; three in a row is the beginning of the account.
const BACKFILL_EMPTY_WINDOWS = 3;

const iso = d => d.toISOString().slice(0, 10);
function addDays(dateStr, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

function apiBase(credentials = {}, env = process.env) {
  if (env.PAYPAL_API_BASE) return env.PAYPAL_API_BASE.replace(/\/$/, "");
  return credentials.sandbox ? SANDBOX_BASE : LIVE_BASE;
}

// THE ONE POST. Client-credentials, Basic-authenticated with the org's own
// app id and secret. Everything after this is a GET.
async function accessToken({ credentials, http, env }) {
  const base = apiBase(credentials, env);
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
  const res = await http.json(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  const token = res?.body?.access_token;
  if (!token) {
    const detail = res?.body?.error_description || res?.body?.error || `HTTP ${res?.status}`;
    // BUILD-92 A2 — THE STEP IS THE FACT, NOT THE PROSE. A failure HERE is the
    // token step: PayPal did not accept the Client ID and Secret. It is not a
    // permissions delay, and the sentence a human reads must not say it is.
    // `step` is declared by the adapter so server.js never has to guess it
    // from a message; `providerCode` is PayPal's own `invalid_client`.
    throw Object.assign(new Error(`PayPal refused the credentials: ${detail}`),
      { status: res?.status, step: "auth", providerCode: res?.body?.error || null });
  }
  return token;
}

// One page of one window. `page` is ONE-INDEXED: PayPal documents a minimum
// of 1 and a default of 1, and a page=0 is not an empty first page - it is a
// SCHEMA VIOLATION, answered 400 INVALID_REQUEST with the generic "Request
// is not well-formed, syntactically incorrect, or violates schema". That is
// the error the demo org's PayPal source returned on every sync.
async function listTransactions({ base, token, http, start, end, page }) {
  const qs = new URLSearchParams({
    start_date: `${start}T00:00:00Z`,
    end_date: `${end}T23:59:59Z`,
    fields: "all",
    page_size: String(PAGE_SIZE),
    page: String(page),
  });
  const res = await http.json(`${base}/v1/reporting/transactions?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  return res;
}

// A PayPal transaction_details entry -> the 89a contract row, or a DROP with
// the reason named so the run summary can say what happened to it.
function mapTransaction(t) {
  const info = t?.transaction_info || {};
  const payer = t?.payer_info || {};
  const id = String(info.transaction_id || "").trim();
  if (!id) return { drop: "no_external_id" };

  const code = String(info.transaction_event_code || "");
  const gross = Number(info.transaction_amount?.value);
  if (!Number.isFinite(gross)) return { drop: "bad_amount", id };

  // THE SIGN IS THE RULE. A withdrawal, an auto-sweep, a payout, a fee on its
  // own line and a refund posted as its own transaction are all negative.
  if (gross <= 0) {
    const why = code.startsWith(WITHDRAWAL_PREFIX) ? "bank_transfer"
      : (code === EVENT.REFUND || code === EVENT.GENERAL_REVERSAL) ? "refund_line"
      : "not_money_in";
    return { drop: why, id };
  }

  // Pending is not received money. It is not dropped as an error either: the
  // next sync will read it again and, once it settles, write it once.
  const status = String(info.transaction_status || "").toUpperCase();
  if (status === "P") return { drop: "pending", id };
  const mapped = status === "S" ? "completed"
    : status === "V" ? "refunded"
    : status === "D" ? "failed"
    : null;
  if (!mapped) return { drop: "unknown_status", id };

  // PayPal reports a fee as a NEGATIVE amount (it is a debit). The contract
  // wants what the provider took, as a positive number beside the gross.
  const feeRaw = Number(info.fee_amount?.value);
  const feeCents = Number.isFinite(feeRaw) ? Math.abs(Math.round(feeRaw * 100)) : 0;

  // THE RECURRING SIGNAL, and the honest limit of it. A subscription payment
  // carries event code T0002; the subscription's own id rides
  // paypal_reference_id when the reference TYPE says so. A T0002 with no
  // usable reference is genuinely recurring and genuinely unidentified — it
  // gets NO ref rather than a synthesised one, and 89a's pattern inference
  // picks it up as "looks monthly". A made-up identity would be worse than
  // an inferred one, because nothing downstream could tell it was made up.
  const refType = String(info.paypal_reference_id_type || "").toUpperCase();
  const ref = String(info.paypal_reference_id || "").trim();
  const isSubscriptionCode = code === EVENT.SUBSCRIPTION || code === EVENT.PREAPPROVED;
  const recurringRef = (ref && (refType === "SUB" || isSubscriptionCode)) ? ref : null;

  const name = payer.payer_name || {};
  const donorName = String(
    name.alternate_full_name ||
    [name.given_name, name.surname].filter(Boolean).join(" ") || ""
  ).trim();

  return {
    row: {
      externalId: id,
      occurredAt: String(info.transaction_initiation_date || info.transaction_updated_date || "").slice(0, 10),
      amountCents: Math.round(gross * 100),
      feeCents,
      currency: info.transaction_amount?.currency_code || "USD",
      donorName,
      donorEmail: String(payer.email_address || "").trim(),
      recurringRef,
      status: mapped,
      memo: String(info.transaction_note || info.invoice_id || "").trim(),
    },
  };
}

// A window's worth of rows, one page at a time. Returns the mapped rows, the
// drop tally, and whether more pages of THIS window remain.
async function readPage({ base, token, http, start, end, page, notices }) {
  const res = await listTransactions({ base, token, http, start, end, page });
  if (res.status === 429) throw Object.assign(new Error("PayPal rate limited the request (429)"), { status: 429 });
  if (!res.ok) {
    const name = res?.body?.name || "";
    const msg = res?.body?.message || `HTTP ${res.status}`;
    // PAYPAL NAMES THE OFFENDING FIELD, AND NOBODY WAS READING IT. The top
    // level `message` on an INVALID_REQUEST is always the same sentence about
    // schema; `details[]` is where PayPal says WHICH field and WHY. Reading
    // only the message is how a page=0 looked for weeks like a mystery 400.
    const details = Array.isArray(res?.body?.details) ? res.body.details : [];
    const fieldNotes = details
      .map(d => [d.field, d.issue, d.description].filter(Boolean).join(" "))
      .filter(Boolean);
    const debugId = res?.body?.debug_id || null;
    if (fieldNotes.length || debugId) {
      console.error(`[paypal] ${res.status} ${name || "error"}: ${msg}` +
        (fieldNotes.length ? ` | details: ${fieldNotes.join(" ; ")}` : "") +
        (debugId ? ` | debug_id=${debugId}` : ""));
    }

    // A refused RANGE is how a backfill discovers the edge of what this
    // account can be asked about. It ends the walk cleanly; it is not an error
    // to report, and it must never look like a credential problem.
    //
    // DECIDED FROM THE STRUCTURED FIELD, NOT THE PROSE. The old test matched
    // /date|range|period/ against `message` - which on a real INVALID_REQUEST
    // reads "Request is not well-formed, syntactically incorrect, or violates
    // schema" and contains none of those words. So a genuine out-of-range
    // window was never recognised as one, and every OTHER schema violation was
    // equally unrecognised. `details[].field` is the answer PayPal actually
    // gives: /start_date, /end_date.
    const rangeField = details.some(d => /start_date|end_date/i.test(String(d.field || "")));
    if (rangeField || (/INVALID_REQUEST|DATA_RETRIEVAL/i.test(name) && /date|range|period/i.test(msg))) {
      return { rows: [], drops: {}, morePages: false, rangeRefused: true };
    }
    // The token already worked to get here, so this is the REPORTING call.
    // A 403 is the Transaction Search permission, which really can take a day.
    const detailSuffix = fieldNotes.length ? ` (${fieldNotes.join("; ")})` : "";
    throw Object.assign(new Error(`PayPal: ${msg}${detailSuffix}`),
      { status: res.status, step: res.status === 403 ? "permission" : "read",
        providerCode: name || null, providerDetails: fieldNotes, debugId });
  }
  const details = Array.isArray(res.body?.transaction_details) ? res.body.transaction_details : [];
  const rows = [], drops = {};
  for (const t of details) {
    const out = mapTransaction(t);
    if (out.drop) { drops[out.drop] = (drops[out.drop] || 0) + 1; continue; }
    rows.push(out.row);
  }
  const totalPages = Number(res.body?.total_pages) || 0;
  return { rows, drops, morePages: page < totalPages, rangeRefused: false };
}

function dropNotice(drops) {
  const parts = Object.entries(drops).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`);
  return parts.length ? `PayPal rows not counted as gifts: ${parts.join(", ")}.` : null;
}

// ── THE CONTRACT ───────────────────────────────────────────────────────────
//
// fetchRows walks ONE page per call and hands the runner a cursor, so a
// three-year backfill is the same loop as a nightly sync and neither one holds
// a window's worth of rows in memory.
//
// The cursor is JSON: { end, page, empties } for a backfill walking BACKWARDS
// in 31-day windows, or { start, end, page } for an incremental read forwards.
async function fetchRows({ credentials, since, until, cursor, http, today, backfill = false, env = process.env }) {
  const base = apiBase(credentials, env);
  const token = await accessToken({ credentials, http, env });
  const notices = [];
  let state = null;
  try { state = cursor ? JSON.parse(cursor) : null; } catch { state = null; }

  if (!backfill) {
    // INCREMENTAL. One window, clamped to PayPal's 31 days. `since` already
    // reaches back past the last sync (the runner subtracts a few days for the
    // publish delay); de-duplication absorbs everything that overlaps.
    const end = state?.end || until || today;
    let start = state?.start || since || addDays(end, -WINDOW_DAYS + 1);
    if (start < addDays(end, -WINDOW_DAYS + 1)) start = addDays(end, -WINDOW_DAYS + 1);
    const page = state?.page || FIRST_PAGE;
    const out = await readPage({ base, token, http, start, end, page, notices });
    const n = dropNotice(out.drops); if (n) notices.push(n);
    return {
      rows: out.rows,
      cursor: out.morePages ? JSON.stringify({ start, end, page: page + 1 }) : null,
      done: !out.morePages,
      notices,
    };
  }

  // BACKFILL. Walk backwards in 31-day windows until PayPal returns nothing
  // three windows running, refuses the range, or we reach the documented edge
  // of Transaction Search. Every one of those three is a CLEAN stop.
  const end = state?.end || until || today;
  const page = state?.page || FIRST_PAGE;
  const empties = state?.empties || 0;
  const walked = state?.walked || 0;
  const start = addDays(end, -WINDOW_DAYS + 1);

  const out = await readPage({ base, token, http, start, end, page, notices });
  const n = dropNotice(out.drops); if (n) notices.push(n);

  if (out.rangeRefused) {
    notices.push(`PayPal would not return transactions before ${start}, so the history starts there.`);
    return { rows: out.rows, cursor: null, done: true, notices };
  }
  if (out.morePages) {
    return { rows: out.rows, cursor: JSON.stringify({ end, page: page + 1, empties, walked }), done: false, notices };
  }

  const foundThisWindow = out.rows.length > 0 || page > FIRST_PAGE;
  const nextEmpties = foundThisWindow ? 0 : empties + 1;
  const nextWalked = walked + 1;
  if (nextEmpties >= BACKFILL_EMPTY_WINDOWS || nextWalked >= MAX_BACKFILL_WINDOWS) {
    return { rows: out.rows, cursor: null, done: true, notices };
  }
  return {
    rows: out.rows,
    cursor: JSON.stringify({ end: addDays(start, -1), page: FIRST_PAGE, empties: nextEmpties, walked: nextWalked }),
    done: false,
    notices,
  };
}

// The Connect screen's "Test" button: the last seven days, a count and a
// total, and NOTHING is written anywhere by this path.
async function testCredentials({ credentials, http, today, env = process.env }) {
  const base = apiBase(credentials, env);
  const token = await accessToken({ credentials, http, env });
  const start = addDays(today, -7), end = today;
  const out = await readPage({ base, token, http, start, end, page: FIRST_PAGE, notices: [] });
  const money = out.rows.filter(r => r.status === "completed");
  return {
    ok: true,
    count: money.length,
    totalCents: money.reduce((s, r) => s + r.amountCents, 0),
    message: money.length
      ? null
      : "PayPal answered, but there were no gifts in the last seven days. That is not a problem with the connection.",
  };
}

module.exports = {
  key: "paypal",
  fetchRows,
  testCredentials,
  // exported for the suite
  mapTransaction, accessToken, apiBase, addDays,
  EVENT, PAGE_SIZE, WINDOW_DAYS, MAX_BACKFILL_WINDOWS, BACKFILL_EMPTY_WINDOWS,
};
