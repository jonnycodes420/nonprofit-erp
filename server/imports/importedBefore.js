// server/imports/importedBefore.js · IMPORT-10 item 6. THE SAME FILE TWICE IS ASKED, NEVER ONE CLICK.
//
// On 12 Nov, after a 251-gift auction import, the importer showed the same file
// again with Import enabled, one click from importing every gift twice. Now a
// file this org imported in the last 30 days (and did not undo) is a question:
// "You imported this file on Nov 12 (251 gifts). Import again anyway?" Import
// waits for the answer (answers.importAgain = that import's id), and the
// commit refuses without it, whichever screen the file was opened from.
//
// The same file: the same cells (summary_json.fileKey, the preview's
// fingerprint, stored on every import from this build), or, for an import
// made before it, the same file name.
"use strict";

const DAYS = 30;
const SQL = `
  SELECT id, gifts_created, donors_created, to_char(committed_at, 'YYYY-MM-DD') AS day
    FROM imports
   WHERE org_id = ? AND shape = 'sheet' AND committed_at IS NOT NULL AND reversed_at IS NULL
     AND committed_at > NOW() - INTERVAL '${DAYS} days'
     AND (summary_json->>'fileKey' = ? OR (summary_json->>'fileKey' IS NULL AND LOWER(source_filename) = LOWER(?)))
   ORDER BY (gifts_created > 0) DESC, committed_at, id LIMIT 1   -- the import that brought its gifts in
`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = d => { const [, m, dd] = String(d).split("-").map(Number); return `${MONTHS[m - 1]} ${dd}`; };

async function importedBefore({ query, orgId, fileKey, fileName, u, answers }) {
  const [row] = await query(SQL, [orgId, fileKey, String(fileName || "")]);
  if (!row) return null;
  const gifts = Number(row.gifts_created || 0), people = Number(row.donors_created || 0);
  const what = gifts ? `${gifts.toLocaleString("en-US")} ${gifts === 1 ? "gift" : "gifts"}` : `${people.toLocaleString("en-US")} ${people === 1 ? "person" : "people"}`;
  const said = { importId: row.id, day: row.day, gifts, sentence: `You imported this file on ${shortDay(row.day)} (${what}).` };
  if ((answers || {}).importAgain !== row.id)
    u.questions.push({ id: "importedBefore", kind: "importedBefore", optional: false, ...said, text: `${said.sentence} Import again anyway?` });
  return said;
}

module.exports = { importedBefore, DAYS };
