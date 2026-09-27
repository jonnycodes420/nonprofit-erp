// shared/institutional.js — FIX-1. WHAT AN ORGANISATION GAVE, IN ITS OWN WORD.
//
// Home's institutional list called every organisation's last gift a "last
// grant" and printed the date as ISO. Only a foundation or a donor-advised
// fund makes a grant; a church's collection and a business's cheque are
// gifts, and so is anything nobody has classified (a guess of "grant" would
// claim a relationship we do not know about). What kind of organisation it is
// comes from vocabulary.orgWordFor: the funder type first, then the imported
// donor type, then the name.
//
// Pure: no clock, no fetch. The server computes it once for /drift and Home
// renders what it was given.

import { orgWordFor } from "./vocabulary.js";

const GRANT_MAKERS = new Set(["foundation", "donor-advised fund"]);

export function lastGiftWord(row) {
  return GRANT_MAKERS.has(orgWordFor(row || {})) ? "last grant" : "last gift";
}

// "Jan 14, 2026" from a civil date — FIX-2 moved the one formatter to
// shared/displayDate.js; this name stays for the callers that read it here.
export { displayDate as shortCivilDate } from "./displayDate.js";
