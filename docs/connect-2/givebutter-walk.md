# Givebutter · connecting a real account in ten minutes

CONNECT-2, 11 Oct 2026. Steward reads Givebutter's transactions and recurring plans. It never
creates, refunds or changes anything in Givebutter: every request is a GET, and the read-only
guard in `sources/index.js` refuses anything else before it leaves Steward.

## What the organisation needs

An API key. Nothing to register on Steward's side, and no Railway variable beyond
`STEWARD_CREDENTIAL_KEY` (already set), which seals the key.

Docs used: https://docs.givebutter.com/api-reference/authentication.md,
https://docs.givebutter.com/api-reference/pagination.md,
https://docs.givebutter.com/api-reference/transactions/list-all-transactions.md,
https://docs.givebutter.com/api-reference/recurring-plans/list-all-recurring-plans.md

## Connecting (on the call)

1. The organisation's admin opens Givebutter, **Settings**, **Integrations**, **API Keys**, and
   clicks **Create New API Key**. Givebutter shows the key once: copy it straight away.
2. In Steward, **Settings**, **Connections**, the **Givebutter** tile. Paste the key and press
   **Test**. Steward reads the last seven days and says how many gifts and how much, writing nothing.
3. Press **Connect**. Choose where gifts go under **Gifts go to**: one of the organisation's funds,
   or **Ask me each time**.
4. Press **Check now**. The first read brings in the history (it does not open thank-you drafts or
   post to the ledger); later reads bring new gifts every six hours.

## What you should see

- The tile reads **Connected**, checked a moment ago, and one sentence of what the check found:
  rows read, new gifts and their total, and how many were already on file.
- Each gift on the donor record with the gross (`amount`), the fee (`fee`) and the net. The donor is
  matched by email, then by name, so nobody gets a second record.
- Any row Givebutter sent that Steward could not use is listed under **rows skipped**, by
  Givebutter id, with the reason. The rest of the check carries on.
- With **Ask me each time**, the tile lists each new gift with a fund picker.
- A gift the organisation also took on its Steward giving page through Stripe is not written a
  second time: it waits as one question under duplicates.

## The one thing to confirm on the first real read

Givebutter's reference types `amount` and `fee` as numbers without saying dollars or cents.
Steward reads them as dollars (Givebutter's dashboard and its AI connector both say dollars).
On the first check, open one gift and compare it with the same transaction in Givebutter. If a
$50 gift shows as $0.50, it is cents: change `toCents(…)` in `sources/givebutter.js` to
`{ unit: "cents" }` for amount and fee, then disconnect and reconnect so the history is re-read.

## Disconnecting

**Disconnect** on the tile. Steward stops reading and deletes the stored key. Every gift already
read stays on the donor records. Delete the key in Givebutter too (Settings, Integrations,
API Keys).
