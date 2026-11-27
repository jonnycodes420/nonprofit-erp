// server/db/ddl/builds/2026-11-27-one-move-1.js · ONE-MOVE-1 item 3. ONE THANK-YOU PER PERSON PER DAY.
//
// thank_you_drafts.also_gift_ids  the person's other gifts of the same day that this one draft
//                                 thanks for (shared/numbers/thankBacklog.js DRAFTED reads it, and
//                                 marking the draft sent thanks every one). Additive; old drafts
//                                 keep '{}' and stay one gift each. No row is written here.
"use strict";
async function run(pool) {
  await pool.query(`ALTER TABLE thank_you_drafts ADD COLUMN IF NOT EXISTS also_gift_ids TEXT[] NOT NULL DEFAULT '{}'`);
}
module.exports = { run };
