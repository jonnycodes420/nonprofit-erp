"use strict";
// FIX-34 · GOOGLE CONNECT CHECKS ITS APIS.
//
// The real failure (7 Oct): the Google Calendar API was switched off in the
// Google Cloud project, so mail read and the calendar silently never ran and
// the card said "did not answer". A connection now asks each API it needs one
// cheap question, right after the OAuth callback and whenever she presses
// Check again, and names in plain words which one refused and why.
//
// The one rule of the wording: "did not answer" means ONLY a timeout or a
// dropped connection. A refusal (403 accessNotConfigured / SERVICE_DISABLED,
// 401, 429, any other status) is said as a refusal, with its reason.

const GOOGLE_CAL = () => process.env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com";
const GMAIL = () => process.env.GMAIL_API_BASE || "https://gmail.googleapis.com";
const GRAPH = () => process.env.GRAPH_API_BASE || "https://graph.microsoft.com";
const CHECK_TIMEOUT_MS = 10000;

// Each API a connection may need, with the one cheap request that proves it.
function apisFor(providerKey, { calendarGranted = false } = {}) {
  if (providerKey === "google") return [
    { api: "gmail", label: "Gmail", product: "Gmail API", what: "mail", url: `${GMAIL()}/gmail/v1/users/me/profile` },
    ...(calendarGranted ? [{ api: "calendar", label: "Google Calendar", product: "Google Calendar API", what: "calendar",
      url: `${GOOGLE_CAL()}/calendar/v3/calendars/primary?fields=id` }] : []),
  ];
  return [
    { api: "mail", label: "Outlook mail", product: "Mail.Read permission", what: "mail", url: `${GRAPH()}/v1.0/me/mailFolders/inbox?$select=id` },
    ...(calendarGranted ? [{ api: "calendar", label: "Outlook calendar", product: "Calendars.ReadWrite permission", what: "calendar",
      url: `${GRAPH()}/v1.0/me/calendar?$select=id` }] : []),
  ];
}

// Why a provider said no, from its own error body. Google puts the reason in
// error.errors[].reason (accessNotConfigured) and error.details[].reason
// (SERVICE_DISABLED); Graph in error.code.
function refusalReason(status, body) {
  const e = (body && body.error) || {};
  const reasons = [
    ...((e.errors || []).map(x => x && x.reason)),
    ...((e.details || []).map(x => x && x.reason)),
    typeof e.code === "string" ? e.code : null, e.status,
  ].filter(Boolean).map(String);
  const has = r => reasons.some(x => x.toLowerCase() === r.toLowerCase());
  if (has("accessNotConfigured") || has("SERVICE_DISABLED")) return "disabled";
  if (status === 401) return "unauthorised";
  if (status === 429 || has("rateLimitExceeded") || has("userRateLimitExceeded")) return "rate_limited";
  if (status === 403 && (has("insufficientPermissions") || has("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || has("ErrorAccessDenied"))) return "scope";
  if (status === 403) return "forbidden";
  if (status >= 500) return "provider_error";
  return "refused";
}

// The sentence she reads. Never a status code, never a stack.
function refusalSentence(spec, reason, status) {
  const it = spec.what === "calendar" ? "your calendar" : "your mail";
  switch (reason) {
    case "disabled":
      return `${spec.label} is turned off in your Google Cloud project, so Steward cannot read ${it}. Turn on the ${spec.product}, then press Check again.`;
    case "unauthorised":
      return `${spec.label} refused Steward's sign-in, so Steward cannot read ${it}. Reconnect, then press Check again.`;
    case "scope":
      return `${spec.label} refused because the permission for ${it} was not granted. Reconnect and tick it, then press Check again.`;
    case "rate_limited":
      return `${spec.label} refused for now because too many requests were made. Steward waits and tries again.`;
    case "forbidden":
      return `${spec.label} refused Steward's request for ${it}. Check the account allows it, then press Check again.`;
    case "provider_error":
      return `${spec.label} had a fault on its side when Steward asked for ${it}. Steward tries again in 5 minutes.`;
    default:
      return `${spec.label} refused Steward's request for ${it}. Press Check again.`;
  }
}
const timeoutSentence = spec => `${spec.label} did not answer when Steward asked for ${spec.what === "calendar" ? "your calendar" : "your mail"}. Steward tries again in 5 minutes.`;

// Is this thrown error a timeout or a dropped connection (the only "did not answer")?
const isNoAnswer = e => !!e && (e.name === "TimeoutError" || e.name === "AbortError"
  || /timeout|ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed/i.test(String(e.message || e.cause?.code || "")));

// One cheap request per API. Returns [{ api, label, ok, status, reason, sentence }].
async function checkApis(providerKey, token, opts = {}) {
  const out = [];
  for (const spec of apisFor(providerKey, opts)) {
    try {
      const r = await fetch(spec.url, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(opts.timeoutMs || CHECK_TIMEOUT_MS) });
      if (r.ok) { out.push({ api: spec.api, label: spec.label, ok: true, status: r.status }); continue; }
      const body = await r.json().catch(() => null);
      const reason = refusalReason(r.status, body);
      out.push({ api: spec.api, label: spec.label, what: spec.what, ok: false, status: r.status, reason, sentence: refusalSentence(spec, reason, r.status) });
    } catch (e) {
      out.push({ api: spec.api, label: spec.label, what: spec.what, ok: false, status: null, reason: "no_answer", sentence: timeoutSentence(spec) });
    }
  }
  return out;
}

// A provider error carried by a thrown read, so syncErrorSentence can say
// "refused" vs "did not answer" truthfully.
function providerError(providerKey, what, status, body, retryAfter) {
  const spec = apisFor(providerKey, { calendarGranted: true }).find(s => s.what === what) || { label: providerKey, what };
  const reason = status == null ? "no_answer" : refusalReason(status, body);
  const sentence = reason === "no_answer" ? timeoutSentence(spec) : refusalSentence(spec, reason, status);
  return Object.assign(new Error(`${spec.label} ${status == null ? "no answer" : "answered " + status}`),
    { code: reason === "no_answer" ? "provider_no_answer" : "provider_refused", status, reason, sentence, retryAfter: retryAfter || null });
}

// Retry-After: seconds or an HTTP date. Returns a Date or null.
function retryAfterDate(header, now = Date.now()) {
  if (!header) return null;
  const s = Number(header);
  if (Number.isFinite(s) && s >= 0) return new Date(now + Math.min(s, 6 * 3600) * 1000);
  const t = Date.parse(header);
  return Number.isFinite(t) ? new Date(Math.min(t, now + 6 * 3600e3)) : null;
}

module.exports = { apisFor, checkApis, refusalReason, refusalSentence, timeoutSentence, isNoAnswer, providerError, retryAfterDate };
