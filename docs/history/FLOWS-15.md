# FLOWS-15 · what the screen claims: appeals, pace, fund names, counts and connections (16 Nov 2026)

Six items from the 16 Nov lead. Items 2, 5 and 6 were reproduced on staging (Harborlight, read
only, real clicks in Playwright); items 1, 3 and 4 on a local build, because asking Atlas and
sending a campaign both write and Harborlight is read-only for a build. `tests/flows15.test.js`
was run against `origin/main` in a throwaway worktree: 24 of 30 red, the 6 passes are controls.

## Why the appeal repeat missed (W-1114-Fundraising-17, second repeat)
FLOWS-12 found the words that thank a reader for giving and flagged them, and let her write a
first-gift version for a text block. It changed what the editor SAID and nothing about what was
SENT: with no version written, Ana still got "you were part of it". And the hero heading was not
read as copy at all. Now the outcome is the rule (`shared/pastGiving.js` `neverGiverOutcome`):
every claiming block has her version, so a never-giver reads hers; or one does not, so never-givers
are left out of the send with their own reason (`no_first_gift_version`), the editor says how many,
and she can tick them in knowingly (`segment.includeNeverGiven`, no schema change). The campaign
audience (`campaignAudience`, through `server/outreach/firstGiftRule.js`) and the send loop read
the same rule, so the Send button's number is the messages written. A hero can carry its own
first-gift heading. The demo seeds one for Harborlight's Year-end appeal; Steward never writes one
for a real org.

## Why the records line missed (W-1116-Atlas-24X)
FLOWS-10 took the Donors tab to be "not deleted, not erased, marked Donor". The tab is Everyone's
people marked Donor, which also leaves out ARCHIVED people. So its plus counted archived people
with no gift, its minus never counted archived givers, and its own test pinned the same wrong rule
on a fixture with nobody archived. On main, the suite's fixture (one of each) foots 1 short. And
the line gave two long clauses and no sum, so a reader adding the first part got 1,188. Now the
line is the sum, each part named, read in one pass with the tab's own predicate
(`shared/numbers/recordsGap.js`).

## The other four
- **Pace (Fundraising-04).** The guess (a different end date) was wrong: the days were the same 45,
  and the week count was rounded up to 7 whole weeks before dividing. `weeklyPace` in
  `shared/numbers/pace.js` divides by the days-left number printed beside it. The overview cache
  key moved to `-5` so a stored answer with the old arithmetic is not served on deploy day.
- **Atlas money as people (Atlas-01X).** Ask's query layer set `peopleCount` to the headline value
  whenever the question was about people, so a $6,523 sum became 6,523 people.
  `shared/numbers/answerUnit.js` says how many people an answer is about by its measure; Atlas
  draws a money or date answer about one person as that figure, not a list. A date field's latest
  or earliest is now a date answer ("When did Linwood last give?"), where Ask used to refuse it.
- **Fund names (Finance-28).** The gift form, giving pages, Connections, QuickBooks and Xero built
  "Name (restricted)". Every one now reads `fundDisplayName` (`shared/giftWords.js`) or
  `<FundName>`, and Restricted is one badge. The profile's bare "Scholarship" was not reproduced on
  staging's Harborlight (every surface there reads `fin_funds.name`); see the report.
- **Stripe card (Atlas-30).** "Take gifts on your giving pages" was On when any Stripe gift arrived
  in 30 days, synced history included. It is now the public page's own check (`orgTakesGifts`),
  history says only that it reads, and the card has one weekly rate over both halves' gifts with
  its window named (`server/give/stripeCard.js`).
