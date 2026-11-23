// client/src/lib/giftForm.js · GIFTS-3. ONE GIFT FORM'S STATE, ONE BODY FOR CREATE AND EDIT.
//
// The profile's New gift and a gift's Edit were two forms with two states and
// two bodies; the edit lacked Campaign, Appeal, the fundraiser page, the soft
// credit, tribute and match, and saved the method word "Needs you" back as if
// it were typed. Both now start from here and send giftBody(): the server reads
// it with one reader (server/donors/giftShape.js).
//
// Money stays a string in the form: the amount box is filled from the gift's
// cents ("123.45"), never from a float a browser may print as 123.4499969482422.
import { orgTodayCivil } from "./orgToday";
import { emptyFund, fundFromGift, fundBody } from "../components/gifts/FundField";
import { methodValue } from "../../../shared/giftMethods.js";

// A dollar amount as the amount box shows it: whole cents, two places.
export function amountInput(v) {
  if (v === "" || v == null) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const c = Math.round(n * 100);
  return (c / 100).toFixed(2);
}

export function emptyGiftForm(date) {
  return { amount: "", date: date || orgTodayCivil(), type: "cash", payment_method: "", notes: "", fund: emptyFund(), fund_id: "",
    acknowledgement_sent: false, pledgeId: "", eventId: "", campaign: null, campaign_id: "", appeal: null, page: null,
    anonymous: false, sc: null, scAmount: "", tribType: "", trib: null, tribNotify: "", tribNotifyEmail: "", match: null, matchAmount: "", typed: {} };
}

// The form for an existing gift (the profile's gift row as loadGiftsFull keeps it).
export function formFromGift(g, extra = {}) {
  const page = g.peer_fundraiser_id ? { id: "peer:" + g.peer_fundraiser_id, name: g.peer_fundraiser_name || "A fundraiser", givingPageId: g.giving_page_id || null, peerFundraiserId: g.peer_fundraiser_id }
    : g.giving_page_id ? { id: "page:" + g.giving_page_id, name: g.giving_page_title || "A giving page", givingPageId: g.giving_page_id, peerFundraiserId: null } : null;
  return { ...emptyGiftForm(g.date || ""), amount: amountInput(g.amount), date: g.date || "", type: g.type || "cash",
    payment_method: methodValue(g.payment_method) || "", notes: g.notes || "",
    property_description: g.property_description || "", stock_shares: g.stock_shares ?? "", stock_ticker: g.stock_ticker || "",
    fund_id: g.fund_id || "", fund: fundFromGift(g), eventId: g.event_id || "",
    // A gift attributed by name only (an old import) keeps that name until she changes it.
    campaign: g.campaign_id ? { id: g.campaign_id, name: g.campaign_name || g.campaign || "A campaign" } : g.campaign ? { id: null, name: g.campaign, sub: "by name" } : null,
    campaign_id: g.campaign_id || "",
    appeal: g.appeal_id ? { id: g.appeal_id, name: g.appeal_name || "An appeal" } : null, page,
    acknowledgement_sent: !!g.acknowledgement_sent, anonymous: g.anonymous === true, ...extra };
}

// The one body. `editing` sends the clears (null) the edit needs; a new gift
// sends only what is set.
export function giftBody(f, { editing = false } = {}) {
  const clear = editing ? null : undefined;
  return {
    amount: String(f.amount).trim(), date: f.date, type: f.type,
    payment_method: methodValue(f.payment_method),
    notes: f.notes || "",
    property_description: f.property_description || undefined, stock_shares: f.stock_shares || undefined, stock_ticker: f.stock_ticker || undefined,
    ...(f.fund ? fundBody(f.fund, { editing }) : { fund_id: f.fund_id || clear }),
    campaignId: f.campaign ? (f.campaign.id || undefined) : clear,
    appealId: (f.appeal && f.appeal.id) || clear,
    givingPageId: (f.page && f.page.givingPageId) || clear,
    peerFundraiserId: (f.page && f.page.peerFundraiserId) || clear,
    eventId: f.eventId || clear,
    acknowledgement_sent: !!f.acknowledgement_sent,
    anonymous: !!f.anonymous,
  };
}

const WORD = { campaign: "campaign", appeal: "appeal", page: "fundraiser or giving page", sc: "soft credit", trib: "tribute", match: "matching employer" };
// Text typed into a picker and never picked: the sentence Save shows, or "".
export function unpickedProblem(f) {
  const t = f.typed || {};
  for (const k of Object.keys(WORD)) {
    if (t[k] && !f[k]) return `You typed '${t[k]}' for the ${WORD[k]} but did not pick one. Pick it from the list, or clear the box.`;
  }
  return "";
}

// Soft credit, tribute and match, as POST /donors/:id/gifts and PUT /gifts/:id/extras take them.
export function extrasBody(f) {
  const out = {};
  if (f.sc && f.sc.id) out.softCredits = [{ donorId: f.sc.id, role: "recommender", ...(f.scAmount ? { amount: Number(f.scAmount) } : {}) }];
  if (f.tribType && f.trib) out.tribute = { type: f.tribType, donorId: f.trib.id || null, name: f.trib.name, notifyName: f.tribNotify || null, notifyEmail: f.tribNotifyEmail || null };
  if (f.match && f.match.id) out.match = { employerId: f.match.id, ...(f.matchAmount ? { amount: Number(f.matchAmount) } : {}) };
  return out;
}
