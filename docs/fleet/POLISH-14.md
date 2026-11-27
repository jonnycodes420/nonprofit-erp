# POLISH-14 · For the fleet

**Surfaces changed:** Home (the day heading, the retention tile's "so far this fiscal year" and its "Last fiscal
year, the full year" line, The Thread's row dates); Reports → Top donors' All time sentence; Reports → Acknowledgment
backlog (count, total, From/To, Home's window, Previous/Next, CSV/PDF of the range); Finance (Waiting to post's
sentence, the empty-ledger line); the board pack PDF (Financial Snapshot and Donor Dashboard tiles, the summary);
Settings → Team (What each role can do, Viewers can export); Settings → Imports (the list's date, the receipt's
Recorded and undo dates); Insights → Call list; Calls to make; a profile's offline recurring plan and Recurring
card; Recurring giving; a new pledge's schedule preview.

**Clicks to try for the next three nights:**
1. **(Read only.)** In a browser set to a zone already on the next day or still on the day before the org (e.g.
   UTC−11 after 1 PM Eastern), open Home: the heading is the org's day ("Friday, November 27"), not the browser's.
2. **(Read only.)** Open Home and click People within half a second, five times. Nothing breaks, and the next
   night's error digest has no `unhandledRejection` from dashboard.js and no "Steward is returning server errors".
3. **(Read only.)** Reports → Acknowledgment backlog. It opens with Gifts waiting and Their total, a sentence
   "N gifts ($X) are waiting to be thanked since <Home's day>", and Gifts 1 to 50 of N. The count matches Home's
   "gifts … since" number. Press Next: Gifts 51 to 100. Set From to Jan 1, 2021 and press Show: the count grows,
   Home's window appears; press it and you are back. Off the happy path: set From after To (the dates swap), and pick a
   range with nothing in it ("No gift is waiting to be thanked since …").
4. **(Read only.)** Finance's Posted + Waiting + History gifts and money, against Reports → Top donors' "Everyone
   together has given": the same dollars. Where undated gifts exist, both say "N gifts ($X) have no date" and where
   they are.
5. **(Needs a write: org_stagewalk.)** Reports → Board pack, generate: the tiles read "Revenue, so far this fiscal
   year" and "Retention, so far this fiscal year", each with "Last fiscal year (FY …), full year: …" under it.
6. **(Needs a write: org_stagewalk.)** Settings → Team: What each role can do lists Admin, Staff, Viewer, Volunteer
   coordinator. Untick Viewers can export: the Viewer row's Export cell reads "No (Viewers can export is off)" without
   a reload; tick it back.
7. **(Needs a write: org_stagewalk.)** New pledge, monthly, 4 payments, first Dec 1: the preview reads
   "4 × $…, Dec 1; Jan 1, 2027; Feb 1, 2027; Mar 1, 2027". An offline recurring plan's line reads "expected Dec 26",
   never "2026-12-26".

**What could have broken nearby:** Home's other reads in the same bundle (Thank-yous, the dashboard list); anything
reading `unthanked` (the weekly email's thank-you line, the profile's Thank-yous card); Finance's ledger status
figures (they now read `allGifts.ALL`); Saved reports' Run/CSV/PDF (they pass range and page through); the board
pack's narrative from AI; every Settings → Team control; groups' starter preview (`/groups/starters/:key`).

**Needs a write:** 5, 6 and 7 in org_stagewalk only. Never Harborlight.
