// shared/mailchimpPreset.js — BUILD-94 Part 2. THE FILE THAT LETS MAILCHIMP GO.
//
// Allie pays Mailchimp over $100 a month for one thing Steward could not do:
// hold people who are not donors. Her audience export is the file that moves
// them, and it is NOT a new importer — it is a preset on the mapper she
// already uses, exactly the BUILD-89S 89d rule ("a statement file is a preset
// on the mapper, never a second importer").
//
// WHAT MAILCHIMP ACTUALLY EXPORTS. Audience → Export Audience gives one CSV
// per status. "Subscribed" is the reachable list; "Unsubscribed" is a SECOND
// FILE, which is the whole reason the unsubscribed half has to be handled
// explicitly: if you import only the first file you silently lose every
// unsubscribe Mailchimp was honouring for you, and the first campaign out of
// Steward goes to people who asked her to stop. That is the failure this
// module exists to make impossible.
//
// THE RULE: an unsubscribed Mailchimp contact imports as UNSUBSCRIBED. Never
// as reachable. Not "probably", not "unless the column is missing" — a file
// this module reads as the unsubscribed export marks every row it carries.
//
// Pure: no DB, no network, no clock, no JSX.

import { normalizeHeader } from "./importShape.js";

// Mailchimp's own spellings, and the merge-tag forms the same columns take
// when an export was configured with merge tags rather than labels.
const COLUMNS = {
  email:      ["email address", "email_address", "email"],
  firstName:  ["first name", "fname", "first_name"],
  lastName:   ["last name", "lname", "last_name"],
  address:    ["address", "addr", "mmerge_address"],
  phone:      ["phone", "phone number", "mmerge_phone"],
  tags:       ["tags"],
  rating:     ["member rating", "member_rating"],
  optinTime:  ["optin time", "optin_time"],
  confirmTime:["confirm time", "confirm_time"],
  status:     ["status", "member status", "member_status"],
  unsubTime:  ["unsub time", "unsub_time", "unsubscribe time"],
  notes:      ["notes"],
};

const norm = (h) => normalizeHeader(String(h || ""));

// Is this a Mailchimp audience export? An email column alone is every CSV ever
// written, so the signal is the COMBINATION of Mailchimp-specific columns.
// Two or more of them and it is Mailchimp; one is a coincidence.
export function detectMailchimpAudience(headers) {
  const hs = (headers || []).map(norm);
  const marks = ["member rating", "optin time", "confirm time", "optin_time", "confirm_time",
                 "member_rating", "leid", "euid", "unsub time", "unsub_time"]
    .map(norm).filter(m => hs.includes(m));
  const hasEmail = COLUMNS.email.some(e => hs.includes(norm(e)));
  const hasTags = hs.includes(norm("tags"));
  const signals = marks.length + (hasTags ? 1 : 0);
  return {
    isMailchimp: hasEmail && signals >= 2,
    signals: [...new Set(marks.concat(hasTags ? ["tags"] : []))],
    hasTags,
  };
}

// Mailchimp writes tags as a comma-separated string, sometimes quoted.
export function parseTags(raw) {
  if (Array.isArray(raw)) return raw.map(t => String(t).trim()).filter(Boolean);
  const s = String(raw || "").trim();
  if (!s) return [];
  return s.replace(/^"|"$/g, "").split(",").map(t => t.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

// A tag that says what someone IS. Offered to the person mapping the file —
// never applied silently, because "Board Game Night 2024" is a tag containing
// the word board and is not a board member. The match is on a WHOLE tag, and
// the mapper asks before any of it is written (the BUILD-78 ask gate).
const VOLUNTEER_TAGS = ["volunteer", "volunteers", "vols"];
const BOARD_TAGS = ["board", "board member", "board members", "staff", "staff member", "trustee", "trustees"];
export function typeSuggestionForTags(tags) {
  const t = parseTags(tags).map(x => x.trim().toLowerCase());
  if (t.some(x => BOARD_TAGS.includes(x))) return "staff_board";
  if (t.some(x => VOLUNTEER_TAGS.includes(x))) return "volunteer";
  return null;
}

// ── UNSUBSCRIBED ───────────────────────────────────────────────────────────
// Two ways a row can say it: the file IS the unsubscribed export (the person
// chose that file, or its name says so), or the row carries a status column.
// Either is enough. Neither is ever inverted into "therefore reachable" — a
// row with no signal at all inherits the FILE's status, and a file with no
// declared status defaults to reachable only because it is the subscribed
// export that a person explicitly labelled as such.
const UNSUB_WORDS = ["unsubscribed", "unsubscribe", "cleaned", "bounced", "archived", "non-subscribed", "pending"];
export function rowIsUnsubscribed(row, { fileStatus = null, statusHeader = null } = {}) {
  if (fileStatus === "unsubscribed") return true;
  const raw = statusHeader && row ? row[statusHeader] : (row && (row.status ?? row.Status));
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return fileStatus === "unsubscribed";
  return UNSUB_WORDS.includes(v);
}

// A file name is evidence, not proof — Mailchimp names its exports
// "<audience> unsubscribed members_<date>.csv". Used to PRESELECT the answer
// on the screen, which the person can change.
export function fileStatusFromName(name) {
  const n = String(name || "").toLowerCase();
  if (/unsub|cleaned|bounce/.test(n)) return "unsubscribed";
  if (/subscribed/.test(n)) return "subscribed";
  return null;
}
