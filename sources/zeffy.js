// sources/zeffy.js — BUILD-89S 89c. READING AN ORGANISATION'S ZEFFY.
//
// A Bearer key an admin copies from Settings -> Integrations -> API.
//
// ── TWO CORRECTIONS TO 89c's BRIEF, BOTH CHECKED 20 SEPTEMBER 2026 ─────────
//
// 1. THE BRIEF SAID ZEFFY'S API CAN RECORD AND DELETE PAYMENTS. IT CANNOT.
//    Zeffy's published guide is explicit that the public API "gives you read
//    access" and documents no create, modify or delete endpoint on any
//    resource. The read-only guard in sources/index.js still applies and is
//    still asserted — it is Steward's promise about Steward, and it must not
//    depend on a provider's current endpoint list staying that way — but the
//    reason recorded in the brief was wrong and is corrected here rather than
//    repeated.
//
// 2. PAGING IS `has_more` + `next_cursor`, not `starting_after`.
//
// ── WHAT IS CONFIRMED, AND WHAT IS NOT ─────────────────────────────────────
// Confirmed from Zeffy's own documentation:
//   base            https://api.zeffy.com/api/v1
//   auth            Authorization: Bearer <key>
//   resources       payments · contacts · campaigns   (read only)
//   paging          cursor-based, `has_more` + `next_cursor`
//   rate limit      100 requests per minute per key; 429 on exceed
//   payment carries line items, refund details, buyer info, a receipt link
//
// NOT confirmed, because the interactive reference could not be read without
// an account: the exact FIELD NAMES on a payment object, and the exact name of
// the request parameter that carries a cursor.
//
// So the field resolution is a DECLARED TABLE (`FIELD_MAP`) rather than
// scattered property reads: every contract field lists the candidate source
// paths in priority order, the mapper walks it, and the suite proves each
// candidate resolves. When a real payload arrives from a Zeffy test
// organisation, correcting this adapter is editing one table — not hunting
// property reads through a mapper. That is the shape the uncertainty should
// take: visible, in one place, and cheap to close.
//
// `BLOCKED-build89c.md` names the live walk that closes it.

const { firstOf, toCents, toCivilDate, dropNotice } = require("./field.js");

const BASE = "https://api.zeffy.com/api/v1";

// Zeffy allows 100 requests a minute per key. 650ms between requests is about
// 92 a minute: under the ceiling with room for a retry, and a page of payments
// is large enough that this costs nothing on any real account.
const MIN_REQUEST_GAP_MS = 650;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = 2000;
const PAGE_LIMIT = 100;
// The request parameter that carries a cursor. NOT confirmed against the
// interactive reference — one constant so the live walk is a one-line fix.
const CURSOR_PARAM = "cursor";

// ── THE FIELD TABLE ────────────────────────────────────────────────────────
// Candidate paths per contract field, most likely first. Dot paths; a path
// that resolves to null/undefined/"" falls through to the next.
const FIELD_MAP = {
  externalId: ["id", "paymentId", "payment_id"],
  occurredAt: ["createdAtUtc", "created_at", "createdAt", "date", "paidAt", "paid_at"],
  amount: ["amount", "totalAmount", "total_amount", "grossAmount", "gross_amount"],
  // Zeffy takes no platform fee; a "fee" here is the card cost or the donor's
  // optional tip, and only a real fee figure is ever stored as one.
  fee: ["feeAmount", "fee_amount", "fees", "processingFee", "processing_fee"],
  currency: ["currency", "currencyCode", "currency_code"],
  donorEmail: ["buyer.email", "contact.email", "donor.email", "email", "payer.email"],
  donorFirst: ["buyer.firstName", "contact.firstName", "donor.firstName", "firstName", "first_name"],
  donorLast: ["buyer.lastName", "contact.lastName", "donor.lastName", "lastName", "last_name"],
  donorName: ["buyer.name", "contact.name", "donor.name", "name", "companyName", "company_name"],
  recurringRef: [
    "recurringPaymentId", "recurring_payment_id", "subscriptionId", "subscription_id",
    "recurring.id", "subscription.id",
  ],
  recurringFlag: ["isRecurring", "is_recurring", "recurring"],
  status: ["status", "paymentStatus", "payment_status", "state"],
  refunded: ["refundedAt", "refunded_at", "isRefunded", "is_refunded", "refund.id", "refundedAmount"],
  memo: ["campaignName", "campaign.name", "campaign_name", "note", "message", "description"],
  type: ["type", "paymentType", "payment_type"],
};

const REFUNDED_STATUSES = ["refunded", "reversed", "chargeback", "charged_back"];
const FAILED_STATUSES = ["failed", "declined", "error", "canceled", "cancelled"];
const PENDING_STATUSES = ["pending", "processing", "requires_action"];

// mapPayment(p) -> { row } | { drop: reason }
function mapPayment(p) {
  const id = String(firstOf(p, FIELD_MAP.externalId) ?? "").trim();
  if (!id) return { drop: "no_external_id" };

  const cents = toCents(firstOf(p, FIELD_MAP.amount));
  if (cents == null) return { drop: "bad_amount", id };
  // Money out is not a gift, here as everywhere.
  if (cents <= 0) return { drop: "not_money_in", id };

  const raw = String(firstOf(p, FIELD_MAP.status) ?? "succeeded").toLowerCase();
  const refundedMark = firstOf(p, FIELD_MAP.refunded);
  let status = "completed";
  if (REFUNDED_STATUSES.includes(raw) || (refundedMark !== undefined && refundedMark !== false)) status = "refunded";
  else if (FAILED_STATUSES.includes(raw)) status = "failed";
  else if (PENDING_STATUSES.includes(raw)) return { drop: "pending", id };

  const when = toCivilDate(firstOf(p, FIELD_MAP.occurredAt));
  if (!when) return { drop: "bad_date", id };

  const first = firstOf(p, FIELD_MAP.donorFirst);
  const last = firstOf(p, FIELD_MAP.donorLast);
  const whole = firstOf(p, FIELD_MAP.donorName);
  const donorName = String(
    [first, last].filter(Boolean).join(" ").trim() || whole || ""
  ).trim();

  // THE RECURRING SIGNAL, and the same honesty as PayPal's: a real
  // subscription id when Zeffy gives one; a bare "this was recurring" flag is
  // NOT an identity, so it leaves the ref null and lets 89a's pattern
  // inference say "looks monthly" instead of inventing something to group on.
  const ref = firstOf(p, FIELD_MAP.recurringRef);
  const recurringRef = ref ? String(ref).trim() : null;

  const feeCents = toCents(firstOf(p, FIELD_MAP.fee));

  return {
    row: {
      externalId: id,
      occurredAt: when,
      amountCents: cents,
      feeCents: feeCents && feeCents > 0 ? feeCents : 0,
      currency: String(firstOf(p, FIELD_MAP.currency) ?? "USD"),
      donorName,
      donorEmail: String(firstOf(p, FIELD_MAP.donorEmail) ?? "").trim(),
      recurringRef,
      status,
      memo: String(firstOf(p, FIELD_MAP.memo) ?? "").trim(),
    },
  };
}

// A paced GET. Zeffy's ceiling is 100 a minute; a 429 is retried with backoff
// rather than surfaced, because the run should slow down, not stop.
async function pacedGet(http, url, { key, sleep = ms => new Promise(r => setTimeout(r, ms)), lastAt = { t: 0 } }) {
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastAt.t);
    if (wait > 0) await sleep(wait);
    lastAt.t = Date.now();
    const res = await http.json(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (res.status !== 429) return res;
    if (attempt === RATE_LIMIT_RETRIES) {
      throw Object.assign(new Error("Zeffy rate limited the request (429)"), { status: 429 });
    }
    await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
  }
}

function assertOk(res) {
  if (res.ok) return;
  const msg = res?.body?.message || res?.body?.error || `HTTP ${res.status}`;
  // BUILD-92 A2 — Zeffy has ONE key that both authenticates and authorises, so
  // the status is the only thing that can separate "this key is wrong" (401)
  // from "this key is not allowed to read payments yet" (403).
  throw Object.assign(new Error(`Zeffy: ${msg}`),
    { status: res.status, step: res.status === 401 ? "auth" : res.status === 403 ? "permission" : "read",
      providerCode: res?.body?.code || res?.body?.error || null });
}

// Both spellings, because the response field is documented as `has_more` /
// `next_cursor` but the payload's own casing is not confirmed.
function readCursor(body) {
  const more = body?.has_more ?? body?.hasMore ?? false;
  const next = body?.next_cursor ?? body?.nextCursor ?? body?.cursor ?? null;
  return { more: !!more && !!next, next };
}
function readItems(body) {
  for (const k of ["payments", "data", "items", "results"]) {
    if (Array.isArray(body?.[k])) return body[k];
  }
  return Array.isArray(body) ? body : [];
}

// ── THE CONTRACT ───────────────────────────────────────────────────────────
// One page per call, cursor handed back to the runner. Polling only; Zeffy's
// `payment.completed` webhook exists and is a later build.
async function fetchRows({ credentials, since, until, cursor, http, today, backfill = false, sleep, env = process.env }) {
  const key = credentials?.apiKey;
  if (!key) throw Object.assign(new Error("Zeffy: no API key"), { code: "NO_CREDENTIALS" });
  const base = (env.ZEFFY_API_BASE || BASE).replace(/\/$/, "");
  const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  // A backfill asks for everything and lets the cursor walk it; an
  // incremental read asks from the last sync, a few days back.
  if (!backfill && since) qs.set("from", since);
  if (!backfill && until) qs.set("to", until);
  if (cursor) qs.set(CURSOR_PARAM, cursor);

  const res = await pacedGet(http, `${base}/payments?${qs}`, { key, sleep });
  assertOk(res);

  const items = readItems(res.body);
  const rows = [], drops = {};
  for (const p of items) {
    const out = mapPayment(p);
    if (out.drop) { drops[out.drop] = (drops[out.drop] || 0) + 1; continue; }
    rows.push(out.row);
  }
  const { more, next } = readCursor(res.body);
  const notices = [];
  const n = dropNotice("Zeffy", drops); if (n) notices.push(n);

  return { rows, cursor: more ? String(next) : null, done: !more, notices };
}

async function testCredentials({ credentials, http, today, sleep, env = process.env }) {
  const key = credentials?.apiKey;
  if (!key) throw Object.assign(new Error("Zeffy: no API key"), { code: "NO_CREDENTIALS" });
  const base = (env.ZEFFY_API_BASE || BASE).replace(/\/$/, "");
  const from = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ""));
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  })();
  const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (from) { qs.set("from", from); qs.set("to", today); }
  const res = await pacedGet(http, `${base}/payments?${qs}`, { key, sleep });
  assertOk(res);
  const money = readItems(res.body).map(mapPayment).filter(o => o.row && o.row.status === "completed").map(o => o.row);
  return {
    ok: true,
    count: money.length,
    totalCents: money.reduce((s, r) => s + r.amountCents, 0),
    message: money.length
      ? null
      : "Zeffy answered, but there were no gifts in the last seven days. That is not a problem with the connection.",
  };
}

module.exports = {
  key: "zeffy",
  fetchRows,
  testCredentials,
  // exported for the suite
  mapPayment, readCursor, readItems, toCents, firstOf,
  FIELD_MAP, BASE, PAGE_LIMIT, MIN_REQUEST_GAP_MS, RATE_LIMIT_RETRIES, CURSOR_PARAM,
};
