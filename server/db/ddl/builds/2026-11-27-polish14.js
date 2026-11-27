// server/db/ddl/builds/2026-11-27-polish14.js · POLISH-14 item 5. A NEW ORG'S VIEW-ONLY PEOPLE DON'T EXPORT.
//
// Duet (27 Nov): "People with view-only access can download the lists and
// reports they can see" was on out of the box (orgs.viewer_exports_off false by
// default). A new org now starts with it off; an admin turns it on in Settings,
// Team. `pool` is part7's DDL session (a short lock_timeout and a retry).
// SET DEFAULT changes the catalog only: no existing org's row is written, so
// every org that exists today keeps its setting (docs/needs-jonathan/POLISH-14.md).
async function run(pool) {
  await pool.query(`ALTER TABLE orgs ALTER COLUMN viewer_exports_off SET DEFAULT true`);
}

module.exports = { run };
