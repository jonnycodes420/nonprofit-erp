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
// strpos, not LIKE: what she typed is an argument, never a pattern, so a "%"
// or "_" in it is matched as itself. No index: a substring test cannot use a
// btree, and this runs only while the chip is on (LIST-6's measurement is in
// docs/history/LIST-6.md).
"use strict";

const TEXT_SQL = `strpos(lower(COALESCE(donors.notes, '') || ' ' || COALESCE(donors.about_them, '') || ' ' || COALESCE(donors.tags, '')), lower(?)) > 0`;

// { sql, args } for the words, or null when there is nothing to match.
function textCond(words) {
  const s = String(words == null ? "" : words).trim().slice(0, 200);
  if (!s) return null;
  return { sql: TEXT_SQL, args: [s] };
}

module.exports = { textCond, TEXT_SQL };
