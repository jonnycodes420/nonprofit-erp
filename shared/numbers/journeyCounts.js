// shared/numbers/journeyCounts.js · FLOWS-20 (W-1120-Fundraising-32). ONE COUNT PER JOURNEY.
//
// The Journeys list header ("15 entered · 9 in it · 5 exited · 1 completed") counted every run
// in cultivation_plans, people since deleted or merged away included; the editor's How it is
// going panel ("Entered 6 · In it now 4") counted only runs of people still on file. One screen,
// two answers. Both now read this, and it counts what each figure opens (GET /journeys/:id/rows):
//
//   ENTRIES OF PEOPLE STILL ON FILE. Each time a person went in counts once (someone who went in
//   twice counts twice); a person in the trash, or merged into another record, is not counted.
//
// entered = inIt + exited + completed always: a run is active, abandoned or done.
"use strict";

const DEFINITION = "Counts entries of people still on file: someone who went in twice counts twice, and people since deleted are not counted.";
const STATUS_KEY = { active: "inIt", abandoned: "exited", done: "completed" };

// The rows every count reads, as SQL: one row per run of a person still on file.
const ON_FILE_RUNS = `FROM cultivation_plans p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
                      WHERE p.org_id = ? AND p.template_id IS NOT NULL AND d.deleted_at IS NULL`;

const empty = () => ({ entered: 0, inIt: 0, exited: 0, completed: 0 });

// Map(templateId → { entered, inIt, exited, completed }) for the org, or for one journey.
async function journeyCounts(query, orgId, templateId = null) {
  const rows = await query(
    `SELECT p.template_id, p.status, COUNT(*)::int AS n ${ON_FILE_RUNS}${templateId ? " AND p.template_id = ?" : ""}
      GROUP BY p.template_id, p.status`, templateId ? [orgId, templateId] : [orgId]);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.template_id)) out.set(r.template_id, empty());
    const c = out.get(r.template_id);
    c.entered += Number(r.n) || 0;
    if (STATUS_KEY[r.status]) c[STATUS_KEY[r.status]] += Number(r.n) || 0;
  }
  return out;
}

async function oneJourneyCounts(query, orgId, templateId) {
  return (await journeyCounts(query, orgId, templateId)).get(templateId) || empty();
}

module.exports = { journeyCounts, oneJourneyCounts, DEFINITION, ON_FILE_RUNS };
