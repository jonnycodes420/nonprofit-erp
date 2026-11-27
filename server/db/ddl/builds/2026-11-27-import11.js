// server/db/ddl/builds/2026-11-27-import11.js · IMPORT-11. NO GIFT OVER THE CAP, BY ANY DOOR.
//
// money.js MAX_CENTS is $100,000,000.00, the most toCents() reads. An import
// wrote a $1,000,000,000 gift that every reader then turned into $0 ("Lifetime
// $0" beside "Lifetime $1,000,000,000"). The check below refuses any NEW
// write of a gift above the cap, whichever path writes it, so no door can
// store an amount Steward cannot read.
//
// Added NOT VALID: rows already over the cap are left exactly as they are (no
// row is changed at deploy, and the add takes no scan). Those rows are listed
// for Jonathan by scripts/ops/import11-over-cap.js. `pool` is part7's DDL
// session: a short lock_timeout and a retry. No row is written here.
"use strict";

async function run(pool) {
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_gifts_amount_within_cap') THEN
      ALTER TABLE gifts ADD CONSTRAINT ck_gifts_amount_within_cap CHECK (amount IS NULL OR abs(amount) <= 100000000) NOT VALID;
    END IF; END $$`);
}

module.exports = { run };
