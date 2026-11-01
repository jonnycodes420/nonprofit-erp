## FIX-23 · The demo seed can tear down Harborlight (2026-10-03)

On prod, `seed-demo.js --i-know-this-is-prod` refused with "the teardown could not remove org org_b72demo;
still refusing: (the orgs row itself)": every table the teardown knew about was clear, and something it did not
know about still pointed at the org. Locally it would not reproduce: seed, seed again, and seed, crash after the
auction, seed again all passed, and every key into `orgs` on a fresh schema is an `org_id` column the teardown
already covered. So the blocker is on prod alone: a row the live server wrote between the table deletes and
the org delete, or a table `information_schema` did not show the seed's role. The teardown now (1) reads every
table and foreign key from pg_catalog, (2) deletes children before parents along the key graph, every DELETE
pinned to `org_id`, (3) runs as one transaction with the org row locked `FOR UPDATE` first, so nothing new can
point at it mid-teardown, and a refusal rolls back whole, and (4) when it still cannot remove the org, names the
table, column, row count and constraint. `tests/script-guards.test.js` now fails if any table can block a demo
delete without an `org_id` to pin it by (proven with a planted table), and seeds the demo twice in a row.
