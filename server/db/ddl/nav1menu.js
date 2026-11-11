// server/db/ddl/nav1menu.js · NAV-1 (menu). THE ORG'S MENU AND ITS MAJOR GIFTS TABS.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   orgs.nav_layout  [{ id, visible }] as text, the org's sidebar: what it
//                    shows and in what order. NULL = the defaults (navGroups.js
//                    ORG_DEFAULT_HIDDEN: Auctions and Peer-to-peer hidden).
//   orgs.mg_views    ["top100", …] as text, the Major Gifts tabs this org
//                    shows. NULL = all four.
// No row is written here: every org reads the defaults until somebody saves.
async function run(pool) {
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS nav_layout TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS mg_views TEXT`);
}

module.exports = { run };
