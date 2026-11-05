// server/donors/receiptEmail.js · FLOWS-1 item 4. A RECEIPT OR STATEMENT IS
// MADE FIRST, AND EMAILED ONLY ON A CLICK.
//
// The profile's Year-end statement generated AND emailed in one press, then
// closed with nothing on screen; Send receipt did the same for one gift. Now
// each one is made (shown, with Download), and this route is the separate
// "Email it" click: it sends the exact PDF already issued (resendReceiptEmail,
// never regenerated), through the mail decision and the staff confirm.
"use strict";

function register(app, { query, requireAuth, checkWriteAccess, wrap, actor, resendReceiptEmail }) {
  app.post("/receipts/:id/email", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const [receipt] = await query("SELECT * FROM receipts WHERE id=? AND org_id=? AND voided_at IS NULL", [req.params.id, orgId]);
    if (!receipt) return res.status(404).json({ error: "not_found", sentence: "That receipt is not on file, or it was voided." });
    const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
    const [donor] = await query("SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [receipt.donor_id, orgId]);
    if (!donor) return res.status(404).json({ error: "not_found", sentence: "That person is no longer in Steward." });
    const what = receipt.type === "year_end" ? `The ${receipt.tax_year} statement` : `Receipt #${receipt.receipt_number}`;
    if (!donor.email) return res.status(409).json({ error: "no_email", sentence: `${donor.name} has no email on file. Download it and send it another way.` });
    const sent = await resendReceiptEmail(receipt, org, donor, actor(req));
    if (!sent) return res.status(409).json({ error: "not_sent", sentence: `${what} was not emailed: ${donor.email} can't be mailed from here. Download it instead.` });
    res.json({ ok: true, sentTo: donor.email, sentence: `${what} was emailed to ${donor.email}.` });
  }));
}

module.exports = { register };
