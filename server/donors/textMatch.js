// server/donors/textMatch.js · LIST-6 item 3. "NOTES OR TAGS: 'gala'".
//
// The People list had a "Search notes & tags" box that filtered in the browser
// over the whole-org list, and that list (GET /donors/summaries) never carries
// notes: on staging it could only ever match a tag. It is now a rule of the one
// list engine (groups.js buildDonorFilter `text`, the registry field `text` in
// donorList.js), so the list, its count, its export, Save as group and a saved
// view all read the same rows.
//
// It reads three things on the person's own row: their notes, their About, and
// their tags. Case does not matter. Conversation notes (interactions) are not
// read: those are the top bar's search ("Search people, gifts, notes").
//
// FRESH-1 item 3: WHOLE WORDS. "cafe" no longer finds "cafeteria", and "gala"
// finds "Gala dinner" and the tag "gala" but not "galaxy". The words are
// matched as a run (\m … \M, Postgres's start and end of a word), and what
// she typed is escaped before it becomes the pattern, so a "." or "(" in it is
// matched as itself. No index: this runs only while the chip is on (LIST-6's
// measurement is in docs/history/LIST-6.md).
"use strict";

const TEXT_SQL = `(COALESCE(donors.notes, '') || ' ' || COALESCE(donors.about_them, '') || ' ' || COALESCE(donors.tags, '')) ~* ?`;

// The pattern for the words: each regex character escaped, runs of spaces as any space.
function wordPattern(s) {
  const esc = s.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&").replace(/\s+/g, "\\s+");
  return `\\m${esc}\\M`;
}

// { sql, args } for the words, or null when there is nothing to match.
function textCond(words) {
  const s = String(words == null ? "" : words).trim().slice(0, 200);
  if (!s) return null;
  // A word that starts or ends in a mark ("#gala", "c++") has no word edge there; match it as typed.
  const lead = /^\w/.test(s), tail = /\w$/.test(s);
  const p = wordPattern(s);
  return { sql: TEXT_SQL, args: [(lead ? "" : "(?:^|\\W)") + p.slice(lead ? 0 : 2, tail ? p.length : -2) + (tail ? "" : "(?:\\W|$)")] };
}

module.exports = { textCond, TEXT_SQL, wordPattern };
