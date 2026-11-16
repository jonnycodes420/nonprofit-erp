# FLOWS-13 · The screen after an action, and five smaller truths (15 Nov 2026)

Six items from the 14 Nov lead (third staging night). Each was reproduced first: on staging
(Harborlight, read-only, every write aborted in the browser) where a read showed it, otherwise on a
local production build of Harborlight (NODE_ENV=production, the built client, `seed-demo.js`).

## What was found
- **The first screen after an action (Volunteers-01X, fourth night).** On today's main the profile
  writes the fleet named (gift edit, write-off) refresh every figure within a second, locally;
  FLOWS-10/11/12, NUMBERS-6 and LAG-1's catch-up after each write landed after the fleet's night.
  What was still wrong: three officer-portfolio sums (Home's portfolio value and its drill-down, the
  officer's monthly report) added the stored total of an erased person; a staff-recorded recurring
  plan's payment and cancel (`/offline-plans`) matched no rule in the change channel; the Brand
  Identity preview read the org's name once, on mount, so a rename on the same page left it a save
  behind. `client/src/lib/writeToRead.js` is now the list: each write, and every read on its screen,
  checked by the suite against `lib/changes.js`.
- **A saved logo (Atlas-15).** The volunteer page drew the logo; the embedded form drew no header at
  all, and the giving page's "Not open yet" answer carried only a sentence. Both draw the logo and
  name now (`pages/OrgBrandHeader.jsx`, `server/give/notOpenBrand.js`).
- **The custom period (Fundraising-07X).** One click worked on staging when nothing else was in
  flight. With an earlier read on its way (Last FY, or a background refresh), its answer landed last
  and painted over the custom days: address custom, figures FY, the fleet's symptom. Overview reads
  are now newest-wins and must match the period in the address (`lib/periodRead.js`).
- **Impact lines (Fundraising-34X).** The live page shows exactly what is saved, and the seed saves
  five different lines on one page. The one line the fleet read on $25, $50, $100 and $250 was the
  editor's example placeholder in every empty box (GivingTuesday has exactly those four amounts).
- **Atlas (Atlas-23).** Atlas asked the model to read every request (up to 12 s) before its own code
  checked whether it could answer; an unanswerable question then waited up to 20 s more in Ask's
  loop. Code now answers first (`server/atlas/noSource.js`), and the whole answer has one limit.

## What was learned
- A repeat that no longer reproduces on today's build is still worth a list: the write-to-read list
  makes the next missing rule fail a suite, not a fleet night.
- A placeholder is read as content. An example in an empty box is a claim on every box.
