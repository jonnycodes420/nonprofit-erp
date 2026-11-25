// server/ai/whyNot.js · CAMPAIGN-2 item 5. WHY AN AI BUTTON DID NOT DRAFT, AND WHAT TO DO.
//
// Jarvis (24 Nov): the sequence editor's "Write with AI" "produced no visible change at all", and
// the template editor's "Draft with AI" opened a panel saying drafting is not available on this
// server, with its action button disabled. Each AI button now either drafts or says, on the first
// click, which of these it is and what the person can do. One sentence per gate reason
// (aiClient.js aiGate: ai_no_key, ai_disabled; requireAi: ai_budget), so every editor says the same.
"use strict";

const SETTINGS_AI = "/app/settings?section=data";

function whyNot(reason, { isAdmin = false } = {}) {
  if (reason === "ai_disabled") {
    return { reason, sentence: "AI drafting is off for your organization, so nothing was drafted.",
      what: isAdmin ? "Turn it on in Settings, Your Data, Reading and drafting, or write the words yourself." : "An admin can turn it on in Settings, Your Data. Until then, write the words yourself.",
      link: isAdmin ? { label: "Settings, Your Data", href: SETTINGS_AI } : null };
  }
  if (reason === "ai_budget") {
    return { reason, sentence: "Your organization has used today's AI requests, so nothing was drafted.",
      what: "AI drafting starts again at midnight UTC. Until then, write the words yourself.", link: null };
  }
  // ai_no_key, or anything else the gate says: Steward's state, not the organization's.
  return { reason: reason || "ai_no_key", sentence: "AI drafting is not available on this server, so nothing was drafted.",
    what: "Nothing in your settings turns it on. Write the words yourself.", link: null };
}

const isAdminReq = req => !!(req && req.user && req.user.role === "admin");

module.exports = { whyNot, isAdminReq, SETTINGS_AI };
