// server/admin/sales/sendToSign.js · SALES-6 item 1. ONE LINK TO SEND.
//
// A deal had two ways to a signature: SALES-3's quote link ("Accept and sign", no card) and ORDER-1's
// order link (read, sign, card on file, book setup). Now there is one action, **Send to sign**: it
// makes the ORDER-1 order from the deal's newest quote (its plan, price, list price, start day and
// setup fee) for the Steward org the deal's organization is linked to, and hands back the order's link
// to copy. Steward sends nothing; Jonathan sends it.
//
// A quote link made before this (CKRH's) still works: her page offers "Open your order", a POST from
// the page she sees, which makes the same order under the quote's own token and opens it, so nothing
// Jonathan already sent goes stale. A quote already accepted stays accepted. When the order is signed
// the quote reads 'ordered' (orderDeal.quoteSigned).
//
// A deal whose organization has no Steward org, or no contact with an email, can't be ordered: the
// action says which, and the old quote page keeps its own "Accept and sign" for that quote.
"use strict";
const Q = require("./quotes");
const O = require("../../onboard/order");
const { noonIn } = require("../../../shared/numbers/orderFigures");

const DAY = 86400000;
const LEAD_MS = 3 * DAY;   // Stripe holds a trial_end only 48 hours out; the link stops three days before the start
const QUOTE_OPENER = { id: "system:sales/quote-link", name: "Quote link (opened as an order)" };

// "She reads the order, signs, adds a card (nothing charged until Jan 1, 2027), and books setup."
const shortDay = d => Q.dayWords(d).replace(/^(\w{3})\w* /, "$1 ");   // "Jan 1, 2027", as the order page writes it
const whatSheSees = startOn => `She reads the order, signs, adds a card (nothing charged until ${shortDay(startOn)}), and books setup.`;

async function signerOf(query, dealId) {
  const [c] = await query(`SELECT c.first_name, c.last_name, c.title, c.emails FROM sales_links l JOIN sales_contacts c ON c.id = l.b_id AND c.deleted_at IS NULL
                            WHERE l.a_type = 'deal' AND l.a_id = ? AND l.b_type = 'contact' ORDER BY l.is_primary DESC, l.created_at LIMIT 1`, [dealId]);
  if (!c || !(c.emails || [])[0]) return null;
  return { name: [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || String(c.emails[0]), title: c.title || "", email: String(c.emails[0]).toLowerCase() };
}
async function orgOf(query, dealId) {
  const [o] = await query(`SELECT o.id, o.name, o.steward_org_id FROM sales_links l JOIN sales_orgs o ON o.id = l.b_id AND o.deleted_at IS NULL
                            WHERE l.a_type = 'deal' AND l.a_id = ? AND l.b_type = 'org' ORDER BY l.is_primary DESC, l.created_at LIMIT 1`, [dealId]);
  return o || null;
}
async function tzOf(query, orgId) {
  const [o] = await query(`SELECT timezone FROM orgs WHERE id = ?`, [orgId]);
  return (o && o.timezone) || "America/New_York";
}

// Can this quote become an order? { ok, says, org, signer } or { ok: false, message }.
async function canOrder(query, q) {
  if (!q) return { ok: false, message: "Save a quote first: the order is made from its terms." };
  const org = await orgOf(query, q.deal_id);
  if (!org || !org.steward_org_id) return { ok: false, message: "Link this deal's organization to its Steward org first: the order is signed for that org." };
  const signer = await signerOf(query, q.deal_id);
  if (!signer) return { ok: false, message: "Add a contact with an email to this deal: she is who signs." };
  return { ok: true, org, signer, says: whatSheSees(q.start_on) };
}

// The quote's terms as ORDER-1's order, through ORDER-1's own validation.
function orderFrom(q, signer) {
  const includes = (q.includes || []).join(". ");
  const v = O.validateOrder({
    planName: q.plan_name, planDetail: includes ? `${includes}.` : "", interval: "month", price: q.price_cents / 100,
    setupFee: q.setup_fee_cents > 0 ? q.setup_fee_cents / 100 : "", startOn: q.start_on, listCents: Number(q.list_cents),
    note: (q.addons || []).length ? `Add-ons: ${q.addons.map(a => a.name).join(", ")}.` : "",
    signerName: signer.name, signerTitle: signer.title, signerEmail: signer.email, band: q.tier_id || "",
    fromQuote: { id: q.id, version: q.version }, agreementVersion: require("../../../customerAgreement").VERSION,
  });
  return v;
}

// When the link stops: 14 days, or three days before billing starts, whichever is first.
async function expiryFor(query, orgId, startOn, now) {
  const start = noonIn(startOn, await tzOf(query, orgId)).getTime();
  const end = Math.min(now + 14 * DAY, start - LEAD_MS);
  if (end < now + DAY) return { error: "invalid", message: `Billing would start ${Q.dayWords(startOn)}, too soon to hold the date. Save a new quote version with a later start.` };
  return { at: new Date(end).toISOString() };
}

// ── Send to sign (the deal's one action, and the Quote panel's "Make a new link") ──
async function sendToSign(ctx, dealId, who, now = Date.now()) {
  const quotes = await Q.forDeal(ctx.query, dealId);
  const q = quotes.find(x => x.status !== "superseded");
  if (!q) return { error: "invalid", message: "Save a quote first: the order is made from its terms." };
  if (q.status === "accepted" || q.status === "ordered") return { error: "invalid", message: `Version ${q.version} is already signed.` };
  const can = await canOrder(ctx.query, q);
  if (!can.ok) return { error: "invalid", message: can.message };
  const orgId = can.org.steward_org_id;
  const signedOpen = await ctx.query(`SELECT order_number FROM start_links WHERE org_id = ? AND status = 'signed' AND expires_at > NOW() LIMIT 1`, [orgId]);
  if (signedOpen.length) return { error: "invalid", message: `Order ${signedOpen[0].order_number} is already signed for this org; it waits for her card.` };
  const v = orderFrom(q, can.signer);
  if (!v.ok) return { error: "invalid", message: v.message };
  const exp = await expiryFor(ctx.query, orgId, q.start_on, now);
  if (exp.error) return exp;
  // One open order per org: a new one retires the open ones (their links stop).
  await ctx.run(`UPDATE start_links SET status = 'revoked' WHERE org_id = ? AND status = 'open'`, [orgId]);
  const made = await require("../../onboard/orderRoutes").insertOrder({ orgId, order: v.order, dealId, who, expiresAt: exp.at });
  if (!made.ok) return { error: "invalid", message: made.message };
  // The quote is sent: its own old link stops, and Today counts it as sent and not signed.
  await ctx.run(`UPDATE sales_quotes SET status = 'sent', start_link_id = ?, token_hash = ?, link_made_at = ?, expires_at = ?, org_name = COALESCE(org_name, ?),
                   steward_org_id = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`,
    [made.id, Q.hash(made.token), new Date(now).toISOString(), exp.at, can.org.name, orgId, who.id, who.name, q.id]);
  return { ok: true, id: made.id, quoteId: q.id, orderNumber: made.number, token: made.token, path: `/start/${made.token}`, expiresAt: exp.at, to: can.signer.email,
    says: `Order ${made.number}, made from quote version ${q.version}. ${can.says} Copy it now: Steward keeps only a fingerprint, so this link can't be shown again. Sending a new one turns this one off. Steward sends nothing; you send it.` };
}

// ── Her old quote link → the order (a POST from her page) ───────────────────
async function openFromQuote(ctx, token, now = Date.now()) {
  const SL = require("../../onboard/startLink");
  const startHash = SL.sha256("start:" + String(token || ""));
  const opened = async () => (await ctx.query(`SELECT id, status FROM start_links WHERE token_hash = ?`, [startHash]))[0] || null;
  const have = await opened();
  if (have && ["open", "signed", "completed"].includes(have.status)) return { ok: true, path: `/start/${token}` };
  const pub = await Q.publicRead(ctx.query, token, now);
  if (pub.gone) return { error: "gone", state: pub.state, message: pub.message };
  if (pub.state !== "open") return { error: "gone", state: pub.state, message: "This quote is already signed." };
  const [q] = await ctx.query(`SELECT id, deal_id, version, plan_name, tier_id, addons, includes, list_cents, price_cents, start_on::text AS start_on, setup_fee_cents,
                                       status, expires_at FROM sales_quotes WHERE token_hash = ?`, [Q.hash(token)]);
  const can = await canOrder(ctx.query, q);
  if (!can.ok) return { error: "invalid", message: "This quote is signed on this page. Jonathan will help if anything looks wrong." };
  const orgId = can.org.steward_org_id;
  const v = orderFrom(q, can.signer);
  if (!v.ok) return { error: "invalid", message: v.message };
  const exp = await expiryFor(ctx.query, orgId, q.start_on, now);
  if (exp.error) return exp;
  const at = new Date(Math.min(new Date(exp.at).getTime(), new Date(q.expires_at).getTime())).toISOString();
  await ctx.run(`UPDATE start_links SET status = 'revoked' WHERE org_id = ? AND status = 'open'`, [orgId]);
  const made = await require("../../onboard/orderRoutes").insertOrder({ orgId, order: v.order, dealId: q.deal_id, who: QUOTE_OPENER, token, expiresAt: at });
  if (!made.ok) { const again = await opened(); return again ? { ok: true, path: `/start/${token}` } : { error: "invalid", message: made.message }; }
  await ctx.run(`UPDATE sales_quotes SET start_link_id = ?, steward_org_id = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ?`,
    [made.id, orgId, QUOTE_OPENER.id, QUOTE_OPENER.name, q.id]);
  return { ok: true, path: `/start/${token}`, orderNumber: made.number };
}

// The Quote panel's line for each version that was sent to sign: its order's number and where it stands.
async function ordersFor(query, quotes) {
  const ids = quotes.map(q => q.start_link_id).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await query(`SELECT id, order_number, status, signed_at, expires_at FROM start_links WHERE id = ANY(?)`, [ids]);
  return new Map(rows.map(r => [r.id, { number: r.order_number, state: require("../../onboard/startLink").linkState(r), signedAt: r.signed_at }]));
}

module.exports = { canOrder, orderFrom, sendToSign, openFromQuote, ordersFor, whatSheSees, QUOTE_OPENER };
