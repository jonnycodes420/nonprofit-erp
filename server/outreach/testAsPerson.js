// server/outreach/testAsPerson.js · FLOWS-3 (W-1107-Fundraising-17). "Send me a
// test" goes to her, but reads as the person the editor is previewing, so the
// test and the preview say the same thing: a never-giver's copy has the
// no-gift sentence in the body and the subject (shared/giftSentence.js), never
// a sample "$250" gift. Any person on file can be the one previewed, donor or
// not. With nobody named it keeps the sample fields it always used.
"use strict";

async function personFields(query, orgId, donorId) {
  if (!donorId || donorId === "me") return null;
  const [d] = await query(`SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [String(donorId), orgId]);
  if (!d) return null;
  // FLOWS-19 item 1: the gift, its date and the names come from emailCompose.personFields,
  // the fill the send, the editor's preview and the starter cards use (lastGift.js's rule).
  const f = await require("../../emailCompose").personFields({ orgId, orgName: "", base: "", orgSlug: "" }, d);
  const out = { first_name: f.first_name, greeting: f.greeting, full_name: d.name || "",
    last_gift_amount: f.last_gift_amount || "", last_gift_date: f.last_gift_date || "" };
  return { person: { id: d.id, name: d.name }, fields: out };
}

module.exports = { personFields };
