// server/onboard/staging.js · ONBOARD-1 Stage 2. A STAGED IMPORT: IN STEWARD, NOT YET LIVE.
//
// THE MECHANISM. A person in the trash is already left out of every count and
// list in Steward, and so are that person's gifts (FIX-54, HARDEN-1: every
// read joins `deleted_at IS NULL`, and the gift reads that do not join say
// NOT EXISTS a deleted donor). So a staged batch's people are kept with
// `deleted_at` set AND `staged_import_id` = the run. Every surface that hides
// the trash hides the batch, with no second filter to forget. The few places
// that show the TRASH itself (the trash list, its count, Empty trash) leave a
// staged person out by `staged_import_id IS NULL`, so a preview never reads
// as somebody's deleted donors and is never emptied away.
//
// THE RULE THAT MAKES IT EXACT. A staged batch must hold every gift it wrote:
// a gift landed on a person who was already live cannot be hidden by hiding
// people. So a file can be staged only when none of its gifts went to a
// person who was in Steward before it. That is the first file into a
// customer's org, which is the case Data in is about. Otherwise the import
// stays as an ordinary live import and the answer says why.
//
// Accept clears both columns for the batch, runs the one after-change step
// (LIVE-1) for its people, and stamps `orgs.data_in_at`. Undo before Accept is
// today's undo by run id: it removes the batch's people whether or not they
// are hidden (undo.js already takes soft-deleted people the file created).
"use strict";

const STAGED = (d = "d") => `${d}.staged_import_id`;
const STAGED_ACTOR = "system:onboard/staged-import";

// The people and gifts of one batch, hidden or not (never an erased shell).
const BATCH_PEOPLE = (d = "d") => `(${d}.org_id = ? AND ${d}.created_import_id = ? AND ${d}.erased_at IS NULL
  AND (${d}.deleted_at IS NULL OR ${d}.staged_import_id = ${d}.created_import_id))`;

// May this org stage a file at all? Only when nobody live could be matched.
async function previewEligible(query, orgId) {
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=? AND deleted_at IS NULL AND erased_at IS NULL`, [orgId]);
  const live = Number(r && r.n) || 0;
  return { eligible: live === 0, livePeople: live,
    sentence: live === 0
      ? "Preview first: the file goes in hidden, and nothing counts until someone checks it and makes it live."
      : `Preview is for the first file into an organization. This one already has ${live.toLocaleString("en-US")} ${live === 1 ? "person" : "people"}, so a new file would add gifts to them that a preview cannot hold back.` };
}

// Hide the batch. Called once, when the run is recorded.
async function stageImport({ query, run }, orgId, importId, { rollback = false } = {}) {
  const [leak] = await query(`SELECT COUNT(*)::int AS gifts, COUNT(DISTINCT g.donor_id)::int AS people FROM gifts g
      JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
     WHERE g.org_id=? AND g.import_id=? AND d.deleted_at IS NULL AND d.created_import_id IS DISTINCT FROM g.import_id`, [orgId, importId]);
  if (Number(leak && leak.gifts) > 0) {
    if (rollback) return { staged: false, reason: "matched_live_people",
      sentence: `Not imported: ${Number(leak.gifts).toLocaleString("en-US")} of this file's gifts would go to ${Number(leak.people).toLocaleString("en-US")} ${Number(leak.people) === 1 ? "person" : "people"} already in Steward, and a preview cannot hold those back. Nothing was written. Import it without "Preview first", or ask Jonathan.` };
    return { staged: false, reason: "matched_live_people",
      sentence: `Not staged: ${Number(leak.gifts).toLocaleString("en-US")} of this file's gifts went to ${Number(leak.people).toLocaleString("en-US")} ${Number(leak.people) === 1 ? "person" : "people"} already in Steward, so the import is live like any other. Use Undo if it should not be.` };
  }
  const hidden = await query(`UPDATE donors SET deleted_at = NOW(), staged_import_id = ?
      WHERE org_id=? AND created_import_id=? AND deleted_at IS NULL AND erased_at IS NULL RETURNING id`, [importId, orgId, importId]);
  await run(`UPDATE imports SET staged_at = NOW() WHERE id=? AND org_id=?`, [importId, orgId]);
  return { staged: true, people: hidden.length,
    sentence: `Staged: ${hidden.length.toLocaleString("en-US")} ${hidden.length === 1 ? "person is" : "people are"} in Steward but hidden from every count and list until the file is checked and made live.` };
}

// What Steward holds for the batch: people, gifts, cents, by year, by fund.
async function heldFacts(query, orgId, importId, MONEY_CENTS, MONEY) {
  const P = [orgId, importId];
  const [g] = await query(`SELECT COUNT(*)::int AS gifts, ${MONEY_CENTS("g")} AS cents, COUNT(DISTINCT g.donor_id)::int AS people
      FROM gifts g JOIN donors d ON d.id = g.donor_id WHERE ${BATCH_PEOPLE("d")} AND g.import_id = d.created_import_id`, P);
  // Each gift's day and cents (MONEY's rule), grouped by year here: the year is the day's first four characters.
  const dated = await query(`SELECT g.date AS day, ROUND(g.amount * 100)::bigint AS cents
      FROM gifts g JOIN donors d ON d.id = g.donor_id WHERE ${BATCH_PEOPLE("d")} AND g.import_id = d.created_import_id
       AND g.date IS NOT NULL AND ${MONEY("g")}`, P);
  const yearMap = new Map();
  for (const r of dated) { const y = Number(String(r.day).slice(0, 4)); if (y) yearMap.set(y, (yearMap.get(y) || 0) + Number(r.cents)); }
  const years = [...yearMap.entries()].sort((a, b) => b[0] - a[0]).map(([year, cents]) => ({ year, cents }));
  const funds = await query(`SELECT COALESCE(f.name, '(no fund named)') AS name, ${MONEY_CENTS("g")} AS cents, COUNT(*)::int AS gifts
      FROM gifts g JOIN donors d ON d.id = g.donor_id LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
     WHERE ${BATCH_PEOPLE("d")} AND g.import_id = d.created_import_id GROUP BY 1 ORDER BY 1`, P);
  const [all] = await query(`SELECT COUNT(*)::int AS n FROM donors d WHERE ${BATCH_PEOPLE("d")}`, P);
  return {
    peopleAll: Number(all && all.n) || 0,
    people: Number(g && g.people) || 0, gifts: Number(g && g.gifts) || 0, cents: Number(g && g.cents) || 0,
    byYear: years.map(y => ({ year: Number(y.year), cents: Number(y.cents) })),
    byFund: funds.map(f => ({ name: f.name, cents: Number(f.cents), gifts: Number(f.gifts) })),
  };
}

// The spot check's Steward side, keyed the way the file side was
// (source id, then e-mail, then name: moveFileFactsFrom's precedence).
async function heldForKeys(query, orgId, importId, keys, { LIFETIME, GIFT_COUNT, LAST_DATE }) {
  if (!keys.length) return new Map();
  const rows = await query(`SELECT d.id, d.name, LOWER(COALESCE(NULLIF(d.external_donor_id,''), NULLIF(d.email,''), d.name)) AS k,
        ROUND(${LIFETIME("d")} * 100)::bigint AS cents, ${GIFT_COUNT("d")} AS gifts, ${LAST_DATE("d")} AS last
      FROM donors d WHERE ${BATCH_PEOPLE("d")}
       AND LOWER(COALESCE(NULLIF(d.external_donor_id,''), NULLIF(d.email,''), d.name)) = ANY(?::text[])`,
    [orgId, importId, keys.map(k => String(k).toLowerCase())]);
  return new Map(rows.map(r => [r.k, { id: r.id, name: r.name, cents: Number(r.cents) || 0, gifts: Number(r.gifts) || 0,
    last: r.last ? String(r.last).slice(0, 10) : null }]));
}

// The same, for a spreadsheet import: its spot check is keyed by the person's id.
async function heldForIds(query, orgId, importId, ids, { LIFETIME, GIFT_COUNT, LAST_DATE }) {
  if (!ids.length) return new Map();
  const rows = await query(`SELECT d.id, d.name, ROUND(${LIFETIME("d")} * 100)::bigint AS cents, ${GIFT_COUNT("d")} AS gifts, ${LAST_DATE("d")} AS last
      FROM donors d WHERE ${BATCH_PEOPLE("d")} AND d.id = ANY(?::text[])`, [orgId, importId, ids]);
  return new Map(rows.map(r => [String(r.id).toLowerCase(), { id: r.id, name: r.name, cents: Number(r.cents) || 0, gifts: Number(r.gifts) || 0,
    last: r.last ? String(r.last).slice(0, 10) : null }]));
}

// Make it live. Returns the people it showed, for the after-change step.
async function acceptImport({ query, run }, orgId, importId, { by, byName, reason, onBehalf }) {
  const shown = await query(`UPDATE donors SET deleted_at = NULL, staged_import_id = NULL
      WHERE org_id=? AND staged_import_id=? RETURNING id`, [orgId, importId]);
  await run(`UPDATE imports SET accepted_at = NOW(), accepted_by = ?, accepted_by_name = ?, accept_reason = ?, accepted_on_behalf = ?
      WHERE id=? AND org_id=? AND accepted_at IS NULL`, [by, byName, reason || null, !!onBehalf, importId, orgId]);
  await run(`UPDATE orgs SET data_in_at = COALESCE(data_in_at, NOW()) WHERE id=?`, [orgId]);
  return shown.map(r => r.id);
}

module.exports = { STAGED, STAGED_ACTOR, BATCH_PEOPLE, previewEligible, stageImport, heldFacts, heldForKeys, heldForIds, acceptImport };
