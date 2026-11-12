// server/give/takesGifts.js · FLOWS-8 (W-1112-Fundraising-35). A PAGE THAT CAN'T TAKE GIFTS SAYS WHY.
// The giving page editor's read carries whether a gift can be made through the
// page, by the rule its public address uses (crmCommon.orgTakesGifts: Stripe
// connected and an account on file), and the sentence for when it can't.
"use strict";

// The one rule: an org takes gifts once Stripe is connected and an account is on
// file. crmCommon.orgTakesGifts (the public pages, Fundraising) is this function.
const orgTakesGifts = org => !!(org && org.stripe_connected && org.stripe_account_id);

const NOT_TAKING = "Connect Stripe to take gifts on this page. Until then its address shows donors a polite \"Not open yet\" page.";

async function takesGiftsPayload({ query }, orgId, surface) {
  if (surface !== "give") return {};
  const [o] = await query("SELECT stripe_connected, stripe_account_id FROM orgs WHERE id=?", [orgId]);
  const yes = orgTakesGifts(o);
  return { takesGifts: yes, notTakingWhy: yes ? null : NOT_TAKING };
}

module.exports = { orgTakesGifts, takesGiftsPayload, NOT_TAKING };
