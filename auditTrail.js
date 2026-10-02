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
// FIX-14 Part 2: the "Edited by, when" stamp is bookkeeping of the edit
// itself, not a field anybody changed.
const NOISE_COLUMNS = new Set(["updated_at", "created_at", "search_vector", "tsv", "edited_at", "edited_by", "edited_by_name"]);

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
  // FIX-12 Part 5: a refused removal is the security event (user_admin_audit's old job).
  [/^\/users\/:id$/,                        { entity: "user", actionRefused: "removal refused", logFailures: true }],
  [/^\/me\/password$/,                       { entity: "password", action: "changed" }],
  [/^\/me\/mfa/,                             { entity: "two-step sign-in", action: "changed" }],
  [/^\/donors\/import/,                      { entity: "import", action: "imported", bulk: true }],
  [/^\/gifts\/import/,                       { entity: "import", action: "imported", bulk: true }],
  [/import/,                                 { bulk: true }],
  // ── FIX-11 Part 6 tail — THE AGENT IS THE ACTOR, AND A HUMAN APPROVED IT ──
  //
  // Part 1 left this open and said so in the census: the middleware supported
  // `req.audit.actor(...)` and no route set it, so an action a MODEL drafted
  // and a person merely approved was logged as that person's own work. The row
  // was correct about who authorised it and silent about the fact a model
  // wrote it, which is precisely the thing oversight exists to record.
  //
  // Declared HERE, by route pattern, for the same reason everything else in
  // this file is: one list, visible, rather than a line added to each of
  // twenty-nine agent routes and forgotten on the thirtieth. The middleware
  // turns `agentApproved` into "Agent, approved by Dana Reyes".
  //
  // These are the routes where the agent's OWN draft becomes a real write. An
  // instruction being created, paused or discarded is the person's own act and
  // is logged as theirs; `/agent/writes/:id/undo` is a person undoing the
  // agent, which is also theirs.
  [/^\/agent\/waiting\/[^/]+\/[^/]+\/approve$/, { agentApproved: true, action: "approved" }],
  [/^\/agent\/drafts\/[^/]+\/send$/,            { agentApproved: true, action: "sent" }],
  [/^\/thank-yous\/[^/]+\/send$/,                { agentApproved: true, action: "sent" }],
  [/^\/org\/import-health\/confirm-gift$/,        { agentApproved: true, action: "confirmed" }],
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
    agentApproved: false,
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

// ── FIX-14 Part 2 · WHAT HAPPENED, IN A PLAIN SENTENCE ────────────────────
// The audit screen's Description is never a dash. Built from what the row
// already holds (the action, the record, the fields that moved, their before
// and after) plus the names of the people it is about, which are looked up
// as the log is read (FIX-12: a row stores people by id). Pure, so the
// screen, the CSV and a donor's History say the same words.
//   "Logged a meeting with Octavian Cobbleworth"
//   "Changed the meeting date from Oct 2 to Oct 1"
//   "Created a next step for Octavian Cobbleworth: follow up around Nov 1"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return v == null || v === "" ? "no date" : String(v);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}
const CONVERSATION_WORD = { call: "call", meeting: "meeting", email: "email", note: "note", visit: "visit",
  event: "event", letter: "letter", text: "text", voice_memo: "voice memo", stewardship: "stewardship touch",
  ask: "ask", other: "conversation", gift: "gift", stage_change: "stage change", planned_gift: "planned gift note" };
const FIELD_WORD = {
  date: "date", note: "note", type: "type", donor_id: "person it is about", metadata: "details",
  next_step_label: "step", due_date: "due date", due_time: "time", title: "title", due: "due date",
  done: "done", priority: "priority", amount: "amount", fund_id: "fund", payment_method: "payment method",
  stage: "stage", status: "status", assigned_to: "owner", email: "email", phone: "phone", name: "name",
};
const ENTITY_WORD = { thread: "next step", interaction: "conversation", "donor relationship": "relationship" };
const lowerFirst = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
const upperFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
function usdShort(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
function showValue(field, v) {
  if (v === null || v === undefined || v === "") return "nothing";
  if (/date|^due$/.test(field)) return shortDate(v);
  if (field === "amount") return usdShort(v);
  if (typeof v === "object") return "new details";
  const s = String(v);
  return s.length > 40 ? `"${s.slice(0, 37)}..."` : `"${s}"`;
}
// The donor a row is about, by id: the record itself when it is a person, or
// the donor_id the record carries (on the row, or in the context the
// middleware kept beside a diff).
function auditDonorId(row) {
  const t = String(row.entity_type || "");
  if (/^(donor|person|people|organisation|organization|stage)$/.test(t) && !/^user_/.test(String(row.entity_id || ""))) return row.entity_id || null;
  const ctx = (row.changes && row.changes.record) || {};
  return (row.after && row.after.donor_id) || (row.before && row.before.donor_id) || ctx.donor_id || null;
}
function describeAuditRow(row, ctx = {}) {
  const people = ctx.people || new Map();
  const action = String(row.action || "changed");
  const type = String(row.entity_type || "record");
  const rec = (row.changes && row.changes.record) || {};
  const full = row.after || row.before || {};
  const donorId = auditDonorId(row);
  const who = donorId ? (people.get(String(donorId)) || null) : null;
  if (row.summary) return upperFirst(String(row.summary));
  if (action === "downloaded") return `Downloaded ${row.entity_label || "a file"}`;
  if (type === "session") return action === "signed out" ? "Signed out" : upperFirst(action);
  const changed = row.before && row.after && action === "updated"
    ? Object.keys({ ...row.before, ...row.after }).filter(k => !/^(edited_|updated_at|created_at)/.test(k)) : [];

  // CONVERSATIONS: a call, a meeting, an email, a note, a visit.
  if (/^(interaction|conversation|touchpoint)$/.test(type)) {
    const word = CONVERSATION_WORD[full.type || rec.type] || "conversation";
    const withWho = who ? ` with ${who}` : "";
    if (action === "created") {
      const ns = full.next_step && typeof full.next_step === "object" ? full.next_step : null;
      return `Logged a ${word}${withWho}${ns && ns.label ? `, with a next step: ${lowerFirst(ns.label)} around ${shortDate(ns.due)}` : ""}`;
    }
    if (action === "deleted") return `Deleted a ${word}${withWho}${full.date ? ` from ${shortDate(full.date)}` : ""}`;
    if (action === "restored") return `Restored a ${word}${withWho} (Undo)`;
    if (changed.length) {
      const parts = changed.map(k => {
        if (k === "note") return "the note";
        if (k === "donor_id") return `who it is about`;
        if (k === "metadata") return "the details";
        return `the ${FIELD_WORD[k] || k.replace(/_/g, " ")} from ${showValue(k, row.before[k])} to ${showValue(k, row.after[k])}`;
      });
      const first = parts[0].replace(/^the /, `the ${word} `);
      return `Changed ${[first, ...parts.slice(1)].join(" and ")}${who ? ` (${who})` : ""}`;
    }
  }
  // NEXT STEPS.
  if (/^(thread|next step)$/.test(type)) {
    const forWho = who ? ` for ${who}` : "";
    const label = full.next_step_label || rec.label;
    const due = full.due_date || rec.due;
    if (action === "created") return `Created a next step${forWho}${label ? `: ${lowerFirst(label)}` : ""}${due ? ` around ${shortDate(due)}` : ""}`;
    if (action === "deleted") return `Deleted the next step${forWho}${label ? `: ${lowerFirst(label)}` : ""}`;
    if (action === "restored") return `Restored the next step${forWho} (Undo)`;
    if (action === "dismissed") return `Dismissed the next step${forWho}`;
    if (changed.length) {
      return `Changed the next step${forWho}: ` + changed.map(k =>
        `${FIELD_WORD[k] || k.replace(/_/g, " ")} from ${showValue(k, row.before[k])} to ${showValue(k, row.after[k])}`).join(", ");
    }
  }
  // TASKS.
  if (type === "task") {
    const title = full.title || rec.title;
    const forWho = who ? ` for ${who}` : "";
    if (action === "created") return `Created a task${forWho}${title ? `: ${title}` : ""}${full.due ? ` due ${shortDate(full.due)}` : ""}`;
    if (action === "deleted") return `Deleted a task${forWho}${title ? `: ${title}` : ""}`;
    if (action === "restored") return `Restored a task${forWho} (Undo)`;
    if (action === "completed" || (changed.length === 1 && changed[0] === "done")) {
      return `${Number(row.after && row.after.done) ? "Completed" : "Reopened"} a task${forWho}${title ? `: ${title}` : ""}`;
    }
  }
  if (type === "gift") {
    const from = who ? ` from ${who}` : "";
    const amt = full.amount != null && !(row.before && row.after && action === "updated") ? `${usdShort(full.amount)} ` : "";
    if (action === "created") return `Recorded a ${amt}gift${from}`;
    if (action === "deleted") return `Deleted a ${amt}gift${from}`;
    if (action === "voided") return `Voided a ${amt}gift${from}`;
  }
  if (/\/auth\/register$/.test(String(row.request_path || ""))) return "Created this organization's Steward account";
  if (type === "stage" && row.before && row.after && row.after.stage !== undefined) {
    return `Moved ${who || "a person"} from ${upperFirst(String(row.before.stage || "no stage"))} to ${upperFirst(String(row.after.stage || "no stage"))}`;
  }
  if (/^(donor|person|people|organisation|organization)$/.test(type)) {
    const name = who || row.entity_label || "a person";
    if (action === "created") return `Added ${name}`;
    if (action === "deleted") return `Deleted ${name}`;
    if (changed.length === 1 && changed[0] === "stage") {
      return `Moved ${name} from ${upperFirst(String(row.before.stage || "no stage"))} to ${upperFirst(String(row.after.stage || "no stage"))}`;
    }
    if (changed.length) return `Changed ${name}: ${changed.map(k => FIELD_WORD[k] || k.replace(/_/g, " ")).join(", ")}`;
    return `${upperFirst(action)} ${name}`;
  }

  // EVERYTHING ELSE: the action, the record, and what moved.
  const noun = ENTITY_WORD[type] || type;
  const label = row.entity_label && !/^\[person\]$/.test(row.entity_label) ? ` ${row.entity_label}` : "";
  const forWho = who && !label ? ` for ${who}` : "";
  const article = action === "created" ? (/^[aeiou]/i.test(noun) ? "an" : "a") : "the";
  let s = `${upperFirst(action)} ${article} ${noun}${label}${forWho}`;
  if (changed.length) {
    const few = changed.slice(0, 3).map(k => {
      const w = FIELD_WORD[k] || k.replace(/_/g, " ");
      const bv = row.before[k], av = row.after[k];
      return (typeof bv === "object" && bv) || (typeof av === "object" && av) || k === "note" || /\[(redacted|person)\]/.test(String(av))
        ? w : `${w} from ${showValue(k, bv)} to ${showValue(k, av)}`;
    });
    s += `: ${few.join(", ")}${changed.length > 3 ? ` and ${changed.length - 3} more` : ""}`;
  }
  if (row.record_count != null && !row.summary) s += ` (${row.record_count} records)`;
  return s;
}

// The Entity column's name for the record: what a person would call it.
function auditRecordName(row, ctx = {}) {
  const people = ctx.people || new Map();
  const type = String(row.entity_type || "");
  const rec = (row.changes && row.changes.record) || {};
  const full = row.after || row.before || {};
  const donorId = auditDonorId(row);
  const who = donorId ? people.get(String(donorId)) : null;
  if (/^(interaction|conversation|touchpoint)$/.test(type)) {
    const word = upperFirst(CONVERSATION_WORD[full.type || rec.type] || "conversation");
    return who ? `${word} with ${who}` : word;
  }
  if (/^(thread|next step)$/.test(type)) return who ? `Next step for ${who}` : "Next step";
  if (type === "task") return full.title || (who ? `Task for ${who}` : "Task");
  if (type === "gift") return who ? `Gift from ${who}` : (row.entity_label || "Gift");
  if (/^(donor|person|people|organisation|organization|stage)$/.test(type)) return who || row.entity_label || "A person";
  return row.entity_label || (who ? `${upperFirst(ENTITY_WORD[type] || type)} for ${who}` : upperFirst(ENTITY_WORD[type] || type || "Record"));
}

module.exports = {
  auditRecordName,
  SECRET_KEY_RE, REDACTED, NOISE_COLUMNS, VERB_PAST, READ_ONLY_POSTS,
  redact, diffFields, sameValue, describeRoute, isReadOnlyPost, singular, prettify, rowSentence,
  bulkSummary, usd, describeAuditRow, auditDonorId, shortDate,
};
