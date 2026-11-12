// server/admin/sales/referrals.js · SALES-2 items 8 and 10. PARTNER REFERRAL LINKS, CUSTOMER REFERRALS.
//
// A partner gets a private link: /refer/<token>, a long random token of which only the hash is
// kept (the link is shown once, when it is made; making a new one revokes the old). The page
// shows the partner's name and a short form, and nothing else: never another deal, never a
// count. Submitting it is inbound.note with the partner and their default term attached, and a
// Today line (the "New inbound" task). Rate-limited, with a honeypot. Nothing is emailed.
//
// A customer's referral (logged by Jonathan from the customer's organization) is the same
// inbound, sourced "Customer referral", naming the customer.
//
// THE PLANTED DEFECT (SALES2_PLANT=refleak on the server, tests only): the public page also lists
// the partner's other deals. tests/sales2-inbound.test.js §8 goes red.
"use strict";
const crypto = require("crypto");
const { newId } = require("../../shared/newId");
const INBOUND = require("./inbound");

const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES2_PLANT || "" : "";
const hash = t => crypto.createHash("sha256").update(String(t)).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

async function make(ctx, partnerId, who) {
  const [p] = await ctx.query(`SELECT id FROM sales_partners WHERE id = ? AND deleted_at IS NULL`, [partnerId]);
  if (!p) return { error: "not_found" };
  await ctx.run(`UPDATE sales_referral_links SET revoked_at = NOW() WHERE partner_id = ? AND revoked_at IS NULL`, [partnerId]);
  const token = crypto.randomBytes(32).toString("base64url");
  const id = newId("srl");
  await ctx.run(`INSERT INTO sales_referral_links (id, partner_id, token_hash, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)`, [id, partnerId, hash(token), who.id, who.name]);
  return { ok: true, id, token, path: `/refer/${token}`, says: "Copy this link now: Steward keeps only a fingerprint of it, so it can't be shown again. Making a new link turns this one off." };
}
async function revoke(ctx, partnerId) {
  const r = await ctx.run(`UPDATE sales_referral_links SET revoked_at = NOW() WHERE partner_id = ? AND revoked_at IS NULL`, [partnerId]);
  return { ok: true, revoked: r.changes };
}
async function linkOf(query, token) {
  if (!TOKEN_RE.test(String(token || ""))) return null;
  const [l] = await query(`SELECT l.id, l.partner_id, p.name FROM sales_referral_links l JOIN sales_partners p ON p.id = l.partner_id AND p.deleted_at IS NULL
                            WHERE l.token_hash = ? AND l.revoked_at IS NULL`, [hash(token)]);
  return l || null;
}

// The public page's read: the partner's name, and nothing else.
async function publicRead(query, token) {
  const l = await linkOf(query, token);
  if (!l) return null;
  const out = { ok: true, partner: l.name, says: `Referred by ${l.name}` };
  if (PLANT === "refleak") out.deals = (await query(`SELECT d.name FROM sales_deal_partners dp JOIN sales_deals d ON d.id = dp.deal_id WHERE dp.partner_id = ?`, [l.partner_id])).map(d => d.name);
  return out;
}

// The public form. b: { orgName, contactName, email, phone, note, website (the honeypot) }
async function publicSubmit(ctx, token, b) {
  const l = await linkOf(ctx.query, token);
  if (!l) return { error: "not_found" };
  if (String(b.website || "").trim()) return { ok: true, honeypot: true };   // a bot filled the hidden field: same answer, nothing written
  const orgName = String(b.orgName || "").trim().slice(0, 200), contactName = String(b.contactName || "").trim().slice(0, 200);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
  if (!orgName) return { error: "invalid", field: "orgName", message: "The organization's name." };
  if (!contactName) return { error: "invalid", field: "contactName", message: "Who to talk to there." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "invalid", field: "email", message: "A working email address for them." };
  const r = await INBOUND.note(ctx, { source: "partner", name: contactName, email, phone: String(b.phone || "").slice(0, 40), orgName,
    note: String(b.note || "").slice(0, 2000), partnerId: l.partner_id, referralLinkId: l.id }, { id: `system:referral-link/${l.id}`, name: `Referral link (${l.name})` });
  return r.error ? r : { ok: true };
}

// The partner's own page: links, and referrals in → meetings → won → MRR → owed.
async function partnerStats(query, partnerId, report) {
  const [links, deals] = await Promise.all([
    query(`SELECT id, created_at, revoked_at, created_by_name FROM sales_referral_links WHERE partner_id = ? ORDER BY created_at DESC`, [partnerId]),
    query(`SELECT d.id, d.name, d.won_at, s.name AS stage_name,
                  EXISTS (SELECT 1 FROM sales_activity_links al JOIN sales_activities a ON a.id = al.activity_id AND a.deleted_at IS NULL AND a.kind = 'meeting'
                           WHERE al.record_type = 'deal' AND al.record_id = d.id) AS met
             FROM sales_deals d JOIN sales_referral_links l ON l.id = d.referral_link_id LEFT JOIN sales_stages s ON s.id = d.stage_id
            WHERE l.partner_id = ? AND d.deleted_at IS NULL ORDER BY d.created_at DESC`, [partnerId]),
  ]);
  return { links, deals, referralsIn: deals.length, meetings: deals.filter(d => d.met).length, won: deals.filter(d => d.won_at).length,
    mrrCents: report ? report.mrrBroughtCents : 0, owedCents: report ? report.owedCents : 0,
    sentences: { referralsIn: "Deals that came in through this partner's referral links.", meetings: "Of those, deals with a meeting logged.",
      won: "Of those, deals that reached a won stage.", mrr: "MRR now of the paying Steward orgs this partner's deals became (the partner report's figure).",
      owed: "What the payout ledger says this partner has earned to this month." } };
}

// A referral Jonathan logs from a customer. b: { fromOrgId, orgName, contactName, email, phone, note }
async function fromCustomer(ctx, b, who) {
  const [from] = await ctx.query(`SELECT id, name FROM sales_orgs WHERE id = ? AND deleted_at IS NULL`, [String(b.fromOrgId || "")]);
  if (!from) return { error: "not_found", message: "That customer doesn't exist." };
  if (!String(b.orgName || "").trim() && !String(b.contactName || "").trim()) return { error: "invalid", message: "Who did they refer? An organization or a person." };
  return INBOUND.note(ctx, { source: "customer", name: b.contactName, email: b.email, phone: b.phone, orgName: b.orgName,
    note: [`Referred by ${from.name}`, String(b.note || "").trim()].filter(Boolean).join(". "), referredByOrgId: from.id }, who);
}

module.exports = { make, revoke, linkOf, publicRead, publicSubmit, partnerStats, fromCustomer, hash, PLANT };
