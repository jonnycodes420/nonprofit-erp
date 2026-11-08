// server/receipts/list.js · TRUTH-3 item 8 (W-1107-Atlas-17). EVERY ISSUED RECEIPT, IN ONE LIST.
//
// Tax Receipts listed nothing: a receipt could be found only from its
// person's profile. GET /receipts is every receipt the org issued, newest
// first, with search (a name, an email, a receipt number, a year), each with
// its PDF (GET /receipts/:id/pdf) and its void (POST /receipts/:id/void, which
// always keeps a note: TRUTH-2). Read-only; no pdf_data in the list.
//   GET /receipts?q=&status=all|active|voided&limit=
"use strict";
const express = require("express");
const routers = { r1: express.Router() };

function mount(ctx) {
  const { query, requireAuth, wrap } = ctx;
  routers.r1.get("/receipts", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const q = String(req.query.q || "").trim().slice(0, 100);
    const status = ["active", "voided"].includes(String(req.query.status)) ? String(req.query.status) : "all";
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const args = [orgId];
    let where = "r.org_id = ?";
    if (status === "active") where += " AND r.voided_at IS NULL";
    if (status === "voided") where += " AND r.voided_at IS NOT NULL";
    if (q) {
      const like = `%${q.toLowerCase().replace(/[\\%_]/g, m => "\\" + m)}%`;
      where += " AND (LOWER(COALESCE(d.name,'')) LIKE ? OR LOWER(COALESCE(r.sent_to,'')) LIKE ? OR LOWER(COALESCE(d.email,'')) LIKE ? OR LOWER(COALESCE(r.receipt_number::text,'')) LIKE ? OR COALESCE(r.tax_year::text,'') = ?)";
      args.push(like, like, like, like, q);
    }
    const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM receipts r LEFT JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id WHERE ${where}`, args);
    const rows = await query(
      `SELECT r.id, r.donor_id, d.name AS donor_name, r.gift_id, r.type, r.tax_year, r.receipt_number, r.amount, r.deductible_amount,
              r.sent_to, r.sent_at, r.voided_at, r.void_reason, r.created_at, (r.pdf_data IS NOT NULL) AS has_pdf
         FROM receipts r LEFT JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id
        WHERE ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, [...args, limit]);
    const [org] = await query("SELECT receipts_enabled FROM orgs WHERE id = ?", [orgId]);
    res.json({ receipts: rows.map(r => ({ ...r, amount: Number(r.amount), deductible_amount: r.deductible_amount == null ? null : Number(r.deductible_amount) })),
      total: n, shown: rows.length, receiptsEnabled: !!(org && org.receipts_enabled),
      sentence: `${n.toLocaleString("en-US")} ${n === 1 ? "receipt" : "receipts"}${q ? ` match "${q}"` : " issued"}${rows.length < n ? `, the newest ${rows.length} shown` : ""}. A voided receipt keeps its number and its note; a number is never issued twice.`,
      whenOff: "With receipts on, every online gift gets its tax receipt by email the moment it arrives, an offline gift gets one when you press Send receipt, and each one is listed here with its PDF. Turning them on needs your legal name, EIN and receipt address." });
  }));
  return {};
}

module.exports = { routers, mount };
