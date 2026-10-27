// SEND-GATE-1 (27 Oct 2026): A DONOR GETS AUTOMATIC EMAIL ONLY IF THE ORG
// TURNED IT ON FOR THEM.
//
// The schema for the per-person switch, the blocked lines and the staff
// confirms, plus the ONE deploy data change. db.js runs this in its schema
// init (which runs when db.js changes). Every column and table is IF NOT
// EXISTS; the data change runs once, keyed in `steward_once`, so a switch a
// person turns off later is never turned back on by a reboot.
//
//   1. Every person in every org starts with auto_email false. That is the
//      column's default: adding it is the change, and nothing else sets it.
//   2. org_creo only (the brief's one exception): every person who received
//      an automatic message in the last 12 months is turned on, so nothing
//      Creo relies on stops. "Received" is read from the rows that record a
//      send to a person: a receipt's sent_at, a sequence or journey send
//      marked sent, and an email interaction Steward wrote itself.
//
// Returns { ran, perOrg: [{ org_id, people }], creoOn }: counts only.

const SYSTEM_ID = "system:send-gate-1-migration";

async function sendGateSchema(pool) {
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS auto_email BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS auto_email_by TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS auto_email_by_name TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS auto_email_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_auto_email ON donors (org_id, LOWER(email)) WHERE auto_email = true`);
  // One row per automatic message the gate stopped. `payload` is the exact
  // message (Steward's tags stripped), so Send sends THAT message once.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_blocked (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      donor_id TEXT,
      kind TEXT,
      what TEXT NOT NULL,
      subject TEXT,
      payload JSONB NOT NULL,
      dedupe_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL DEFAULT 'system:send-gate',
      created_by_name TEXT DEFAULT 'Steward',
      sent_at TIMESTAMPTZ,
      sent_by TEXT,
      sent_by_name TEXT
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mail_blocked_dedupe ON mail_blocked (org_id, dedupe_key)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mail_blocked_donor ON mail_blocked (org_id, donor_id, created_at DESC)`);
  // A staff click recorded for one exact message: the recipient it was for,
  // used once. A manual send carries its id; the gate consumes it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS send_confirms (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      recipient TEXT NOT NULL,
      what TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ
    )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS steward_once (key TEXT PRIMARY KEY, ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), detail JSONB)`);
}

async function sendGateDeployChange(pool) {
  const claim = await pool.query(`INSERT INTO steward_once (key) VALUES ('send-gate-1') ON CONFLICT (key) DO NOTHING RETURNING key`);
  if (!claim.rowCount) return { ran: false };
  // Counts only: the people in each org whose automatic donor mail is now off.
  const perOrg = (await pool.query(
    `SELECT org_id, COUNT(*)::int AS people FROM donors WHERE deleted_at IS NULL GROUP BY org_id ORDER BY org_id`)).rows;
  const creo = await pool.query(
    `UPDATE donors d SET auto_email = true, auto_email_at = NOW(), auto_email_by = '${SYSTEM_ID}',
            auto_email_by_name = 'SEND-GATE-1: received automatic mail in the last 12 months'
      WHERE d.org_id = 'org_creo' AND d.deleted_at IS NULL AND d.auto_email = false AND (
        EXISTS (SELECT 1 FROM receipts r WHERE r.org_id = d.org_id AND r.donor_id = d.id
                  AND r.sent_at >= NOW() - INTERVAL '12 months')
     OR EXISTS (SELECT 1 FROM sequence_sends s WHERE s.donor_id = d.id AND s.status = 'sent'
                  AND s.sent_at >= NOW() - INTERVAL '12 months')
     OR EXISTS (SELECT 1 FROM journey_sends j WHERE j.org_id = d.org_id AND j.donor_id = d.id AND j.status = 'sent'
                  AND j.sent_at >= NOW() - INTERVAL '12 months')
     OR EXISTS (SELECT 1 FROM interactions i WHERE i.org_id = d.org_id AND i.donor_id = d.id AND i.type = 'email'
                  AND i.created_at >= NOW() - INTERVAL '12 months'
                  AND (i.created_by LIKE 'system:%' OR i.metadata->>'via' IN ('campaign','sequence','journey','receipt','workflow'))))`);
  const detail = { perOrg, creoOn: creo.rowCount };
  await pool.query(`UPDATE steward_once SET detail = $1 WHERE key = 'send-gate-1'`, [JSON.stringify(detail)]);
  return { ran: true, ...detail };
}

module.exports = { sendGateSchema, sendGateDeployChange, SYSTEM_ID };
