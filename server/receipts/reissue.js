// server/receipts/reissue.js · RECEIPTS-1 item 3. VOID AND REISSUE, SAME NUMBER WITH A SUFFIX.
//
// Every receipt issued before RECEIPTS-1 printed the org's address under the donor's name. Nothing
// is reissued automatically (scripts/ops/receipts1-org-address-receipts.js counts them for
// Jonathan). An org that wants a corrected copy presses Reissue on the receipt in Settings → Tax
// Receipts → Issued receipts: the receipt is voided with a note naming its successor, and the same
// gift (or statement year) is receipted again under the same number with a suffix, 2026-00027 →
// 2026-00027-R1. The new PDF is made, not emailed: "Email it" is its own click (FLOWS-1).
//
//   POST /receipts/:id/reissue   (registered once, in drift.js: admin) → 201 { receipt, voidedId, sentence }
"use strict";
const RP = require("./receiptParts");

function register(app, ctx) {
  const { query, run, actor,
          issueGiftReceipt, issueYearEndStatement, issueHouseholdStatement, householdChoice, householdLines } = ctx;

  // One route (drift.js registers POST /receipts/:id/reissue); with no drift it calls this.
  sameNumber = async (req, res) => {
    const orgId = req.user.orgId;
    const [old] = await query("SELECT * FROM receipts WHERE id = ? AND org_id = ? AND voided_at IS NULL", [req.params.id, orgId]);
    if (!old) return res.status(404).json({ error: "not_found", sentence: "That receipt is not on file, or it was already voided." });
    const [org] = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
    if (!org.receipts_enabled) return res.status(409).json({ error: "receipts_off", sentence: "Tax receipts are off for this organization, so nothing can be reissued. Turn them on in Settings first." });
    const base = String(old.receipt_number || "").replace(/-R\d+$/, "");
    const taken = (await query("SELECT receipt_number FROM receipts WHERE org_id = ? AND receipt_number LIKE ?", [orgId, `${base}-R%`])).map(r => r.receipt_number);
    const number = RP.reissueNumber(old.receipt_number, taken);
    const by = actor(req);
    const note = `Reissued as #${number} by ${by.name}.`;
    const refuse = sentence => res.status(409).json({ error: "not_reissued", sentence });

    let made = null;
    if (old.type === "gift") {
      const [gift] = await query("SELECT * FROM gifts WHERE id = ? AND org_id = ?", [old.gift_id || "", orgId]);
      if (!gift) return refuse(`The gift behind receipt #${old.receipt_number} is no longer on file, so it cannot be reissued.`);
      const [donor] = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [gift.donor_id, orgId]);
      if (!donor) return refuse("The person this gift is from is no longer on file.");
      const nc = RP.nonCash(gift);
      if (nc && !nc.description) return refuse(RP.NO_DESCRIPTION_MESSAGE);
      // The old one steps aside first (one active receipt per gift), and comes back if nothing was made.
      await run("UPDATE receipts SET voided_at = NOW(), void_reason = ? WHERE id = ? AND org_id = ? AND voided_at IS NULL", [note, old.id, orgId]);
      const out = await issueGiftReceipt(gift, org, donor, { send: false, by, manual: true, receiptNumber: number });
      if (!out.receipt || !out.created) {
        await run("UPDATE receipts SET voided_at = NULL, void_reason = NULL WHERE id = ? AND org_id = ?", [old.id, orgId]);
        return refuse(`Receipt #${old.receipt_number} was left as it was: this gift can't be receipted now (${String(out.skipped || "unknown").replace(/_/g, " ")}).`);
      }
      made = out.receipt;
    } else if (old.type === "year_end") {
      const [donor] = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [old.donor_id, orgId]);
      if (!donor) return refuse("The person this statement is for is no longer on file.");
      const out = await issueYearEndStatement(org, donor, Number(old.tax_year), { send: false, by, receiptNumber: number });
      if (!out.receipt) return refuse(`The ${old.tax_year} statement was left as it was: there are no gifts for ${old.tax_year} on file now.`);
      made = out.receipt;
    } else if (old.type === "household_year_end") {
      const c = await householdChoice(query, orgId, old.household_id || "");
      if (!c) return refuse("The household this statement is for is no longer on file.");
      const L = await householdLines(query, orgId, c.members, Number(old.tax_year));
      if (!L.giftCount) return refuse(`The ${old.tax_year} household statement was left as it was: there are no gifts for ${old.tax_year} on file now.`);
      made = await issueHouseholdStatement(org, c, L, Number(old.tax_year), { by, send: false, receiptNumber: number });
    } else {
      return refuse("This kind of receipt can't be reissued here.");
    }
    // A statement's own path voided the old one as "Superseded"; the note says what replaced it.
    await run("UPDATE receipts SET void_reason = ? WHERE id = ? AND org_id = ?", [note, old.id, orgId]);
    const { pdf_data: _pdf, ...receipt } = made;   // the PDF is fetched on its own (GET /receipts/:id/pdf)
    res.status(201).json({ receipt, voidedId: old.id,
      sentence: `Receipt #${old.receipt_number} was voided and reissued as #${number}. Nothing was emailed: download it here, or email it from the person's Giving tab.` });
  };
}

let sameNumber = null;
// drift.js's route, for a receipt whose gift has not changed. Write access as the drift path asks.
function reissueSameNumber(req, res, next) {
  if (!sameNumber) return res.status(503).json({ error: "not_ready", sentence: "Steward is still starting. Try again in a moment." });
  return sameNumber(req, res, next);
}

module.exports = { register, reissueSameNumber };
