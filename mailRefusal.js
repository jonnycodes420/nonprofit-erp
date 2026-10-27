// FIX-48 · A REFUSED SEND IS AN ANSWER, NOT AN OUTAGE.
//
// A pledge reminder Resend refused never advanced its step, so the hourly
// sweep sent it again every hour, forever, and Resend refused it every hour.
// The sweeps treated every "not delivered" alike. There are three kinds, and
// this file is the one place that says which one a result is:
//
//   wait       the ORGANIZATION is not sending right now (mail off, not
//              onboarded, a demo). Nothing is wrong with this send; it goes
//              the day the org's mail is on. Not a failure, not consumed.
//   transient  the provider could not take it right now (5xx, 429, a network
//              error, Steward's own key or From address). Retried later.
//   permanent  this send will never go: Resend refused it (a 4xx that is about
//              the message, a 422 for an address it will not take), the
//              address hard-bounced or complained, the person is deceased or
//              unsubscribed, or the address is on Steward's permanent block.
//              Marked failed with its reason ONCE and never retried.
//
// Pure, so the suite can prove each arm.

// donorMailDecision / orgMaySendEmail reasons that are about the org, not the
// person. Everything else a decision refuses is about the person: permanent.
const ORG_WAIT_REASONS = new Set([
  "org_emails_disabled", "not_onboarded", "demo_org", "org_not_found", "org_gate_unreadable", "no_org",
  "donor_mail_off", "staff_mail_off", "billing_mail_off", "not_a_customer",
]);
// Provider error names that are Steward's own configuration, not this message.
const OUR_CONFIG = new Set(["missing_api_key", "invalid_api_key", "restricted_api_key", "invalid_from_address", "invalid_access"]);

function classifyDecision(reason) {
  if (!reason) return null;
  return ORG_WAIT_REASONS.has(reason) ? "wait" : "permanent";
}

// `err` is the `error` a Resend send returned (or the proxy's own refusal).
function classifyProviderError(err) {
  if (!err) return null;
  const name = String(err.name || "");
  if (name === "org_mail_off") return "wait";
  if (name === "blocked_address") return "permanent";
  // SEND-GATE-1: this person's automatic emails are off. The message is kept
  // on their profile with a Send button; no sweep tries it again.
  if (name === "auto_email_off") return "permanent";
  if (OUR_CONFIG.has(name)) return "transient";
  const code = Number(err.statusCode || err.status || 0);
  if (code === 429 || code >= 500 || !code) return "transient";
  if (code === 401 || code === 403) return "transient";
  return code >= 400 ? "permanent" : "transient";
}

// A hard bounce is never retried, by any path: the reason a decision gives for
// an address the provider said does not exist.
const HARD_BOUNCE_REASONS = new Set(["bounced", "email_unreachable", "complained"]);

function reasonText(err) {
  if (!err) return "unknown";
  if (typeof err === "string") return err.slice(0, 300);
  return String(err.message || err.name || "refused").slice(0, 300);
}

module.exports = { classifyDecision, classifyProviderError, reasonText, ORG_WAIT_REASONS, HARD_BOUNCE_REASONS };
