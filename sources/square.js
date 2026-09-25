// sources/square.js — BUILD-95 §5A. READING AN ORGANISATION'S SQUARE.
//
// ── THE PROBLEM THAT IS NOT THE API ────────────────────────────────────────
// Every other provider Steward reads is a GIVING platform: a row in PayPal,
// Zeffy or Givebutter is a donation unless it says otherwise. Square is a
// POINT OF SALE. An equine-therapy farm running Square is taking lesson fees,
// clinic fees, merchandise, hay, event tickets and — somewhere in among it —
// donations. They are the same shape in the API and Square has no field that
// says which is which.
//
// So the honest design is NOT a cleverer classifier. It is: SQUARE CANNOT TELL
// US, SO THE ORGANISATION HAS TO. The source carries a `config` naming which
// Square LOCATIONS are giving, and optionally a phrase their donation items
// carry. Nothing is imported until one of those is set, and the connect screen
// says why in those words.
//
// Importing a $45 lesson fee as a charitable gift is not a cosmetic error: it
// inflates a giving total, it lands on a donor's lifetime figure, it moves
// Drift, and at year end it can reach a tax receipt. It is the messy-2500
// class of mistake — money that is not a gift — and it is worth refusing to
// guess about.
//
// ── WHAT IS CONFIRMED, AND WHAT IS NOT ─────────────────────────────────────
// Confirmed from Square's published API reference (checked 22 September 2026):
//   base        https://connect.squareup.com/v2
//   auth        Authorization: Bearer <access token>, plus a Square-Version header
//   list        GET /v2/payments?begin_time=&end_time=&cursor=&location_id=
//   paging      `cursor` in, `cursor` out; absent/empty means the last page
//   amounts     MINOR UNITS — amount_money.amount of 250 is $2.50, not $250
//
// NOT confirmed, because the reference could not be exercised without a live
// Square account: whether a donation taken through Square's own "Donations"
// item surfaces a distinguishing field. Until a real payload says otherwise,
// the location/phrase gate above is the answer. Same discipline as Zeffy and
// Givebutter: a DECLARED TABLE, and a suite that proves every candidate path
// resolves. `NEEDS-JONATHAN.md` §6 names the live walk that closes it.
//
// Square gives nonprofits NO discounted rate — 2.6–3.5% like any merchant —
// so an org on Square is there because of the card reader in the barn, not
// because it is the cheapest way to take a gift. That is worth remembering
// when deciding what to recommend to them.

const { firstOf, toCents, toCivilDate, dropNotice } = require("./field.js");

const BASE = "https://connect.squareup.com/v2";
// Pinned deliberately. Square dates its API and changes behaviour between
// versions; an unpinned client silently follows whatever is current.
const SQUARE_VERSION = "2025-01-23";
const PAGE_LIMIT = 100;

const FIELD_MAP = {
  externalId:  ["id", "payment_id"],
  occurredAt:  ["created_at", "createdAt", "updated_at"],
  // total_money includes tip; amount_money does not. A donation with a "tip"
  // is still money the organisation received, so total is the honest figure —
  // and it is what lands in their bank.
  amount:      ["total_money", "amount_money", "approved_money"],
  fee:         ["processing_fee.0.amount_money", "app_fee_money"],
  currency:    ["total_money.currency", "amount_money.currency", "currency"],
  donorEmail:  ["buyer_email_address", "buyerEmailAddress", "customer.email_address", "shipping_address.email"],
  donorFirst:  ["shipping_address.first_name", "billing_address.first_name", "customer.given_name"],
  donorLast:   ["shipping_address.last_name", "billing_address.last_name", "customer.family_name"],
  donorName:   ["shipping_address.name", "billing_address.name", "customer.company_name"],
  status:      ["status"],
  memo:        ["note", "reference_id", "receipt_number"],
  locationId:  ["location_id", "locationId"],
  refunded:    ["refunded_money"],
  sourceType:  ["source_type", "sourceType"],
};

// Square's own payment states. APPROVED is authorised but not captured — it is
// not money yet, and treating it as one would book a gift that may never land.
const COMPLETED = ["COMPLETED"];
const FAILED = ["FAILED", "CANCELED", "CANCELLED"];
const PENDING = ["APPROVED", "PENDING"];

// Money that moved but is not a gift, whatever the location says.
const NEVER_A_GIFT_SOURCE = ["BANK_ACCOUNT_TRANSFER", "SQUARE_ACCOUNT"];

// Does this payment pass the gate the ORGANISATION set? Returns a reason
// string when it does not, so the drop tally can say which rule refused it.
function gateReason(p, config) {
  const cfg = config || {};
  const locs = Array.isArray(cfg.locationIds) ? cfg.locationIds.filter(Boolean) : [];
  const phrase = String(cfg.onlyNoteContains || "").trim().toLowerCase();
  if (!locs.length && !phrase) return "no_gate_configured";
  if (locs.length) {
    const loc = String(firstOf(p, FIELD_MAP.locationId) ?? "");
    if (!locs.includes(loc)) return "other_location";
  }
  if (phrase) {
    const memo = String(firstOf(p, FIELD_MAP.memo) ?? "").toLowerCase();
    if (!memo.includes(phrase)) return "phrase_not_found";
  }
  return null;
}

function mapPayment(p, { config } = {}) {
  const id = String(firstOf(p, FIELD_MAP.externalId) ?? "").trim();
  if (!id) return { drop: "no_external_id" };

  const src = String(firstOf(p, FIELD_MAP.sourceType) ?? "").toUpperCase();
  if (NEVER_A_GIFT_SOURCE.includes(src)) return { drop: "not_money_in", id };

  // THE GATE, before anything else is decided about this row.
  const refused = gateReason(p, config);
  if (refused) return { drop: refused, id };

  // MINOR UNITS. Square sends 250 for $2.50; every other provider in this
  // product sends dollars. Getting this wrong is a 100x error on somebody's
  // giving total, in the direction nobody notices until year end.
  const cents = toCents(firstOf(p, FIELD_MAP.amount), { unit: "cents" });
  if (cents == null) return { drop: "bad_amount", id };
  if (cents <= 0) return { drop: "not_money_in", id };

  const raw = String(firstOf(p, FIELD_MAP.status) ?? "").toUpperCase();
  let status = "completed";
  if (FAILED.includes(raw)) status = "failed";
  else if (PENDING.includes(raw)) return { drop: "pending", id };
  else if (!COMPLETED.includes(raw) && raw) return { drop: "pending", id };

  const refundedCents = toCents(firstOf(p, FIELD_MAP.refunded), { unit: "cents" });
  if (refundedCents != null && refundedCents >= cents) status = "refunded";

  const when = toCivilDate(firstOf(p, FIELD_MAP.occurredAt));
  if (!when) return { drop: "bad_date", id };

  const first = firstOf(p, FIELD_MAP.donorFirst);
  const last = firstOf(p, FIELD_MAP.donorLast);
  const donorName = String([first, last].filter(Boolean).join(" ").trim()
    || firstOf(p, FIELD_MAP.donorName) || "").trim();

  const fee = toCents(firstOf(p, FIELD_MAP.fee), { unit: "cents" });

  return {
    row: {
      externalId: id,
      occurredAt: when,
      amountCents: cents,
      feeCents: fee && fee > 0 ? fee : 0,
      currency: String(firstOf(p, FIELD_MAP.currency) ?? "USD"),
      donorName,
      donorEmail: String(firstOf(p, FIELD_MAP.donorEmail) ?? "").trim(),
      // Square's Payments API has no recurring concept — a monthly gift taken
      // on a card reader is a series of unrelated payments as far as this
      // endpoint is concerned. So the provider is `inferred`: the pattern is
      // read from the gifts, never claimed as a subscription record.
      recurringRef: null,
      status,
      memo: String(firstOf(p, FIELD_MAP.memo) ?? "").trim(),
    },
  };
}

async function get(http, url, token) {
  const res = await http.json(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Square-Version": SQUARE_VERSION,
    },
  });
  if (res.status === 429) throw Object.assign(new Error("Square rate limited the request (429)"), { status: 429 });
  if (!res.ok) {
    const e = res?.body?.errors?.[0];
    const msg = e?.detail || e?.code || `HTTP ${res.status}`;
    throw Object.assign(new Error(`Square: ${msg}`), {
      status: res.status,
      step: res.status === 401 ? "auth" : res.status === 403 ? "permission" : "read",
      providerCode: e?.code || null,
    });
  }
  return res.body || {};
}

const items = (body) => Array.isArray(body?.payments) ? body.payments : [];
const nextCursor = (body) => {
  const c = body?.cursor;
  return c && String(c).trim() ? String(c) : null;
};

async function fetchRows({ credentials, since, cursor, http, today, config, env = process.env }) {
  const token = credentials?.accessToken;
  if (!token) throw Object.assign(new Error("Square: no access token"), { code: "NO_CREDENTIALS" });
  const base = String(env.SQUARE_API_BASE || BASE).replace(/\/$/, "");

  const params = new URLSearchParams({ limit: String(PAGE_LIMIT), sort_order: "ASC" });
  if (since) params.set("begin_time", `${String(since).slice(0, 10)}T00:00:00Z`);
  if (cursor) params.set("cursor", String(cursor));

  const body = await get(http, `${base}/payments?${params}`, token);

  const rows = [], drops = {};
  for (const p of items(body)) {
    const out = mapPayment(p, { config });
    if (out.drop) { drops[out.drop] = (drops[out.drop] || 0) + 1; continue; }
    rows.push(out.row);
  }

  const notices = [];
  // THE LOUD ONE. A Square account with no gate set imports nothing, and the
  // reason must reach the screen — silence here reads as "Square had no
  // donations", which is a different and much more comforting untruth.
  if (drops.no_gate_configured) {
    notices.push(
      `Steward read ${drops.no_gate_configured} Square payment${drops.no_gate_configured === 1 ? "" : "s"} and imported none of them. ` +
      "Square is a point-of-sale, so a lesson fee and a donation look identical to it. " +
      "Tell Steward which Square locations take donations, or a phrase your donation items carry, and these will come in."
    );
  }
  if (drops.other_location || drops.phrase_not_found) {
    const n = (drops.other_location || 0) + (drops.phrase_not_found || 0);
    notices.push(`${n} Square payment${n === 1 ? "" : "s"} did not match your donation locations and were left alone.`);
  }
  const n = dropNotice("Square", drops); if (n) notices.push(n);

  const next = nextCursor(body);
  return { rows, cursor: next, done: !next, notices };
}

async function testCredentials({ credentials, http, today, config, env = process.env }) {
  const token = credentials?.accessToken;
  if (!token) throw Object.assign(new Error("Square: no access token"), { code: "NO_CREDENTIALS" });
  const base = String(env.SQUARE_API_BASE || BASE).replace(/\/$/, "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ""));
  const from = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] - 7)).toISOString() : null;
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT), sort_order: "ASC" });
  if (from) params.set("begin_time", from);
  const body = await get(http, `${base}/payments?${params}`, token);

  const all = items(body);
  const money = all.map(p => mapPayment(p, { config }))
    .filter(o => o.row?.status === "completed").map(o => o.row);

  // The connect screen gets the truth in both directions: the key works AND
  // whether the gate is letting anything through.
  const gated = !config || (!(config.locationIds || []).length && !String(config.onlyNoteContains || "").trim());
  return {
    ok: true,
    count: money.length,
    totalCents: money.reduce((s, r) => s + r.amountCents, 0),
    message: gated && all.length
      ? `Square answered and there were ${all.length} payment${all.length === 1 ? "" : "s"} in the last seven days — but none are being imported yet. Square cannot tell a donation from a lesson fee, so choose which locations take donations below.`
      : money.length
        ? null
        : "Square answered, but there were no donations in the last seven days. That is not a problem with the connection.",
  };
}

module.exports = {
  key: "square",
  fetchRows,
  testCredentials,
  mapPayment, gateReason, items, nextCursor,
  FIELD_MAP, BASE, SQUARE_VERSION, PAGE_LIMIT, NEVER_A_GIFT_SOURCE,
};
