// shared/givingSources.js — BUILD-89S 89a. WHAT CROSSES THE LINE FROM A
// PAYMENT PROVIDER, AND WHAT STEWARD CONCLUDES FROM IT.
//
// ── THE SENTENCE THIS BUILD HAS TO MAKE TRUE ───────────────────────────────
// "Keep PayPal. Keep Zeffy. Steward reads them. It never holds or moves a
// dollar." Every rule below exists to keep the second half of that literally
// true: there is one shape a provider may return, it is money-in only, and
// nothing in this file or downstream of it can express a write.
//
// Pure: no DB, no network, no clock (today is always a parameter), no JSX.
// Node-testable directly, which is why the whole of 89a's judgement lives here
// and the adapters underneath it only fetch and shape.

import { addCivilDays } from "./threadShape.js";
import orgTime from "../orgTime.js";

// ── THE PROVIDER REGISTRY ──────────────────────────────────────────────────
// `mode: "api"` reads on a schedule. `mode: "file"` is a statement a human
// drops in once a month, because the provider has no API that reads an
// account — and saying that plainly is better product than implying a
// connection that does not exist.
//
// `recurring` is what the provider itself tells us: "exact" means the payload
// names the subscription and Steward does not have to guess; "inferred" means
// nobody is telling us and the 27-to-34-day rule below is all there is.
export const PROVIDERS = {
  paypal: {
    key: "paypal", label: "PayPal", mode: "api", recurring: "exact",
    credentialFields: [
      { name: "clientId", label: "Client ID", secret: false },
      { name: "clientSecret", label: "Secret", secret: true },
    ],
    // PayPal is the one provider that needs a POST, and only to mint the
    // OAuth token that every subsequent GET carries. It is the sole exception
    // in READ_ONLY_EXCEPTIONS and the suite pins that list.
    help: "In PayPal, open Developer → Apps & Credentials, create a REST app on your live account, and switch on Transaction Search in its settings.",
    delay: "PayPal can take up to a day to allow this. Steward will keep trying.",
    // BUILD-92 B2 — the numbered steps, in the order Jonathan actually hit
    // them on a real PayPal account. They live HERE, in the registry, beside
    // `help`, for the same reason `help` does: the copy that describes ANOTHER
    // company's screens belongs with the provider, not scattered through a
    // settings page, and a provider that changes its menus is then one edit.
    steps: [
      "Open PayPal and click Developer at the top right.",
      "Switch Sandbox to Live.",
      "Open Apps and Credentials.",
      "Click Create App.",
      "Tick Transaction search, and untick Payouts.",
      "Click Save Changes.",
      "Copy the Client ID and the Secret with the copy icons.",
    ],
    // Said BEFORE the steps, because the first check often fails and that is
    // normal. A person who is not told this reads a permission error as
    // something they did wrong and undoes correct work.
    waitNote: "PayPal can take up to a day to switch this on. If the first check says not allowed yet, Steward keeps trying and nothing is wrong.",
  },
  zeffy: {
    key: "zeffy", label: "Zeffy", mode: "api", recurring: "inferred",
    credentialFields: [{ name: "apiKey", label: "API key", secret: true }],
    help: "In Zeffy, an admin opens Settings, then Integrations, chooses API, and copies the key.",
    steps: [
      "Open Zeffy as an administrator and go to Settings.",
      "Open Integrations, then API.",
      "Create a key and copy it.",
    ],
  },
  stripe: {
    key: "stripe", label: "Stripe", mode: "api", recurring: "exact",
    credentialFields: [{ name: "apiKey", label: "Restricted key", secret: true }],
    help: "In Stripe, open Developers → API keys → Create restricted key, and give it read access to Charges, Subscriptions, Invoices and Customers.",
    steps: [
      "Open Stripe and go to Developers, then API keys.",
      "Click Create restricted key.",
      "Give it read access to Charges, Subscriptions, Invoices and Customers, and nothing else.",
      "Copy the key.",
    ],
  },
  givebutter: {
    key: "givebutter", label: "Givebutter", mode: "api", recurring: "exact",
    credentialFields: [{ name: "apiKey", label: "API key", secret: true }],
    help: "In Givebutter, open Account → Integrations → API, and create a key.",
    steps: [
      "Open Givebutter and go to Account, then Integrations.",
      "Open API and create a key.",
      "Copy the key.",
    ],
  },
  cashapp: {
    key: "cashapp", label: "Cash App", mode: "file", recurring: "inferred",
    credentialFields: [],
    help: "Cash App has no API that reads an account. Once a month you drop the statement in and Steward reads it.",
  },
  venmo: {
    key: "venmo", label: "Venmo", mode: "file", recurring: "inferred",
    credentialFields: [],
    help: "Venmo has no API that reads an account. Once a month you drop the statement in and Steward reads it.",
  },
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS);
export const API_PROVIDERS = PROVIDER_KEYS.filter(k => PROVIDERS[k].mode === "api");
export const FILE_PROVIDERS = PROVIDER_KEYS.filter(k => PROVIDERS[k].mode === "file");

export function providerLabel(key) {
  return PROVIDERS[key]?.label || String(key || "");
}

// ── READ ONLY, AND PROVABLY ────────────────────────────────────────────────
// Zeffy's API can record AND DELETE payments. Stripe's can refund. The guard
// against "an adapter grew a write one day" is not a code review, it is this
// list plus a suite that asserts every outbound request an adapter makes is a
// GET unless it is named here — matched on method AND path shape, so a POST
// to anything but PayPal's token endpoint fails the build.
export const READ_ONLY_EXCEPTIONS = [
  { provider: "paypal", method: "POST", pathIncludes: "/v1/oauth2/token", why: "client-credentials token; every read after it is a GET" },
];
export function requestAllowed(provider, method, url) {
  const m = String(method || "GET").toUpperCase();
  if (m === "GET") return true;
  return READ_ONLY_EXCEPTIONS.some(e =>
    e.provider === provider && e.method === m && String(url || "").includes(e.pathIncludes));
}

// ── THE ADAPTER CONTRACT ───────────────────────────────────────────────────
// Every provider returns THIS and nothing else. The point of a narrow contract
// is that adding Donorbox next month is one file: it cannot introduce a new
// concept into the runner, because there is nowhere to put one.
export const ROW_FIELDS = [
  "externalId",     // the provider's own id for this payment — the dedupe key
  "occurredAt",     // civil date, YYYY-MM-DD
  "amountCents",    // GROSS, in integer cents. The donor gave the gross.
  "feeCents",       // what the provider took, integer cents, 0 when unknown
  "currency",
  "donorName",
  "donorEmail",
  "recurringRef",   // the provider's subscription/plan id, or null
  "status",         // completed | refunded | failed
  "memo",
];
export const ROW_STATUSES = ["completed", "refunded", "failed"];

const MONEY_RE = /^-?\d+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// normalizeRow(raw) → { ok, row } | { ok:false, reason }
//
// The refusals are the interesting part and each one is a decision:
//   no_external_id — without the provider's id there is no dedupe key, and a
//     row that cannot dedupe will be written again on every single sync.
//   not_money_in — a transfer to the bank, a payout, a fee charged as its own
//     row, a purchase. Zero and negative amounts are dropped AT THE ADAPTER
//     boundary so no part of the runner has to know what a payout is.
//   bad_date / bad_status — refuse rather than coerce; a guessed date lands a
//     gift in the wrong tax year.
export function normalizeRow(raw, { provider = "" } = {}) {
  const r = raw || {};
  const externalId = String(r.externalId ?? "").trim();
  if (!externalId) return { ok: false, reason: "no_external_id" };
  const occurredAt = String(r.occurredAt ?? "").slice(0, 10);
  if (!DATE_RE.test(occurredAt)) return { ok: false, reason: "bad_date", externalId };
  const amountCents = Number(r.amountCents);
  if (!Number.isInteger(amountCents) || !MONEY_RE.test(String(amountCents))) return { ok: false, reason: "bad_amount", externalId };
  if (amountCents <= 0) return { ok: false, reason: "not_money_in", externalId };
  const status = String(r.status || "completed").toLowerCase();
  if (!ROW_STATUSES.includes(status)) return { ok: false, reason: "bad_status", externalId };
  let feeCents = Number(r.feeCents);
  if (!Number.isInteger(feeCents) || feeCents < 0) feeCents = 0;
  // A fee larger than the gift is a sign the adapter mapped a net/gross pair
  // the wrong way round. Refusing is better than storing a gift that nets
  // negative and quietly wrecks a bookkeeper's reconciliation.
  if (feeCents > amountCents) return { ok: false, reason: "fee_exceeds_gross", externalId };
  return {
    ok: true,
    row: {
      externalId, occurredAt, amountCents, feeCents,
      currency: String(r.currency || "USD").toUpperCase().slice(0, 3),
      donorName: String(r.donorName || "").trim().slice(0, 200),
      donorEmail: String(r.donorEmail || "").trim().toLowerCase().slice(0, 200),
      recurringRef: r.recurringRef ? String(r.recurringRef).trim().slice(0, 120) : null,
      status, memo: String(r.memo || "").trim().slice(0, 500),
      provider: provider || null,
    },
  };
}

// The dedupe key, namespaced by provider. Namespacing is not tidiness: it
// means a PayPal CSV statement (89d) and the PayPal API (89b) carrying the
// SAME transaction id land on the same gift instead of two, and that two
// providers reusing a short numeric id can never collide.
export function externalKey(provider, externalId) {
  return `${provider}:${externalId}`;
}

// ── WHAT "MONTHLY" MEANS ───────────────────────────────────────────────────
// Cowork's design, and the numbers are meant to be changed once real data
// argues with them.
//
// A window, not a number: a monthly donor charged on the 31st is charged on
// the 28th in February (28 days) and a provider retrying a soft decline lands
// a day or two late (up to 34). Outside that, two gifts are just two gifts.
export const MONTH_MIN_DAYS = 27;
export const MONTH_MAX_DAYS = 34;
// Three, because two gifts a month apart is a coincidence and the cost of
// being wrong is telling a fundraiser somebody is a sustainer who is not.
export const RECURRING_MIN_RUN = 3;
// Five days, because a provider's own retry window is two to three and a
// Thread that fires on day one would fire on every soft decline that fixes
// itself. This is the line between "late" and "gone".
export const MISSED_GRACE_DAYS = 5;

export const CONFIDENCE = { PROVIDER: "provider", INFERRED: "inferred" };

// Same day next month, clamped to the month's length — the 31st becomes the
// 28th in February and does NOT drift to March 3rd, which +30 days would do
// and which would make every February look like a missed payment.
export function addCivilMonths(dateStr, n) {
  const m = DATE_RE.exec(String(dateStr || ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const target = new Date(Date.UTC(y, mo - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

const daysApart = (a, b) => orgTime.daysBetween(a, b);

// detectCommitments(rows, { today }) → [commitment]
//
// `rows` are one donor's gifts THROUGH ONE SOURCE, any order:
//   { externalId, occurredAt, amountCents, recurringRef }
//
// Two kinds come out and they are not equal:
//   · provider — the provider named a subscription. Steward states it.
//   · inferred — nobody named anything; Steward saw three or more gifts of the
//     same amount, each 27 to 34 days after the last. It reads "looks monthly"
//     on every surface until a human taps once to confirm, because a guess
//     presented as a fact is the thing this product refuses to do.
//
// Refunded and failed rows are excluded from the pattern: a refunded gift is
// not evidence of a commitment, and a failed one is the ABSENCE of a payment.
export function detectCommitments(rows, { today = null } = {}) {
  const usable = (rows || [])
    .filter(r => r && DATE_RE.test(String(r.occurredAt || "")) && (r.status || "completed") === "completed")
    .slice()
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)) || String(a.externalId).localeCompare(String(b.externalId)));
  const out = [];
  const claimed = new Set();

  // 1 — the provider's own word, grouped by its subscription id.
  const byRef = new Map();
  for (const r of usable) {
    if (!r.recurringRef) continue;
    claimed.add(r.externalId);
    if (!byRef.has(r.recurringRef)) byRef.set(r.recurringRef, []);
    byRef.get(r.recurringRef).push(r);
  }
  for (const [ref, list] of byRef) {
    const last = list[list.length - 1];
    out.push(commitment({
      confidence: CONFIDENCE.PROVIDER, recurringRef: ref,
      amountCents: last.amountCents, gifts: list, today,
    }));
  }

  // 2 — the pattern, per amount. Same amount is part of the definition: a
  // donor whose gift changes size is making a decision, not keeping a
  // schedule, and the new amount starts its own run.
  const byAmount = new Map();
  for (const r of usable) {
    if (claimed.has(r.externalId)) continue;
    const k = String(r.amountCents);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k).push(r);
  }
  for (const [, list] of byAmount) {
    const run = longestMonthlyRun(list);
    if (run.length < RECURRING_MIN_RUN) continue;
    out.push(commitment({
      confidence: CONFIDENCE.INFERRED, recurringRef: null,
      amountCents: run[run.length - 1].amountCents, gifts: run, today,
    }));
  }
  return out;
}

// The longest run of gifts each 27-34 days after the previous one. Walked
// forward keeping the best run seen, so a donor who gave monthly for a year,
// stopped for six months and started again is recognised on the LONGER of the
// two runs rather than on neither.
function longestMonthlyRun(list) {
  let best = [], cur = [];
  for (const r of list) {
    if (!cur.length) { cur = [r]; continue; }
    const gap = daysApart(cur[cur.length - 1].occurredAt, r.occurredAt);
    if (gap != null && gap >= MONTH_MIN_DAYS && gap <= MONTH_MAX_DAYS) cur.push(r);
    else { if (cur.length > best.length) best = cur; cur = [r]; }
  }
  if (cur.length > best.length) best = cur;
  return best;
}

function commitment({ confidence, recurringRef, amountCents, gifts, today }) {
  const last = gifts[gifts.length - 1];
  const expectedNext = addCivilMonths(last.occurredAt, 1);
  return {
    confidence, recurringRef, amountCents,
    interval: "month",
    giftCount: gifts.length,
    firstGiftOn: gifts[0].occurredAt,
    lastGiftOn: last.occurredAt,
    lastExternalId: last.externalId,
    expectedNext,
    missed: today ? isMissed(expectedNext, today) : false,
  };
}

// A payment is MISSED when its expected date passed by the grace period and
// nothing arrived. Not "is late" — late is the grace period's whole job.
export function isMissed(expectedNext, today, { grace = MISSED_GRACE_DAYS } = {}) {
  if (!DATE_RE.test(String(expectedNext || "")) || !DATE_RE.test(String(today || ""))) return false;
  const deadline = addCivilDays(expectedNext, grace);
  return String(today) > String(deadline);
}

// ── WHAT SHE READS ─────────────────────────────────────────────────────────
// One sentence, built once, used by the Settings row, the donor header and the
// Thread label — so the three cannot drift apart.
//
// NEVER "live", NEVER "real time". Steward polls every six hours and a
// provider can take hours to publish a transaction; a product that says "live"
// about a number that is four hours old has told its first lie to a person
// whose job is being accurate about money.
export const FORBIDDEN_FRESHNESS_WORDS = ["live", "real time", "real-time", "realtime", "instantly", "instant"];

export function recurringPhrase(c, { provider = "" } = {}) {
  const amt = money(c.amountCents);
  const per = c.interval === "year" ? "yearly" : "monthly";
  const through = provider ? ` through ${providerLabel(provider)}` : "";
  return c.confidence === CONFIDENCE.PROVIDER
    ? `Gives ${amt} ${per}${through}`
    : `Looks like ${amt} ${per}${through}`;
}

// "Dana's monthly $50 through PayPal did not arrive on the 14th."
export function missedPhrase({ firstName, amountCents, provider, expectedNext, interval = "month" }) {
  const who = String(firstName || "").trim();
  const per = interval === "year" ? "yearly" : "monthly";
  const through = provider ? ` through ${providerLabel(provider)}` : "";
  return `${who ? who + "'s " : "A "}${per} ${money(amountCents)}${through} did not arrive on the ${ordinalDay(expectedNext)}`;
}

export function money(cents) {
  const n = Math.round(Number(cents) || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

export function ordinalDay(dateStr) {
  const m = DATE_RE.exec(String(dateStr || ""));
  if (!m) return "";
  const d = +m[3], t = d % 10, h = d % 100;
  const suf = (t === 1 && h !== 11) ? "st" : (t === 2 && h !== 12) ? "nd" : (t === 3 && h !== 13) ? "rd" : "th";
  return d + suf;
}
