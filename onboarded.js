// onboarded.js: MAIL-1. WHEN AN ORGANIZATION HAS ONBOARDED.
//
// Jonathan's definition (4 Oct 2026): an org is onboarded once a committed
// import has written at least one non-sample donor. A super-admin can also
// mark it by hand. Until then Steward sends it no staff or donor mail
// (mailPolicy.js), so this is the line between "a stranger set up an account"
// and "a nonprofit put its donors in".
//
// A DONOR FILE, not any import: a bank deposit, a giving-source sync and a
// volunteer list are not her donor file, and a sample donor is fiction. The
// donor must still be on file, so an import she undid does not count.
//
// One SQL fragment, used by the stamp after each import and by the boot
// backfill, so the two can never disagree. `query` is passed in (db.js and
// server.js each hand over their own) and takes `?` placeholders.

const DONOR_FILE_IMPORT = `
  i.committed_at IS NOT NULL
  AND COALESCE(i.shape,'') NOT IN ('deposit','source','volunteers')
  AND EXISTS (SELECT 1 FROM donors d WHERE d.org_id = i.org_id AND d.created_import_id = i.id
                AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE)`;

// After an import is recorded. Stamps the org once; a later import never
// moves the date. Returns true when this import is the one that onboarded it.
async function stampOnboardedFromImport(query, orgId, importId) {
  if (!orgId || !importId) return false;
  const rows = await query(
    `UPDATE orgs o SET onboarded_at = NOW(), onboarded_via = 'import:' || ?,
                       onboarded_by = 'system:import', onboarded_by_name = 'Steward (first donor file)'
      WHERE o.id = ? AND o.onboarded_at IS NULL AND o.is_demo_org IS NOT TRUE AND o.id NOT IN ('org_b72demo','org_creo')
        AND EXISTS (SELECT 1 FROM imports i WHERE i.id = ? AND i.org_id = o.id AND ${DONOR_FILE_IMPORT})
      RETURNING o.id`,
    [importId, orgId, importId]);
  if (rows.length) console.log(`[mail-1] org ${orgId} onboarded by import ${importId}: staff and donor mail may now send`);
  return rows.length > 0;
}

// Boot: every org that already meets the definition, dated by its first such
// import. Demo orgs are never stamped.
async function backfillOnboarded(query) {
  return query(
    `UPDATE orgs o SET onboarded_at = first.at, onboarded_via = 'import:' || first.import_id,
                       onboarded_by = 'system:mail-1-backfill', onboarded_by_name = 'Steward (first donor file)'
       FROM (SELECT DISTINCT ON (i.org_id) i.org_id, i.id AS import_id, i.committed_at AS at
               FROM imports i WHERE ${DONOR_FILE_IMPORT}
              ORDER BY i.org_id, i.committed_at) first
      WHERE o.id = first.org_id AND o.onboarded_at IS NULL AND o.is_demo_org IS NOT TRUE AND o.id NOT IN ('org_b72demo','org_creo')`);
}

module.exports = { stampOnboardedFromImport, backfillOnboarded };
