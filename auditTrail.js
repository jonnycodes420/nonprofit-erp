// auditTrail.js — FIX-11 Part 1. THE TRAIL EVERY CHANGE LEAVES.
//
// On 30 September a $100,000 gift was recorded by hand on the Creo demo org and
// the audit log did not mention it. The reason was not a filter or a delay: no
// gift path wrote an audit row at all. Thirty-three `writeAuditLog(...)` calls
// existed, every one of them hand-placed in a finance or settings route, and
// the other four hundred and thirty-odd mutating routes wrote nothing.
//
// A list of audit calls is a list somebody forgets to add to, and the thing
// they forget is a record of whose money moved. So the trail is not written by
// routes any more. It is written ONCE, by a middleware every request passes
// through before it reaches a router, and a route that wants a better row
// improves it rather than remembering to create it. A route added tomorrow is
// logged by default and the author does nothing.
//
// This module is the PURE half: what a request is called, which record it
// touched, and what may never be written down. No database, no Express. The
// middleware that uses it is middleware/auditTrail.js.

// ── WHAT MAY NEVER BE WRITTEN DOWN ────────────────────────────────────────
// An audit row is read by more people than any other row in the database: an
// owner, an admin, a bookkeeper, eventually an auditor. Anything that would
// let one of them ACT as somebody else is redacted at the boundary, by key
// name, before the value is ever serialised. Matched loosely and deliberately
// so a field named `api_secret`, `secretSealed` or `password_hash` is all one
// case, and so the next field somebody adds with "token" in its name is
// covered the day it appears rather than the day it leaks.
const SECRET_KEY_RE = /pass|secret|token|sealed|credential|signature|otp|mfa|private|webhook_id|_hash$|^hash$|(^|_)key$|key_|apikey|api_key|cvv|ssn|ein|routing|account_number|card_number/i;

// A redacted value still says that the field CHANGED, because "somebody
// rotated the signing secret at 14:12" is exactly the kind of thing an audit
// log exists to say. It just never says what to.
const REDACTED = "[redacted]";

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 6) return "[deep]";
  if (Array.isArray(value)) return value.slice(0, 200).map(v => redact(v, depth + 1));
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    const out = {};
    for (const k of Object.keys(value)) {
      if (SECRET_KEY_RE.test(k)) { out[k] = REDACTED; continue; }
      out[k] = redact(value[k], depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return value.slice(0, 2000) + "…";
  return value;
}

// ── THE DIFF ──────────────────────────────────────────────────────────────
// Only the fields that actually moved, and both sides of each. A row that
// listed every column would be unreadable and would hide the one change that
// mattered inside forty that did not. Timestamps the database maintains
// itself are not changes anybody made.
const NOISE_COLUMNS = new Set(["updated_at", "created_at", "search_vector", "tsv"]);

function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined || b === "";
  if (b === null || b === undefined) return a === "";
  if (a instanceof Date || b instanceof Date) {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  // Postgres hands numerics back as strings ("100000.00"), and the value that
  // went in was a number. "100000.00" and 100000 are the same amount, and an
  // audit row claiming the amount changed when it did not is a false accusation.
  if (typeof a !== "object" && typeof b !== "object") {
    const na = Number(a), nb = Number(b);
    if (String(a).trim() !== "" && String(b).trim() !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
    return String(a) === String(b);
  }
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

// Returns { before, after } carrying ONLY the changed fields, already
// redacted, or null when nothing moved.
function diffFields(before, after) {
  if (!before && !after) return null;
  const b = before || {}, a = after || {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const outB = {}, outA = {};
  let n = 0;
  for (const k of keys) {
    if (NOISE_COLUMNS.has(k)) continue;
    if (sameValue(b[k], a[k])) continue;
    if (SECRET_KEY_RE.test(k)) { outB[k] = REDACTED; outA[k] = REDACTED; n++; continue; }
    outB[k] = redact(b[k]); outA[k] = redact(a[k]); n++;
  }
  if (!n) return null;
  return { before: outB, after: outA };
}

// ── WHAT A REQUEST IS CALLED ──────────────────────────────────────────────
// Derived from the matched Express route PATTERN, never from the concrete URL:
// the pattern is what identifies the route, and reading ids out of a concrete
// path means guessing which segment is an id. `/donors/:id/gifts` is a gift
// created on a donor whatever the donor's id happens to be.
//
// THE RULE that does most of the work: a POST whose last pattern segment
// follows a `:param` is an ACTION ON that record, not a sub-resource. That is
// what makes `/gifts/:id/void` a void, `/donors/:id/merge` a merge and
// `/campaigns/:id/send` a send, with nothing hand-written anywhere.
const VERB_PAST = {
  void: "voided", unvoid: "reinstated", merge: "merged", send: "sent", resend: "resent",
  cancel: "canceled", pause: "paused", resume: "resumed", approve: "approved",
  reject: "rejected", undo: "undone", archive: "archived", restore: "restored",
  publish: "published", unpublish: "unpublished", enable: "enabled", disable: "disabled",
  revoke: "revoked", rotate: "rotated", refund: "refunded", import: "imported",
  export: "exported", invite: "invited", remove: "removed", assign: "assigned",
  unassign: "unassigned", seat: "seated", unseat: "unseated", "check-in": "checked in",
  thank: "thanked", acknowledge: "acknowledged", confirm: "confirmed", verify: "verified",
  connect: "connected", disconnect: "disconnected", reconcile: "reconciled",
  deposit: "deposited", close: "closed", reopen: "reopened", duplicate: "duplicated",
  activate: "activated", deactivate: "deactivated", complete: "completed", start: "started",
  stop: "stopped", sync: "synced", regenerate: "regenerated", clear: "cleared",
  apply: "applied", split: "split", "write-off": "written off",
};

const METHOD_ACTION = { POST: "created", PUT: "updated", PATCH: "updated", DELETE: "deleted" };

// Routes whose generic reading would be wrong or unhelpfully vague. SMALL on
// purpose: every entry here is a line somebody has to maintain, so it only
// holds cases where the pattern genuinely does not say what happened.
const ROUTE_OVERRIDES = [
  [/^\/auth\/login$/,                        { entity: "session", action: "signed in", actionRefused: "sign-in refused", logFailures: true, actorFromBody: "email" }],
  [/^\/auth\/login\/verify$/,                { entity: "session", action: "signed in", actionRefused: "sign-in refused", logFailures: true, actorFromBody: "email" }],
  [/^\/auth\/logout$/,                       { entity: "session", action: "signed out" }],
  [/^\/auth\/register$/,                     { entity: "organisation", action: "created", actorFromBody: "email" }],
  [/^\/auth\/forgot-password$/,              { entity: "password", action: "reset requested", actionRefused: "reset request refused", logFailures: true, actorFromBody: "email" }],
  [/^\/auth\/reset-password$/,               { entity: "password", action: "reset", logFailures: true }],
  [/^\/me\/password$/,                       { entity: "password", action: "changed" }],
  [/^\/me\/mfa/,                             { entity: "two-step sign-in", action: "changed" }],
  [/^\/donors\/import/,                      { entity: "import", action: "imported", bulk: true }],
  [/^\/gifts\/import/,                       { entity: "import", action: "imported", bulk: true }],
  [/import/,                                 { bulk: true }],
  [/^\/stripe\/webhook$/,                    { entity: "payment", action: "received", system: "Stripe sync" }],
  [/^\/billing\/webhook$/,                   { entity: "subscription", action: "received", system: "Stripe billing" }],
  [/^\/paypal\/webhook$/,                    { entity: "payment", action: "received", system: "PayPal sync" }],
  [/^\/inbound-email$/,                      { entity: "message", action: "received", system: "Inbound email" }],
  [/^\/resend\/webhook$/,                    { entity: "email", action: "delivery reported", system: "Resend" }],
];

// A POST that computes and returns something without changing anything. These
// are the only mutating-METHOD routes that are not mutating ROUTES, and each
// one is named rather than matched by a loose pattern, so a real write cannot
// slip in behind a word like "preview". The route inventory test reads THIS
// list: adding to it is a visible decision, and the default for everything
// else, including every route written after today, is that it is logged.
const READ_ONLY_POSTS = [
  /^\/donors\/import\/(preview|detect|analyse|analyze)$/,
  /^\/gifts\/import\/(preview|detect)$/,
  /^\/import\/(preview|detect|shape|map-preview)$/,
  /^\/reports\/[^/]*\/?(preview|run|render)$/,
  /^\/receipts\/preview$/,
  /^\/(ai|agent)\/(draft|suggest|stream|preview|brief)$/,
  /^\/email\/preview$/,
  /^\/appeals\/[^/]+\/preview$/,
  /^\/search$/,
  /^\/geocode\/preview$/,
  /^\/bookkeeper\/preview$/,
];

function isReadOnlyPost(pattern) {
  return READ_ONLY_POSTS.some(re => re.test(pattern));
}

function singular(word) {
  const w = String(word || "");
  if (/ies$/.test(w)) return w.replace(/ies$/, "y");
  if (/(ses|xes|zes|ches|shes)$/.test(w)) return w.replace(/es$/, "");
  if (/s$/.test(w) && !/ss$/.test(w)) return w.replace(/s$/, "");
  return w;
}

function prettify(word) {
  return singular(String(word || "").replace(/[-_]+/g, " ")).trim();
}

// describeRoute("POST", "/donors/:id/gifts") →
//   { entity: "gift", action: "created", resource: "gifts", idParam: null, ... }
function describeRoute(method, pattern) {
  const m = String(method || "").toUpperCase();
  const p = String(pattern || "").split("?")[0] || "/";
  const segs = p.split("/").filter(Boolean);

  let out = {
    method: m,
    pattern: p,
    entity: null,
    action: METHOD_ACTION[m] || m.toLowerCase(),
    resource: null,     // the table-shaped plural, when the pattern has one
    idParam: null,      // the :param that names the record, when there is one
    created: null,      // the sub-resource a POST creates, when the pattern names one
    family: null,       // the resource family the route lives under ("/gifts/import-history" → "gift")
    bulk: false,
    logFailures: false,
    system: null,
    actorFromBody: null,
    actionRefused: null,
    readOnly: m === "POST" && isReadOnlyPost(p),
  };

  const last = segs[segs.length - 1] || "";
  // The FIRST segment names the family. A bulk row counts donors or gifts, not
  // "import-histories" — reading the noun off the last segment gave
  // "Imported 243 records" and "Removed 12 bulk deletes".
  out.family = segs.length && !segs[0].startsWith(":") ? prettify(segs[0]) : null;
  const paramIdx = segs.map((s2, i) => [s2, i]).filter(([s2]) => s2.startsWith(":")).map(([, i]) => i);
  const lastParamIdx = paramIdx.length ? paramIdx[paramIdx.length - 1] : -1;
  out.idParam = lastParamIdx >= 0 ? segs[lastParamIdx].slice(1) : null;

  // THE RECORD THIS REQUEST IS ABOUT, for the before-snapshot: the plural
  // segment immediately in front of the id param. `/users/:id/role` is a
  // change to a USER whatever the sub-path is called, and that is the row
  // whose fields belong in before/after.
  out.resource = lastParamIdx > 0 && !segs[lastParamIdx - 1].startsWith(":")
    ? segs[lastParamIdx - 1]
    : (lastParamIdx === -1 && !last.startsWith(":") ? last : null);

  if (last.startsWith(":")) {
    out.entity = out.resource ? prettify(out.resource) : prettify(last.slice(1));
  } else if (VERB_PAST[last] && lastParamIdx >= 0) {
    // /gifts/:id/void, /donors/:id/merge — an ACTION on the record named by
    // the id param. This is the branch that earns its keep: it names the
    // void, the merge and the send with nothing hand-written per route.
    out.entity = out.resource ? prettify(out.resource) : prettify(last);
    out.action = VERB_PAST[last];
  } else if (lastParamIdx >= 0 && lastParamIdx < segs.length - 1) {
    // /donors/:id/gifts, /events/:id/tables, /users/:id/role — a sub-record
    // of the record named by the id param. The CREATED row is the sub-record;
    // the surrounding record is still what before/after describes for an edit.
    out.created = last;
    out.entity = prettify(last);
  } else if (VERB_PAST[last] && segs.length > 1) {
    out.resource = segs[segs.length - 2];
    out.entity = prettify(out.resource);
    out.action = VERB_PAST[last];
  } else {
    out.created = last;
    out.entity = prettify(last);
  }

  for (const [re, patch] of ROUTE_OVERRIDES) {
    if (re.test(p)) Object.assign(out, patch);
  }
  if (!out.entity) out.entity = "record";
  return out;
}

// ── ONE ROW FOR A BULK ACTION, AND ITS SENTENCE ───────────────────────────
// "Imported 243 gifts, $240,853.00, from bookkeeper.csv". One line of
// history; two hundred and forty-three lines is a wall nobody reads, and the
// one import that went wrong would be invisible inside it.
//
// Built from the response the route already returns rather than from a
// sentence each import route writes for itself, so an import added later gets
// a summary without anybody remembering to. A route that knows better says so
// with req.audit.summary().
const BULK_COUNTERS = [
  ["created", "created"], ["inserted", "imported"], ["imported", "imported"],
  ["updated", "updated"], ["deleted", "removed"], ["purged", "removed"],
  ["merged", "merged"], ["tagged", "tagged"], ["sent", "sent"],
  ["skipped", "skipped"], ["duplicates", "skipped as duplicates"], ["invalid", "refused"],
];
const MONEY_KEYS = ["totalAmount", "total_amount", "gross", "grossAmount", "amountTotal", "sum"];
const FILE_KEYS = ["fileName", "filename", "sourceFile", "source_file", "file"];

function usd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pickNumber(obj, key) {
  const v = obj && obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object" && typeof v.length === "number") return v.length;
  return null;
}

// Returns { text, count } or null when the response says nothing countable —
// in which case the row still exists, just without a tally on it.
function bulkSummary(desc, responseBody, requestBody) {
  const b = responseBody && typeof responseBody === "object" ? responseBody : {};
  const parts = [];
  let primary = null;
  const noun = (desc && desc.family) || (desc && desc.entity) || "record";
  const rest = [];
  for (const [key, word] of BULK_COUNTERS) {
    const n = pickNumber(b, key);
    if (n === null || n === 0) continue;
    if (primary === null) {
      primary = n;
      parts.push(`${word.charAt(0).toUpperCase() + word.slice(1)} ${n} ${n === 1 ? noun : noun + "s"}`);
    } else {
      rest.push(`${n} ${word}`);
    }
  }
  if (primary === null) return null;
  let money = null;
  for (const k of MONEY_KEYS) { const v = pickNumber(b, k); if (v !== null && v !== 0) { money = usd(v); break; } }
  if (money) parts.push(money);
  let file = null;
  for (const k of FILE_KEYS) {
    const v = requestBody && requestBody[k];
    if (typeof v === "string" && v.trim()) { file = v.trim().slice(0, 200); break; }
    if (v && typeof v === "object" && typeof v.name === "string" && v.name.trim()) { file = v.name.trim().slice(0, 200); break; }
  }
  let text = parts.join(", ");
  if (file) text += `, from ${file}`;
  if (rest.length) text += `, ${rest.join(", ")}`;
  return { text, count: primary };
}

// ── THE SENTENCE A ROW READS AS ───────────────────────────────────────────
// Built on the server so the screen, the CSV and a future PDF say the same
// words. "Every number has a sentence" applies to a row of history too.
function rowSentence(row) {
  const who = row.user_name || row.actor_name || "System";
  const action = row.action || "changed";
  const entity = row.entity_label || row.entity_type || "a record";
  if (row.summary) return `${who} ${action} ${row.summary}`;
  return `${who} ${action} ${entity}`;
}

module.exports = {
  SECRET_KEY_RE, REDACTED, NOISE_COLUMNS, VERB_PAST, READ_ONLY_POSTS,
  redact, diffFields, sameValue, describeRoute, isReadOnlyPost, singular, prettify, rowSentence,
  bulkSummary, usd,
};
