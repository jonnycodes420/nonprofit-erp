// server/receipts/householdStatement.js · FLOWS-11 item 3 (W-1114-Finance-29). ONE YEAR-END
// STATEMENT FOR A HOUSEHOLD.
//
// "The Two Household" gave $100 combined ($60 by House One, $40 by House Two), and the only
// statements Steward made were per person: #00007 for $60 and #00008 for $40. The combined $100
// was on neither. A household that files together asks for one statement.
//
// This is the STATEMENT only. Tax receipts stay per giver (receipts-and-tax.md: one receipt per
// gift, to the person who gave it), and the per-person statement stays exactly as it is. The
// household statement lists each member's gifts under their name and the combined total, footed
// in cents by statementTotals.js, the per-person statement's own function, so the household's
// total is always the members' statements added up.
//
// It is stored as its own receipt type, `household_year_end`, on the primary member's record with
// `household_id`, so it never takes the place of anyone's own statement
// (receipts_active_statement_uk covers `year_end` only). Making it again voids the earlier one, as
// the per-person statement does.
"use strict";
const { toDollars } = require("../../money");
const { statementLines } = require("../../statementTotals");

const TYPE = "household_year_end";

// The members, the primary first, and whether they share one mailing address (the default choice).
async function householdChoice(query, orgId, householdId) {
  const [hh] = await query("SELECT id, name, primary_donor_id FROM households WHERE id = ? AND org_id = ?", [householdId, orgId]);
  if (!hh) return null;
  const members = await query(`SELECT id, name, email, address, address2, city, state, zip FROM donors
                                WHERE org_id = ? AND household_id = ? AND deleted_at IS NULL
                                ORDER BY (id = ?) DESC, name, id`, [orgId, householdId, hh.primary_donor_id || ""]);
  const key = m => [m.address, m.address2, m.city, m.state, m.zip].map(x => String(x || "").trim().toLowerCase().replace(/\s+/g, " ")).join("|");
  const withAddr = members.filter(m => String(m.address || "").trim());
  const shared = members.length > 1 && withAddr.length === members.length && new Set(members.map(key)).size === 1;
  return {
    household: { id: hh.id, name: hh.name, primaryId: hh.primary_donor_id || (members[0] && members[0].id) || null },
    members: members.map(m => ({ id: m.id, name: m.name })),
    sharedAddress: shared,
    defaultChoice: shared ? "household" : "person",
    sentence: shared
      ? `${members.length === 2 ? "Both" : `All ${members.length}`} share one mailing address, so one statement for the household is the default. Each person's own statement is still there.`
      : "They don't share one mailing address on file, so each person's own statement is the default. One statement for the household is still there.",
  };
}

// The statement's money: each member's lines (with the giver named) and the combined totals, in cents.
async function householdLines(query, orgId, members, year) {
  const per = [];
  for (const m of members) {
    const gifts = await query(`SELECT * FROM gifts WHERE org_id = ? AND donor_id = ? AND (is_sample IS NOT TRUE)
                                 AND date >= ? AND date <= ? ORDER BY date ASC, id`, [orgId, m.id, `${year}-01-01`, `${year}-12-31`]);
    const ST = statementLines(gifts, { year: true });
    per.push({ id: m.id, name: m.name, gifts: gifts.length, ...ST });
  }
  const totalCents = per.reduce((n, p) => n + p.totalCents, 0);
  const deductibleCents = per.reduce((n, p) => n + p.deductibleCents, 0);
  return { per, totalCents, deductibleCents, giftCount: per.reduce((n, p) => n + p.gifts, 0) };
}

function mountHousehold(app, ctx) {
  const { requireAuth, checkWriteAccess, wrap, query, run, actor, allocateReceiptNumber, resolveOrgBrandTheme, resolvePdfLogo,
          applyReceiptTokens, renderReceiptPdf, orgTime, orgToday, orgTz, TF, sendReceiptEmail, donorMailDecision } = ctx;

  app.get("/households/:id/statement-choice", requireAuth, wrap(async (req, res) => {
    const c = await householdChoice(query, req.user.orgId, req.params.id);
    if (!c) return res.status(404).json({ error: "Household not found" });
    res.json(c);
  }));

  // What the household's statement for `year` would say, written nowhere (the truth check reads it).
  app.get("/households/:id/year-end-statement/preview", requireAuth, wrap(async (req, res) => {
    const year = parseInt(req.query.year, 10);
    if (!year) return res.status(400).json({ error: "year required" });
    const c = await householdChoice(query, req.user.orgId, req.params.id);
    if (!c) return res.status(404).json({ error: "Household not found" });
    const L = await householdLines(query, req.user.orgId, c.members, year);
    res.json({ household: c.household, year, totalCents: L.totalCents, deductibleCents: L.deductibleCents,
               members: L.per.map(p => ({ id: p.id, name: p.name, totalCents: p.totalCents, lines: p.lines.length })) });
  }));

  app.post("/households/:id/year-end-statement", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const year = parseInt(req.body && req.body.year, 10);
    if (!year) return res.status(400).json({ error: "year required" });
    const [org] = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
    if (!org.receipts_enabled) return res.status(400).json({ error: "Tax receipts are not enabled for this org yet, set it up in Settings first." });
    const c = await householdChoice(query, orgId, req.params.id);
    if (!c) return res.status(404).json({ error: "Household not found" });
    const L = await householdLines(query, orgId, c.members, year);
    if (!L.giftCount) return res.status(400).json({ error: `No gifts found for ${year} from anyone in ${c.household.name}.` });
    const out = await issue(org, c, L, year, { by: actor(req), send: req.body.send === true });
    res.status(201).json(out);
  }));

  // The statement itself, made (or made again: RECEIPTS-1's Reissue passes `receiptNumber`).
  function issue(org, c, L, year, { by, send = false, receiptNumber: reissueAs = null }) {
    const orgId = org.id;
    return require("../shared/personLock").withPersonLock("year-end", orgId, `${c.household.id}:${year}`, async () => {
      await run(`UPDATE receipts SET voided_at = NOW(), void_reason = 'Superseded by a newly generated statement'
                  WHERE org_id = ? AND household_id = ? AND tax_year = ? AND type = ? AND voided_at IS NULL`, [orgId, c.household.id, year, TYPE]);
      const lineItems = [];
      for (const p of L.per) for (const l of p.lines) {
        lineItems.push({ date: l.date ? orgTime.formatCivil(l.date) : "", amount: toDollars(l.amountCents), deductibleAmount: toDollars(l.deductibleCents),
                         paymentMethod: l.paymentMethod, giver: p.name });
      }
      const [primary] = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [c.household.primaryId, orgId]);
      const receiptNumber = reissueAs || await allocateReceiptNumber(orgId);
      const brand = await resolveOrgBrandTheme(orgId).catch(() => null);
      const snapshot = {
        type: "year_end", household: true,
        orgLegalName: org.legal_name || org.name,
        orgAccent: brand ? brand.band : null, orgAccentFg: brand ? brand.bandFg : null,
        orgLogo: await resolvePdfLogo(brand),
        orgEin: (await import("../../shared/placeholderCopy.js")).publicEin(org.ein),
        orgAddress: org.receipt_address || "",
        signatureName: org.receipt_signature_name || "", signatureTitle: org.receipt_signature_title || "",
        customMessage: applyReceiptTokens(org.receipt_custom_message, org, primary || { name: c.household.name }),
        taxLanguage: org.tax_language || null,
        receiptNumber,
        issueDate: orgTime.formatCivil(orgToday(await orgTz(orgId))),   // ORG_TZ_SEAM_OK
        donorName: c.household.name,
        // RECEIPTS-1: the household's mailing address: the one its members share, else the primary member's.
        ...(await require("./receiptParts").donorBlock(primary)),
        taxYear: year,
        lineItems,
        members: L.per.map(p => ({ name: p.name, totalAmount: toDollars(p.totalCents), gifts: p.lines.length })),
        totalAmount: toDollars(L.totalCents), totalDeductible: toDollars(L.deductibleCents),
      };
      if (TF.isDemoOrg(org)) snapshot.demo = true;
      const pdf = await renderReceiptPdf(snapshot);
      const id = require("../shared/newId").newId("rcpt");
      await run(`INSERT INTO receipts (id, org_id, donor_id, household_id, gift_id, type, tax_year, receipt_number, amount, deductible_amount, snapshot, pdf_data, created_by, created_by_name)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, orgId, c.household.primaryId, c.household.id, null, TYPE, year, receiptNumber, snapshot.totalAmount, snapshot.totalDeductible,
         JSON.stringify(snapshot), pdf.toString("base64"), by.id, by.name]);
      if (send && primary && primary.email) {
        const decision = await donorMailDecision("year_end", primary.email, orgId, { donorId: primary.id });
        if (decision.send && await sendReceiptEmail(org, primary, snapshot, pdf, `${year}-household-giving-statement.pdf`)) {
          await run("UPDATE receipts SET sent_to = ?, sent_at = NOW() WHERE id = ?", [primary.email, id]);
        }
      }
      const [row] = await query("SELECT * FROM receipts WHERE id = ?", [id]);
      return row;
    });
  }
  return { issueHouseholdStatement: issue };
}

module.exports = { mountHousehold, householdChoice, householdLines, TYPE };
