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

export const CODE_SENTENCES = {
  nothing_to_publish: "Nothing to publish: this page has no changes since it was last published.",
  not_found: "That isn't there any more. Refresh the page and try again.",
  forbidden: "You don't have access to do that. An admin can change your role in Settings.",
  unauthorized: "Your sign-in has ended. Sign in again and try once more.",
  bad_range: "Choose a start and an end date.",
  bad_request: "Steward couldn't read that request. Check what you entered and try again.",
  already_done: "That was already done, so nothing changed.",
  conflict: "That changed while you were looking. Refresh the page and try again.",
  paused: "This is paused for your organization, so nothing ran.",
  too_long: "That's too long. Shorten it and try again.",
  empty: "There's nothing there yet. Add something and try again.",
  rate_limited: "That was tried too many times in a row. Wait a minute and try again.",
  read_only: "Your organization is read-only right now, so nothing was changed.",
};

const BY_STATUS = {
  400: "Steward couldn't do that with what was entered. Nothing was changed.",
  403: "You don't have access to do that. Nothing was changed.",
  404: "That isn't there any more. Refresh the page and try again.",
  409: "That changed while you were looking, so nothing was changed. Refresh and try again.",
  429: "That was tried too many times in a row. Wait a minute and try again.",
};
const GENERIC = "That didn't go through, and nothing was changed. Try again in a minute.";

// The sentence for a code, with the response's status when there is one.
export function codeSentence(code, status) {
  const k = String(code || "").trim();
  return CODE_SENTENCES[k] || BY_STATUS[status] || (status >= 500 ? GENERIC : GENERIC);
}

// What a banner says for a failed response body.
export function bodySentence(body, status, fallback = "Request failed") {
  const b = body || {};
  for (const said of [b.sentence, b.message, b.error]) {
    if (typeof said !== "string" || !said.trim()) continue;
    return isCode(said) ? codeSentence(said, status) : said;
  }
  return fallback;
}
