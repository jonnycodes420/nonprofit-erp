// shared/webhookOut.js — INT-5. WHAT STEWARD TELLS SOMEBODY ELSE.
//
// An organisation points an endpoint at Steward and picks the things it wants
// to hear about. Steward posts a signed payload and keeps trying for a day.
//
// ── OUTBOUND, AND ONLY OUTBOUND ────────────────────────────────────────────
// Nothing here can read a request. A webhook is Steward saying "this happened"
// to an address somebody in that org typed, and the whole file is the shape of
// that sentence plus the arithmetic of retrying it.
//
// ── THE SIGNATURE IS TIMESTAMPED, AND THAT IS NOT DECORATION ───────────────
// A bare HMAC of the body proves the body came from Steward, and proves nothing
// about WHEN. Anyone who captures one delivery can replay it for ever: the same
// "gift.created" arriving a hundred times, each one a valid signature. So the
// timestamp is signed WITH the body and the receiver is told to reject anything
// older than five minutes. That is the difference between a signature and a
// password somebody can photograph.
//
// Pure: no DB, no network, no crypto (the HMAC is the route's job, because
// shared/ is bundled into the browser and node:crypto is not), no clock.

// ── WHAT AN ORGANISATION MAY SUBSCRIBE TO ──────────────────────────────────
// Each event says what it MEANS, because the name alone is ambiguous in the
// ways that matter: "gift.created" is a gift recorded in Steward by any path,
// not a card being charged.
export const EVENTS = {
  "gift.created": {
    key: "gift.created", label: "Gift recorded",
    description: "A gift was recorded in Steward, however it arrived: online, a cheque, an import or this API.",
  },
  "gift.refunded": {
    key: "gift.refunded", label: "Gift refunded",
    description: "A gift already recorded was refunded.",
  },
  "person.created": {
    key: "person.created", label: "Person added",
    description: "A new person record was created.",
  },
  "person.updated": {
    key: "person.updated", label: "Person changed",
    description: "Something on a person's record changed. The payload names what.",
  },
  "recurring_plan.failed": {
    key: "recurring_plan.failed", label: "Recurring gift failed",
    description: "A recurring gift's payment failed. This is the one worth acting on the same day.",
  },
  "volunteer.signed_up": {
    key: "volunteer.signed_up", label: "Volunteer signed up",
    description: "Somebody signed up for a volunteer slot.",
  },
  "event.registration": {
    key: "event.registration", label: "Event registration",
    description: "Somebody registered for an event.",
  },
};
export const EVENT_KEYS = Object.keys(EVENTS);
export const isEvent = k => EVENT_KEYS.includes(String(k || ""));

export function validateEndpoint(input) {
  const i = input || {};
  const errors = [];
  const url = String(i.url || "").trim();
  let parsed = null;
  try { parsed = new URL(url); } catch { /* handled below */ }
  if (!parsed) errors.push("That is not a web address Steward can post to.");
  else if (parsed.protocol !== "https:") {
    // HTTP would send an organisation's donor data across the open internet in
    // clear text. There is no "just for testing" exception here, because the
    // testing endpoint is the one people forget to change.
    errors.push("The address must start with https. Steward will not post donor data over an unencrypted connection.");
  }
  const events = [...new Set((Array.isArray(i.events) ? i.events : []).map(String).filter(isEvent))];
  if (!events.length) errors.push("Choose at least one thing to be told about.");
  return errors.length ? { ok: false, errors }
    : { ok: true, value: { url: parsed.toString(), events: events.sort(), description: String(i.description || "").trim().slice(0, 120) || null } };
}

// ── THE SIGNATURE ──────────────────────────────────────────────────────────
// `t=<unix seconds>,v1=<hex hmac of "<t>.<body>">`, which is the shape most
// receivers already know how to check because several large providers use it.
// Steward signs; the caller verifies; neither needs a library.
export const SIGNATURE_HEADER = "steward-signature";
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

export function signatureBase(timestampSeconds, rawBody) {
  return `${Number(timestampSeconds)}.${String(rawBody == null ? "" : rawBody)}`;
}
export function signatureHeader(timestampSeconds, hexHmac) {
  return `t=${Number(timestampSeconds)},v1=${String(hexHmac)}`;
}
export function parseSignature(header) {
  const parts = String(header || "").split(",").map(s => s.trim());
  const out = { t: null, v1: null };
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "t") out.t = Number(v) || null;
    if (k === "v1") out.v1 = v || null;
  }
  return out;
}
/** Is this timestamp inside the window? The clock is a parameter, never read here. */
export function timestampFresh(t, nowSeconds, tolerance = TIMESTAMP_TOLERANCE_SECONDS) {
  const ts = Number(t), now = Number(nowSeconds);
  if (!Number.isFinite(ts) || !Number.isFinite(now)) return false;
  return Math.abs(now - ts) <= tolerance;
}

export const VERIFY_SNIPPET = `const crypto = require("crypto");

function verify(rawBody, header, secret) {
  const [t, v1] = header.split(",").map(p => p.split("=")[1]);
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;   // too old to trust
  const expected = crypto.createHmac("sha256", secret)
    .update(t + "." + rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}`;

// ── RETRYING FOR A DAY, THEN STOPPING ──────────────────────────────────────
// Backoff so a receiver that is down is not hammered, and a ceiling so Steward
// is not still knocking a week later. The delays add up to just over 24 hours.
export const RETRY_DELAYS_SECONDS = [
  10, 30, 60, 300, 900, 1800, 3600, 7200, 14400, 21600, 28800, 36000,
];
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

/** When to try again, or null when this delivery is finished failing. */
export function nextAttemptDelay(attempt) {
  const n = Number(attempt) || 0;
  if (n < 1 || n > RETRY_DELAYS_SECONDS.length) return null;
  return RETRY_DELAYS_SECONDS[n - 1];
}

/** A delivery's outcome from the status a receiver gave. */
export function deliveryOutcome(status) {
  const n = Number(status) || 0;
  if (n >= 200 && n < 300) return { ok: true, retry: false, reason: "delivered" };
  // 410 Gone is the receiver saying "stop", and honouring it is the polite and
  // the correct thing: retrying an endpoint that has told you it is finished is
  // how an integration becomes somebody's incident.
  if (n === 410) return { ok: false, retry: false, reason: "endpoint_gone" };
  if (n === 401 || n === 403) return { ok: false, retry: true, reason: "rejected" };
  if (n === 429 || n >= 500 || n === 0) return { ok: false, retry: true, reason: "unavailable" };
  if (n >= 400) return { ok: false, retry: true, reason: "not_accepted" };
  return { ok: false, retry: true, reason: "unknown" };
}

// ── AN ENDPOINT THAT KEEPS FAILING IS PAUSED, AND SOMEBODY IS TOLD ─────────
// Not silently disabled: a webhook that stopped working without anybody
// noticing is how an organisation discovers, a month later, that its
// thank-you automation has been dead since March.
export const PAUSE_AFTER_CONSECUTIVE_FAILURES = 5;
export function shouldPause(consecutiveFailures) {
  return (Number(consecutiveFailures) || 0) >= PAUSE_AFTER_CONSECUTIVE_FAILURES;
}
export function pauseSentence(url, failures) {
  return `Steward has stopped sending to ${url}: the last ${failures} deliveries all failed. Nothing has been lost, and turning it back on resends what is still waiting.`;
}

/** The body Steward posts. Small on purpose: an id and what happened. */
export function eventPayload({ event, orgId, data, id, sentAt }) {
  return {
    id: String(id || ""),
    type: String(event || ""),
    createdAt: String(sentAt || ""),
    organization: String(orgId || ""),
    data: data || {},
  };
}

export default {
  EVENTS, EVENT_KEYS, isEvent, validateEndpoint,
  SIGNATURE_HEADER, TIMESTAMP_TOLERANCE_SECONDS, signatureBase, signatureHeader,
  parseSignature, timestampFresh, VERIFY_SNIPPET,
  RETRY_DELAYS_SECONDS, MAX_ATTEMPTS, nextAttemptDelay, deliveryOutcome,
  PAUSE_AFTER_CONSECUTIVE_FAILURES, shouldPause, pauseSentence, eventPayload,
};
