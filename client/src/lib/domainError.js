// client/src/lib/domainError.js — FIX (2026-09-10).
//
// ── AN ERROR HANDLER THAT TURNS A BUG INTO A DATA-QUALITY MESSAGE IS WORSE
//    THAN NO HANDLER ──────────────────────────────────────────────────────
//
// BUILD-84 shipped a `const` referenced inside its own temporal dead zone: the
// new `stageBasis` memo was declared between `payload` and `stagePreview`, so
// `payload`'s factory read it before its declaration and threw a
// ReferenceError. `payload`'s catch swallowed it and returned an empty
// payload, and the screen said:
//
//     "No rows ready — map at least one column to name or email."
//
// That sentence is plausible, domain-shaped, and completely false. It sent the
// reader to go fix their spreadsheet for a bug in ours. Every unit test passed,
// because the pure builders were correct and nothing ever threw in them — only
// rendering the component could produce it.
//
// It is the same family as everything else that build was about: A SCREEN
// STATING SOMETHING IT CANNOT BACK. The import receipt naming a drive-time
// column as the file's money, a stage split "based on giving history" over a
// file with no gifts, and this — all three are the product asserting a cause it
// does not have.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
// A catch around domain logic RE-THROWS anything that is not a domain error,
// and NEVER emits user-facing copy for one it did not expect.
//
// A domain error is a condition the code anticipated and can describe: a
// refused upload, a 403 from a route, a file that will not parse. A
// ReferenceError, TypeError, RangeError or SyntaxError is a bug, always — the
// code did something impossible to itself, and there is nothing true to say to
// a user about it. Let it reach the ErrorBoundary, which says the honest thing
// ("something went wrong on this screen") and does not blame the data.
//
// The cost of getting this wrong is asymmetric, which is why the default is to
// re-throw: a crash screen on a real bug is embarrassing and correct, while a
// data-quality message on a real bug is calm, confident and wrong.

// The error types that are always the program's fault. `InternalError` is
// SpiderMonkey's; harmless to list, and this must not depend on the engine.
const PROGRAMMER_ERROR_NAMES = new Set([
  "ReferenceError", "TypeError", "RangeError", "SyntaxError", "InternalError",
]);

export function isProgrammerError(e) {
  if (!e) return false;
  // `instanceof` is unreliable across realms (an iframe, a worker, a bundled
  // copy of a library), so the NAME is the test — it survives them all.
  const name = (e && e.name) || (e && e.constructor && e.constructor.name) || "";
  return PROGRAMMER_ERROR_NAMES.has(String(name));
}

// The one line every domain catch starts with. Re-throws a bug; returns the
// error unchanged when it is something the caller may legitimately describe.
//
//   try { … } catch (e) {
//     rethrowProgrammerError(e);
//     return { ok: false, error: e.message };   // a DOMAIN failure, described
//   }
export function rethrowProgrammerError(e) {
  if (isProgrammerError(e)) throw e;
  return e;
}

// errorMessage(e, fallback) — the message to SHOW a person.
//
// The other half of the rule, for the places a re-throw is the wrong medicine:
// an async event handler. React error boundaries do NOT catch errors thrown
// from an async callback, so re-throwing there produces an unhandled rejection
// and a stuck spinner — worse than the message it replaced. Those handlers
// keep catching; what changes is what they are allowed to SAY.
//
//   a DOMAIN error  → its own message. A route that refuses with
//                     "You've reached your donor record limit of 500" is
//                     telling the truth and should be quoted.
//   a BUG           → a message that names itself as ours. "Cannot read
//                     properties of undefined (reading 'sum')" shown next to
//                     the user's file is a sentence about their data as far as
//                     they can tell.
export function errorMessage(e, fallback) {
  if (isProgrammerError(e)) {
    const detail = (e && e.message) ? ` (${e.message})` : "";
    return `Something went wrong inside Steward — this is not a problem with your data, and nothing was changed.${detail}`;
  }
  return (e && e.message) || fallback;
}
