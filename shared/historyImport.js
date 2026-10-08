// shared/historyImport.js: IMPORT-2. BRING THEIR WHOLE HISTORY.
//
// An organisation switching to Steward has years of notes, call reports,
// meeting notes, open tasks and attached letters about its donors. The donor
// and gift importers bring the people and the money; this brings what people
// WROTE about them, each line as its proper kind on the person's timeline,
// with the original date and the original author.
//
// The judgement is here once, pure (no DB, no network, no clock: today is a
// parameter), so the preview a person reads and the write that follows are
// built from the same plan. The server does the matching against its own
// people and the writing; nothing here can express a write.
//
// THE RULES THAT ARE NOT NEGOTIABLE
//   - Nothing is guessed silently. A row that matches nobody, or more than one
//     person, is listed for a person to decide. A row that cannot be read is
//     listed with the reason.
//   - A communication preference found in a note ("do not solicit", "no phone
//     calls") is PROPOSED, never set. A person confirms each one.
//   - A date is read month-first. It is read day-first only when it cannot be
//     month-first (20/10/2023), and every such row is listed in the preview
//     (Jonathan's decision, 8 Oct 2026).
//   - History never invents a value. A blank author stays blank; a missing date
//     is a refusal, not today.

import { normalizeDate, normalizeHeader, normalizeEmail, matchNameKey, donorIdKey, detectNoteMarkers } from "./importShape.js";

// ── WHAT A ROW CAN BE ──────────────────────────────────────────────────────
// Steward's own interaction types, plus "task". Each source word maps to one.
export const KINDS = {
  note:    { key: "note",    label: "Note" },
  call:    { key: "call",    label: "Call" },
  meeting: { key: "meeting", label: "Meeting" },
  visit:   { key: "visit",   label: "Visit" },
  email:   { key: "email",   label: "Email" },
  letter:  { key: "letter",  label: "Letter" },
  text:    { key: "text",    label: "Text" },
  event:   { key: "event",   label: "Event conversation" },
  task:    { key: "task",    label: "Task" },
};
export const KIND_KEYS = Object.keys(KINDS);

// First match wins, so the specific words come before the general ones.
const KIND_WORDS = [
  ["task",    /\b(task|action|to ?do|follow[- ]?up item|reminder)\b/i],
  ["event",   /\bevent\b|\bgala\b|\bconversation at\b/i],
  ["visit",   /\b(visit|site visit|tour|home visit)\b/i],
  ["meeting", /\b(meeting|meet|lunch|coffee|appointment|zoom)\b/i],
  ["call",    /\b(call|phone|telephone|voicemail)\b/i],
  ["text",    /\b(text|sms)\b/i],
  ["letter",  /\b(letter|mail(ing)?|card|postal)\b/i],
  ["email",   /\be-?mail\b/i],
  ["note",    /\b(note|comment|contact report|background|memo|general)\b/i],
];
/** The Steward kind for a source's type word. Blank or unknown is a note. */
export function kindFor(typeText) {
  const t = String(typeText || "").trim();
  if (!t) return "note";
  for (const [k, re] of KIND_WORDS) if (re.test(t)) return k;
  return "note";
}

// ── THE COLUMNS A HISTORY FILE CAN HAVE ────────────────────────────────────
// Each field with the header spellings that claim it, matched as whole
// normalised headers (the imports rule: never by substring).
export const FIELDS = {
  externalId: ["account number", "account id", "constituent id", "donor id", "contact id", "id number", "lookup id",
               "account no", "constituent", "lgl constituent id", "account", "donor number", "person id", "supporter id",
               "contact account number", "related to id", "who id", "account id c"],
  name:       ["name", "full name", "donor name", "constituent name", "contact name", "contact", "account name", "who", "supporter"],
  firstName:  ["first name", "first", "given name"],
  lastName:   ["last name", "last", "surname", "family name"],
  email:      ["email", "e mail", "email address", "e mail address", "primary email", "contact email"],
  address:    ["address", "address line 1", "street", "street address", "address 1"],
  date:       ["date", "interaction date", "note date", "activity date", "contact date", "action date", "created date",
               "date of contact", "start date", "date created", "completed date", "created"],
  kind:       ["type", "interaction type", "note type", "activity type", "action type", "contact type", "channel", "method",
               "subtype", "category", "task subtype", "contact method"],
  subject:    ["subject", "title", "summary", "description short", "action", "purpose"],
  note:       ["note", "notes", "comment", "comments", "description", "body", "details", "narrative", "text", "report",
               "contact report", "background", "note text", "interaction notes", "action notes", "memo"],
  author:     ["entered by", "author", "created by", "added by", "user", "staff", "solicitor", "owner name", "logged by",
               "contacted by", "assigned to name"],
  owner:      ["assigned to", "owner", "task owner", "assignee", "responsible"],
  status:     ["status", "task status", "completed", "is completed", "done", "state"],
  due:        ["due date", "due", "activity date due", "deadline", "action due date", "due on"],
  attachment: ["attachment", "attachments", "file", "file name", "filename", "document", "attached file"],
  relationship: ["relationship", "relationship type", "relation"],
  relatedTo:  ["related to", "related person", "spouse", "employer", "knows"],
  tags:       ["tags", "tag", "keywords", "attributes", "groups"],
};
export const FIELD_KEYS = Object.keys(FIELDS);

// ── RECOGNISED EXPORTS ─────────────────────────────────────────────────────
// A preset claims a file only on two of its own signal columns, the same rule
// the donor presets keep. Every one is "documented-not-walked" until a real
// export is checked against it; `tested` says what this build checked.
export const PRESETS = {
  bloomerang:    { label: "Bloomerang interactions and notes", signals: ["account number", "channel", "purpose", "is inbound"],
                   tested: "documented-not-walked" },
  donorperfect:  { label: "DonorPerfect contacts", signals: ["donor id", "activity code", "contact date", "mailing code"],
                   tested: "documented-not-walked" },
  npsp:          { label: "Salesforce NPSP tasks and activities", signals: ["who id", "what id", "activity date", "task subtype"],
                   tested: "documented-not-walked" },
  neon:          { label: "Neon activities", signals: ["account id", "activity type", "activity date", "activity subject"],
                   tested: "documented-not-walked" },
  littlegreenlight: { label: "Little Green Light contact reports", signals: ["lgl constituent id", "contact report", "contact method", "contact date"],
                   tested: "documented-not-walked" },
  raisersedge:   { label: "Raiser's Edge actions and notes", signals: ["constituent id", "action type", "action date", "action notes"],
                   tested: "documented-not-walked" },
  kindful:       { label: "Kindful and Bloomerang notes", signals: ["contact id", "note text", "note date", "note type"],
                   tested: "documented-not-walked" },
  // Givebutter and Zeffy notes carry no vendor-only columns this build could
  // confirm, so they claim a file only when their own name is in two headers.
  givebutter:    { label: "Givebutter notes", signals: ["givebutter contact id", "givebutter note", "givebutter id"],
                   tested: "documented-not-walked" },
  zeffy:         { label: "Zeffy notes", signals: ["zeffy donor id", "zeffy note", "zeffy id"],
                   tested: "documented-not-walked" },
  plain:         { label: "A plain spreadsheet", signals: [],
                   tested: "walked with the IMPORT-2 test file (2,420 rows)" },
};
export function detectPreset(headers) {
  const hs = new Set((headers || []).map(h => normalizeHeader(h)));
  const scored = Object.entries(PRESETS)
    .filter(([k]) => k !== "plain")
    .map(([k, p]) => [k, p.signals.filter(s => hs.has(s)).length])
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1]);
  if (!scored.length) return { key: "plain", ...PRESETS.plain, ambiguous: false };
  const ambiguous = scored.length > 1 && scored[0][1] === scored[1][1];
  return { key: scored[0][0], ...PRESETS[scored[0][0]], ambiguous, tiedWith: ambiguous ? scored[1][0] : null };
}

/** {field: header} for a file's headers. One header per field, first claim wins. */
export function guessMapping(headers) {
  const out = {};
  const taken = new Set();
  for (const f of FIELD_KEYS) {
    for (const h of headers || []) {
      if (taken.has(h)) continue;
      if (FIELDS[f].includes(normalizeHeader(h))) { out[f] = h; taken.add(h); break; }
    }
  }
  return out;
}

// ── HTML TO PLAIN TEXT, LINE BREAKS KEPT ───────────────────────────────────
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", rsquo: "'", lsquo: "'",
  rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "..." };
export const looksLikeHtml = s => /<\/?(p|br|div|b|i|u|em|strong|span|ul|ol|li|font|table|tr|td|h\d|a)\b[^>]*>/i.test(String(s || ""));
// Line structure first (a break, a list item, the end of a paragraph become
// line breaks), then every remaining tag is dropped by splitting on "<", and
// any stray angle bracket goes with it. No regex removes a tag, so nothing a
// pass leaves behind can recombine into one (CodeQL's incomplete sanitization).
const stripTags = x => {
  const lined = x
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*\/\s*(p|div|ul|ol|h\d|tr|table)\s*>/gi, "\n");
  return lined.split("<").map((part, i) => {
    if (i === 0) return part;
    const close = part.indexOf(">");
    return close === -1 ? part : part.slice(close + 1);
  }).join("").replace(/[<>]/g, "");
};
export function cleanText(raw) {
  let s = String(raw ?? "").replace(/\r\n?/g, "\n");
  const html = looksLikeHtml(s);
  if (html) s = stripTags(s);
  s = s.replace(/&(#?\w+);/g, (m, e) => {
    if (ENTITIES[e.toLowerCase()] !== undefined) return ENTITIES[e.toLowerCase()];
    if (/^#\d+$/.test(e)) return String.fromCharCode(Number(e.slice(1)));
    return m;
  });
  // An HTML note's encoded "&lt;b&gt;" decodes to a tag; it goes the same way.
  if (html) s = stripTags(s);
  return s.split("\n").map(l => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── THE DATE RULE ──────────────────────────────────────────────────────────
/**
 * Month-first, unless it cannot be: a slash date whose first number is over 12
 * is day-first, and says so. Returns {value, dayFirst, reason}.
 */
export function readDate(raw, { currentYear } = {}) {
  const s = String(raw ?? "").trim();
  if (!s) return { value: null, dayFirst: false, reason: "No date." };
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  const dayFirst = !!(m && Number(m[1]) > 12 && Number(m[2]) <= 12);
  const r = normalizeDate(s, { dayFirst, currentYear });
  if (!r.value) return { value: null, dayFirst: false, reason: `Steward could not read "${s.slice(0, 40)}" as a date.` };
  return { value: r.value, dayFirst, reason: null };
}

// ── COMMUNICATION PREFERENCES IN THE WORDS ─────────────────────────────────
// Proposed, never set. `detectNoteMarkers` is the one reader the donor import
// already uses; history adds the phone phrases it does not cover. Deceased is
// deliberately NOT read from history: "her husband died" in a call note is not
// the donor, and that is the worst false positive there is.
export const PREFS = {
  do_not_solicit: { flag: "do_not_solicit", label: "Do not solicit" },
  do_not_contact: { flag: "do_not_contact", label: "Do not contact" },
  do_not_mail:    { flag: "do_not_mail",    label: "Do not mail" },
  do_not_email:   { flag: "do_not_email",   label: "Do not email" },
  do_not_call:    { flag: "do_not_call",    label: "No phone calls" },
};
export function prefsIn(text, extra = "") {
  const t = `${String(text || "")} ${String(extra || "")}`.trim();
  if (!t) return [];
  const m = detectNoteMarkers(t);
  const out = [];
  const add = (flag, phrase) => { if (!out.some(o => o.flag === flag)) out.push({ flag, phrase }); };
  if (m.doNotSolicit) add("do_not_solicit", (t.match(/do not solicit|no solicitation|\bDNS\b|no more asks|remove(d)? from[^.]*|do not (mail or |mail\/)?call/i) || [m.matched[0]])[0]);
  if (m.doNotContact) add("do_not_contact", (t.match(/do not contact|no further contact/i) || ["do not contact"])[0]);
  if (m.doNotMail) add("do_not_mail", (t.match(/do not mail\b|remove(d)? from (the )?mailing( list)?|stop (all )?mail/i) || ["do not mail"])[0]);
  if (m.doNotEmail) add("do_not_email", (t.match(/do not e-?mail|unsubscribed?/i) || ["do not email"])[0]);
  const phone = t.match(/no (phone )?calls|do not (phone|call)|don'?t call|email only|e-mail only/i);
  if (phone) add("do_not_call", phone[0]);
  return out;
}

// ── IS A TASK STILL OPEN ───────────────────────────────────────────────────
const DONE_WORDS = /^(completed?|done|closed|finished|true|yes|y|1)$/i;
export const isDoneStatus = s => DONE_WORDS.test(String(s || "").trim());

// ── ONE ROW, READ ──────────────────────────────────────────────────────────
/**
 * What one source row means, before matching. `refused` is a sentence when the
 * row cannot come in; everything else is the row as it will look.
 */
export function readRow(row, mapping, { currentYear } = {}) {
  const get = f => (mapping[f] ? String(row[mapping[f]] ?? "") : "");
  const typeWord = get("kind");
  const status = get("status").trim();
  const due = get("due").trim();
  let kind = kindFor(typeWord);
  // A row with a due date and an open-looking status is a task even when its
  // type column says "Call": it is a call somebody still has to make.
  if (kind !== "task" && due && status && !isDoneStatus(status)) kind = "task";
  const rawNote = get("note");
  const wasHtml = looksLikeHtml(rawNote);
  const note = cleanText(rawNote);
  const subject = cleanText(get("subject"));
  const authorRaw = get("author").trim();
  const author = /^(admin|administrator|system|unknown|n\/?a|none|-)?$/i.test(authorRaw) ? null : authorRaw;
  const date = readDate(get("date"), { currentYear });
  const dueDate = due ? readDate(due, { currentYear }) : { value: null, dayFirst: false };
  const attachment = get("attachment").trim() || null;
  const out = {
    kind, typeWord: typeWord.trim() || null, note, subject: subject || null, wasHtml,
    author, authorPlaceholder: !author && !!authorRaw.trim(), date: date.value, dayFirst: date.dayFirst || dueDate.dayFirst,
    taskOpen: kind === "task" ? !isDoneStatus(status) : false, due: dueDate.value, owner: get("owner").trim() || null,
    attachment, prefs: prefsIn(note, subject),
    relationship: get("relationship").trim() || null, relatedTo: get("relatedTo").trim() || null,
    tags: get("tags").split(/[;,|]/).map(t => t.trim()).filter(Boolean),
    identity: {
      externalId: get("externalId").trim() || null,
      email: normalizeEmail(get("email")).value || null,
      name: get("name").trim() || [get("firstName").trim(), get("lastName").trim()].filter(Boolean).join(" ") || null,
      address: get("address").trim() || null,
    },
    refused: null,
  };
  // An open task's date is its due date when the file gives no other.
  if (!out.date && out.kind === "task" && out.due) out.date = out.due;
  if (!out.date) out.refused = date.reason;
  else if (!note && !subject && !attachment && out.kind === "note") out.refused = "The note is empty, so there is nothing to bring in.";
  return out;
}

// ── MATCHING TO PEOPLE ─────────────────────────────────────────────────────
/** The index the server builds once from its own people. */
export function buildIndex(donors) {
  const byExt = new Map(), byEmail = new Map(), byName = new Map();
  const push = (m, k, d) => { if (!k) return; if (!m.has(k)) m.set(k, []); if (!m.get(k).some(x => x.id === d.id)) m.get(k).push(d); };
  for (const d of donors || []) {
    const ids = [d.external_donor_id, ...(Array.isArray(d.external_donor_ids) ? d.external_donor_ids : [])];
    for (const id of ids) push(byExt, id ? donorIdKey(id) : null, d);
    push(byEmail, d.email ? String(d.email).trim().toLowerCase() : null, d);
    push(byName, nameKey(d.name), d);
  }
  return { byExt, byEmail, byName };
}
// "Nelson, Lisa" and "Lisa Nelson" are the same name.
export function nameKey(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  const comma = s.match(/^([^,]+),\s*(.+)$/);
  if (comma) s = `${comma[2]} ${comma[1]}`;
  const k = matchNameKey(s);
  return (k && typeof k === "object" ? k.key : k) || null;
}
const addrKey = a => String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Old system's id first, then email, then name (narrowed by address when the
 * row has one). One person is a match; more than one is ambiguous and listed;
 * none is unmatched and listed. Nothing is guessed.
 */
export function matchRow(identity, index) {
  const id = identity || {};
  if (id.externalId) {
    const hits = index.byExt.get(donorIdKey(id.externalId)) || [];
    if (hits.length === 1) return { status: "matched", method: "id", donorId: hits[0].id };
    if (hits.length > 1) return { status: "ambiguous", method: "id", candidates: hits.map(h => h.id) };
  }
  if (id.email) {
    const hits = index.byEmail.get(id.email) || [];
    if (hits.length === 1) return { status: "matched", method: "email", donorId: hits[0].id };
    if (hits.length > 1) return { status: "ambiguous", method: "email", candidates: hits.map(h => h.id) };
  }
  const nk = nameKey(id.name);
  if (nk) {
    let hits = index.byName.get(nk) || [];
    if (hits.length > 1 && id.address) {
      const narrowed = hits.filter(h => addrKey(h.address) && addrKey(h.address) === addrKey(id.address));
      if (narrowed.length) hits = narrowed;
    }
    if (hits.length === 1) return { status: "matched", method: "name", donorId: hits[0].id };
    if (hits.length > 1) return { status: "ambiguous", method: "name", candidates: hits.map(h => h.id) };
  }
  return { status: "unmatched", method: null };
}

// ── THE PLAN ───────────────────────────────────────────────────────────────
/**
 * Every row, read and matched. The preview is a summary of this; the write
 * walks this. `picks` is {rowIndex: donorId} for rows a person resolved.
 */
export function planHistory(rows, mapping, index, { currentYear, picks = {} } = {}) {
  const items = (rows || []).map((row, i) => {
    const r = readRow(row, mapping, { currentYear });
    const m = picks[i] ? { status: "matched", method: "picked", donorId: picks[i] } : matchRow(r.identity, index);
    return { line: i + 2, index: i, ...r, match: m };
  });
  return { items, counts: countPlan(items) };
}

export function countPlan(items) {
  const c = { rows: items.length, matched: 0, byMethod: { id: 0, email: 0, name: 0, picked: 0 }, ambiguous: 0, unmatched: 0,
    refused: 0, byKind: {}, openTasks: 0, openTasksOverdue: 0, completedTasks: 0, html: 0, attachments: 0, dayFirst: 0,
    prefs: {}, placeholderAuthors: 0 };
  for (const it of items) {
    // Matching is counted for EVERY row, so the scorecard foots to the file;
    // a refused row is also counted as refused, and nothing below it applies.
    if (it.match.status === "matched") { c.matched++; c.byMethod[it.match.method]++; }
    else if (it.match.status === "ambiguous") c.ambiguous++;
    else c.unmatched++;
    if (it.refused) { c.refused++; continue; }
    c.byKind[it.kind] = (c.byKind[it.kind] || 0) + 1;
    if (it.kind === "task") { if (it.taskOpen) c.openTasks++; else c.completedTasks++; }
    if (it.wasHtml) c.html++;
    if (it.attachment) c.attachments++;
    if (it.dayFirst) c.dayFirst++;
    if (it.authorPlaceholder) c.placeholderAuthors++;
    for (const p of it.prefs) c.prefs[p.flag] = (c.prefs[p.flag] || 0) + 1;
  }
  return c;
}

/** The timeline line for one item, as the person will read it. */
export function timelineNote(it) {
  const parts = [];
  if (it.subject && it.subject !== it.note) parts.push(it.subject);
  if (it.note) parts.push(it.note);
  if (!it.note && it.kind !== "note") parts.push(`${KINDS[it.kind]?.label || "Conversation"}, no notes recorded.`);
  if (it.attachment) parts.push(`${it.attachment} was attached in your old system.`);
  return parts.join("\n").slice(0, 8000);
}

/** The Steward interaction type an item is written as. */
export const interactionTypeFor = kind => (kind === "task" ? "note" : kind);

export default { KINDS, KIND_KEYS, FIELDS, FIELD_KEYS, PRESETS, detectPreset, guessMapping, kindFor, cleanText, looksLikeHtml,
  readDate, PREFS, prefsIn, isDoneStatus, readRow, buildIndex, nameKey, matchRow, planHistory, countPlan, timelineNote,
  interactionTypeFor };
