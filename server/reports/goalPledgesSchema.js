// server/reports/goalPledgesSchema.js · GIFTS-2. "Count pledges toward this goal",
// stored on each goal. NULL means the goal never said: the org's goal is off and
// a campaign is on (shared/numbers/goalPledges.js countsPledges). Columns only,
// no row changes.
"use strict";
async function goalPledgesSchema(pool) {
  await pool.query(`ALTER TABLE fundraising_goals ADD COLUMN IF NOT EXISTS count_pledges BOOLEAN`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS count_pledges BOOLEAN`);
}
module.exports = { goalPledgesSchema };
