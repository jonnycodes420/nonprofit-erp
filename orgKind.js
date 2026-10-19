// ADMIN-CLEAN (Jonathan, 7 Oct 2026): WHAT AN ORG IS, READ IN ONE PLACE.
//
// The console counted Harborlight and CREO as $499 customers and Jonathan's
// own test orgs as churn, because it had no idea what an org IS. Every org is
// exactly one of five kinds:
//
//   customer        pays, or paid, Steward through a real Stripe subscription
//   prospect_trial  a real organisation trying Steward
//   demo            invented data shown to prospects (Harborlight, CREO)
//   internal_test   Jonathan's own orgs and the ones he made to try things
//   fixture         an org a walk, a suite or a verify script made
//
// Only customer and prospect_trial count in Metrics and Overview. A kind
// somebody SET (orgs.org_kind) always wins; otherwise `inferKind` reads it from
// facts and says why, so the console and the cleanup script never disagree.
// Pure: no database in this file, so the suite and the script both read it.

const KINDS = ["customer", "prospect_trial", "demo", "internal_test", "fixture"];
const KIND_LABEL = {
  customer: "Customer", prospect_trial: "Prospect trial", demo: "Demo",
  internal_test: "Internal test", fixture: "Fixture",
};
const COUNTED_KINDS = new Set(["customer", "prospect_trial"]);
const countsAsCustomer = kind => COUNTED_KINDS.has(kind);

// The demo orgs: the two mailPolicy.js and twoFactor.js name, and ONBOARD-1's
// Riverbend Food Pantry (seeded before setup, so it has no donors and the
// cleanup would otherwise call it junk and delete it).
const DEMO_ORG_IDS = ["org_b72demo", "org_creo", "org_riverbend_demo"];

// Jonathan's addresses. A "+tag" alias of one is the same person. More can be
// added without a deploy through STEWARD_INTERNAL_EMAILS (comma separated).
const INTERNAL_EMAILS = ["xjca2006@gmail.com"];
const INTERNAL_DOMAINS = ["stewardapp.dev"];
function internalEmails(env = process.env) {
  const extra = String(env.STEWARD_INTERNAL_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean);
  return [...INTERNAL_EMAILS, ...(env.FOUNDER_EMAIL ? [env.FOUNDER_EMAIL] : []), ...extra]
    .map(baseEmail);
}
function baseEmail(e) {
  const [local, domain] = String(e || "").trim().toLowerCase().split("@");
  if (!domain) return String(e || "").trim().toLowerCase();
  return local.split("+")[0] + "@" + domain;
}
function isInternalEmail(email, list = internalEmails()) {
  const b = baseEmail(email);
  if (!b.includes("@")) return false;
  if (INTERNAL_DOMAINS.includes(b.split("@")[1])) return true;
  return list.includes(b);
}
// Addresses no real organisation signs up with: the suites' and walks' own.
const FIXTURE_EMAIL_RE = /@(example\.(org|com|net)|[a-z0-9-]+\.(test|demo|invalid|example))$/i;

// Names a walk or a verify script gave its org.
const FIXTURE_NAME_RE = /\b(FIX|BUILD|TRANS|WALK|INT|PARITY|PROOF|HARDEN|GTM)[- ]?\d+[a-z]?\b|\bwalk\b|\bfixture\b|delete me|\bverify\b|\blive test\b/i;
// Names nobody runs a nonprofit under: one to three characters, a test word, a joke.
const JUNK_NAME_RE = /^\s*([a-z0-9]{1,3}|test\s*\d*|testing|poop|asdf+|qwerty|jon|atkinson|steward)\s*$/i;

const LIVE_STATUSES = new Set(["active", "past_due"]);
const ENDED_STATUSES = new Set(["canceled", "cancelled", "unpaid"]);

// `org` is the orgs row. `facts`: users [{email}], payments (count of paid
// Steward invoices). Returns { kind, source: "set"|"inferred", reason }.
function inferKind(org, facts = {}, env = process.env) {
  if (!org) return { kind: "prospect_trial", source: "inferred", reason: "no org row" };
  if (KINDS.includes(org.org_kind)) return { kind: org.org_kind, source: "set", reason: "set in /admin" };
  const name = String(org.name || "");
  const users = (facts.users || []).filter(u => u && u.email);
  const payments = Number(facts.payments || 0);
  const list = internalEmails(env);
  const why = reason => reason;

  if (org.is_demo_org === true || DEMO_ORG_IDS.includes(org.id))
    return { kind: "demo", source: "inferred", reason: why("marked as a demo org") };
  if (/\(demo\)|\bdemo\b/i.test(name))
    return { kind: "demo", source: "inferred", reason: why(`name says demo ("${name}")`) };
  if (FIXTURE_NAME_RE.test(name))
    return { kind: "fixture", source: "inferred", reason: why(`name reads as a walk or test fixture ("${name}")`) };
  if (users.length && users.every(u => FIXTURE_EMAIL_RE.test(u.email)))
    return { kind: "fixture", source: "inferred", reason: why("every login is a test address") };
  // Money is the strongest fact about a real customer: an org that paid is a
  // customer even if Jonathan is on it.
  const hasLiveSub = !!org.stripe_subscription_id && LIVE_STATUSES.has(org.subscription_status);
  if (payments > 0)
    return { kind: "customer", source: "inferred", reason: `${payments} paid Steward invoice${payments === 1 ? "" : "s"}` };
  if (users.length && users.every(u => isInternalEmail(u.email, list)))
    return { kind: "internal_test", source: "inferred", reason: "every login is Jonathan's" };
  if (JUNK_NAME_RE.test(name))
    return { kind: "internal_test", source: "inferred", reason: `name reads as a test ("${name}")` };
  if (hasLiveSub && org.subscription_status === "active")
    return { kind: "customer", source: "inferred", reason: "active Stripe subscription" };
  return { kind: "prospect_trial", source: "inferred", reason: org.stripe_subscription_id
    ? `Stripe subscription, ${org.subscription_status || "no status"}, nothing paid yet`
    : "no Stripe subscription and no payment" };
}

// What an org pays Steward a month, in cents. Only a counted kind with a live
// subscription and a real Stripe amount: never a plan's list price.
function orgMrrCents(org, kind) {
  if (!countsAsCustomer(kind)) return 0;
  if (!org.stripe_subscription_id || !LIVE_STATUSES.has(org.subscription_status)) return 0;
  const c = Number(org.billing_mrr_cents);
  return Number.isFinite(c) && c > 0 ? Math.round(c) : 0;
}

// A Stripe subscription (or subscription-shaped object) -> monthly cents.
// Sums every item's price times quantity, normalised to a month.
function monthlyCentsFromSubscription(sub) {
  const items = sub?.items?.data || [];
  let total = 0;
  for (const it of items) {
    const price = it.price || it.plan || {};
    const amount = Number(price.unit_amount ?? price.amount);
    if (!Number.isFinite(amount)) continue;
    total += perMonth(amount * Number(it.quantity || 1), price.recurring?.interval || price.interval, price.recurring?.interval_count || price.interval_count);
  }
  return Math.round(total);
}
function perMonth(cents, interval, count = 1) {
  const n = Number(count) || 1;
  if (interval === "year") return cents / (12 * n);
  if (interval === "week") return (cents * 52) / (12 * n);
  if (interval === "day") return (cents * 365) / (12 * n);
  return cents / n;
}
// One invoice line -> monthly cents (an invoice's own amount, normalised).
function monthlyCentsFromInvoice(inv) {
  const line = (inv?.lines?.data || []).find(l => l.price || l.plan) || null;
  if (line) {
    const price = line.price || line.plan || {};
    return Math.round(perMonth(Number(line.amount ?? inv.amount_paid), price.recurring?.interval || price.interval, price.recurring?.interval_count || price.interval_count));
  }
  return Number(inv?.amount_paid) || 0;
}

// THE PLAN LINE. Default: 8 paying customers by 31 Dec 2026, then 5 net new a
// month through 2027. `target` is { start: {month:"2026-12", customers:8},
// monthlyNet: 5, through: "2027-12" }. Returns customers expected at month m
// ("YYYY-MM"), or null before the plan starts counting.
const DEFAULT_TARGET = { start: { month: "2026-12", customers: 8 }, monthlyNet: 5, through: "2027-12" };
function targetFor(month, target = DEFAULT_TARGET) {
  const t = target || DEFAULT_TARGET;
  const [sy, sm] = t.start.month.split("-").map(Number);
  const [y, m] = month.split("-").map(Number);
  const diff = (y - sy) * 12 + (m - sm);
  const [ty, tm] = String(t.through || t.start.month).split("-").map(Number);
  if ((y - ty) * 12 + (m - tm) > 0) return null;
  if (diff < 0) {
    // Before the first milestone the line climbs straight from zero at the
    // end of September 2026 to it, so "on pace" means something in October.
    const from = t.from || "2026-09";
    const [fy, fm] = from.split("-").map(Number);
    const span = (sy - fy) * 12 + (sm - fm);
    const at = (y - fy) * 12 + (m - fm);
    if (at < 0 || span <= 0) return null;
    return Math.round((t.start.customers * at) / span * 10) / 10;
  }
  return t.start.customers + diff * Number(t.monthlyNet || 0);
}

module.exports = {
  KINDS, KIND_LABEL, COUNTED_KINDS, countsAsCustomer, DEMO_ORG_IDS,
  inferKind, isInternalEmail, baseEmail, internalEmails, orgMrrCents,
  monthlyCentsFromSubscription, monthlyCentsFromInvoice, perMonth,
  DEFAULT_TARGET, targetFor, LIVE_STATUSES, ENDED_STATUSES, JUNK_NAME_RE, FIXTURE_NAME_RE,
};
