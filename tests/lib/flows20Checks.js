// tests/lib/flows20Checks.js · FLOWS-20 (W-1120-Fundraising-32). A JOURNEY'S FOUR COUNTS, ONE ANSWER.
//
// The Journeys list header and the editor's How it is going panel, asked at once, each against the
// rows its figure opens and the key from the database: entries of people still on file (runs in
// cultivation_plans whose person is not deleted). Written out here with no app code.
"use strict";

async function flows20Checks({ orgId, get, q, agree, skip }) {
  if (skip.has("journeyCounts")) return;
  const list = await get("/journeys");
  for (const j of (list && list.journeys) || []) {
    const [k] = await q(`SELECT COUNT(*)::int AS entered,
                                COUNT(*) FILTER (WHERE p.status = 'active')::int AS in_it,
                                COUNT(*) FILTER (WHERE p.status = 'abandoned')::int AS exited,
                                COUNT(*) FILTER (WHERE p.status = 'done')::int AS completed
                           FROM cultivation_plans p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
                          WHERE p.org_id = $1 AND p.template_id = $2 AND d.deleted_at IS NULL`, [orgId, j.id]);
    // Nobody ever went in, by the key and by the header: nothing to open (keeps the check quick).
    if (!Number(k.entered) && !Number(j.entered) && !Number(j.inIt) && !Number(j.exited) && !Number(j.completed)) continue;
    const stats = await get(`/journeys/${encodeURIComponent(j.id)}/stats`);
    const fig = key => { const f = ((stats && stats.figures) || []).find(x => x.key === key); return f ? Number(f.value) : undefined; };
    const rows = async key => Number(((await get(`/journeys/${encodeURIComponent(j.id)}/rows?rows=${key}`)) || {}).count);
    for (const [key, keyCol] of [["entered", "entered"], ["inIt", "in_it"], ["exited", "exited"], ["completed", "completed"]]) {
      agree(`journey "${j.name}" ${key}`, [
        ["the key (entries of people on file)", Number(k[keyCol])],
        ["the Journeys list header", Number(j[key])],
        ["How it is going", fig(key)],
        ["the rows it opens", await rows(key)],
      ]);
    }
  }
}

module.exports = { flows20Checks };
