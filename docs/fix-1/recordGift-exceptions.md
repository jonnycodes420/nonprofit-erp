# The recordGift exceptions — logged for a later FIX

CLAUDE.md's rule is "one gift path": a gift is written by `recordGift`
(server.js). The bulk writers that predate it are the only exceptions, and none
may be added. FIX-1 does not fold them in (it changes no gift path); this is
the list a later FIX starts from. Measured on `fix-1` after the split
(26 September 2026) by grepping every `INSERT INTO gifts` outside `recordGift`.

| # | Where | Route / caller | Why it is still outside recordGift | What folding it in needs |
|---|---|---|---|---|
| 1 | `routes/crm.js` (`/donors/import-combined`, the gift batch insert) | `POST /donors/import-combined` | Batched multi-row INSERT under one transaction with a SAVEPOINT per batch; `uq_gifts_external` makes a re-import a no-op at the DB and `RETURNING` decides which rows get an interaction + ledger stamp. recordGift writes one row per call. | A batched `recordGifts([...])` that keeps the one-transaction/savepoint shape, the external-id dedupe, and the reconciliation invariant BUILD-72 asserts before commit. |
| 2 | `routes/crm.js` (`/gifts/import-history`) | `POST /gifts/import-history` | Same shape as #1 (gift-only history import, batched, external-id idempotent, ledger rows for current-FY gifts in the same batch). | Same batched path as #1. |
| 3 | `routes/crm.js` (`/org/load-sample-data`, two inserts) | `POST /org/load-sample-data` | Sample gifts carry `is_sample=true` and deterministic ids (`ON CONFLICT (id) DO NOTHING`) so clearing sample data (BUILD-96) removes exactly them; no receipts, threads or ledger side effects are wanted. | recordGift gaining an `isSample` mode that skips every side effect (thread, receipt, ledger, workflow triggers) and keeps caller-supplied ids. |
| 4 | `routes/webhooks.js` (`charge.dispute.funds_reinstated`) | `POST /stripe/webhook` | Restores a gift a lost dispute reversed, VERBATIM from the snapshot the reversal froze (every column, same id), so receipts and ledger links point at the same row again. This is a restore, not a new gift. | Either a named `restoreGift(snapshot)` beside recordGift, or leave it as the one documented restore path. |
| 5 | `db.js` seed (two inserts) | boot seed of `org_creo` | The fixture org's fabricated history, written at first boot before any route exists. | Nothing — seeds are not gift paths. Listed so the next grep does not rediscover it. |

`scripts/seed-demo.js` (the Harborlight demo, FIX-1 §11) also inserts gifts
directly, in batches, for the same reason as #5: it is a seed, pinned to the
demo org, never a runtime path.
