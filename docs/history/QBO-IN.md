## QBO-IN · Gifts entered in QuickBooks come into Steward, counted once (2026-10-12)

`qboRead.js` reads Sales Receipts, Payments (through the invoice's items), Deposit lines and Refund Receipts
from the connected company, GETs only, and records a line as a gift only when its income account is ticked
as a donation account ("Which QuickBooks income accounts are donations?", `mapping.qbo.read`). Skips, each
listed with its reason: what Steward sent (sent ledger + DocNumber gift id + the "via Steward" memo), a gift
already in Steward from another door (processor id, or same person + cents within 3 days), a processor
payout deposit line, and a deposit line that banks a receipt (LinkedTxn). Once-only key `qbo_read_gifts`
(company + txn + line) claimed before `recordGift`, external id `qbo:<key>` as the second belt. First read
always stops at a review (`qbo_read_runs`/`qbo_read_lines`, every number a `qbo-read` figure); save goes
through `recordGift` (which now takes `importId`, `checkNumber`, `readFromVendor`); undo takes the run
back. `gifts.read_from_vendor` keeps a read gift out of the send side's Pending. Refund receipts and voided
or deleted transactions reverse the gift the way a Stripe refund does, with a timeline line.
Guard: `tests/qboin-read.test.js` (45) on the stand-in in `tests/qboin/standin.js`. Walk: `scripts/qboin-walk.js`.
