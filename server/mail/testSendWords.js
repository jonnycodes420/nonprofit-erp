// server/mail/testSendWords.js · SENDS-3 item 2. A TEST THAT DID NOT GO SAYS WHY, IN WORDS.
//
// "Send me a test" in org_stagewalk answered 502 send_failed for every
// address: the mail gate refused it (that org's donor and staff switches are
// off) and the route turned every refusal into the same 502. Now a refusal is
// a 409 with the reason's own sentence, decided before anything is rendered
// for the wire, and only a provider failure is a 502 (still with words).
"use strict";

const mailPolicy = require("../../mailPolicy");

// The gate's answer for a test from this org, before sending: null when it may go.
function refusalBefore(org) {
  const d = mailPolicy.orgMailDecision(org || null, mailPolicy.categoryOf("campaign_test"), "campaign_test");
  if (d.send) return null;
  return { error: "test_not_sent", reason: d.reason, sentence: mailPolicy.REASON_SENTENCE[d.reason] || "Email is not going out from this organization right now, so the test was not sent." };
}

// The wrapped client answered with an error: a refusal (the gate, the block
// list) is 409 with its words; anything else is the provider, 502 with words.
function afterError(error, what = "campaign") {
  const name = error && error.name, msg = String((error && error.message) || "");
  if (name === "org_mail_off") {
    const reason = msg.replace(/^org_mail_off:\s*/, "");
    return { status: 409, body: { error: "test_not_sent", reason, sentence: mailPolicy.REASON_SENTENCE[reason] || "Email is not going out from this organization right now, so the test was not sent." } };
  }
  if (name === "blocked_address") return { status: 409, body: { error: "test_not_sent", reason: "blocked_address", sentence: "Steward never sends to that address, so the test was not sent." } };
  return { status: 502, body: { error: "send_failed", message: `The test could not be sent just now. Nothing about the ${what} changed.`,
    sentence: `The email service did not take the test just now. Nothing about the ${what} changed; try again in a minute.` } };
}

module.exports = { refusalBefore, afterError };
