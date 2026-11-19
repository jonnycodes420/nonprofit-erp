// server/outreach/previewPerson.js · FLOWS-19 item 1 (W-1118-Fundraising-T1, a third night).
// ONE PERSON, FILLED THE WAY THE EMAIL WILL BE.
//
// New campaign's starter cards read "Hello Silas, Thank you for your gift of
// $25" while the editor and the saved draft read his last real gift, $5,801.
// The cards were filled from their own query (GET /campaigns/templates: the
// person with the newest gift ROW, and that row's amount), and his newest row
// was a $25 gift refunded in full. FLOWS-14 fixed the segment preview's read
// (lastGiftRow) and FLOWS-18 the starter's merge tag and the block engine;
// neither touched the gallery's own SQL, which is a third reader of "the gift".
//
// Now every preview of a starter or template takes its person from here, and
// the gift and name come from emailCompose.personFields, the function the send,
// the editor's preview and a saved draft render with (shared/numbers/lastGift.js,
// FLOWS-11's rule: above $0, not a refund, not refunded in full, with the old
// system's last gift as the floor).
//   newestGiver(query, orgId)            the person whose last REAL gift is newest
//   previewPerson(query, orgId, donor)   { id, name, firstName, giftAmount, totalGiving }
"use strict";
const emailCompose = require("../../emailCompose");
const { GIFT } = require("../../shared/numbers/money");
const { LAST_GIFT_ORDER } = require("../../shared/numbers/lastGift");

// The sample person a card shows before there is a list: the newest giver, by
// their last real gift (a refund row or a refunded gift never picks them).
async function newestGiver(query, orgId) {
  const [d] = await query(
    `SELECT d.id, d.name, d.email, d.total_giving FROM donors d JOIN gifts g ON g.donor_id = d.id AND g.org_id = d.org_id
      WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.erased_at IS NULL AND COALESCE(d.name, '') <> ''
        AND g.date IS NOT NULL AND ${GIFT("g")}
      ORDER BY ${LAST_GIFT_ORDER} LIMIT 1`, [orgId]).catch(() => []);
  return d || null;
}

// What a preview fills for one person. `giftAmount` is "" for somebody with no
// gift (the renderer then leaves the thank-you sentence out, TRUST-1).
async function previewPerson(query, orgId, donor) {
  if (!donor || !donor.id) return null;
  const f = await emailCompose.personFields({ orgId, orgName: "", base: "", orgSlug: "" }, donor);
  const money = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const name = String(donor.name || "").trim();
  return {
    id: donor.id, name,
    firstName: f.first_name || name.split(/\s+/)[0] || "",
    giftAmount: f.last_gift_amount || "",
    ...(Number(donor.total_giving) > 0 ? { totalGiving: money(donor.total_giving) } : {}),
  };
}

module.exports = { newestGiver, previewPerson };
