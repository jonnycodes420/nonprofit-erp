// shared/paypalWebhook.js — INT-1. WHAT PAYPAL SIGNED, AND WHAT STEWARD WILL
// ACCEPT.
//
// A webhook body is attacker-shaped input. Anybody on the internet can POST
// JSON to a public URL claiming a $10,000 gift arrived, and the ONLY thing
// between that and a gift row is the signature. So this file holds the
// verification, in the two halves it naturally has:
//
//   · PURE (here): the exact string PayPal signed, the allowlist of hosts a
//     certificate may be fetched from, and the refusal reasons. No crypto, no
//     network, no clock — so a suite can hand it a forged header and read back
//     precisely why it was refused.
//   · NOT PURE (routes/webhooks.js): the RSA-SHA256 verify and the certificate
//     fetch, which need node:crypto and a socket. shared/ is bundled into the
//     browser, so neither may live here.
//
// ── THE SIGNED STRING, FROM PAYPAL'S OWN REFERENCE ─────────────────────────
// Confirmed against developer.paypal.com (webhook signature verification):
//
//     transmissionId | transmissionTime | webhookId | crc32(rawBody)
//
// joined with literal pipes, signed RSA-SHA256 with the certificate at
// `paypal-cert-url`, and sent base64 in `paypal-transmission-sig`.
//
// THE CERT URL IS THE ATTACK. `paypal-cert-url` is a URL out of the REQUEST:
// an attacker who can make Steward fetch a certificate from a host they
// control can sign anything they like and have it verify. So the host is
// checked against an allowlist BEFORE a socket is opened, and https is
// required. That check is the whole reason this is a module rather than four
// lines in a route.
//
// Pure: no DB, no network, no crypto, no clock, no JSX.

// Only PayPal's own domains, and only over TLS.
export const CERT_HOSTS = ["api.paypal.com", "api-m.paypal.com",
                           "api.sandbox.paypal.com", "api-m.sandbox.paypal.com"];

export const REQUIRED_HEADERS = ["paypal-transmission-id", "paypal-transmission-time",
                                 "paypal-transmission-sig", "paypal-cert-url", "paypal-auth-algo"];

// PayPal signs with SHA256withRSA and says so in the header. Anything else is
// refused rather than mapped: an algorithm Steward has not thought about is
// not one it should accept because the name looked close enough.
export const AUTH_ALGO = "SHA256withRSA";

export const REFUSALS = {
  no_webhook_id: "Steward has no PayPal webhook id configured, so it cannot check that PayPal sent this.",
  missing_headers: "That request did not carry PayPal's signature headers.",
  bad_algo: "That request was signed with an algorithm Steward does not accept.",
  bad_cert_host: "That request pointed at a certificate somewhere other than PayPal.",
  bad_signature: "That request's signature did not match what PayPal signs.",
};

// CRC32, the ordinary one (IEEE 802.3, reflected, init 0xFFFFFFFF), over the
// RAW body bytes. It must be the bytes as received: re-serialising the JSON
// changes the checksum and every legitimate webhook then fails.
const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(bytes) {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function certHostAllowed(certUrl) {
  let u;
  try { u = new URL(String(certUrl || "")); } catch { return false; }
  return u.protocol === "https:" && CERT_HOSTS.includes(u.hostname);
}

/**
 * Everything that can be decided WITHOUT crypto or a socket.
 * @returns {{ok:true, signedString:string, certUrl:string, signature:string}
 *          |{ok:false, reason:string, sentence:string}}
 */
export function prepareVerification({ headers = {}, rawBody, webhookId }) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : v;
  if (!webhookId) return refuse("no_webhook_id");
  for (const name of REQUIRED_HEADERS) if (!h[name]) return refuse("missing_headers");
  if (String(h["paypal-auth-algo"]).toUpperCase() !== AUTH_ALGO.toUpperCase()) return refuse("bad_algo");
  if (!certHostAllowed(h["paypal-cert-url"])) return refuse("bad_cert_host");
  const body = typeof rawBody === "string" ? new TextEncoder().encode(rawBody) : (rawBody || new Uint8Array());
  const signedString = [h["paypal-transmission-id"], h["paypal-transmission-time"], webhookId, crc32(body)].join("|");
  return { ok: true, signedString, certUrl: h["paypal-cert-url"], signature: h["paypal-transmission-sig"] };
}

function refuse(reason) { return { ok: false, reason, sentence: REFUSALS[reason] }; }

// ── WHAT AN EVENT MEANS ────────────────────────────────────────────────────
// Only the events this build acts on. Anything else is acknowledged (so PayPal
// stops retrying) and ignored, which is deliberate: a webhook Steward does not
// understand must never become a gift.
export const EVENT_KINDS = {
  "PAYMENT.CAPTURE.COMPLETED": "payment",
  "PAYMENT.SALE.COMPLETED": "payment",
  "PAYMENT.CAPTURE.REFUNDED": "refund",
  "PAYMENT.CAPTURE.REVERSED": "refund",
  "PAYMENT.SALE.REFUNDED": "refund",
  "BILLING.SUBSCRIPTION.ACTIVATED": "recurring_started",
  "BILLING.SUBSCRIPTION.CANCELLED": "recurring_stopped",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED": "recurring_failed",
};
export const eventKind = type => EVENT_KINDS[String(type || "").toUpperCase()] || null;

export default { CERT_HOSTS, REQUIRED_HEADERS, AUTH_ALGO, REFUSALS, crc32,
                 certHostAllowed, prepareVerification, EVENT_KINDS, eventKind };
