// sources/givebutter.js — BUILD-89S 89e. READING AN ORGANISATION'S GIVEBUTTER.
//
// A Bearer API key. Two resources: transactions (the gifts) and plans (the
// recurring commitments, which Givebutter names).
//
// ── THE SAME HONESTY AS ZEFFY ──────────────────────────────────────────────
// Givebutter's field-level reference could not be read without an account, so
// the field resolution is a DECLARED TABLE and the suite proves every declared
// candidate is actually read. `NEEDS-JONATHAN.md` §6 names the live walk.
//
// ── WHY A FAILED PLAN COMES BACK AS A "FAILED" CONTRACT ROW ────────────────
// Givebutter's webhooks include `plan.failed`, `plan.canceled` and
// `plan.paused`, and the brief says each should raise the missed-payment
// Thread. A plan is not a payment, so there is a temptation to open a second
// channel from the adapter into the runner for it.
//
// There is already a place for this in the ONE contract: a row with status
// `failed` and a recurring reference. 89a never writes such a row as a gift —
// it counts it, and treats the provider SAYING a recurring payment did not
// happen as better evidence than the absence of one, raising the Thread that
// day rather than waiting out the five-day grace. So a stopped plan is
// expressed as exactly that, and no second channel exists to keep in step.

const { firstOf, toCents, toCivilDate, dropNotice } = require("./field.js");

const BASE = "https://api.givebutter.com/v1";
const PAGE_LIMIT = 100;

const FIELD_MAP = {
  externalId: ["id", "transaction_id", "transactionId"],
  occurredAt: ["created_at", "createdAt", "date", "captured_at", "transacted_at"],
  amount: ["amount", "total", "gross_amount", "grossAmount"],
  fee: ["fee", "fees", "processing_fee", "processingFee", "platform_fee"],
  currency: ["currency", "currency_code"],
  donorEmail: ["email", "donor.email", "contact.email", "giving_space.email", "payer.email"],
  donorFirst: ["first_name", "firstName", "donor.first_name", "contact.first_name"],
  donorLast: ["last_name", "lastName", "donor.last_name", "contact.last_name"],
  donorName: ["giving_space.name", "name", "donor.name", "contact.name", "company"],
  recurringRef: ["plan_id", "planId", "plan.id", "recurring_plan_id", "subscription_id"],
  status: ["status", "transaction_status", "state"],
  memo: ["campaign_title", "campaign.title", "campaign_code", "note", "message"],
};

const PLAN_FIELDS = {
  id: ["id", "plan_id", "planId"],
  status: ["status", "state"],
  amount: ["amount", "recurring_amount", "total"],
  email: ["email", "contact.email", "donor.email"],
  first: ["first_name", "firstName", "contact.first_name"],
  last: ["last_name", "lastName", "contact.last_name"],
  name: ["name", "contact.name", "donor.name"],
  lastEvent: ["updated_at", "updatedAt", "last_failed_at", "next_bill_date", "created_at"],
};

// The three plan states the brief names, and only those. A plan that is
// ACTIVE, or one whose state Givebutter has not published, raises nothing —
// silence is not a signal.
const STOPPED_PLAN_STATUSES = ["failed", "canceled", "cancelled", "paused"];

const REFUNDED = ["refunded", "partially_refunded", "reversed", "chargeback", "disputed"];
const FAILED = ["failed", "declined", "canceled", "cancelled", "voided"];
const PENDING = ["pending", "processing", "authorized"];

function mapTransaction(t) {
  const id = String(firstOf(t, FIELD_MAP.externalId) ?? "").trim();
  if (!id) return { drop: "no_external_id" };

  const cents = toCents(firstOf(t, FIELD_MAP.amount));
  if (cents == null) return { drop: "bad_amount", id };
  if (cents <= 0) return { drop: "not_money_in", id };

  const raw = String(firstOf(t, FIELD_MAP.status) ?? "succeeded").toLowerCase();
  let status = "completed";
  if (REFUNDED.includes(raw)) status = "refunded";
  else if (FAILED.includes(raw)) status = "failed";
  else if (PENDING.includes(raw)) return { drop: "pending", id };

  const when = toCivilDate(firstOf(t, FIELD_MAP.occurredAt));
  if (!when) return { drop: "bad_date", id };

  const first = firstOf(t, FIELD_MAP.donorFirst);
  const last = firstOf(t, FIELD_MAP.donorLast);
  const donorName = String([first, last].filter(Boolean).join(" ").trim()
    || firstOf(t, FIELD_MAP.donorName) || "").trim();

  const fee = toCents(firstOf(t, FIELD_MAP.fee));
  const ref = firstOf(t, FIELD_MAP.recurringRef);

  return {
    row: {
      externalId: id,
      occurredAt: when,
      amountCents: cents,
      feeCents: fee && fee > 0 ? fee : 0,
      currency: String(firstOf(t, FIELD_MAP.currency) ?? "USD"),
      donorName,
      donorEmail: String(firstOf(t, FIELD_MAP.donorEmail) ?? "").trim(),
      recurringRef: ref ? String(ref).trim() : null,
      status,
      memo: String(firstOf(t, FIELD_MAP.memo) ?? "").trim(),
    },
  };
}

// A stopped plan -> a `failed` contract row carrying the plan's identity. See
// the note at the top of this file: this is the one contract, not a second
// channel. `externalId` is namespaced so it can never collide with a real
// transaction id from the same account.
function mapStoppedPlan(p, { today }) {
  const id = String(firstOf(p, PLAN_FIELDS.id) ?? "").trim();
  if (!id) return { drop: "no_external_id" };
  const status = String(firstOf(p, PLAN_FIELDS.status) ?? "").toLowerCase();
  if (!STOPPED_PLAN_STATUSES.includes(status)) return { drop: "plan_active" };

  const cents = toCents(firstOf(p, PLAN_FIELDS.amount));
  if (cents == null || cents <= 0) return { drop: "bad_amount", id };
  const when = toCivilDate(firstOf(p, PLAN_FIELDS.lastEvent)) || today;
  if (!when) return { drop: "bad_date", id };

  const first = firstOf(p, PLAN_FIELDS.first);
  const last = firstOf(p, PLAN_FIELDS.last);
  const donorName = String([first, last].filter(Boolean).join(" ").trim()
    || firstOf(p, PLAN_FIELDS.name) || "").trim();

  return {
    row: {
      externalId: `plan:${id}:${status}:${when}`,
      occurredAt: when,
      amountCents: cents,
      feeCents: 0,
      currency: "USD",
      donorName,
      donorEmail: String(firstOf(p, PLAN_FIELDS.email) ?? "").trim(),
      recurringRef: id,
      status: "failed",
      memo: `Givebutter plan ${status}`,
    },
  };
}

async function get(http, url, key) {
  const res = await http.json(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (res.status === 429) throw Object.assign(new Error("Givebutter rate limited the request (429)"), { status: 429 });
  if (!res.ok) {
    const msg = res?.body?.message || res?.body?.error || `HTTP ${res.status}`;
    // BUILD-92 A2 — same split as Stripe: 401 is a wrong key, 403 is a key
    // that has not been allowed to read this yet.
    throw Object.assign(new Error(`Givebutter: ${msg}`),
      { status: res.status, step: res.status === 401 ? "auth" : res.status === 403 ? "permission" : "read",
        providerCode: res?.body?.code || res?.body?.error || null });
  }
  return res.body;
}

function items(body) {
  for (const k of ["data", "transactions", "plans", "items"]) if (Array.isArray(body?.[k])) return body[k];
  return Array.isArray(body) ? body : [];
}
// Givebutter pages by number; `meta.last_page` / `links.next` both appear in
// Laravel-shaped APIs, so both are read.
function hasNextPage(body, page) {
  if (body?.links?.next) return true;
  const last = Number(body?.meta?.last_page ?? body?.last_page);
  return Number.isFinite(last) && page < last;
}

// One page of transactions per call; the plans are read ONCE, on the page that
// ends the walk, so a stopped plan is noticed on every sync without costing a
// request per page.
async function fetchRows({ credentials, since, until, cursor, http, today, backfill = false, env = process.env }) {
  const key = credentials?.apiKey;
  if (!key) throw Object.assign(new Error("Givebutter: no API key"), { code: "NO_CREDENTIALS" });
  const base = String(env.GIVEBUTTER_API_BASE || BASE).replace(/\/$/, "");
  const page = Number(cursor) || 1;

  const qs = new URLSearchParams({ per_page: String(PAGE_LIMIT), page: String(page) });
  const body = await get(http, `${base}/transactions?${qs}`, key);

  const rows = [], drops = {};
  for (const t of items(body)) {
    const out = mapTransaction(t);
    if (out.drop) { drops[out.drop] = (drops[out.drop] || 0) + 1; continue; }
    rows.push(out.row);
  }

  const more = hasNextPage(body, page);
  const notices = [];

  if (!more) {
    // The plans, once, at the end of the walk.
    try {
      const plans = await get(http, `${base}/plans?${new URLSearchParams({ per_page: String(PAGE_LIMIT) })}`, key);
      let stopped = 0;
      for (const p of items(plans)) {
        const out = mapStoppedPlan(p, { today });
        if (out.drop) continue;
        rows.push(out.row);
        stopped++;
      }
      if (stopped) notices.push(`Givebutter reported ${stopped} recurring plan${stopped === 1 ? "" : "s"} that stopped.`);
    } catch (e) {
      // A plans read that fails must not lose the transactions already read.
      notices.push("Givebutter's recurring plans could not be read on this check. The gifts above are complete.");
    }
  }

  const n = dropNotice("Givebutter", drops); if (n) notices.push(n);
  return { rows, cursor: more ? String(page + 1) : null, done: !more, notices };
}

async function testCredentials({ credentials, http, today, env = process.env }) {
  const key = credentials?.apiKey;
  if (!key) throw Object.assign(new Error("Givebutter: no API key"), { code: "NO_CREDENTIALS" });
  const base = String(env.GIVEBUTTER_API_BASE || BASE).replace(/\/$/, "");
  const body = await get(http, `${base}/transactions?${new URLSearchParams({ per_page: String(PAGE_LIMIT), page: "1" })}`, key);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ""));
  const from = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] - 7)).toISOString().slice(0, 10) : null;
  const money = items(body).map(mapTransaction)
    .filter(o => o.row?.status === "completed" && (!from || o.row.occurredAt >= from))
    .map(o => o.row);
  return {
    ok: true,
    count: money.length,
    totalCents: money.reduce((s, r) => s + r.amountCents, 0),
    message: money.length
      ? null
      : "Givebutter answered, but there were no gifts in the last seven days. That is not a problem with the connection.",
  };
}

module.exports = {
  key: "givebutter",
  fetchRows,
  testCredentials,
  mapTransaction, mapStoppedPlan, items, hasNextPage,
  FIELD_MAP, PLAN_FIELDS, STOPPED_PLAN_STATUSES, BASE, PAGE_LIMIT,
};
