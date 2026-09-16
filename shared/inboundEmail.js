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
// be tested without a mail provider existing yet (see BLOCKED-build87.md: the
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
export const DROP_REASONS = ["no_org", "unknown_org", "sender_not_user", "empty"];

// Why a message is being held for a human instead of logged.
export const HOLD_KINDS = ["no_match", "multiple", "self_test"];

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
export function activityDate(raw, today) {
  const s = String(raw == null ? "" : raw).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (s) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    }
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
 * @param ctx      { domain, today, orgSlug, senderIsUser, senderName,
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
  const date = activityDate(p.date, today);
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
    return { action: "hold", kind: "multiple", candidates: matched.map(d => ({ id: d.id, name: d.name, email: normalizeEmail(d.email) })), ...held };
  }

  // 4 · the director testing this by BCCing herself. Everyone left is staff
  //     (or she wrote to nobody but the logging address). It holds like any
  //     other unmatched message, but it says what it is — a test that reaches
  //     the Unmatched list having proved nothing is a test that looks broken.
  const onlyStaff = targets.length === 0 || targets.every(t => userEmails.includes(t));
  if (onlyStaff) return { action: "hold", kind: "self_test", candidates: [], ...held };

  return { action: "hold", kind: "no_match", candidates: [], ...held };
}
