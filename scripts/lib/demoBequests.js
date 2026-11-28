// scripts/lib/demoBequests.js · HOME-7. THE DEMO'S BEQUESTS (scripts/ci/seed-demo.js calls it).
//
// Home's Planned giving card leads with "N have told you you're in their will": the people whose record
// holds a bequest (planned_gifts, the profile's Giving tab). The demo had none, so the card had no
// first figure. Three long-time givers (ten years or more, $5,000 or more in all, not one of the
// drifting donors the pitch is about) each told Dana at a spring lunch. Made-up, like the rest of the demo.
"use strict";

async function seedBequests({ q, ORG, TODAY, driftedIds, orgTime }) {
  const heirs = await q(`SELECT d.id FROM donors d WHERE d.org_id = $1 AND d.deleted_at IS NULL AND COALESCE(d.kind,'') NOT IN ('organisation','anonymous')
      AND d.first_gift_date IS NOT NULL AND d.first_gift_date <= $2 AND d.total_giving >= 5000 AND NOT (d.id = ANY($3))
    ORDER BY d.first_gift_date, d.id LIMIT 3`, [ORG, orgTime.addDays(TODAY, -3650), driftedIds]);
  for (const [i, h] of heirs.entries()) {
    await q(`INSERT INTO planned_gifts (id,org_id,donor_id,type,estimated_value,date_indicated,notes,created_by,created_by_name)
             VALUES ($1,$2,$3,'bequest',NULL,$4::date,'Told Dana at the spring lunch that Harborlight is in the will.','u_b72demo','Dana Reyes')`,
      [`pg_b72_heir${i + 1}`, ORG, h.id, orgTime.addDays(TODAY, -120 - i * 200)]);
    await q(`UPDATE donors SET planned_giving = true WHERE id = $1 AND org_id = $2`, [h.id, ORG]);
  }
  return heirs.length;
}

module.exports = { seedBequests };
