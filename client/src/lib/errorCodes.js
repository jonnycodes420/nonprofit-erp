// lib/errorCodes.js · FLOWS-16 item 6 (W-1116-Fundraising-34X). NO RAW CODE IN A BANNER.
//
// Publish with nothing changed showed a pink banner reading only
// "nothing_to_publish": apiFetch built its Error from `message || error`, so a
// route that answered with a code (and sometimes a `sentence` beside it) put
// the code on screen. Now the message is the route's sentence first, then its
// message, and a bare code is never shown: a known code has its sentence here,
// and any other code-shaped string gets the plain sentence for its status.
// The code itself stays on the error (`e.error`) for any caller that branches on it.

// A code: lower case, no spaces ("nothing_to_publish", "not_found", "paused").
export const isCode = s => typeof s === "string" && /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/.test(s.trim());

// Kept to one sentence: this file is in Home's first look (perf-app's 247 KB budget). A route
// that has more to say sends its own `sentence` (nothing_to_publish names the live version),
// and that is read first.
export const GENERIC = "That didn't go through. Nothing was changed.";

// What a banner says for a failed response body.
export function bodySentence(body, fallback = "Request failed") {
  const b = body || {};
  for (const said of [b.sentence, b.message, b.error]) {
    if (typeof said !== "string" || !said.trim()) continue;
    return isCode(said) ? GENERIC : said;
  }
  return fallback;
}
