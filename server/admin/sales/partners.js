// server/admin/sales/partners.js · SALES-1 Part B. CHANNEL PARTNERS, THEIR TERMS, THE PAYOUT LEDGER.
//
// A partner (name, company, contact) has one or more terms: finder, closer,
// reseller or a custom name; a percent or a flat amount; recurring or one-time;
// a duration in months or no end; an optional cap. `terms_stack` says whether
// several of the partner's terms can apply to one deal, or only one (Ross's
// finder 10% OR closer 40%, never both). A deal records its partner and the
// term that applies, which can be overridden on that deal.
//
// The ledger: for each deal whose primary organization is linked to a PAYING
// Steward org, each month from the month it was won to this month, the term
// times the org's MRR (the Onboarding tab's own figure) gives what is owed,
// through shared/numbers/partnerPayout.js. A month is marked paid with a day
// and a note; a paid month keeps the amount it was paid at. Nothing is sent.
"use strict";
const { newId } = require("../../shared/newId");
const PAY = require("../../../shared/numbers/partnerPayout");
const M = require("./model");

const KINDS = ["finder", "closer", "reseller", "custom"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = "America/New_York";
const monthOf = (t, tz = TZ) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(new Date(t)).slice(0, 7);
const nextMonth = k => { const [y, m] = k.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
const monthsBetween = (a, b) => { const out = []; for (let k = a; k <= b && out.length < 240; k = nextMonth(k)) out.push(k); return out; };
const termName = t => (t.kind === "custom" ? t.custom_name || "Custom" : t.kind[0].toUpperCase() + t.kind.slice(1));
function termWords(t) {
  const amt = t.percent != null ? `${Number(t.percent)}% of MRR` : `$${(Number(t.flat_cents || t.flatCents || 0) / 100).toLocaleString("en-US")}`;
  const months = t.months == null ? "no end" : `${t.months} month${Number(t.months) === 1 ? "" : "s"}`;
  return `${amt}, ${t.recurring === false ? "one-time" : `monthly, ${months}`}${t.cap_cents != null || t.capCents != null ? `, cap $${(Number(t.cap_cents ?? t.capCents) / 100).toLocaleString("en-US")}` : ""}`;
}

function cleanTerm(b) {
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) return { error: "A term is a finder, closer, reseller or custom term." };
  if (kind === "custom" && !M.clean(b.custom_name)) return { error: "Name the custom term." };
  const pct = b.percent === "" || b.percent == null ? null : Number(b.percent);
  const flat = b.flat_cents === "" || b.flat_cents == null ? null : Math.round(Number(b.flat_cents));
  if ((pct == null) === (flat == null)) return { error: "A term is a percent or a flat amount, one of the two." };
  if (pct != null && !(pct > 0 && pct <= 100)) return { error: "A percent is more than 0 and at most 100." };
  if (flat != null && !(flat > 0)) return { error: "A flat amount is more than zero." };
  const months = b.months === "" || b.months == null ? null : Math.round(Number(b.months));
  if (months != null && !(months >= 1)) return { error: "A duration is at least one month, or none." };
  const cap = b.cap_cents === "" || b.cap_cents == null ? null : Math.round(Number(b.cap_cents));
  if (cap != null && !(cap > 0)) return { error: "A cap is more than zero, or none." };
  return { kind, custom_name: kind === "custom" ? M.clean(b.custom_name) : null, percent: pct, flat_cents: flat, recurring: b.recurring !== false, months, cap_cents: cap };
}

async function createPartner(ctx, b, who) {
  const name = M.clean(b.name);
  if (!name) return { error: "invalid", message: "Name the partner." };
  if (b.contact_email && !M.emailOf(b.contact_email)) return { error: "invalid", message: "That isn't an email address." };
  const id = newId("spt");
  await ctx.run(`INSERT INTO sales_partners (id, name, company, contact_name, contact_email, phone, notes, terms_stack, created_by, created_by_name, updated_by, updated_by_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, M.clean(b.company), M.clean(b.contact_name), M.emailOf(b.contact_email), M.clean(b.phone), b.notes ? String(b.notes).slice(0, 5000) : null, b.terms_stack === true, who.id, who.name, who.id, who.name]);
  for (const t of Array.isArray(b.terms) ? b.terms : []) { const r = await addTerm(ctx, id, t, who); if (r.error) return r; }
  return { ok: true, id };
}
async function updatePartner(ctx, id, b, who) {
  const sets = [], vals = [];
  for (const k of ["name", "company", "contact_name", "phone"]) if (k in b) { if (k === "name" && !M.clean(b.name)) return { error: "invalid", message: "Name the partner." }; sets.push(`${k} = ?`); vals.push(M.clean(b[k])); }
  if ("contact_email" in b) { if (b.contact_email && !M.emailOf(b.contact_email)) return { error: "invalid", message: "That isn't an email address." }; sets.push("contact_email = ?"); vals.push(M.emailOf(b.contact_email)); }
  if ("notes" in b) { sets.push("notes = ?"); vals.push(b.notes ? String(b.notes).slice(0, 5000) : null); }
  if ("terms_stack" in b) { sets.push("terms_stack = ?"); vals.push(b.terms_stack === true); }
  if (!sets.length) return { ok: true, id };
  const r = await ctx.run(`UPDATE sales_partners SET ${sets.join(", ")}, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`, [...vals, who.id, who.name, id]);
  return r.changes ? { ok: true, id } : { error: "not_found" };
}
async function removePartner(ctx, id, who) {
  const r = await ctx.run(`UPDATE sales_partners SET deleted_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`, [who.id, who.name, id]);
  return r.changes ? { ok: true } : { error: "not_found" };
}
async function addTerm(ctx, partnerId, b, who) {
  const t = cleanTerm(b || {});
  if (t.error) return { error: "invalid", message: t.error };
  const [p] = await ctx.query(`SELECT id FROM sales_partners WHERE id = ? AND deleted_at IS NULL`, [partnerId]);
  if (!p) return { error: "not_found" };
  const id = newId("stm");
  await ctx.run(`INSERT INTO sales_partner_terms (id, partner_id, kind, custom_name, percent, flat_cents, recurring, months, cap_cents, created_by, created_by_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, partnerId, t.kind, t.custom_name, t.percent, t.flat_cents, t.recurring, t.months, t.cap_cents, who.id, who.name]);
  return { ok: true, id };
}
async function removeTerm(ctx, termId) {
  const r = await ctx.run(`UPDATE sales_partner_terms SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`, [termId]);
  return r.changes ? { ok: true } : { error: "not_found" };
}

// Put a partner on a deal under one of its terms. When the partner's terms do
// not stack, a second term of the same partner on the same deal is refused.
async function attach(ctx, dealId, b, who) {
  const [deal] = await ctx.query(`SELECT id FROM sales_deals WHERE id = ? AND deleted_at IS NULL`, [dealId]);
  if (!deal) return { error: "not_found" };
  const [term] = await ctx.query(`SELECT t.id, t.partner_id, p.terms_stack, p.name FROM sales_partner_terms t JOIN sales_partners p ON p.id = t.partner_id
                                   WHERE t.id = ? AND t.deleted_at IS NULL AND p.deleted_at IS NULL`, [String(b.term_id || "")]);
  if (!term) return { error: "invalid", message: "Choose one of the partner's terms." };
  if (!term.terms_stack) {
    const [other] = await ctx.query(`SELECT id FROM sales_deal_partners WHERE deal_id = ? AND partner_id = ? AND term_id <> ?`, [dealId, term.partner_id, term.id]);
    if (other) return { error: "invalid", message: `The terms of ${term.name} don't stack: only one applies to a deal. Remove the other first, or let them stack on the partner.` };
  }
  const ov = k => (b[k] === "" || b[k] == null ? null : Number(b[k]));
  const id = newId("sdp");
  await ctx.run(`INSERT INTO sales_deal_partners (id, deal_id, partner_id, term_id, override_percent, override_flat_cents, override_months, override_cap_cents, created_by, created_by_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (deal_id, term_id) DO UPDATE SET override_percent = EXCLUDED.override_percent, override_flat_cents = EXCLUDED.override_flat_cents,
                   override_months = EXCLUDED.override_months, override_cap_cents = EXCLUDED.override_cap_cents`,
    [id, dealId, term.partner_id, term.id, ov("override_percent"), ov("override_flat_cents"), ov("override_months"), ov("override_cap_cents"), who.id, who.name]);
  return { ok: true };
}
async function detach(ctx, dealPartnerId) {
  const [paid] = await ctx.query(`SELECT COUNT(*)::int AS n FROM sales_payouts WHERE deal_partner_id = ?`, [dealPartnerId]);
  if (paid.n) return { error: "invalid", message: "Months on this term are marked paid, so it stays on the deal." };
  const r = await ctx.run(`DELETE FROM sales_deal_partners WHERE id = ?`, [dealPartnerId]);
  return r.changes ? { ok: true } : { error: "not_found" };
}

// Every deal-partner line with its deal, its paying org, its MRR and its months.
// mrrOf: { [stewardOrgId]: cents } from the Onboarding tab's figure (stewardLink.facts).
async function lines(query, { partnerId = null, dealId = null } = {}) {
  const where = ["p.deleted_at IS NULL", "d.deleted_at IS NULL"], vals = [];
  if (partnerId) { where.push("dp.partner_id = ?"); vals.push(partnerId); }
  if (dealId) { where.push("dp.deal_id = ?"); vals.push(dealId); }
  return query(`SELECT dp.id, dp.deal_id, dp.partner_id, dp.term_id, dp.override_percent, dp.override_flat_cents, dp.override_months, dp.override_cap_cents,
                       t.kind, t.custom_name, t.percent, t.flat_cents, t.recurring, t.months, t.cap_cents,
                       p.name AS partner_name, d.name AS deal_name, d.won_at, d.source, d.value_cents,
                       (SELECT o.steward_org_id FROM sales_links l JOIN sales_orgs o ON o.id = l.b_id AND o.deleted_at IS NULL
                         WHERE l.a_type = 'deal' AND l.a_id = d.id AND l.b_type = 'org' ORDER BY l.is_primary DESC LIMIT 1) AS steward_org_id
                  FROM sales_deal_partners dp JOIN sales_partner_terms t ON t.id = dp.term_id JOIN sales_partners p ON p.id = dp.partner_id
                  JOIN sales_deals d ON d.id = dp.deal_id
                 WHERE ${where.join(" AND ")} ORDER BY p.name, d.name`, vals);
}

// The ledger rows: one per line per month from the won month to this month, while the org pays.
function ledger(lineRows, mrrOf, paidRows, now = Date.now()) {
  const paid = new Map(paidRows.map(r => [`${r.deal_partner_id}|${r.month}`, r]));
  const thisMonth = monthOf(now);
  const out = [];
  for (const l of lineRows) {
    const mrr = l.steward_org_id ? Number(mrrOf[l.steward_org_id] || 0) : 0;
    const term = PAY.termOf(l, l);
    const label = `${termName(l)} · ${termWords({ ...l, percent: term.percent, flat_cents: term.flatCents, months: term.months, cap_cents: term.capCents })}`;
    if (!l.won_at || !mrr) { out.push({ lineId: l.id, partnerId: l.partner_id, partner: l.partner_name, dealId: l.deal_id, deal: l.deal_name, term: label, months: [], paying: false, mrrCents: mrr }); continue; }
    const months = monthsBetween(monthOf(l.won_at), thisMonth);
    const owed = PAY.owedByMonth(term, months, mrr).map(m => {
      const p = paid.get(`${l.id}|${m.month}`);
      return { ...m, owedCents: p ? Number(p.amount_cents) : m.cents, paid: p ? { on: String(p.paid_on).slice(0, 10), note: p.note, by: p.created_by_name } : null };
    }).filter(m => m.owedCents > 0 || m.paid);
    out.push({ lineId: l.id, partnerId: l.partner_id, partner: l.partner_name, dealId: l.deal_id, deal: l.deal_name, term: label, months: owed, paying: true, mrrCents: mrr });
  }
  return out;
}

async function markPaid(ctx, { lineId, month, paid_on, note, amount_cents }, who) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return { error: "invalid", message: "Say which month, like 2026-11." };
  if (!DAY_RE.test(String(paid_on || ""))) return { error: "invalid", message: "Paid on is a day, like 2026-11-30." };
  const [l] = await ctx.query(`SELECT id, partner_id, deal_id FROM sales_deal_partners WHERE id = ?`, [lineId]);
  if (!l) return { error: "not_found" };
  const cents = Math.round(Number(amount_cents));
  if (!(cents > 0)) return { error: "invalid", message: "The amount owed that month is zero; nothing to mark paid." };
  await ctx.run(`INSERT INTO sales_payouts (id, deal_partner_id, partner_id, deal_id, month, amount_cents, paid_on, note, created_by, created_by_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (deal_partner_id, month) DO UPDATE SET paid_on = EXCLUDED.paid_on, note = EXCLUDED.note`,
    [newId("spo"), l.id, l.partner_id, l.deal_id, month, cents, paid_on, note ? String(note).slice(0, 500) : null, who.id, who.name]);
  return { ok: true };
}
async function unmarkPaid(ctx, lineId, month) {
  const r = await ctx.run(`DELETE FROM sales_payouts WHERE deal_partner_id = ? AND month = ?`, [lineId, month]);
  return r.changes ? { ok: true } : { error: "not_found" };
}

// The partner report: deals sourced, won, MRR brought, owed, paid.
function report(partners, dealLines, ledgerRows) {
  return partners.map(p => {
    const mine = dealLines.filter(l => l.partner_id === p.id);
    const deals = [...new Set(mine.map(l => l.deal_id))];
    const won = [...new Set(mine.filter(l => l.won_at).map(l => l.deal_id))];
    const led = ledgerRows.filter(r => r.partnerId === p.id);
    const mrrByDeal = new Map(led.filter(r => r.paying).map(r => [r.dealId, r.mrrCents]));
    const owed = led.reduce((n, r) => n + r.months.reduce((a, m) => a + m.owedCents, 0), 0);
    const paid = led.reduce((n, r) => n + r.months.filter(m => m.paid).reduce((a, m) => a + m.owedCents, 0), 0);
    return { partnerId: p.id, name: p.name, dealsSourced: deals.length, dealsWon: won.length,
      mrrBroughtCents: [...mrrByDeal.values()].reduce((a, b) => a + b, 0), owedCents: owed, paidCents: paid, dueCents: owed - paid };
  });
}
const REPORT_SENTENCES = {
  dealsSourced: "Deals this partner is on, under any term.",
  dealsWon: "Of those, deals that reached a won stage.",
  mrrBrought: "The MRR now (the Onboarding tab's figure) of the paying Steward orgs those deals became, each org once.",
  owed: "Everything the ledger says this partner has earned to this month.",
  paid: "Of that, the months marked paid, at the amount they were paid at.",
  due: "Owed minus paid.",
  ledger: PAY.SENTENCE,
};

module.exports = { KINDS, cleanTerm, createPartner, updatePartner, removePartner, addTerm, removeTerm, attach, detach, lines, ledger, markPaid, unmarkPaid,
  report, REPORT_SENTENCES, termName, termWords, monthOf, monthsBetween };
