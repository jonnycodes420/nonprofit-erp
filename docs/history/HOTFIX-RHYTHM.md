# HOTFIX-RHYTHM · "See who" froze the tab; 4,093 duplicates on a 6,400-person import (2026-11-05)

A real customer, about 6,400 people imported. Home's "What your history shows: 25 are now late
for their own rhythm" → See who → the underlined 25: the panel vanished back to Home and the tab
stopped answering. The same import "left 4093 possible duplicates".

**The loop.** The readout panel (`home/ReadoutPanel.jsx`, HOME-6) is its own React root on
document.body, with no router. The 25 opens the figure's rows, and every row is a `RecordLink`, a
router `<Link>`: outside a router it throws ("Cannot destructure property 'basename'"), and an
uncaught error unmounts the whole root, so the panel disappeared and Home was all that was left.
The host's setter went with it, and `openReadout` waited for a host by polling every 20 ms with no
end, one more endless poll per press of See who. Separately, the rows panel opened at z-index 400,
under the readout's 450, so even a drawn list could not be clicked. And the readout row's own link
was `href="/app"`, which is not an app address: `*` → `/` → `/dashboard`, a remount of Home.

**The fix.** `RecordLink` draws a plain `<a href>` outside a router and opens it through
`steward:go`. The readout panel hands its figures `openPerson` and `panelZ` (FigureContext), so a
name opens the profile and the list sits above the panel; an error inside it says so in place. A
dead host is made again, and the wait for a first mount is bounded (50 × 20 ms). The row links to
`/dashboard#readout-<id>`. The suite's guard fails on any Home link to `/app`, `/` or the Agent page.

**Duplicates.** Before: two people matched on any email or phone they had in common once trimmed
and lower-cased, with a 50-person cap on a shared value as candidates but no limit in the judging;
a near name with nothing in common was a low pair. On the 6,200-person fixture
(`tests/lib/dupFixture.js`) that gave 136 pairs for 24 planted: "n/a", "none", "-", 000-000-0000,
1234567890 and a shared office line matched people with common names, and Mary/Mark Wilson
at two addresses with two emails were "name only". After (`server/dataHealth/realValues.js`): only
a real email (an address, not a placeholder) or a real US phone (not one digit repeated, not a 0/1
area code or exchange, not 555-5555) matches; a value carried by more than 3 different names is
shared (an office line) and matches no one; a name-only pair needs nothing to contradict it (two
real emails, two phones or two addresses that differ); a first name differing in its first letter,
or a short one (five letters or fewer) with one letter swapped, is a different name, not a slip
(Gary/Mary, Mark/Mary), while a letter added or left out is still a spelling (CLEAN-1's
Theresa/Teresa at one address stays medium; the first push dropped it and seed-demo's own check
went red in CI). The fixture now gives exactly the 24 planted. Home's notice counts again
with the current rule on read (`server/dataHealth/noticeCount.js`, cached ten minutes); the stored
run and the "Review N possible duplicates" task already written are left as they are.

**Guard.** `tests/hotfix-rhythm.test.js`. On main 0f10f79: 5 failed (the dup rule ×2, the list,
a name opening, page errors). Planted: the rows' empty state redirecting to /app, red (3
navigations, the list gone).
