// server/onboard/order.js · ORDER-1. THE ORDER SHE READS AND SIGNS, AS PURE RULES.
//
// Jonathan approved the mockup on 24 Nov 2026 (one link from "yes" to a card on file,
// instead of an e-sign vendor). He types the order when he makes the close link
// (the start link, ONBOARD-1): the plan, the price per month or per year, the setup
// fee or "Waived", the free days before the first charge, a note line, and who signs.
// The page shows exactly that, built here into one SNAPSHOT: every line and figure as
// shown. Its SHA-256 travels with the page; signing re-builds it and refuses a
// mismatch, so what she signed is what she saw (an edited order, or a page left open
// past midnight, reloads). The signed row keeps the snapshot and its hash; the PDF is
// drawn from the stored snapshot, never re-built.
//
// No database and no network here. The figures come from shared/numbers/orderFigures.
"use strict";
const crypto = require("crypto");
const { orderFigures, usd } = require("../../shared/numbers/orderFigures");
const PRICING = require("../../pricing");
const TERMS = require("../../shared/terms.json");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_FREE_DAYS = 30;
// Stripe refuses a trial_end under 48 hours away, so the shortest free period is 3 days.
const MIN_FREE_DAYS = 3, MAX_FREE_DAYS = 365;
const DEFAULTS = {
  planName: "Steward, everything included",
  planDetail: "Donors, gifts and receipts, letters, events, volunteers, Atlas, giving pages, integrations. Unlimited users.",
  setupDetail: "We move your donor file in, connect Stripe, QuickBooks and Outlook, and spend an hour with your team.",
};
// The short version of the terms, as the mockup has it. The full Terms are linked beside it.
const SHORT_TERMS = [
  "Your donors' data is yours. Export all of it any time, and we delete it when you leave.",
  "Steward never emails your donors unless someone at your organization presses Send.",
  "Month to month. No long contract.",
  "Setup fees aren't refunded once setup has started.",
];

const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const toCents = v => {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return Math.round(v * 100);
  const s = String(v).replace(/[$,\s]/g, "");
  if (/^waived$/i.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

// What Jonathan typed → the order as stored (start_links.order_json), or an error.
// b: { planName, planDetail, interval, price, setupFee ("" | "Waived" | dollars), setupDetail,
//      freeDays, note, signerName, signerTitle, signerEmail, band }
function validateOrder(b = {}) {
  const planName = clean(b.planName, 120) || DEFAULTS.planName;
  const planDetail = clean(b.planDetail, 300) || DEFAULTS.planDetail;
  const interval = b.interval === "year" ? "year" : "month";
  const priceCents = toCents(b.price);
  if (priceCents == null || !Number.isFinite(priceCents) || priceCents <= 0)
    return { ok: false, error: "price_invalid", field: "price", message: `The ${interval === "year" ? "yearly" : "monthly"} price is an amount above zero, like 149.` };
  const fee = toCents(b.setupFee);
  if (fee != null && (!Number.isFinite(fee) || fee < 0))
    return { ok: false, error: "setup_fee_invalid", field: "setupFee", message: "The setup fee is an amount, or Waived." };
  const setupFeeCents = fee || null;   // 0 and empty are both Waived
  const setupDetail = clean(b.setupDetail, 300) || DEFAULTS.setupDetail;
  const freeDays = b.freeDays === "" || b.freeDays == null ? DEFAULT_FREE_DAYS : Number(b.freeDays);
  if (!DATE_RE.test(String(b.startOn || "")) && (!Number.isInteger(freeDays) || freeDays < MIN_FREE_DAYS || freeDays > MAX_FREE_DAYS))
    return { ok: false, error: "free_days_invalid", field: "freeDays", message: `Free days is a whole number from ${MIN_FREE_DAYS} to ${MAX_FREE_DAYS}.` };
  const note = clean(b.note, 300) || null;
  const signerName = clean(b.signerName, 200);
  const signerTitle = clean(b.signerTitle, 200);
  const signerEmail = clean(b.signerEmail, 320).toLowerCase();
  if (!signerName) return { ok: false, error: "signer_name_required", field: "signerName", message: "Who signs: their full name." };
  if (!EMAIL_RE.test(signerEmail)) return { ok: false, error: "signer_email_invalid", field: "signerEmail", message: "Who signs: a valid email." };
  const tier = PRICING.tierById(String(b.band || "")) || PRICING.TIERS[0];
  if (!PRICING.TIERS.includes(tier)) return { ok: false, error: "invalid_band", field: "band", message: "Pick the size band (it sets the Stripe product)." };
  const order = { planName, planDetail, interval, priceCents, setupFeeCents, setupDetail, freeDays, note,
    signerName, signerTitle, signerEmail, tierId: tier.id };
  // SALES-6: an order made from a quote keeps the quote's day, list price and agreement through an edit.
  if (DATE_RE.test(String(b.startOn || ""))) { order.startOn = String(b.startOn); order.freeDays = null; }
  if (Number.isInteger(b.listCents) && b.listCents > 0) order.listCents = b.listCents;
  if (b.fromQuote && typeof b.fromQuote === "object") order.fromQuote = { id: clean(b.fromQuote.id, 64), version: Number(b.fromQuote.version) || 1 };
  if (b.agreementVersion) order.agreementVersion = clean(b.agreementVersion, 40);
  return { ok: true, order };
}

// SW-2026-0007. `n` is this year's count so far plus one.
const orderNumber = (year, n) => `SW-${year}-${String(n).padStart(4, "0")}`;

function dateWords(at, tz) {
  try { return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz }); }
  catch { return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }); }
}
function dayOfMonth(at, tz) {
  try { return Number(new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: tz }).format(new Date(at))); }
  catch { return new Date(at).getUTCDate(); }
}
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));
function monthDay(at, tz) {
  try { return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz }); }
  catch { return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
}

// THE SNAPSHOT: everything the page shows, in order, as words and cents. `at` is the
// moment it is for: now on the page, the signing instant on the stored row.
function buildSnapshot({ order, orderNumber: number, version, orgName, preparedBy, preparedAt, tz, at }) {
  const f = orderFigures(order, at, tz);
  const per = f.interval === "year" ? "year" : "month";
  const first = dateWords(f.firstChargeAt, tz);
  const dom = dayOfMonth(f.firstChargeAt, tz);
  const then = f.interval === "year"
    ? `Then ${usd(f.priceCents)} every year on ${monthDay(f.firstChargeAt, tz)}.`
    : `Then ${usd(f.priceCents)} on the ${ordinal(dom)} of each month${dom > 28 ? " (the month's last day when it is shorter)" : ""}.`;
  // SALES-6: below a list price the plan line says so, as the quote did.
  const list = order.listCents > f.priceCents ? ` List price ${usd(order.listCents)} / ${per}; this is the price agreed with Steward for ${orgName}.` : "";
  const lines = [
    { key: "plan", label: order.planName, detail: `${order.planDetail}${list}`, cents: f.priceCents, amount: `${usd(f.priceCents)} / ${per}` },
    { key: "setup", label: "Hands-on setup", detail: order.setupDetail, cents: f.setupCents, amount: f.setupWaived ? "Waived" : usd(f.setupCents) },
    f.startOn
      ? { key: "free", label: `Until ${first}`, detail: `Starts the day you sign. Nothing is charged before ${first}; cancel any time before then and you pay nothing.`, cents: 0, amount: "$0" }
      : { key: "free", label: `First ${f.freeDays} days`, detail: `Starts the day you sign. Cancel any time before ${first} and you pay nothing.`, cents: 0, amount: "$0" },
  ];
  const total = {
    key: "first", label: `First charge, ${first}`, cents: f.firstChargeCents, amount: usd(f.firstChargeCents),
    detail: `${f.setupWaived ? "" : `Your ${per === "year" ? "first year" : "first month"} and the ${usd(f.setupCents)} setup fee. `}${then} Cancel any time in two clicks from Settings.`,
  };
  return {
    orderNumber: number, version: Number(version) || 1, termsVersion: TERMS.version,
    orgName, preparedBy: preparedBy || "Steward", preparedOn: dateWords(preparedAt, tz), timeZone: tz,
    signer: { name: order.signerName, title: order.signerTitle || "", email: order.signerEmail },
    billingEmail: order.signerEmail,
    lines, total, note: order.note || null,
    figures: { priceCents: f.priceCents, interval: f.interval, setupCents: f.setupCents, freeDays: f.freeDays,
      firstChargeAt: f.firstChargeAt.toISOString(), firstChargeOn: first, firstChargeCents: f.firstChargeCents, todayCents: 0 },
    shortTerms: SHORT_TERMS,
    // SALES-6: an order made from a quote carries the customer agreement the quote did, without its
    // paper signature block (agreementBlock.js): the fields below it are the signature.
    ...(order.agreementVersion ? { agreement: agreementFor(order.agreementVersion) } : {}),
  };
}
function agreementFor(version) {
  const a = require("../../customerAgreement").agreement();
  return { version: a.ok ? a.version : version, text: a.ok ? require("./agreementBlock").bodyOf(a.text).body : "" };
}

// The hash is of the snapshot with its keys in a fixed order, so the same order always
// hashes the same, on the page, at signing and in a test.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v === undefined ? null : v);
}
const snapshotSha = s => crypto.createHash("sha256").update(canonical(s), "utf8").digest("hex");
// What the page SHOWS: the snapshot without the first charge's exact instant (the page shows
// its date). The stale check compares this one, so a page opened at 9:00 still signs at 9:05,
// and one opened before midnight on a 30-day order (a new date) reloads.
const shownSha = s => snapshotSha({ ...s, figures: { ...s.figures, firstChargeAt: null } });

// The order as text: what start_signatures.rendered_text holds, so Settings → Billing and
// ONBOARD-2's paper gate read an order signature the way they read every other.
function snapshotText(s) {
  const rows = [
    `# Steward order ${s.orderNumber}`,
    `For ${s.orgName}. Signing for the organization: ${s.signer.name}${s.signer.title ? `, ${s.signer.title}` : ""}. Billing email: ${s.billingEmail}.`,
    `## What you're getting`,
    ...s.lines.map(l => `**${l.label}: ${l.amount}.** ${l.detail}`),
    `**${s.total.label}: ${s.total.amount}.** ${s.total.detail}`,
    ...(s.note ? [s.note] : []),
    `## The short version of the terms`,
    ...s.shortTerms.map(t => `- ${t}`),
    `This order and the Terms of Service (version ${s.termsVersion}) at stewardapp.dev/terms.`,
    ...(s.agreement ? ["---", s.agreement.text.trim()] : []),
  ];
  return rows.join("\n\n");
}

// "Signed by Sarah Fishback on Nov 24, 2026 at 11:14 PM ET." Always Eastern, as the brief says.
function signedStamp(name, at) {
  const d = new Date(at);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `Signed by ${name} on ${day} at ${time} ET`;
}
function updatedWords(at) {
  const d = new Date(at);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;
}

module.exports = { DEFAULTS, DEFAULT_FREE_DAYS, SHORT_TERMS, TERMS_VERSION: TERMS.version, validateOrder, orderNumber,
  buildSnapshot, snapshotSha, shownSha, snapshotText, signedStamp, updatedWords, canonical, usd };
