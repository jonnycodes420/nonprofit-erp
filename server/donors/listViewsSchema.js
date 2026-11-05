// server/donors/listViewsSchema.js · LIST-3. The schema init's part for this
// build, called from db.js initSchema right after donor_list_views is made:
// new columns only, IF NOT EXISTS, no row changes.
//   donor_list_views.sort_by / sort_dir   the sort a saved view was saved with
//   (a view saved before LIST-3 has none and opens in the list's own order)
"use strict";

async function listViewsSchema(pool) {
  await pool.query(`ALTER TABLE donor_list_views ADD COLUMN IF NOT EXISTS sort_by TEXT`);
  await pool.query(`ALTER TABLE donor_list_views ADD COLUMN IF NOT EXISTS sort_dir TEXT`);
}

module.exports = { listViewsSchema };
