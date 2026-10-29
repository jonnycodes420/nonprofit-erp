// exportGuard.js — SECURE-2 item 8. A LARGE EXPORT BY STAFF NEEDS AN ADMIN.
//
// A file of more than 1,000 people taken by someone who is not an admin is
// refused with one sentence, unless an admin has allowed it for the whole
// organization in Settings (orgs.allow_staff_large_exports, off by default).
// An admin can always take it. There is no approval queue: the admin either
// takes the file, or switches the setting on. Every export, allowed or not,
// is already in the audit log (middleware/auditTrail.js).
"use strict";
const { query } = require("./db");

const LARGE_EXPORT = 1000;
const LARGE_EXPORT_SENTENCE = "Exports of more than 1,000 people need an admin's OK. Ask an admin, or an admin can allow it in Settings.";

// true when the request was refused (the answer is already sent).
async function largeExportRefused(req, res, n) {
  if (!(Number(n) > LARGE_EXPORT)) return false;
  if (!req.user || req.user.role === "admin" || req.user.isSuperAdmin) return false;
  const [o] = await query("SELECT allow_staff_large_exports FROM orgs WHERE id=?", [req.user.orgId]);
  if (o && o.allow_staff_large_exports) return false;
  res.status(403).json({ error: "large_export_needs_admin", message: LARGE_EXPORT_SENTENCE, count: Number(n), limit: LARGE_EXPORT });
  return true;
}

module.exports = { LARGE_EXPORT, LARGE_EXPORT_SENTENCE, largeExportRefused };
