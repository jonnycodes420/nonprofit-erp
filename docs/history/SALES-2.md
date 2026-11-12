# SALES-2 · The sales CRM that books meetings (Part A, with SALES-FIX-1)

**Why.** SALES-1 made the record. Jonathan sells to nonprofits of $100K to $2M in Kentucky, Ohio
and Tennessee, by phone, to the executive director and the development director, in about six
hours a week. Part A makes /ops → Sales the place he finds and works prospects. On 11 Nov his
first real import (15 orgs, 16 contacts, 13 deals) hit five problems; SALES-FIX-1 folded them in.

**SALES-FIX-1, what was wrong and why.**
- **The door hid the real reason.** `requireAuth404` turned every 401/403 into `not_found`, so a
  stale page (open across a ship and two restarts) read "could not be read". `requireAuth404` now
  takes an optional `reveal(req)`; the /ops door passes one that is true only when the token's
  signature verifies (its age may not) and its user is a live, non-support super-admin. They see
  the real refusal and its "Reload the page" message; the sales screens show it with a Reload
  button. Everyone else still gets the plain 404.
- **Skip never linked.** `commit` did `continue` on a skipped row before `linkTo`. Now a skipped
  row adds the links it names (never removes one), so contacts imported before their orgs are
  linked by importing them again with Skip.
- **Nothing said what didn't link.** Preview and commit now report each row's associations
  (`organization 'X' not found`), the commit lists the unlinked rows, and the preview warns
  "Import organizations first: 12 of 16 rows name an organization that isn't here."
- **Email-less contacts duplicated on Update.** A contact with no email now matches a live
  contact with the same name at the same organization, or, for the exact shape that bit (contacts
  imported before orgs, so never linked), the same name with no organization and no email.
- **The column map overlapped** at 1440. It is a two-column list now (file column → field).
- **Existing bad rows:** `scripts/ops/sales-contact-repair.js` (dry run by default) lists
  duplicate email-less copies and unlinked contacts; `--apply` merges the copies with SALES-1's
  merge. Unlinked contacts are fixed by re-importing the contacts file with Skip.

**What Part A built** (`server/admin/sales/`, `client/src/pages/ops/sales/`, DDL `sales2.js`).
- **Prospect lists** (`prospectLists.js`, `prospectImport.js`): a lead list in any shape, one row
  per organization; a row with an ED and a DD makes one org and two contacts with roles. A list is
  a saved view (filters, sort) plus its own membership, so an org can be on several lists. Undo
  takes away what the import made, changed, linked and listed.
- **Fit** (`fit.js`, `prospectRows.js`): a checklist in Sales settings ("state in KY, OH, TN";
  "revenue $100K–$2M"; "has a DD"). Each org reads "Fits 4 of 5" with the misses named, computed on
  read, never stored, never a model's score. Revenue is a number column now (`revenue`), so the
  rule can read $100K–$2M; the old band stays.
- **Call mode** (`callMode.js`, `CallMode.jsx`): one entry per org in the view's order, offering
  its ED or DD with a number left, whoever was tried least recently. Skips Do not contact, an open
  task due after today, called today, reached today or with a meeting ahead (added on the walk:
  without it, booking with the ED put the DD next), and Not a fit. Eight outcomes; each logs a call
  with `outcome` and `list_id` and sets the next step by its rule in `sales_settings.call_rules`.
- **Do not contact** on orgs and contacts (reason, day, who): out of every queue and list export;
  an org's flag covers its people. Lifting it is a deliberate second click.
- **Email templates** (`templates.js`, `EmailDraft.jsx`): filled, then Copy or Open in Mail
  (`mailto:`). Steward sends nothing; Copy/Open logs an `email` activity ("Email drafted").
- **Meeting booked** (`meetings.js`, `MeetingForm.jsx`): day, time (New York), place, attendees;
  moves the deal to Meeting booked (making it if needed) and adds "Send the calendar invite" due
  today. Today shows meetings booked ahead, and "How did it go?" the day after.

**Decisions made in the build.**
- "Donors loaded next" moves the deal to the **Donors loaded** stage (each answer is one stage).
- "Not a fit" closes the **organization** (`lost_at`, `lost_reason`) and moves its open deals to
  Lost; an org has no stage of its own.
- "Connected – not now" defaults to call again in 20 business days, and both Connected outcomes
  move the deal to Contacted (making one if the org has none). All editable.
- A dial is any outcome logged; a connect is either Connected outcome or Meeting booked.
