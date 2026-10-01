// shared/mailboxLog.js — INT-4. HER OWN INBOX, AND THE LINE AROUND IT.
//
// A development director writes to donors from Gmail or Outlook all day. Those
// conversations are the relationship, and today they live in one person's
// mailbox: when she leaves, they leave with her. Steward logs them onto the
// donor's record so the organisation keeps its own history.
//
// ── THE RULE THAT MAKES THIS ACCEPTABLE AT ALL ─────────────────────────────
//
//     ONLY MESSAGES TO OR FROM A PERSON ALREADY IN THIS ORG'S STEWARD.
//     EVERYTHING ELSE IS NEVER STORED: not the subject, not the address, not
//     the body, not even a count of how many there were.
//
// This is a staff member's personal mailbox. Her doctor, her children's school,
// her union, her job applications are all in there. The only defensible
// position is that Steward cannot see them, cannot count them and cannot prove
// they exist, and the way to be sure of that is to make "not stored" the
// DEFAULT and logging the narrow exception. Everything in this file is written
// so that a message drops unless something positively matches.
//
// She also gets three switches on top of that, because a rule she cannot
// override is a rule she will not turn on in the first place: a list of
// addresses and domains never to log, a "do not log this one" on any message
// already logged, and a pause.
//
// Pure: no DB, no network, no clock (today is always a parameter), no JSX.

// ── WHAT IS STORED FOR A MATCHED MESSAGE, AND NOTHING MORE ─────────────────
// Pinned as a list for the same reason INT-3 pins its push fields: the
// temptation is always the next one. Attachments are COUNTED, never stored:
// "2 attachments" plus a link back to the message in her mailbox, so the file
// itself stays in the system that already holds it under its own rules.
// INT-BUILD-1 Part 0 — A DEMO ORG SHOWS THE CARD AND CONNECTS NOTHING.
// Harborlight and Creo are public logins. A real mailbox behind one would be
// somebody's inbox open to everyone who has the demo password, so the buttons
// stay (a prospect has to SEE where this lives) and the server refuses the
// handshake with this sentence. The "connected" example a demo shows is built
// at read time and stores no row and no token.
export const DEMO_MAILBOX_ORG_IDS = ["org_b72demo", "org_creo"];
export const isDemoMailboxOrg = org =>
  !!org && (org.is_demo_org === true || DEMO_MAILBOX_ORG_IDS.includes(org.id));
export const DEMO_CONNECT_SENTENCE =
  "In the demo, connecting is turned off so no real mailbox sits behind a public login. In your own account this connects Gmail or Outlook in about a minute.";
// Before Google verifies the app, Google shows its own warning screen first.
// Saying so before the click is the difference between a person who continues
// and a person who thinks Steward is a scam.
export const GOOGLE_UNVERIFIED_SENTENCE =
  "Google will first show a screen saying it hasn't verified Steward yet. Choose Advanced, then Go to Steward, to continue. Steward still asks only to read your mail, never to send or delete it.";

export const FIELDS_LOGGED = ["date", "direction", "people", "subject", "bodyText", "attachmentCount"];
export const FIELDS_SENTENCE =
  "For a message to or from someone on file, Steward keeps the date, who it was between, the subject and the text of the message. It does not keep attachments, and it keeps nothing at all about any other message in your mailbox.";

export const DIRECTIONS = ["inbound", "outbound"];

// ── WHY A MESSAGE WAS DROPPED ──────────────────────────────────────────────
// Every reason is a key so a count can be shown to the staff member without
// ever naming what was dropped. The counts are of HER OWN mailbox and are not
// stored: they exist for the run's summary and then they are gone.
export const DROP_REASONS = {
  paused: "Logging is paused.",
  no_match: "Nobody on this message is a person in Steward.",
  never_log: "The address or its domain is on your never-log list.",
  excluded: "You removed this message from the record.",
  self_only: "The only people on it are colleagues here.",
  empty: "There was nothing to keep: no subject and no text.",
};

const norm = e => String(e || "").trim().toLowerCase();
const domainOf = e => { const s = norm(e); const i = s.lastIndexOf("@"); return i < 0 ? "" : s.slice(i + 1); };

/**
 * Is this address one the staff member asked Steward never to log?
 *
 * An entry is either a whole address ("mum@example.com") or a bare domain
 * ("example.com"), and a domain entry covers every address under it. Matching
 * is on the domain as a WHOLE LABEL, so "notexample.com" is not covered by
 * "example.com": a substring match here would silently over-block, and a rule
 * that blocks more than she asked is as wrong as one that blocks less.
 */
export function isNeverLogged(address, entries) {
  const a = norm(address);
  if (!a) return false;
  const d = domainOf(a);
  for (const raw of entries || []) {
    const e = norm(raw);
    if (!e) continue;
    if (e.includes("@")) { if (e === a) return true; continue; }
    if (d === e || d.endsWith("." + e)) return true;
  }
  return false;
}

/** A never-log entry the staff member typed, validated and normalised. */
export function validateNeverLog(input) {
  const raw = norm(input);
  if (!raw) return { ok: false, error: "Type an email address or a domain." };
  if (raw.includes("@")) {
    const [user, dom] = raw.split("@");
    if (!user || !dom || !dom.includes(".")) return { ok: false, error: "That does not look like an email address." };
    return { ok: true, value: raw, kind: "address" };
  }
  if (!raw.includes(".") || /\s/.test(raw)) return { ok: false, error: "That does not look like a domain." };
  return { ok: true, value: raw, kind: "domain" };
}

// ── TRIMMING THE QUOTED REPLY ──────────────────────────────────────────────
// A six-line answer on top of a forty-line quoted thread should read as six
// lines on the record. The markers below are the ones real clients actually
// write. Anything not recognised is LEFT ALONE: over-trimming loses what she
// said, which is worse than a record that is longer than it needs to be.
const QUOTE_MARKERS = [
  /^On .+ wrote:\s*$/i,                    // Gmail, Apple Mail
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i, // Outlook
  /^_{5,}\s*$/,                             // Outlook's rule above a quote
  /^From:\s.+$/i,                           // Outlook header block
  /^Sent from my \w+/i,                     // signatures that precede nothing
  /^>\s?/,                                  // plain quoting
];
export function trimQuoted(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (QUOTE_MARKERS.some(re => re.test(l))) { cut = i; break; }
  }
  const kept = lines.slice(0, cut).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // If trimming left nothing, the whole message WAS the quote, and the honest
  // record is the original rather than an empty line.
  return kept || String(text || "").trim();
}

/** "2 attachments" — counted, never stored, and never named. */
export function attachmentLine(n) {
  const c = Number(n) || 0;
  if (!c) return null;
  return `${c} attachment${c === 1 ? "" : "s"}`;
}

/**
 * THE WHOLE DECISION, as a pure function of one message and the rows the
 * caller looked up. It returns exactly one of:
 *
 *   { action: "drop", reason }              nothing is stored, not even that it existed
 *   { action: "log",  donorIds, direction, subject, body, date, attachmentCount }
 *
 * `people` on the message are every address on it (from, to, cc). A donor
 * matches by address. The staff member's OWN address never makes a match, and
 * a message whose only counterparties are colleagues is dropped: an internal
 * thread about a donor is not a conversation WITH that donor.
 *
 * @param msg {from, to:[], cc:[], subject, bodyText, date, attachmentCount, id}
 * @param ctx {paused, neverLog:[], excludedIds:[], mailboxAddress, staffEmails:[],
 *             donorsByEmail: Map|object email -> donorId, today}
 */
export function classifyMailboxMessage(msg, ctx) {
  const m = msg || {};
  const c = ctx || {};
  const drop = reason => ({ action: "drop", reason });

  if (c.paused === true) return drop("paused");
  if (m.id && (c.excludedIds || []).includes(String(m.id))) return drop("excluded");

  const mine = norm(c.mailboxAddress);
  const from = norm(m.from);
  const recipients = [...(m.to || []), ...(m.cc || [])].map(norm).filter(Boolean);
  const everyone = [from, ...recipients].filter(Boolean);

  // THE NEVER-LOG LIST WINS OVER EVERYTHING, and it applies if ANY address on
  // the message is on it. A thread that includes her doctor is not logged just
  // because a donor was copied in: the point of the list is that those people
  // do not appear in a work system at all.
  if (everyone.some(a => isNeverLogged(a, c.neverLog))) return drop("never_log");

  // Who on this message is a person on file. Her own address and her
  // colleagues' are never matches.
  const staff = new Set([...(c.staffEmails || []).map(norm), mine].filter(Boolean));
  const lookup = c.donorsByEmail instanceof Map
    ? (e => c.donorsByEmail.get(e))
    : (e => (c.donorsByEmail || {})[e]);

  const donorIds = [];
  for (const a of everyone) {
    if (staff.has(a)) continue;
    const id = lookup(a);
    if (id && !donorIds.includes(id)) donorIds.push(id);
  }
  if (!donorIds.length) {
    // Said apart from no_match so the summary can tell her the difference
    // between "nothing in your mailbox concerned a donor" and "you were
    // emailing colleagues", which are different facts about her week.
    const counterparties = everyone.filter(a => !staff.has(a));
    return drop(counterparties.length ? "no_match" : "self_only");
  }

  const subject = String(m.subject || "").trim() || "(no subject)";
  const body = trimQuoted(m.bodyText);
  if (!body && subject === "(no subject)") return drop("empty");

  // DIRECTION IS ABOUT HER, not about the donor: she wrote it, or she received
  // it. It decides how the line reads on the record and nothing else.
  const direction = from && mine && from === mine ? "outbound" : "inbound";

  return {
    action: "log",
    donorIds, direction, subject, body,
    date: String(m.date || c.today || "").slice(0, 10),
    attachmentCount: Number(m.attachmentCount) || 0,
  };
}

/**
 * The line as it reads on the donor's record. The subject leads because that
 * is what she will recognise; the attachment count rides at the end because it
 * is the one thing that is NOT on the record and she needs to know where it is.
 */
export function conversationNote(decision, { staffName } = {}) {
  const d = decision || {};
  const who = String(staffName || "").trim();
  const lead = d.direction === "outbound"
    ? (who ? `${who} wrote:` : "Written from a staff mailbox:")
    : (who ? `Replied to ${who}:` : "Received in a staff mailbox:");
  const att = attachmentLine(d.attachmentCount);
  return `${lead} ${d.subject}` + (att ? ` (${att}, in the mailbox)` : "");
}

// ── WHAT A LOGGED CONVERSATION COUNTS AS, AND WHAT IT MUST NOT TOUCH ───────
//
//     A CONVERSATION IS A TOUCH. IT IS NEVER A GIFT.
//
// It feeds last contact and it closes a Thread step that asked for exactly
// this. It does NOT move giving, drift, LYBUNT, SYBUNT or any figure that
// counts money, and it must not be able to: an email is evidence that somebody
// was spoken to, and reading it as evidence that somebody gave would quietly
// corrupt every retention number in the product.
export const TOUCH_SENTENCE =
  "A logged conversation counts as contact: it updates when this person was last heard from, and it can close a step on your Thread that asked you to write to them. It never changes giving, drift or any figure about money.";
export const NEVER_TOUCHES = ["total_giving", "last_gift_date", "drift", "lybunt", "sybunt", "stage"];

/**
 * Does this logged conversation close an open Thread step?
 *
 * Only a step that asked for contact WITH THIS PERSON, and only one that is
 * still open. "Call or write to Marion" is done when Marion gets an email.
 * A step about a gift, a report or a form is not closed by having written to
 * somebody, however warmly.
 */
// The Thread step types that HAVING WRITTEN actually finishes. Taken from
// shared/threadShape.js's NEXT_STEP_TYPES, deliberately as a SUBSET:
//
//   · `follow_up`, `try_again`, `send`, `follow_up_no_reply` are all "get in
//     touch with this person", and an email to them is that, done.
//   · `thank` and `thank_you_note` are too: a thank-you sent from her own
//     mailbox is a thank-you.
//
// NOT here, on purpose: `check_in_ask` (the ask has a state of its own and
// writing does not resolve it), `pledge_reminder` and `membership_renewal`
// (those close when the money or the renewal arrives, not when somebody was
// reminded). Closing those on an email would mark a thing done that has not
// happened, which is the failure mode this narrow list exists to prevent.
export const CONTACT_STEP_TYPES = ["follow_up", "try_again", "send", "follow_up_no_reply", "thank", "thank_you_note"];

export function closesStep(step, { donorIds, date }) {
  const s = step || {};
  if (!s.id || (s.closedAt)) return false;
  if (!CONTACT_STEP_TYPES.includes(String(s.nextStepType || s.kind || ""))) return false;
  if (!s.donorId || !(donorIds || []).includes(s.donorId)) return false;
  // A step cannot be closed by a conversation that predates it: an email from
  // last month is not the follow-up she was asked for yesterday.
  if (s.openedOn && date && String(date) < String(s.openedOn)) return false;
  return true;
}

export default {
  FIELDS_LOGGED, FIELDS_SENTENCE, DIRECTIONS, DROP_REASONS,
  isNeverLogged, validateNeverLog, trimQuoted, attachmentLine,
  classifyMailboxMessage, conversationNote,
  TOUCH_SENTENCE, NEVER_TOUCHES, CONTACT_STEP_TYPES, closesStep,
};
