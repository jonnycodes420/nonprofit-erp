// sources/stripeSource.js — BUILD-89S 89e. READING AN ORGANISATION'S OWN STRIPE.
//
// ── THIS IS NOT STEWARD'S STRIPE, AND IT MUST NEVER BECOME IT ──────────────
// Steward already talks to Stripe two ways (stripeKeys.js): the DONATION
// client on the org's connected account, and the PLATFORM BILLING client for
// Steward's own subscription. This is a THIRD, unrelated thing: an
// organisation that takes gifts through its OWN Stripe account, which Steward
// has nothing to do with, pastes a restricted read-only key so Steward can
// read those gifts.
//
// So this file deliberately shares NO code path with either:
//   · it never imports stripeKeys.js, never touches `stripe`/`billingStripe`,
//     and never reads STRIPE_SECRET_KEY or STRIPE_BILLING_SECRET_KEY;
//   · it does not use the Stripe SDK at all. Raw GETs through the read-only
//     handle, because an SDK object would happily expose `.refunds.create()`
//     to anything holding it, and the whole point of the handle is that the
//     write cannot be FORMED. The suite asserts this file mentions none of
//     those names.
//
// A restricted key over OAuth is Cowork's call: it ships in thirty minutes and
// OAuth does not.
//
// ── WHAT IS READ ───────────────────────────────────────────────────────────
// ONE endpoint carries everything this build needs: `/v1/charges`.
//   · a succeeded charge is a gift;
//   · `amount_refunded`/`refunded` is the refund signal;
//   · a FAILED charge carrying an invoice is a failed subscription payment,
//     which is the whole reason Stripe is worth reading directly — the
//     provider TELLING us a payment did not happen is better evidence than the
//     absence of one, so 89a raises the Thread that day instead of waiting out
//     the five-day grace.
// `balance_transaction` is expanded for the real fee; `invoice` is expanded to
// resolve the subscription behind a charge.
//
// ── THE GENERATIONAL SHAPE PROBLEM, ALREADY PAID FOR ONCE ──────────────────
// BUILD-57's real-Stripe drill found that where a subscription id lives on an
// invoice DEPENDS ON THE API VERSION: older payloads carry `invoice.subscription`,
// 2025+ payloads carry `invoice.parent.subscription_details.subscription`.
// Both are read here. That finding is recorded in CLAUDE.md; this adapter
// cannot import the server's normalizer (it must not depend on server.js at
// all), so the three-line read is repeated deliberately, with the reason.

const { toCivilDate, dropNotice } = require("./field.js");

const BASE = "https://api.stripe.com";
const PAGE_LIMIT = 100;

function apiBase(env = process.env) {
  // The same local-test seam BUILD-45 established for the donation client,
  // and the ONLY thing this adapter reads from the environment.
  return String(env.STRIPE_SOURCE_API_BASE || env.STRIPE_API_BASE || BASE).replace(/\/$/, "");
}

// The subscription behind a charge, across both API generations. See the note
// above: this is BUILD-57's finding, not a guess.
function subscriptionIdOf(invoice) {
  if (!invoice || typeof invoice !== "object") return null;
  const legacy = invoice.subscription;
  if (typeof legacy === "string" && legacy) return legacy;
  if (legacy && typeof legacy === "object" && legacy.id) return legacy.id;
  const modern = invoice.parent?.subscription_details?.subscription;
  if (typeof modern === "string" && modern) return modern;
  if (modern && typeof modern === "object" && modern.id) return modern.id;
  return null;
}

// A Stripe charge -> the 89a contract row, or a drop with its reason.
// Stripe speaks in MINOR UNITS already, so nothing is multiplied here.
function mapCharge(ch) {
  const id = String(ch?.id || "").trim();
  if (!id) return { drop: "no_external_id" };

  const amount = Number(ch.amount);
  if (!Number.isInteger(amount)) return { drop: "bad_amount", id };
  if (amount <= 0) return { drop: "not_money_in", id };

  const when = toCivilDate(ch.created);
  if (!when) return { drop: "bad_date", id };

  const status = String(ch.status || "").toLowerCase();
  let mapped;
  if (status === "pending") return { drop: "pending", id };
  else if (status === "failed") mapped = "failed";
  else if (status === "succeeded") mapped = (ch.refunded || Number(ch.amount_refunded) > 0) ? "refunded" : "completed";
  else return { drop: "unknown_status", id };

  // A disputed charge is money HELD, not money returned, and Steward already
  // has a dispute path (BUILD-58). It is not a refund and must not be counted
  // as one here.
  const bt = ch.balance_transaction;
  const feeCents = bt && typeof bt === "object" && Number.isInteger(bt.fee) ? Math.abs(bt.fee) : 0;

  const bd = ch.billing_details || {};
  const donorEmail = String(ch.receipt_email || bd.email || ch.customer?.email || "").trim();
  const donorName = String(bd.name || ch.customer?.name || "").trim();

  return {
    row: {
      externalId: id,
      occurredAt: when,
      amountCents: amount,
      feeCents,
      currency: String(ch.currency || "usd").toUpperCase(),
      donorName,
      donorEmail,
      recurringRef: subscriptionIdOf(ch.invoice),
      status: mapped,
      memo: String(ch.description || ch.statement_descriptor || "").trim(),
    },
  };
}

async function get(http, url, key) {
  const res = await http.json(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (res.status === 429) throw Object.assign(new Error("Stripe rate limited the request (429)"), { status: 429 });
  if (!res.ok) {
    const msg = res?.body?.error?.message || `HTTP ${res.status}`;
    // BUILD-92 A2 — a restricted key that does not exist / was rolled answers
    // 401; one that exists but was not given the read permission answers 403.
    // They are different problems with different fixes and now read that way.
    throw Object.assign(new Error(`Stripe: ${msg}`),
      { status: res.status, stripeCode: res?.body?.error?.code,
        step: res.status === 401 ? "auth" : res.status === 403 ? "permission" : "read",
        providerCode: res?.body?.error?.code || null });
  }
  return res.body;
}

function chargesUrl({ base, since, until, startingAfter }) {
  const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  // Stripe wants unix seconds. A civil date is the org's day; midnight UTC is
  // the conventional edge for a range filter and the re-read window that
  // 89a's runner applies makes any boundary slip harmless by construction.
  const unix = d => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);
  if (since) qs.set("created[gte]", String(unix(since)));
  if (until) qs.set("created[lte]", String(unix(until) + 86399));
  if (startingAfter) qs.set("starting_after", startingAfter);
  qs.append("expand[]", "data.balance_transaction");
  qs.append("expand[]", "data.invoice");
  return `${base}/v1/charges?${qs}`;
}

async function fetchRows({ credentials, since, until, cursor, http, today, backfill = false, env = process.env }) {
  const key = credentials?.apiKey;
  if (!key) throw Object.assign(new Error("Stripe: no restricted key"), { code: "NO_CREDENTIALS" });
  const base = apiBase(env);
  const body = await get(http, chargesUrl({
    base,
    since: backfill ? null : since,
    until: backfill ? null : until,
    startingAfter: cursor || null,
  }), key);

  const data = Array.isArray(body?.data) ? body.data : [];
  const rows = [], drops = {};
  for (const ch of data) {
    const out = mapCharge(ch);
    if (out.drop) { drops[out.drop] = (drops[out.drop] || 0) + 1; continue; }
    rows.push(out.row);
  }
  const notices = [];
  const n = dropNotice("Stripe", drops); if (n) notices.push(n);
  const more = !!body?.has_more && data.length > 0;
  return { rows, cursor: more ? data[data.length - 1].id : null, done: !more, notices };
}

async function testCredentials({ credentials, http, today, env = process.env }) {
  const key = credentials?.apiKey;
  if (!key) throw Object.assign(new Error("Stripe: no restricted key"), { code: "NO_CREDENTIALS" });
  const base = apiBase(env);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ""));
  const from = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] - 7)).toISOString().slice(0, 10) : null;
  const body = await get(http, chargesUrl({ base, since: from, until: today }), key);
  const money = (body?.data || []).map(mapCharge).filter(o => o.row?.status === "completed").map(o => o.row);
  return {
    ok: true,
    count: money.length,
    totalCents: money.reduce((s, r) => s + r.amountCents, 0),
    message: money.length
      ? null
      : "Stripe answered, but there were no gifts in the last seven days. That is not a problem with the connection.",
  };
}

module.exports = {
  key: "stripe",
  fetchRows,
  testCredentials,
  mapCharge, subscriptionIdOf, chargesUrl, apiBase, PAGE_LIMIT,
};
