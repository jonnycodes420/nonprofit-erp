# Zeffy · connecting a real account in ten minutes

CONNECT-2, 11 Oct 2026. Steward reads Zeffy's payments. Zeffy's API is read only and labelled
beta; Steward's read-only guard holds anyway.

## What the organisation needs

An API key, created by a Zeffy admin. Nothing to register on Steward's side, and no Railway
variable beyond `STEWARD_CREDENTIAL_KEY` (already set).

If the organisation's Zeffy does not show **API** under Settings, Integrations (it is a beta),
the export works instead: **Payments**, **Export**, **Payments**, **All columns**, and drop the file
into Steward's import (the Zeffy preset reads it). A payment brought in by the file and later by
the API is counted once: same Zeffy payment id, same amount.

Docs used: https://www.zeffy.com/api/docs (the OpenAPI spec on that page),
https://support.zeffy.com/get-started-with-the-zeffy-api, https://www.zeffy.com/integration/api,
https://support.zeffy.com/export-or-download-all-payments-or-tickets-associated-with-a-specific-form-u0tyj

What the spec settled (and what changed in `sources/zeffy.js`): `amount` is in **cents** (it was
read as dollars, which would have put every Zeffy gift on the record at a hundred times its size);
the date is `created`, unix seconds; paging is `starting_after` with `next_cursor`; the list is
`data`; refunds are `refund_status` none, partial or full; a monthly gift names
`recurring.subscription_id`; there is no fee field, because Zeffy takes no fee.

## Connecting (on the call)

1. In Zeffy, as an admin: **Settings**, **Integrations**, **API**, create a key and copy it.
2. In Steward, **Settings**, **Connections**, the **Zeffy** tile. Paste the key, press **Test**,
   then **Connect**. Choose a fund under **Gifts go to**, or **Ask me each time**.
3. Press **Check now**. Zeffy allows 100 requests a minute; Steward paces itself under that.

## What you should see

- **Connected**, the time of the check, and what it found.
- Each gift with its gross and a fee of $0, so the net equals the gross.
- The donor matched by email, then by name. Zeffy often sends no email for a donor who gave by
  cheque or in person; those land on the one person of that name already on file.
- A fully refunded payment is not written as a gift. A partly refunded one is, with "Partly
  refunded in Zeffy" in its note.
- Rows Steward could not use, listed by Zeffy id with the reason.

## Disconnecting

**Disconnect** on the tile. Steward stops reading and deletes the stored key. Gifts already read
stay. Revoke the key in Zeffy (Settings, Integrations, API).
