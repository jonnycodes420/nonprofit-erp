// FIX-50 (Justin's Place, 26 Oct): AN ORG IS A DEMO ONLY IF ITS KIND IS DEMO.
//
// Kind (org_kind) is the one answer (orgKind.isDemoOrg). is_demo_org stays as
// a copy of it for the seeds and readers that name the column, and the trigger
// installed here means the two can never disagree again. db.js runs this in
// its schema init, which runs when db.js itself changes (BUILD-54's hash fast
// path), so a change to THIS file alone needs a touch to db.js to run on a
// deploy. It is idempotent.
//
//   1. An org nobody set a Kind for, that the console showed as Demo (the
//      flag, a seeded demo id, or "demo" in its name), gets Kind = Demo, so
//      nothing that was fiction starts mailing.
//   2. is_demo_org is set to match Kind for every org. An org whose flag goes
//      off was fiction a moment ago, so its donor mail waits for the switch
//      (as POST /admin/orgs/:id/kind has done since #234).
//   3. From then on a trigger decides the flag from Kind on every write. A
//      seed or provisioning run that creates an org flagged demo (or named
//      "(Demo)", or with a seeded demo id) and no Kind gets Kind = Demo. An
//      older writer that flips only the flag changes Kind with it.
//
// Returns { kindsSet, flagsChanged }: counts only.

const { DEMO_ORG_IDS } = require("./orgKind");
const IDS = DEMO_ORG_IDS.map(id => `'${id}'`).join(",");   // constants, never input

async function matchDemoFlagToKind(pool) {
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS org_kind_before_demo TEXT`);
  await pool.query(`DROP TRIGGER IF EXISTS trg_org_demo_sync ON orgs`);
  const k = await pool.query(`UPDATE orgs SET org_kind='demo', org_kind_set_at=NOW(), org_kind_set_by='system:fix50-migration'
    WHERE org_kind IS NULL AND (is_demo_org IS TRUE OR id IN (${IDS})
      OR COALESCE(name, '') ~* '\\(\\s*demo\\s*\\)' OR COALESCE(name, '') ~* '\\mdemo\\M')`);
  const f = await pool.query(`UPDATE orgs SET is_demo_org = (COALESCE(org_kind, '') = 'demo'),
      emails_enabled = CASE WHEN is_demo_org IS TRUE AND COALESCE(org_kind, '') <> 'demo' THEN FALSE ELSE emails_enabled END
    WHERE is_demo_org IS DISTINCT FROM (COALESCE(org_kind, '') = 'demo')`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION steward_org_demo_sync() RETURNS TRIGGER AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.org_kind IS NULL AND (NEW.is_demo_org IS TRUE OR NEW.id IN (${IDS})
            OR COALESCE(NEW.name, '') ~* '\\(\\s*demo\\s*\\)') THEN
          NEW.org_kind := 'demo';
        END IF;
      ELSIF NEW.org_kind IS NOT DISTINCT FROM OLD.org_kind AND NEW.is_demo_org IS DISTINCT FROM OLD.is_demo_org THEN
        IF NEW.is_demo_org IS TRUE THEN NEW.org_kind := 'demo';
        ELSIF OLD.org_kind = 'demo' THEN NEW.org_kind := NULL;
        END IF;
      END IF;
      NEW.is_demo_org := (COALESCE(NEW.org_kind, '') = 'demo');
      RETURN NEW;
    END $fn$ LANGUAGE plpgsql`);
  await pool.query(`CREATE TRIGGER trg_org_demo_sync BEFORE INSERT OR UPDATE ON orgs FOR EACH ROW EXECUTE FUNCTION steward_org_demo_sync()`);
  return { kindsSet: k.rowCount, flagsChanged: f.rowCount };
}

module.exports = { matchDemoFlagToKind };
