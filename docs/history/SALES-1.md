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
