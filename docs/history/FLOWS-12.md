# FLOWS-12 · what a donor reads, and what a button says it did (15 Nov 2026)

Six items from the 14 Nov lead (third staging night). Each was reproduced before it was fixed:
Brief me on staging (Harborlight, read-only), the rest on a local build of `origin/main` with real
clicks in Playwright, which is also how `tests/flows12.test.js` was proven red (22 of 24 failed on
main, the two passes are controls).

## Why the Brief me repeat missed (W-1113-Donors-26, second repeat)
FLOWS-10 fixed the AI path: the About note leads the rows and `completeBrief` puts it first. Its test
called those two functions directly. Staging has no AI key, so the fleet never reached that path:
with AI off the More menu hid Brief me (FIX-55 item 6) and `POST /donors/:id/brief` answered 503.
There was no template path at all. Now AI off writes the brief from the same rows in Steward's own
sentences (`server/donors/briefTemplate.js`), finished by the same `completeBrief`, and Brief me is
on the menu either way. The suite drives the route and the menu with AI off, as staging runs.

## The other five
- **An appeal thanking a never-giver (Fundraising-17).** TRUST-1 swaps a sentence that names a gift
  field; "Your support gave us room…" names none. `shared/pastGiving.js` finds the words that thank
  someone for giving, the campaign editor says how many in the audience have never given
  (`shared/numbers/neverGave.js`), and a text block can carry her first-gift version (`firstGift`),
  which a person with no gift reads instead (`shared/emailBlocks.js`). With no version written, the
  preview flags it. Steward never writes the version and never blocks the send: it is hers.
- **The giving page card (Fundraising-35X).** A linked page's Raised was the campaign's total and its
  Gifts the page's own. Both are the page's now, said in one sentence; the campaign's total is its
  own line (`shared/numbers/pageCard.js`).
- **The batch journey preview (Fundraising-28X).** It dated everyone from the first person's
  birthday. The start and the preview both ask `server/shared/journeySchedule.js`, person by person.
- **Erased people (Finance-29X).** `/donors/pick` (every person picker) and portfolio membership
  read `shared/numbers/pickable.js`; a household refuses an erased member. Reads, so the erased rows
  that already exist drop out with no repair.
- **Make a draft (Fundraising-19X).** The answer went to a note at the top of the rail, out of sight
  of the button, and a second draft was made silently beside a waiting one. A waiting draft is now a
  409 with "… already has a draft from Nov 11. Open it or replace it.", the answer shows under the
  button, and a made draft opens Drafts to review.
