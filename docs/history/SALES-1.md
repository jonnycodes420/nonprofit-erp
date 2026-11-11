# SALES-1 · Steward's own sales CRM in /ops (Part A)

**Why.** Jonathan sold Steward from HubSpot's free CRM, which can't see inside Steward:
whether a prospect signed in, imported, or went quiet on day 12 of a trial. /ops already held
the back half of the pipeline (ONBOARD-2's five gates and MRR) and the usage signals
(Journey). Part A adds the front half as one record from lead to paying.

**What it is.** Organizations, contacts and deals, each with its own list and page
(`server/admin/sales/`, `client/src/pages/ops/sales/`), many-to-many associations with
labels and a primary, custom properties, activities on several records at once, pipelines
with editable stages, a board, saved views, bulk edits, duplicates and merge, a HubSpot-shaped
CSV import with undo, export of any list, Today and a forecast card. Super-admins only:
every route is behind /ops's door (404 to anyone else). The tables are `sales_*`, with no
`org_id`, read by nothing outside `server/admin/sales/` (tenant-isolation checks the files).

**Decisions made in the build.**
- **The stages** are the brief's revised defaults: Lead 5 → Contacted 10 → Meeting booked 20 →
  Demo done 35 → Donors loaded 55 → Verbal yes 80 → Trial 90 → Paying 100, and two closed
  stages. **Later** needs a revisit date, comes back in Today on it, and sets neither won_at
  nor lost_at, so it is never a loss in the win rate. **Lost** needs a reason (a HubSpot
  Closed Lost row with none says "Not given in the import").
- **No row at deploy.** Until the first write the Direct pipeline is read from the defaults
  under fixed ids (`sst_lead` …); the first write stores them under those ids. A GET never writes.
- **One number, computed once.** MRR now is ONBOARD-2's figure (`board().summary.mrrNowCents`);
  the facts box's people count is `shared/numbers/households` PERSON; the gates are `board.one`.
- **Delete is one record.** `deleted_at` on that row; its links and what it links to stay.
- **Lists filter in memory** (`lists.applyView`, pure): one seller's book is hundreds of rows,
  read in a fixed number of statements, never one per row.

**What the walk found and fixed.** On the board a deal grabbed by its name would not drag
(Chrome starts no drag from a `<button>`), and a drop read the dragged deal from React state
that had not re-rendered yet, so it could name the wrong deal. The whole card is now the
drag handle and the click target, and the drop reads the id from `dataTransfer`. Ten columns
at 210 px put Later and Lost off a 1440 screen; columns now share the width. A deal in Later
now says when it comes back rather than "Has an open task".

**Planted defects, each red:** `SALES1_PLANT=cascade` (§2), `notask` (§12), `door` (§0);
and a stray `sales_orgs` reader outside the sales folder turns tenant-isolation red.

# Part B · email, partners, payouts

**Email on the records.** Jonathan connects his own mailbox under Sales settings. The consent
uses the same provider apps and redirect as the org mailboxes. A sales state carries a
`sales.` nonce, and the app's OAuth landing sends it to `/ops/sales/mailbox/:provider/complete`.
The permission is sealed with aad `"sales"` in `sales_mailboxes`, never in an org's
`mailbox_connections`. The read is the customer engine's own `fetchMailboxMessages`, given only
the sales contacts' addresses and the prospect domains. `email.keeps()` then checks every
message again, so anything else is never stored. Bodies are sealed at rest. A captured email
links to every matching contact, their organizations and their *open* deals. "Last emailed"
and "No reply in N days" (default 5) show on contacts and deals, and No reply is a line in
Today. Disconnect keeps captured mail; "Delete captured sales email" needs DELETE typed.

**Partners and payouts.** A partner has terms: finder, closer, reseller or custom; a percent or
a flat amount; recurring or one-time; months or no end; an optional cap. `terms_stack` decides
whether one deal can carry several of the partner's terms. A deal records its partner, the
term, and any per-deal override. The ledger runs each month from the win to now, while the
linked Steward org pays, using `shared/numbers/partnerPayout.js` on ONBOARD-2's MRR. A month
is marked paid at the ledger's own amount, never the browser's. There's a statement CSV and
the partner report.

**Decisions made in the build.**
- `routes/finance.js` was 42 lines over its size baseline. Its state signing, env lookup and
  mailbox-address read moved verbatim to `server/shared/oauthFlow.js`, and both flows import
  them, so finance.js shrank by 29 lines.
- Push (instant notices) is **not** wired for the sales mailbox. It reads on the worker every
  30 minutes and on "Read now". PUSH-1's channels are keyed to `mailbox_connections` rows, and
  giving the sales scope its own channels would change that engine. That's the next brief's.
- Outlook's search for prospect *domains* is weaker than Gmail's. Gmail matches a bare domain;
  Graph's filter matches exact addresses. Mail with a stranger at a prospect domain may be
  missed on Microsoft 365 until that person is a contact.
- The forecast's "MRR now" is the Onboarding board's total. The ledger's MRR is the linked
  org's own figure. Both come from ONBOARD-2's one rule.

**What the walk found and fixed.** The partner report scrolled sideways at 390. The refusal
read "Linden Partners's terms". The fixture mailbox offered a Read now that did nothing.
Ledger months showed as `2026-10`. The seed made a win land before its deal was created.

**Planted defects, each red:** `storeall` (§11), `duration` (§13), `door` (§0).
