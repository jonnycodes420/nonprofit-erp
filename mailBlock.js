// mailBlock.js — ADDRESSES STEWARD MUST NEVER EMAIL, FROM ANY ORG, FOR ANY REASON.
//
// Set 2026-09-24 on Jonathan's instruction, after the 22 September incident
// (INCIDENT-2026-09-22-outbound-email.md). This is a HARD block in code, not a
// preference: it is checked at the Resend client itself (the proxy in
// server.js every send passes through), in donorMailDecision, and on the two
// sends that bypass the proxy (the ops alert and the MiGulfCoast contact form).
// A Resend-side suppression is kept as well, but the code does not rely on it.
//
// THIS LIST IS JONATHAN'S. Nothing removes an address from it except him.
// tests/mail-block.test.js pins the entry below by name, so taking it out is
// a deliberate edit to two files, never a side effect.
"use strict";

const BLOCKED_ADDRESSES = Object.freeze([
  "hello@justinsplaceky.com",
]);

const _set = new Set(BLOCKED_ADDRESSES.map(a => a.toLowerCase()));

// "Allie <Hello@JustinsPlaceKY.com>" and " hello@justinsplaceky.com " are the
// same mailbox. Anything that is not an address is not blocked here.
function bareAddress(v) {
  const s = String(v == null ? "" : v).trim();
  const m = /<([^<>]+)>\s*$/.exec(s);
  return (m ? m[1] : s).trim().toLowerCase();
}

function isBlockedAddress(v) {
  return _set.has(bareAddress(v));
}

// Every recipient field of a Resend payload: to, cc, bcc — each a string or a
// list. A blocked address anywhere blocks the whole message: a copy is a send.
function blockedRecipientIn(opts) {
  if (!opts || typeof opts !== "object") return null;
  for (const field of ["to", "cc", "bcc"]) {
    const v = opts[field];
    const list = Array.isArray(v) ? v : v == null ? [] : [v];
    for (const r of list) if (isBlockedAddress(r)) return bareAddress(r);
  }
  return null;
}

module.exports = { BLOCKED_ADDRESSES, isBlockedAddress, blockedRecipientIn, bareAddress };
