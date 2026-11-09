// server/outreach/testAsPerson.js · FLOWS-3 (W-1107-Fundraising-17). "Send me a
// test" goes to her, but reads as the person the editor is previewing, so the
// test and the preview say the same thing: a never-giver's copy has the
// no-gift sentence in the body and the subject (shared/giftSentence.js), never
// a sample "$250" gift. Any person on file can be the one previewed, donor or
// not. With nobody named it keeps the sample fields it always used.
"use strict";
const NUMBERS = require("../../shared/numbers");

async function personFields(query, orgId, donorId) {
  if (!donorId || donorId === "me") return null;
  const [d] = await query(`SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [String(donorId), orgId]);
  if (!d) return null;
  const GR = await import("../../shared/greeting.js");
  const first = String(d.name || "").trim().split(/\s+/)[0] || "";
  const lg = (await NUMBERS.lastGift.lastGifts(query, orgId, [d.id]).catch(() => new Map())).get(d.id);
  const out = { first_name: GR.firstNames(d) || first, greeting: GR.greetingName(d) || first, full_name: d.name || "",
    last_gift_amount: "", last_gift_date: "" };
  if (lg) {
    out.last_gift_amount = "$" + (lg.cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "");
    const day = String(lg.date instanceof Date ? lg.date.toISOString() : lg.date || "").slice(0, 10);
    if (day) out.last_gift_date = new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  return { person: { id: d.id, name: d.name }, fields: out };
}

module.exports = { personFields };
