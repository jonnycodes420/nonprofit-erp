// server/db/ddl/book1.js · BOOK-1: the time she picked on /book. Additive only, on the init session.
"use strict";

async function run(pool) {
  await pool.query(`ALTER TABLE sales_bookings ADD COLUMN IF NOT EXISTS slot_at TIMESTAMPTZ`);
}

module.exports = { run };
