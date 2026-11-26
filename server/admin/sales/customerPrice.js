// server/admin/sales/customerPrice.js · SALES-5 item 1. ONE PRICE PER CUSTOMER, AND THE RULE FOR WHICH ONE WINS.
//
// A customer had four prices and nothing tied them together: the deal's value_cents, the
// accepted quote's or signed order's price, the Steward org's agreed billing_mrr_cents (the
// onboarding board's "agreed"), and what Stripe bills now (the onboarding board's MRR now).
// Editing one changed only that one. Every sales screen now reads the price from here:
//
//   1. Stripe's live subscription, when the org is billing (signals.mrrNowCents);
//   2. else the signed order's price (ORDER-1, start_links, a yearly price ÷ 12), or the
//      accepted quote's (SALES-3), whichever was signed last;
//   3. else the org's agreed price (signals.mrrAgreedCents: billing_mrr_cents first);
//   4. else the deal's own value_cents.
//
// pick(facts) is pure. forDeals(query, deals) reads the facts for many deals in a fixed number
// of statements (no query per deal). Each price carries its cents, its source, ARR (arrOf, the one
// place a monthly price becomes a yearly one), when billing starts, and the sentence that says so:
// "$299/mo, from the signed order; Stripe starts billing Jan 1, 2027".
//
// Read-only: nothing here writes. Only server/admin/sales/ reads the sales_ tables.
"use strict";
const { usd } = require("../../../shared/numbers/orderFigures");
const SIGNALS = require("../../onboard/signals");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MISSING = new Set(["42P01", "42703"]);
const safe = p => p.catch(e => { if (e && MISSING.has(e.code)) return []; throw e; });
const civil = (t, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const dayWords = d => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); return `${MONTHS[m - 1]} ${dd}, ${y}`; };

// ARR is the monthly price times twelve: here, and nowhere else.
const arrOf = monthlyCents => Math.round(Number(monthlyCents || 0)) * 12;

const SOURCE_WORDS = {
  stripe: "what Stripe bills now",
  order: "from the signed order",
  quote: "from the accepted quote",
  agreed: "the price agreed on the Steward org",
  deal: "the deal's value",
};
const SENTENCE = "A customer's monthly price is what Stripe bills now if it is billing; else the signed order's or accepted quote's price; else the price agreed on the Steward org; else the deal's own value. ARR is that price times 12.";

// facts: { dealValueCents, stripeCents (> 0 only when billing), order: { priceCents, startOn, at } | null,
//          quote: { priceCents, startOn, at } | null, agreedCents, firstChargeOn (the org's own day), closeDate, stewardOrgId }
// A signed order and an accepted quote are one step: whichever was signed last wins it.
function pick(f) {
  const pos = c => (Number(c) > 0 ? Math.round(Number(c)) : null);
  const prices = { stripe: pos(f.stripeCents), order: f.order ? pos(f.order.priceCents) : null, quote: f.quote ? pos(f.quote.priceCents) : null,
    agreed: pos(f.agreedCents), deal: Math.round(Number(f.dealValueCents || 0)) };
  const signedKind = prices.order != null && prices.quote != null ? ((f.order.at || 0) >= (f.quote.at || 0) ? "order" : "quote")
    : prices.order != null ? "order" : prices.quote != null ? "quote" : null;
  let cents, source;
  if (prices.stripe != null) { cents = prices.stripe; source = "stripe"; }
  else if (signedKind) { cents = prices[signedKind]; source = signedKind; }
  else if (prices.agreed != null) { cents = prices.agreed; source = "agreed"; }
  else { cents = prices.deal; source = "deal"; }
  const billing = source === "stripe";
  const signed = source === "order" || source === "quote";
  // When billing starts, for a customer who is not billing yet: the order's (or quote's) start, the org's first charge, the close date.
  const startsOn = billing ? null : (signed && f[source].startOn) || f.firstChargeOn || (f.closeDate ? String(f.closeDate).slice(0, 10) : null);
  const says = `${usd(cents)}/mo, ${SOURCE_WORDS[source]}${billing ? "" : startsOn ? `; Stripe starts billing ${dayWords(startsOn)}` : source !== "deal" ? "; no first charge date yet" : ""}`;
  return { cents, arrCents: arrOf(cents), source, sourceWords: SOURCE_WORDS[source], billing, signed, startsOn, says,
    dealValueCents: prices.deal, dealDiffers: source !== "deal" && prices.deal !== cents, prices,
    stewardOrgId: f.stewardOrgId || null, sentence: SENTENCE };
}

// The record page's MRR row for a linked Steward org: "Not billing yet · $299/mo agreed, first charge Jan 1, 2027".
function mrrRow(p) {
  if (!p) return null;
  if (p.billing) return `${usd(p.cents)}/mo`;
  if (p.source === "deal") return "Not billing yet";
  return `Not billing yet · ${usd(p.cents)}/mo agreed${p.startsOn ? `, first charge ${dayWords(p.startsOn)}` : ""}`;
}

// deals: rows with { id, value_cents, close_date, linked_org_ids?, org_id? }. Returns Map(dealId → pick()).
async function forDeals(query, deals) {
  const out = new Map();
  if (!deals || !deals.length) return out;
  const dealIds = deals.map(d => d.id);
  const salesOrgIds = [...new Set(deals.flatMap(d => [d.org_id, ...(d.linked_org_ids || [])]).filter(Boolean))];
  const [links, quotes] = await Promise.all([
    salesOrgIds.length ? query(`SELECT id, steward_org_id FROM sales_orgs WHERE id = ANY(?) AND steward_org_id IS NOT NULL AND deleted_at IS NULL`, [salesOrgIds]) : [],
    safe(query(`SELECT DISTINCT ON (deal_id) deal_id, price_cents, start_on::text AS start_on, accepted_at FROM sales_quotes
                 WHERE status = 'accepted' AND deal_id = ANY(?) ORDER BY deal_id, accepted_at DESC NULLS LAST`, [dealIds])),
  ]);
  const stewardOf = new Map(links.map(r => [r.id, r.steward_org_id]));
  // The deal's Steward org: its primary organization's link, else any linked organization's.
  const stewardFor = d => stewardOf.get(d.org_id) || (d.linked_org_ids || []).map(id => stewardOf.get(id)).find(Boolean) || null;
  const stewardIds = [...new Set(deals.map(stewardFor).filter(Boolean))];
  const [orders, facts] = await Promise.all([
    safe(query(`SELECT l.id, l.org_id, l.deal_id, l.price_cents, l.order_json->>'interval' AS interval, l.first_charge_at, l.first_charge_on::text AS first_charge_on,
                       l.signed_at, o.timezone FROM start_links l LEFT JOIN orgs o ON o.id = l.org_id
                 WHERE l.status IN ('signed', 'completed') AND (l.deal_id = ANY(?) OR l.org_id = ANY(?)) ORDER BY l.signed_at DESC NULLS LAST`, [dealIds, stewardIds])),
    stewardIds.length ? SIGNALS.readFacts(query, stewardIds) : {},
  ]);
  const orderOf = o => ({ at: o.signed_at ? new Date(o.signed_at).getTime() : 0,
    priceCents: o.interval === "year" ? Math.round(Number(o.price_cents) / 12) : Number(o.price_cents),
    startOn: o.first_charge_at ? civil(o.first_charge_at, o.timezone) : o.first_charge_on || null });
  for (const d of deals) {
    const sid = stewardFor(d);
    const f = sid ? facts[sid] || null : null;
    // The newest signed order for this deal, else for its Steward org.
    const ord = orders.find(o => o.deal_id === d.id) || (sid ? orders.find(o => o.org_id === sid && (!o.deal_id || o.deal_id === d.id)) : null);
    const q = quotes.find(x => x.deal_id === d.id);
    const quote = q ? { at: q.accepted_at ? new Date(q.accepted_at).getTime() : 0, priceCents: Number(q.price_cents), startOn: q.start_on } : null;
    out.set(d.id, pick({ dealValueCents: d.value_cents, stripeCents: f ? f.mrrNowCents : 0, order: ord ? orderOf(ord) : null, quote, agreedCents: f ? f.mrrAgreedCents : 0,
      firstChargeOn: f ? f.firstChargeOn : null, closeDate: d.close_date, stewardOrgId: sid }));
  }
  return out;
}

// The same, from deal ids alone (the scoreboard, the price-check script): reads each deal's value, close date and organizations.
async function forDealIds(query, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return new Map();
  const [deals, links] = await Promise.all([
    query(`SELECT id, value_cents, close_date::text AS close_date FROM sales_deals WHERE id = ANY(?)`, [list]),
    query(`SELECT a_id AS deal_id, b_id AS org_id, is_primary FROM sales_links WHERE a_type = 'deal' AND b_type = 'org' AND a_id = ANY(?)`, [list]),
  ]);
  const rows = deals.map(d => {
    const mine = links.filter(l => l.deal_id === d.id);
    const primary = mine.find(l => l.is_primary) || mine[0];
    return { id: d.id, value_cents: Number(d.value_cents || 0), close_date: d.close_date, org_id: primary ? primary.org_id : null, linked_org_ids: mine.map(l => l.org_id) };
  });
  return forDeals(query, rows);
}

// Put the price on deal rows (the list, the board, the header and the forecast read these fields).
async function attach(query, rows) {
  const m = await forDeals(query, rows);
  for (const r of rows) {
    const p = m.get(r.id);
    if (!p) continue;
    Object.assign(r, { price_cents: p.cents, arr_cents: p.arrCents, price_source: p.source, price_says: p.says, price_billing: p.billing,
      price_signed: p.signed, billing_starts_on: p.startsOn, price_deal_differs: p.dealDiffers });
  }
  return rows;
}

// The price a deal's edit would leave behind: the warning SALES-5 asks for when the deal's value is
// edited on a deal whose price is a signed order, an accepted quote or live billing.
function editWarning(p, newCents) {
  if (!p || !["stripe", "order", "quote"].includes(p.source)) return null;
  if (Math.round(Number(newCents)) === p.cents) return null;
  const what = p.source === "stripe" ? `Stripe bills ${usd(p.cents)}/mo` : p.source === "order" ? `The signed order says ${usd(p.cents)}/mo` : `The accepted quote says ${usd(p.cents)}/mo`;
  const where = p.source === "quote" ? { label: "Change the quote", href: null, panel: "quote" }
    : { label: p.source === "stripe" ? "Change the subscription: /admin → Organizations" : "Change the order: /admin → Organizations → Make order", href: "/admin" };
  return { says: `This changes the pipeline value only. ${what}, and every screen shows that price. Change the ${p.source === "stripe" ? "subscription" : p.source} too?`, priceCents: p.cents, source: p.source, where };
}

module.exports = { pick, forDeals, forDealIds, attach, arrOf, mrrRow, editWarning, dayWords, SOURCE_WORDS, SENTENCE };
