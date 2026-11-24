// server/donors/giftShape.js · GIFTS-3 item 1. ONE SHAPE FOR A GIFT'S WRITE.
//
// The gift form (POST /donors/:id/gifts) and its edit (PUT /gifts/:id) were two
// readers of two bodies: the edit had no appeal or fundraiser page, kept the word
// "Needs you" as if it were a method, and a campaign typed and never picked was
// dropped by one and stored as loose text by the other. Both routes now read
// their body here, so a field either route knows, both know.
//
// readGiftBody(body) → the fields the body SENT, in one spelling. A field the
// body did not send is absent (undefined), which the edit reads as "keep it" and
// the form reads as "none". `null` / "" sent for a reference clears it.
//
// resolveTypedCampaign: a campaign named in words with no campaign chosen is
// either exactly one campaign of this org (case and spaces aside) or it is
// refused with the sentence the form shows: "No campaign called 'Spring'.
// Create it?" A typed name is never stored as loose text and never dropped.
"use strict";

let GM = null;
const methods = async () => GM || (GM = await import("../../shared/giftMethods.js"));
const has = (b, ...ks) => ks.some(k => b[k] !== undefined);
const pick = (b, ...ks) => { for (const k of ks) if (b[k] !== undefined) return b[k]; return undefined; };
const ref = v => (v === undefined ? undefined : (v == null || String(v).trim() === "" ? null : String(v).trim()));

async function readGiftBody(body) {
  const b = body && typeof body === "object" ? body : {};
  const out = {};
  if (b.amount !== undefined) out.amount = b.amount;
  if (b.date !== undefined) out.date = b.date;
  if (b.type !== undefined) out.type = b.type || null;
  if (b.notes !== undefined) out.notes = b.notes == null ? "" : String(b.notes);
  if (has(b, "paymentMethod", "payment_method")) out.paymentMethod = (await methods()).methodValue(pick(b, "paymentMethod", "payment_method"));
  if (has(b, "fundId", "fund_id")) out.fundId = ref(pick(b, "fundId", "fund_id"));
  if (has(b, "campaignId", "campaign_id")) out.campaignId = ref(pick(b, "campaignId", "campaign_id"));
  if (b.campaign !== undefined) out.campaignText = String(b.campaign == null ? "" : b.campaign).replace(/\s+/g, " ").trim();
  if (has(b, "eventId", "event_id")) out.eventId = ref(pick(b, "eventId", "event_id"));
  if (has(b, "appealId", "appeal_id")) out.appealId = ref(pick(b, "appealId", "appeal_id"));
  if (has(b, "givingPageId", "giving_page_id")) out.givingPageId = ref(pick(b, "givingPageId", "giving_page_id"));
  if (has(b, "peerFundraiserId", "peer_fundraiser_id")) out.peerFundraiserId = ref(pick(b, "peerFundraiserId", "peer_fundraiser_id"));
  // THANKS-1: the form's box is "Thanked" (gifts.thanked_at). The old spelling still arrives from
  // older tabs and API callers, and always meant the same box.
  if (has(b, "thanked", "thanked")) out.thanked = b.thanked === true;
  else if (has(b, "acknowledgementSent", "acknowledgement_sent")) out.thanked = pick(b, "acknowledgementSent", "acknowledgement_sent") === true;
  if (b.anonymous !== undefined) out.anonymous = b.anonymous === true;
  if (b.pledgeId !== undefined) out.pledgeId = ref(b.pledgeId);
  return out;
}

// A campaign named in words, with no campaign chosen. → { campaignId } | { error, status, code }
async function resolveTypedCampaign(query, orgId, text) {
  const name = String(text || "").replace(/\s+/g, " ").trim();
  if (!name) return { campaignId: null };
  const rows = await query(
    `SELECT id FROM campaigns WHERE org_id=? AND LOWER(REGEXP_REPLACE(TRIM(name), '\\s+', ' ', 'g')) = LOWER(?) LIMIT 2`, [orgId, name]);
  if (rows.length === 1) return { campaignId: rows[0].id };
  if (rows.length > 1) return { status: 400, code: "campaign_ambiguous", error: `More than one campaign is called '${name}'. Pick one from the list.` };
  return { status: 400, code: "campaign_not_found", error: `No campaign called '${name}'. Create it?`, name };
}

// The campaign a body chose: its id as sent (undefined = not sent, null = cleared), or a
// campaign named in words resolved to its id, or the refusal.
async function chosenCampaign(query, orgId, G) {
  if (G.campaignId !== undefined || !G.campaignText) return { campaignId: G.campaignId };
  return resolveTypedCampaign(query, orgId, G.campaignText);
}

module.exports = { readGiftBody, resolveTypedCampaign, chosenCampaign };
