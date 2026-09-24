// shared/reservedDomains.js — BUILD-97 Part 5. THE DOMAINS THAT CANNOT REACH
// A REAL PERSON.
//
// The 22 September incident turned on this distinction and nothing in the
// product held it. Seeded fixtures were rewritten to
// `<local>@<provider>.example.com` precisely because **example.com is IANA-
// reserved (RFC 2606) and publishes no MX**, so a message to one is a message
// to nobody. Every other domain in an email log is a real mailbox somewhere.
//
// The observability page's central alarm — "a demonstration organisation sent
// mail to a real address" — is this predicate and a join. Without it the alarm
// fires on every fixture in the product, and an alarm that fires constantly is
// an alarm nobody reads.
//
// ── WHY THIS IS A SHARED MODULE AND NOT A LINE IN server.js ───────────────
// `tests/email-links.test.js` bans the string "localhost" from server.js
// OUTRIGHT — "no localhost can ever leak into a production link" — and that
// blanket ban is exactly what makes the guard enforceable: the moment it grows
// an exception list it stops being checkable. This predicate legitimately needs
// to name localhost, so it lives here, where it is also reusable and testable
// without booting a server.
//
// Pure: no DB, no network, no clock, no JSX.

// RFC 2606 §2 reserves these four TLDs, and §3 reserves the three second-level
// names, for documentation and testing. None of them resolves to a mailbox.
export const RESERVED_TLDS = ["test", "example", "invalid", "localhost"];
export const RESERVED_SECOND_LEVEL = ["example.com", "example.org", "example.net"];

const RESERVED_RE = new RegExp(
  "(^|\\.)(" +
  RESERVED_SECOND_LEVEL.map(d => d.replace(/\./g, "\\.")).join("|") +
  "|" + RESERVED_TLDS.join("|") +
  ")$", "i");

// True when a message to this domain cannot reach a person.
//
// Matched on the SUFFIX, so `yahoo.example.com` — the shape the incident's
// fixture rewrite produced, keeping the provider as a subdomain so two
// different donors did not silently merge into one address — reads as
// unroutable, while `example.com.co` does not.
export function isUnroutableDomain(domain) {
  const d = String(domain || "").trim().toLowerCase().replace(/\.$/, "");
  if (!d) return true;           // no domain at all reaches nobody
  return RESERVED_RE.test(d);
}

// The other half, said as its own sentence because it is the one the alarm
// actually asks: could this have reached a person?
export const reachesARealMailbox = (domain) => !isUnroutableDomain(domain);
