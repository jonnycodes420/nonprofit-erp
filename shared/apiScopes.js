// shared/apiScopes.js — INT-5. WHAT A KEY IS ALLOWED TO DO.
//
// BUILD-98 Part 6 shipped API keys that were read-only by construction: there
// were no write routes, so `scopes: ["read"]` was a placeholder for a decision
// nobody had to make yet. INT-5 adds writes, so the decision arrives.
//
// ── THE RULE THAT DECIDES EVERY QUESTION BELOW ─────────────────────────────
//
//     A KEY GRANTS EXACTLY WHAT SOMEBODY TICKED, AND NOTHING ELSE.
//
// Not "read implies read everything later added", not "write implies read".
// Each scope is one verb over one kind of thing, and a key that was made before
// a scope existed does not silently acquire it. That is what makes it safe to
// hand a key to Zapier, or to a consultant for one afternoon.
//
// ── AND THE ONE THAT PROTECTS THE EXISTING KEYS ────────────────────────────
// Every key already issued holds the literal scope `read`. Those keys are in
// somebody's Zapier account and in somebody's script, and they must keep
// working and must NOT gain the ability to write. So `read` is kept as a legacy
// scope that expands to every READ scope and to no write scope, for ever.
//
// Pure: no DB, no network, no clock, no JSX.

export const LEGACY_READ = "read";

// Each scope is {verb}:{thing}. The description is what the person ticking the
// box actually reads, so it says what the key can DO, not what endpoint it hits.
export const SCOPES = {
  "read:people": {
    key: "read:people", verb: "read", thing: "people", label: "Read people",
    description: "See the people on file: names, contact details, and their giving totals.",
  },
  "write:people": {
    key: "write:people", verb: "write", thing: "people", label: "Add and update people",
    description: "Create a person, or change one that exists. It goes through the same rules the app uses, including how duplicates are merged.",
  },
  "read:gifts": {
    key: "read:gifts", verb: "read", thing: "gifts", label: "Read gifts",
    description: "See recorded gifts, their amounts, dates and funds.",
  },
  "write:gifts": {
    key: "write:gifts", verb: "write", thing: "gifts", label: "Record gifts",
    description: "Record a gift. It is written by the same function the app uses, so receipts, funds and totals all behave exactly as they would inside Steward.",
  },
  "read:funds": {
    key: "read:funds", verb: "read", thing: "funds", label: "Read funds",
    description: "See the names of your funds, so a gift can be put in the right one.",
  },
  "read:events": {
    key: "read:events", verb: "read", thing: "events", label: "Read events",
    description: "See events and who has registered for them.",
  },
  "write:notes": {
    key: "write:notes", verb: "write", thing: "notes", label: "Log notes",
    description: "Add a note or a logged conversation to somebody's record. It cannot change giving.",
  },
};
export const SCOPE_KEYS = Object.keys(SCOPES);
export const READ_SCOPES = SCOPE_KEYS.filter(k => SCOPES[k].verb === "read");
export const WRITE_SCOPES = SCOPE_KEYS.filter(k => SCOPES[k].verb === "write");

/**
 * The scopes a stored key actually carries.
 *
 * THE LEGACY EXPANSION IS READ-ONLY AND ALWAYS WILL BE. A key issued before
 * INT-5 holds `read`; it keeps every read it had and gains no write, whatever
 * is added to this file later. Widening it would hand write access to keys
 * somebody granted for reading.
 */
export function effectiveScopes(stored) {
  const list = Array.isArray(stored) ? stored.map(String) : [];
  const out = new Set();
  for (const s of list) {
    if (s === LEGACY_READ) { for (const r of READ_SCOPES) out.add(r); continue; }
    if (SCOPES[s]) out.add(s);
  }
  return [...out].sort();
}

/** Does this key allow the scope a route requires? */
export function allows(stored, needed) {
  if (!SCOPES[needed]) return false;          // an unknown requirement fails closed
  return effectiveScopes(stored).includes(needed);
}

/** What somebody ticked, validated. An empty choice is refused, never widened. */
export function validateScopes(input) {
  const list = Array.isArray(input) ? input.map(s => String(s || "").trim()).filter(Boolean) : [];
  const unknown = list.filter(s => !SCOPES[s]);
  if (unknown.length) return { ok: false, error: `Not a permission Steward offers: ${unknown.join(", ")}.` };
  const picked = [...new Set(list)].sort();
  if (!picked.length) return { ok: false, error: "Choose at least one thing this key may do." };
  return { ok: true, value: picked };
}

/** The sentence a refusal gives back. It names the scope, because the person reading it is a developer. */
export function refusalFor(needed) {
  const s = SCOPES[needed];
  return {
    error: "insufficient_scope",
    required: needed,
    message: s
      ? `This key does not have the "${s.label}" permission. Make a new key with it ticked, or add it to this one.`
      : "This key does not have the permission this endpoint needs.",
  };
}

// ── THE CALL LOG ───────────────────────────────────────────────────────────
// Kept for thirty days, per key. NO DONOR DATA BEYOND THE IDS: a log that
// records what was sent would be a second, unguarded copy of the CRM, kept
// where nobody thinks to look for it.
export const CALL_LOG_DAYS = 30;
export const CALL_LOG_SENTENCE =
  "The last 30 days of calls made with this key: when, what was asked for, and what Steward answered. It records the ids involved and never the contents of anybody's record.";

/** The plain sentence beside a logged status, so a 4xx is not just a number. */
export function statusSentence(status, scope) {
  const n = Number(status) || 0;
  if (n === 401) return "The key was missing or not valid.";
  if (n === 403) return scope ? `The key does not have the "${SCOPES[scope]?.label || scope}" permission.` : "The key is not allowed to do that.";
  if (n === 404) return "Steward has no such record for this organisation.";
  if (n === 422) return "The request was understood but something in it was not usable.";
  if (n === 429) return "Too many calls too quickly. This key was asked to slow down.";
  if (n >= 500) return "Something went wrong at Steward's end.";
  if (n >= 400) return "The request was not accepted.";
  return "Answered.";
}

// ── RATE LIMITS, PER KEY ───────────────────────────────────────────────────
// Per key rather than per org, so one noisy integration cannot starve another,
// and generous enough that no honest use will meet it.
export const RATE_LIMIT_PER_MINUTE = 120;
export const RATE_LIMIT_SENTENCE =
  `Each key may make ${RATE_LIMIT_PER_MINUTE} calls a minute. Beyond that Steward answers 429 and asks you to wait; nothing is lost, and the next minute starts clean.`;
export function rateLimitBody(retryAfterSeconds) {
  return {
    error: "rate_limited",
    retryAfter: Math.max(1, Number(retryAfterSeconds) || 60),
    message: `This key has made more than ${RATE_LIMIT_PER_MINUTE} calls in a minute. Wait a moment and try again.`,
  };
}

export default {
  SCOPES, SCOPE_KEYS, READ_SCOPES, WRITE_SCOPES, LEGACY_READ,
  effectiveScopes, allows, validateScopes, refusalFor,
  CALL_LOG_DAYS, CALL_LOG_SENTENCE, statusSentence,
  RATE_LIMIT_PER_MINUTE, RATE_LIMIT_SENTENCE, rateLimitBody,
};
