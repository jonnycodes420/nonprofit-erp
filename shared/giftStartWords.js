// shared/giftStartWords.js — WALKB-1 item 2. THE EMAIL STEP SAYS WHAT HAPPENS.
//
// Step 2 said "Your email is saved when you continue", and Muse's Walk B read
// that as "I am now a contact". No contact is made: continuing writes one row
// to the "gifts started, not finished" list (gift_starts, PARITY-4), keyed by
// the page's own token, and a person only joins the org's records when a gift
// goes through recordGift. A public, unauthenticated form must not be able to
// write person records, so the sentence moved to the code, not the other way.
//
// One sentence, read by both of Steward's forms (the three-step form and the
// one-page form), so the two cannot promise different things.
export function emailStepSentence(orgName) {
  const org = String(orgName || "").trim() || "this organization";
  return `Your receipt goes here. If you stop before paying, ${org} sees that a gift was started from this address and may write once to check. You join their records only when a gift goes through.`;
}
