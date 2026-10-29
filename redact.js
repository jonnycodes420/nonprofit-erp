// redact.js — SECURE-2 item 1. ONE REDACTOR FOR EVERY LOG LINE AND EVERY SENTRY EVENT.
//
// Server logs, error logs and Sentry never carry a donor's or a staff member's
// email, name, phone, street address, a full IP address, a token, a cookie, a
// request body or a secret. They keep what finds a problem: the request id,
// the route, the status, the timing and the org id.
//
// Two layers, because a log line is either a value with a name or free text:
//   · BY KEY. Inside an object, a value whose key names a person's details
//     (name, email, phone, address…), a credential (token, password, secret,
//     cookie, authorization…) or a body is replaced whole.
//   · BY SHAPE. In any string, an email, a phone number, a street address, an
//     IP, a bearer token, a JWT, a provider key and a token= query value are
//     replaced by what they are ("[email]", "[phone]"…).
// A name in free text has no shape, so a call site that would print one
// prints the record's id instead (that is the rule for new code too).
//
// install() runs once, first thing in server.js: it wraps console.* so every
// existing log call goes through here, and sentryOptions() hands Sentry the
// same functions for beforeSend and beforeBreadcrumb.
"use strict";

const MASK = {
  email: "[email]", phone: "[phone]", address: "[address]", ip: "[ip]",
  token: "[token]", secret: "[secret]", redacted: "[redacted]",
};

// Keys whose value is a person's details, a credential or a body. Matched on
// the key with case, dashes and underscores ignored, so `first_name`,
// `firstName` and `First-Name` are one key.
const PERSON_KEYS = new Set([
  "name", "firstname", "lastname", "fullname", "displayname", "donorname", "username", "contactname",
  "preferredname", "nickname", "spousename", "sendername", "recipientname", "toname", "fromname",
  "email", "emails", "emailaddress", "to", "from", "cc", "bcc", "replyto", "recipient", "recipients",
  "phone", "phones", "mobile", "cell", "telephone", "phonenumber", "sms",
  "address", "address1", "address2", "addressline1", "addressline2", "street", "streetaddress",
  "line1", "line2", "postal", "postalcode", "zip", "zipcode",
  "ip", "ipaddress", "remoteaddress", "xforwardedfor", "xrealip",
]);
const SECRET_KEYS = new Set([
  "password", "passwordhash", "newpassword", "currentpassword", "pass", "secret", "clientsecret",
  "token", "accesstoken", "refreshtoken", "idtoken", "trusttoken", "resettoken", "apikey", "privatekey",
  "authorization", "cookie", "cookies", "setcookie", "otp", "mfacode", "totp", "recoverycode", "recoverycodes",
  "jwt", "session", "sessiontoken", "signature", "stripesignature", "svixsignature", "webhooksecret",
  "card", "cardnumber", "cvc", "ssn", "ein", "taxid", "accountnumber", "routingnumber",
]);
const BODY_KEYS = new Set(["body", "rawbody", "data", "html", "text", "notes", "note", "message_body", "messagebody", "subject", "rows", "sheets", "grid"]);
const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");

// ── BY SHAPE ────────────────────────────────────────────────────────────────
// Order matters: a JWT and a bearer token are taken before the long-secret
// rule, an email before anything that might eat its domain.
const SHAPES = [
  // Bearer / Basic credentials in a header echoed into a line.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/g, (_m, kind) => `${kind} ${MASK.token}`],
  // A JWT: three base64url parts, the first starting eyJ.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, MASK.token],
  // Provider keys: Stripe, Resend, webhook secrets, Anthropic, GitHub, Slack, AWS.
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, MASK.secret],
  [/\b(?:whsec|re|acct_secret|sk-ant(?:-[a-z0-9]+)?)_[A-Za-z0-9+\/=_-]{8,}/g, MASK.secret],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, MASK.secret],
  [/\b(?:ghp|gho|ghs|github_pat|xox[abpr])_[A-Za-z0-9_-]{8,}/g, MASK.secret],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK.secret],
  // token=…, code=…, key=… in a URL or a query string (reset links, cancel
  // links, invite links, OAuth callbacks).
  [/([?&;](?:token|code|key|secret|sig|signature|state|access_token|refresh_token|t)=)[^&#\s"'<>]+/gi, (_m, p) => p + MASK.token],
  // Emails (before phones, so digits in a local part stay with their address).
  [/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, MASK.email],
  // IPv4: an address in full is never kept (the first three parts are, as the
  // session list does, so "the office" is still recognisable).
  [/\b(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, (m, a, b, c) =>
    [a, b, c].every(n => Number(n) <= 255) ? `${a}.${b}.${c}.x` : m],
  // IPv6 with at least four groups: keep the first three.
  [/\b([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::[0-9a-f]{0,4}){3,5}\b/gi, (_m, a, b, c) => `${a}:${b}:${c}:…`],
  // Street addresses: a house number, one to four capitalised words, a street word.
  [/\b\d{1,6}\s+(?:[A-Z][A-Za-z.'-]*\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct|Way|Place|Pl|Circle|Cir|Terrace|Ter|Parkway|Pkwy|Highway|Hwy|Pike|Trail|Trl|Square|Sq)\b\.?(?:\s*(?:Apt|Suite|Ste|Unit|#)\s*[A-Za-z0-9-]+)?/g, MASK.address],
  // Phones: North American with separators, or international with a +.
  [/(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, MASK.phone],
  [/\+\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g, MASK.phone],
  [/\b(?:\+?1)?[2-9]\d{2}[2-9]\d{6}\b(?![-_]|\.\d)/g, MASK.phone],
];

function redactString(s) {
  if (typeof s !== "string" || !s) return s;
  let out = s;
  for (const [re, rep] of SHAPES) out = out.replace(re, rep);
  return out;
}

// ── BY KEY, RECURSIVELY ─────────────────────────────────────────────────────
// Errors keep their class, message and stack (redacted). Cycles and depth are
// bounded so a log call can never hang or blow the stack.
function redactValue(v, depth = 0, seen = new WeakSet()) {
  if (v == null) return v;
  if (typeof v === "string") return redactString(v);
  if (typeof v !== "object") return v;
  if (depth > 6) return "[…]";
  if (seen.has(v)) return "[circular]";
  seen.add(v);
  if (v instanceof Error) {
    const e = new Error(redactString(v.message));
    try { e.name = v.name; } catch { /* read-only */ }
    e.stack = redactString(String(v.stack || ""));
    for (const k of Object.keys(v)) {
      if (k === "message" || k === "stack") continue;
      try { e[k] = redactField(k, v[k], depth, seen); } catch { /* frozen */ }
    }
    return e;
  }
  if (Buffer.isBuffer(v)) return `[${v.length} bytes]`;
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => redactValue(x, depth + 1, seen));
  const out = {};
  for (const k of Object.keys(v)) out[k] = redactField(k, v[k], depth, seen);
  return out;
}
function redactField(k, val, depth, seen) {
  const nk = normKey(k);
  if (val == null || val === "") return val;
  if (SECRET_KEYS.has(nk)) return MASK.redacted;
  if (PERSON_KEYS.has(nk)) return typeof val === "object" ? MASK.redacted : (typeof val === "string" && /^\[[a-z]+\]$/.test(val) ? val : MASK.redacted);
  if (BODY_KEYS.has(nk)) return typeof val === "string" && val.length < 3 ? val : MASK.redacted;
  return redactValue(val, depth + 1, seen);
}

// ── CONSOLE ────────────────────────────────────────────────────────────────
// Format-string arguments are kept as given; each one is redacted on its own,
// so "%s" lines keep their shape.
let installed = false;
function install() {
  if (installed) return;
  installed = true;
  for (const level of ["log", "info", "warn", "error", "debug", "trace"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      let safe;
      try { safe = args.map(a => redactValue(a)); } catch { safe = ["[log line withheld: redaction failed]"]; }
      orig(...safe);
    };
  }
}

// ── SENTRY ─────────────────────────────────────────────────────────────────
// The request is cut down to method, route and the query with tokens masked;
// the body, cookies and every header but a few harmless ones go. The user is
// kept as an id (and the org as a tag); never an email, a name or an IP.
const KEEP_HEADERS = new Set(["user-agent", "content-type", "content-length", "x-request-id", "x-steward-org", "accept"]);
function sentryEvent(event) {
  if (!event || typeof event !== "object") return event;
  try {
    if (event.request) {
      const r = event.request;
      const headers = {};
      for (const [k, v] of Object.entries(r.headers || {})) if (KEEP_HEADERS.has(k.toLowerCase())) headers[k] = redactString(String(v));
      event.request = {
        method: r.method,
        url: redactString(String(r.url || "")),
        query_string: typeof r.query_string === "string" ? redactString(r.query_string) : (r.query_string ? redactValue(r.query_string) : undefined),
        headers,
      };
    }
    if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : {};
    if (event.message) event.message = redactString(event.message);
    if (event.logentry) event.logentry = redactValue(event.logentry);
    if (event.exception && Array.isArray(event.exception.values)) {
      for (const ex of event.exception.values) {
        if (ex.value) ex.value = redactString(ex.value);
        const frames = ex.stacktrace && ex.stacktrace.frames;
        if (Array.isArray(frames)) for (const f of frames) { if (f.vars) f.vars = redactValue(f.vars); }
      }
    }
    if (event.extra) event.extra = redactValue(event.extra);
    if (event.contexts) event.contexts = redactValue(event.contexts);
    if (event.tags) event.tags = redactValue(event.tags);
    if (Array.isArray(event.breadcrumbs)) event.breadcrumbs = event.breadcrumbs.map(sentryBreadcrumb).filter(Boolean);
    else if (event.breadcrumbs && Array.isArray(event.breadcrumbs.values)) event.breadcrumbs.values = event.breadcrumbs.values.map(sentryBreadcrumb).filter(Boolean);
  } catch {
    // A redaction that fails must not let the raw event through.
    return null;
  }
  return event;
}
function sentryBreadcrumb(b) {
  if (!b || typeof b !== "object") return b;
  try {
    const out = { ...b };
    if (out.message) out.message = redactString(out.message);
    if (out.data) out.data = redactValue(out.data);
    return out;
  } catch { return null; }
}
function sentryOptions() {
  return { sendDefaultPii: false, beforeSend: sentryEvent, beforeSendTransaction: sentryEvent, beforeBreadcrumb: sentryBreadcrumb };
}

module.exports = { install, redactString, redactValue, sentryEvent, sentryBreadcrumb, sentryOptions, MASK };
