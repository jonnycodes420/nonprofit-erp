// shared/inboundEmail.js — BUILD-87 Part 3. EMAIL LOGGING BY BCC.
//
// The cheap version of "email integration": no OAuth, no mailbox reading, no
// sync. Each org gets ONE logging address — `log+<org_slug>@<inbound domain>`
// — and a staff member BCCs it on any email she sends a donor. The message
// lands on that donor's record as an `email` activity.
//
// Everything in this file is PURE: no network, no database, no provider SDK,
// no JSX. The webhook in server.js does exactly two things this module cannot
// — read rows, and write them. That split is what lets the whole inbound path
// be tested without a mail provider existing yet (see NEEDS-JONATHAN.md §9: the
// subprocessor and its DNS are a human's decision, deliberately not made here).
//
// THE RULES, and why each one is a refusal rather than a guess:
//
//  1. THE ORG IS THE PLUS-ADDRESS, AND NOTHING ELSE. Not the sender's domain,
//     not a lookup on the To address, not "the only org this donor belongs
//     to". Mail with no valid slug is DROPPED and COUNTED — never guessed
//     into somebody's CRM.
//  2. THE SENDER MUST BE A USER OF THAT ORG. The logging address is a
//     capability anybody who has seen one BCC header can type. The sender
//     check is the tenant wall: org B's staff mailing org A's logging address
//     writes nothing, ever.
//  3. AN INBOUND EMAIL NEVER CREATES A DONOR. One donor match logs it; zero
//     or many hold it for a human in the Unmatched list. A CRM that invents
//     constituents from stray mail is a CRM nobody can trust the counts of.
//  4. THE BODY IS PLAIN TEXT, TRIMMED AT THE FIRST REPLY MARKER, CAPPED.
//     A thread quoted six replies deep stores the same paragraph six times
//     and buries the one sentence somebody actually wrote.
//  5. ATTACHMENTS ARE DROPPED. Storing files that arrive over an unauthenticated
//     mail path is a different decision with a different blast radius.

// Plain-text body cap. 10,000 characters is several pages of real writing and
// still small enough that a runaway auto-responder cannot fill a table.
export const BODY_CAP = 10000;

// The local-part prefix of every logging address. One prefix for every org —
// the slug after the `+` is what distinguishes them.
export const LOG_LOCAL_PREFIX = "log";

// Why a message was dropped. These are the COUNTED outcomes: nothing is
// stored from the message itself, only that one arrived and was refused.
// FIX-11 Part 5 — `no_match` moved here from HOLD_KINDS. A message that names
// nobody on file is dropped, not held: see the note where it is returned.
export const DROP_REASONS = ["no_org", "unknown_org", "sender_not_user", "empty", "no_match"];

// Why a message is being held for a human instead of logged.
export const HOLD_KINDS = ["multiple", "self_test"];

// ── addresses ───────────────────────────────────────────────────────────────

/** Lowercase, trimmed, angle-brackets stripped. "" when there is nothing usable. */
export function normalizeEmail(raw) {
  let s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  // "Jane Doe <jane@example.org>" → "jane@example.org"
  const angle = s.match(/<([^>]+)>/);
  if (angle) s = angle[1];
  s = s.replace(/^mailto:/i, "").trim().toLowerCase();
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s) ? s : "";
}

/**
 * Accepts what real webhooks actually send for a recipient field: a string of
 * comma/semicolon-separated addresses, an array of strings, or an array of
 * `{ address }` / `{ email }` objects. Returns normalized addresses, deduped,
 * in order.
 */
export function parseAddressList(value) {
  const out = [];
  const push = (v) => { const e = normalizeEmail(v); if (e && !out.includes(e)) out.push(e); };
  const walk = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === "object") { walk(v.address ?? v.email ?? v.value ?? ""); return; }
    // A display name may itself contain a comma ("Doe, Jane" <j@x.org>), so
    // split on separators that sit OUTSIDE angle brackets and quotes.
    const s = String(v);
    let depth = 0, quoted = false, buf = "";
    for (const ch of s) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === "<") depth++;
      else if (!quoted && ch === ">") depth = Math.max(0, depth - 1);
      if (!quoted && depth === 0 && (ch === "," || ch === ";")) { push(buf); buf = ""; continue; }
      buf += ch;
    }
    push(buf);
  };
  walk(value);
  return out;
}

/** The one logging address for an org. */
export function loggingAddress(orgSlug, domain) {
  const slug = String(orgSlug || "").trim().toLowerCase();
  const dom = String(domain || "").trim().toLowerCase();
  if (!slug || !dom) return "";
  return `${LOG_LOCAL_PREFIX}+${slug}@${dom}`;
}

/** True when `addr` is a logging address on the configured inbound domain. */
export function isLoggingAddress(addr, domain) {
  return slugFromAddress(addr, domain) !== null;
}

/**
 * `log+acme@log.example.org` → "acme". Anything else → null. The domain must
 * match exactly: a `log+acme@` on some other domain is not our address and is
 * not evidence of anything.
 */
export function slugFromAddress(addr, domain) {
  const e = normalizeEmail(addr);
  const dom = String(domain || "").trim().toLowerCase();
  if (!e || !dom) return null;
  const at = e.lastIndexOf("@");
  if (e.slice(at + 1) !== dom) return null;
  const local = e.slice(0, at);
  const m = local.match(/^([a-z0-9._-]+)\+([a-z0-9][a-z0-9-]*)$/);
  if (!m || m[1] !== LOG_LOCAL_PREFIX) return null;
  return m[2];
}

/**
 * The org slug this message is addressed to, from every recipient field a
 * provider might hand us. Returns null when there is no logging address, and
 * null when there are TWO DIFFERENT slugs — a message addressed to two orgs'
 * logging addresses is ambiguous, and an ambiguous tenant is a dropped
 * message, not a coin flip.
 */
export function orgSlugFromPayload(payload, domain) {
  const all = recipientAddresses(payload);
  const slugs = [];
  for (const a of all) {
    const s = slugFromAddress(a, domain);
    if (s && !slugs.includes(s)) slugs.push(s);
  }
  return slugs.length === 1 ? slugs[0] : null;
}

/**
 * Every address the message was delivered to, across the fields providers
 * actually populate. A BCC is invisible in the headers, so the logging address
 * usually arrives only in the envelope recipient — which is why this looks at
 * more than `to`.
 */
export function recipientAddresses(payload) {
  const p = payload || {};
  const out = [];
  for (const v of [p.to, p.cc, p.envelopeTo, p.envelope_to, p.recipient, p.recipients, p.bcc,
                   p.envelope && p.envelope.to]) {
    for (const a of parseAddressList(v)) if (!out.includes(a)) out.push(a);
  }
  return out;
}

// ── FIX-11 Part 5 — THE RESEND ADAPTER ────────────────────────────────────
//
// BUILD-87 built this route provider-agnostic and left the provider unchosen,
// which was right. On 30 September Muse wired Resend inbound at
// log.stewardapp.dev and pointed `email.received` at /inbound-email. It would
// have received nothing, for two reasons, and both were silent:
//
//   1. RESEND NESTS EVERYTHING UNDER `data`. The payload is
//      { type: "email.received", created_at, data: { email_id, from, to, cc,
//      bcc, message_id, subject, attachments } }. This route reads `to` and
//      `from` at the TOP level, so `orgSlugFromPayload` found no recipient,
//      every message was dropped as "no_org", and the drop counter would have
//      been the only trace.
//   2. RESEND'S WEBHOOK CARRIES NO BODY. Not the text, not the html, not the
//      headers — only metadata and an `email_id`. The body is a second call,
//      GET https://api.resend.com/emails/receiving/{id}. So even a flattened
//      payload would have logged a subject and an empty note.
//
// `adaptResendInbound` is the FLATTENING, which is pure and therefore testable
// without a server or a network. Fetching the body is the route's job, because
// only the route has the API key.
export function isResendInbound(payload) {
  const p = payload || {};
  return String(p.type || "") === "email.received" && !!p.data && typeof p.data === "object";
}

export function adaptResendInbound(payload) {
  const p = payload || {};
  const d = p.data || {};
  return {
    // Resend sends `to`, `cc` and `bcc` as ARRAYS of display-name strings
    // ("Acme <ada@x.org>"); parseAddressList already reads both shapes, so
    // they are passed through rather than pre-parsed here.
    to: d.to, cc: d.cc, bcc: d.bcc,
    from: d.from,
    subject: d.subject,
    // The body is not in the webhook. It arrives from the Receiving API and is
    // merged in by the caller; adapting a payload that never had one must not
    // invent an empty string that reads as "the donor wrote nothing".
    text: d.text, html: d.html,
    date: d.created_at || p.created_at,
    messageId: d.message_id,
    // What the caller needs to go and get the body.
    providerEmailId: d.email_id || null,
    provider: "resend",
    attachmentCount: Array.isArray(d.attachments) ? d.attachments.length : 0,
    // GRANTS-1: the list itself, so an email to a funder contact can store any
    // attachment that arrives with its bytes or a download URL.
    attachments: Array.isArray(d.attachments) ? d.attachments : [],
  };
}

// The URL the body comes from. A function so the local test seam
// (RESEND_BASE_URL, the same one every other Resend call uses) applies here
// too, and so no suite needs the internet.
export function resendReceivedUrl(emailId, base) {
  const root = String(base || "https://api.resend.com").replace(/\/+$/, "");
  return `${root}/emails/receiving/${encodeURIComponent(String(emailId))}`;
}

// What the Receiving API hands back, merged onto the adapted payload. Pure, so
// a malformed response is a dropped message rather than a thrown webhook.
export function mergeResendBody(adapted, body) {
  const b = body && typeof body === "object" ? body : {};
  return {
    ...adapted,
    text: typeof b.text === "string" ? b.text : adapted.text,
    html: typeof b.html === "string" ? b.html : adapted.html,
    // The Receiving API's `to`/`cc`/`bcc` are more complete than the webhook's
    // (a BCC is invisible in the headers and arrives as an envelope
    // recipient), so they WIN where present. This is the field the whole
    // org-routing turns on.
    to: b.to !== undefined ? b.to : adapted.to,
    cc: b.cc !== undefined ? b.cc : adapted.cc,
    bcc: b.bcc !== undefined ? b.bcc : adapted.bcc,
    from: b.from !== undefined ? b.from : adapted.from,
    subject: b.subject !== undefined ? b.subject : adapted.subject,
    attachments: Array.isArray(b.attachments) ? b.attachments : adapted.attachments,
    attachmentCount: Array.isArray(b.attachments) ? b.attachments.length : adapted.attachmentCount,
    headers: b.headers,
  };
}

// ── the quoted-reply stripper ───────────────────────────────────────────────

// Each entry is one client's way of saying "everything below here is what the
// other person already wrote". Tested against Gmail, Outlook AND Apple Mail in
// tests/inbound-email.test.js — one format is not a stripper, it is a guess
// that happens to hold on the tester's own machine.
const REPLY_MARKERS = [
  // Gmail and Apple Mail both write an attribution line; Gmail's wraps across
  // lines on long addresses, so the match spans newlines up to "wrote:".
  //   Gmail:      On Mon, Sep 14, 2026 at 9:02 AM Jane Doe <jane@x.org> wrote:
  //   Apple Mail: On Sep 14, 2026, at 9:02 AM, Jane Doe <jane@x.org> wrote:
  /^[ \t>]*On\s[\s\S]{0,400}?wrote:[ \t]*$/m,
  // Outlook, both shapes it produces.
  /^[ \t]*-{2,}\s*Original Message\s*-{2,}/mi,
  /^[ \t]*-{2,}\s*Forwarded Message\s*-{2,}/mi,
  // Outlook's header block, with or without the horizontal rule above it.
  /^[ \t]*From:[ \t]*\S[\s\S]{0,300}?^[ \t]*(?:Sent|Date):[ \t]*\S/m,
  // Apple Mail / Gmail forward.
  /^[ \t]*Begin forwarded message:/mi,
  // The quote itself, whoever wrote it.
  /^[ \t]*>/m,
];

/**
 * Everything the sender actually typed, and nothing below the first reply
 * marker. Never throws, never returns null.
 */
export function stripQuotedReply(text) {
  const s = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let cut = s.length;
  for (const re of REPLY_MARKERS) {
    const m = re.exec(s);
    if (m && m.index < cut) cut = m.index;
  }
  let head = s.slice(0, cut);
  // Outlook puts a rule of underscores immediately above its header block, and
  // Apple Mail a lone blank line; neither is content.
  head = head.replace(/[ \t]*_{5,}[ \t]*\n?\s*$/, "");
  return head.replace(/[ \t]+$/gm, "").trim();
}

/** A crude, dependency-free HTML → text fall-back for senders who write no plain part. */
export function htmlToText(html) {
  return String(html == null ? "" : html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n");
}

/** Plain text, quoted replies removed, capped at BODY_CAP characters. */
export function bodyText({ text, html } = {}) {
  const raw = (text && String(text).trim()) ? String(text) : htmlToText(html);
  const stripped = stripQuotedReply(raw);
  return stripped.length > BODY_CAP ? stripped.slice(0, BODY_CAP) : stripped;
}

// ── subject and date ────────────────────────────────────────────────────────

export const SUBJECT_CAP = 300;

export function cleanSubject(raw) {
  const s = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  return s.slice(0, SUBJECT_CAP) || "(no subject)";
}

/**
 * The civil date (YYYY-MM-DD) an interaction is filed under. An unparseable or
 * absent header falls back to `today` — an activity with no date is worse than
 * one dated the day it arrived, and the arrival date is a fact we do have.
 */
// FIX-14 Part 1 — a header carrying a TIME is an instant, and its day is the
// day in the ORG's zone (`tz`). It was read as the UTC day, so an email sent
// at 9pm in New York was filed under the next day. A bare date stays as it is.
export function activityDate(raw, today, tz = null) {
  const s = String(raw == null ? "" : raw).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso && !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:/.test(s)) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (s) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      if (tz) {
        try {
          const f = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
            .formatToParts(d).map(x => [x.type, x.value]));
          return `${f.year}-${f.month}-${f.day}`;
        } catch { /* an unknown zone reads as UTC, below */ }
      }
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    }
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  return today;
}

// ── the decision ────────────────────────────────────────────────────────────

/**
 * The whole inbound decision, as a pure function of the message and the rows
 * the webhook looked up. Returns exactly one of:
 *
 *   { action: "drop", reason }                     — counted, nothing stored
 *   { action: "log",  donorId, subject, body, date }
 *   { action: "hold", kind, candidates, subject, body, date, from }
 *
 * @param payload  { to, from, subject, text, html, date, ... } normalized
 * @param ctx      { domain, today, tz, orgSlug, senderIsUser, senderName,
 *                   donors: [{ id, name, email }], userEmails: [string] }
 */
export function classifyInbound(payload, ctx) {
  const p = payload || {};
  const c = ctx || {};
  const domain = c.domain || "";
  const today = c.today || "1970-01-01";

  // 1 · the org is the plus-address, or there is no org.
  const slug = orgSlugFromPayload(p, domain);
  if (!slug) return { action: "drop", reason: "no_org" };
  if (c.orgSlug == null) return { action: "drop", reason: "unknown_org", slug };
  if (c.orgSlug !== slug) return { action: "drop", reason: "unknown_org", slug };

  // 2 · the sender must be a user of THAT org. This is the tenant wall.
  const from = normalizeEmail(p.from);
  if (!from || !c.senderIsUser) return { action: "drop", reason: "sender_not_user", slug };

  const subject = cleanSubject(p.subject);
  const body = bodyText(p);
  const date = activityDate(p.date, today, c.tz || null);
  if (!body && subject === "(no subject)") return { action: "drop", reason: "empty", slug };

  // 3 · match the ORIGINAL recipients against this org's donors. The logging
  //     address itself and the sender are never candidates.
  const userEmails = (c.userEmails || []).map(normalizeEmail).filter(Boolean);
  const targets = recipientAddresses(p)
    .filter(a => !isLoggingAddress(a, domain))
    .filter(a => a !== from);

  const donors = c.donors || [];
  // A map to a LIST, not to one donor. Two constituent records sharing one
  // address is the "which of these people" case this whole hold list exists
  // for — keeping only the first would silently file a couple's email on
  // whichever of them the query happened to return first.
  const byEmail = new Map();
  for (const d of donors) {
    const e = normalizeEmail(d.email);
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e).push(d);
  }
  const matched = [];
  for (const t of targets) {
    for (const d of byEmail.get(t) || []) {
      if (!matched.some(m => m.id === d.id)) matched.push(d);
    }
  }

  const held = { subject, body, date, from, to: targets.join(", ") };
  if (matched.length === 1) return { action: "log", donorId: matched[0].id, ...held };
  if (matched.length > 1) {
    // Everybody involved IS on file; the only question is which of them, and
    // that is a question for a human. Holding it is within the rule.
    return { action: "hold", kind: "multiple", candidates: matched.map(d => ({ id: d.id, name: d.name, email: normalizeEmail(d.email) })), ...held };
  }

  // 4 · the director testing this by BCCing herself. Everyone left is staff
  //     (or she wrote to nobody but the logging address). It holds like any
  //     other unmatched message, but it says what it is — a test that reaches
  //     the Unmatched list having proved nothing is a test that looks broken.
  const onlyStaff = targets.length === 0 || targets.every(t => userEmails.includes(t));
  if (onlyStaff) return { action: "hold", kind: "self_test", candidates: [], ...held };

  // ── FIX-11 Part 5 — A MESSAGE ABOUT NOBODY ON FILE IS NOT STORED AT ALL ──
  //
  // This used to HOLD, with its subject, its body and its addresses, on the
  // Unmatched list for a human to place. The other half of INT-4 — the Gmail
  // and Outlook sync, shared/mailboxLog.js — does the opposite for the same
  // case: it drops, and its decision carries no subject, no body and no
  // address, which tests/int4-mailbox.test.js §1 pins byte-wise. Two paths
  // handling the same kind of data disagreed, and the BCC one was the looser.
  //
  // The reason the strict one is right: a message that names nobody on file is
  // correspondence with somebody Steward has no relationship with. A vendor, a
  // friend, a journalist, a doctor. Keeping its subject and body so that staff
  // MIGHT file it later means a donor CRM holding the contents of mail about
  // people who never consented to be in it, on the chance it turns out to be
  // useful. The count is kept, because "eleven messages arrived that Steward
  // stored nothing from" is a true and useful thing to be able to say.
  //
  // The decision deliberately carries no `held` fields, so there is nothing
  // for a caller to write down even by accident.
  return { action: "drop", reason: "no_match", slug };
}
