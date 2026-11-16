// server/outreach/firstGiftRule.js · FLOWS-15 item 1 (W-1114-Fundraising-17, second repeat).
// A NEVER-GIVER NEVER RECEIVES DONOR-ONLY COPY.
//
// The rule is shared/pastGiving.js neverGiverOutcome: a letter that thanks the reader for giving,
// with a block that has no first-gift version, leaves out everyone who has never given
// (shared/numbers/neverGave.js), unless she ticked "Send it to them anyway"
// (segment.includeNeverGiven). The campaign audience (the editor's count, the Send button's
// number) and the send itself both read this, so the count is the messages the send writes.
"use strict";
const { neverGave } = require("../../shared/numbers/neverGave");

const segmentOf = c => { try { return typeof c.segment === "string" ? JSON.parse(c.segment || "{}") : (c.segment || {}); } catch { return {}; } };
const blocksOf = c => { const b = c && c.email_blocks; if (Array.isArray(b)) return b; try { return b ? JSON.parse(b) : null; } catch { return null; } };

// What happens to the never-givers in this campaign's audience. `donorOnlyCopy` stands in for the
// blocks when the caller has none (the editor's live blocks, sent with segment-preview).
async function outcomeFor(campaign, { donorOnlyCopy = null } = {}) {
  const PG = await import("../../shared/pastGiving.js");
  const include = segmentOf(campaign).includeNeverGiven === true;
  const blocks = blocksOf(campaign);
  if (blocks) return PG.neverGiverOutcome({ blocks, includeNeverGiven: include });
  if (donorOnlyCopy === true) return include ? "included" : "left_out";
  return "no_claim";
}

// Moves the never-givers out of an audience's reach into their own reason. aud: campaignAudience's
// { recipients, leftOut, leftOutCount }.
async function applyFirstGiftRule(aud, campaign, opts = {}) {
  const outcome = await outcomeFor(campaign, opts);
  aud.neverGiverOutcome = outcome;
  if (outcome !== "left_out") return aud;
  const out = aud.recipients.filter(neverGave);
  if (!out.length) return aud;
  const PG = await import("../../shared/pastGiving.js");
  aud.recipients = aud.recipients.filter(d => !neverGave(d));
  aud.leftOut = [...aud.leftOut, { reason: PG.LEFT_OUT_REASON, count: out.length, people: out }];
  aud.leftOutCount += out.length;
  return aud;
}

module.exports = { outcomeFor, applyFirstGiftRule, segmentOf };
