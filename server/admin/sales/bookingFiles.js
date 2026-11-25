// server/admin/sales/bookingFiles.js · ONBOARD-4 Part B. THE FILE SHE ATTACHED WHEN SHE BOOKED.
//
// A booking from /book (Part A's sales_bookings) may carry her donor file. Once she signs,
// the org's guided setup offers it ("already waiting") and "Send it to us" makes it a
// concierge job (server/onboard/concierge.js). A booking is this org's when its sales
// organization is linked to the org (sales_orgs.steward_org_id), or its email is one of the
// org's admins'. A file already made into a job is not offered again. Here, because only
// server/admin/sales/ reads the sales_ tables (tests/tenant-isolation.test.js).
"use strict";
const MISSING = new Set(["42P01", "42703"]);
const quiet = e => { if (e && MISSING.has(e.code)) return []; throw e; };

async function waitingFor(query, orgId) {
  return query(`SELECT b.id, b.file_name, b.file_size, b.created_at FROM sales_bookings b
                 WHERE b.file_data IS NOT NULL
                   AND (b.sales_org_id IN (SELECT id FROM sales_orgs WHERE steward_org_id = ?)
                        OR lower(b.email) IN (SELECT lower(email) FROM users WHERE org_id = ? AND role = 'admin' AND deactivated_at IS NULL))
                   AND NOT EXISTS (SELECT 1 FROM onboard_concierge_jobs j WHERE j.booking_id = b.id)
                 ORDER BY b.created_at DESC LIMIT 5`, [orgId, orgId]).catch(quiet);
}

async function fileFor(query, orgId, bookingId) {
  if (!(await waitingFor(query, orgId)).some(b => b.id === bookingId)) return null;
  const [b] = await query(`SELECT id, file_name, file_type, file_data FROM sales_bookings WHERE id = ?`, [bookingId]);
  return b || null;
}

module.exports = { waitingFor, fileFor };
