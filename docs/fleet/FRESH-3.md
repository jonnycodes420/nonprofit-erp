# FRESH-3 · for the fleet

## Surfaces changed
- Finance: Overview → This month (Money in this month, Unrestricted balance, the months), Transactions, Funds cards, Budgets, Grants money → Restricted, Deposits and payouts → Recurring giving, Exports → Month close
- Fundraising → Pledges; Fundraising → Campaigns & pages (the list's line "All campaigns with a goal · N")
- Volunteers → Schedule: the "Schedule conflicts" card and its list; Volunteers → Applications ("Already a volunteer"); a profile's Volunteer tab
- Events desk: an event's guests and waitlist, the event cards' counts
- The public volunteer application page, when the applicant already volunteers
- Profile → Giving → Delete this pledge, on a written-off pledge with payments
- Every tab when the same person switches organization in another tab (the brass banner)

## Clicks to try for the next three nights
1. **Needs a write.** Finance → Overview → This month open in tab 1. In tab 2, on a made-up person, Giving → + Add Gift → 100 → Save. Tab 1: "Money in this month" up by $100 within a few seconds, no reload. Off the path: delete that gift in tab 2; tab 1 goes back down.
2. **Needs a write.** Fundraising → Pledges open in tab 1. In tab 2 record a payment on a pledge, then Write Off the rest (confirm). Tab 1: paid and left move, then the pledge leaves the open list, no reload.
3. **Needs a write.** Finance → Deposits and payouts → Recurring giving open. On a profile, record a staff recurring plan, then Cancel it (confirm). The roster's monthly total and the row's status move, no reload.
4. **Needs a write.** Volunteers → Schedule → next week (›). Put one made-up volunteer on two shifts that overlap that week. The card reads "Schedule conflicts, <dates> · 1" and the two shift cards say "1 conflict"; open the card: one line naming the person and both shifts. Go back to this week (Today): the card says "Schedule conflicts this week" with this week's number.
5. **Needs a write.** Schedule open; delete a shift with nobody on it, then Undo from Recent changes: the shift is back on the Schedule with its tags, no reload.
6. **Needs a write.** Published volunteer page in org_stagewalk; apply with the name and email of an active volunteer (an @walk.staging.invalid address). The page says "You're already one of our volunteers." Volunteers → Applications: listed under "Already a volunteer".
7. **Needs a write.** A pledge with one payment, written off. Delete this pledge → Delete pledge: a message says the pledge stays because its payments are real gifts and it is already written off.
8. One browser, one person who belongs to two organizations, two tabs. Switch organization in tab B. Tab A shows "You switched to <Org> in another tab. Reload to follow, or stay here." with two buttons, and is still signed in. Stay here → keep working in tab A: it stays in its organization. Reload to follow → it opens the other organization. Nobody is sent to sign in.

9. **Needs a write.** Two tabs in one browser: Fundraising → Pledges in tab 1; in tab 2 record a payment on a pledge, then Write Off the rest. Tab 1 moves within a few seconds each time, no reload (it used to wait up to a minute). Same with Finance → Recurring giving in tab 1 and a staff plan cancelled in tab 2.
10. **Needs a write.** Import two made-up people with a gift each; delete one of the imported gifts by hand; Undo the import: both people go to the trash, and the confirm names nobody as having activity since.

## What could have broken nearby
- Anything that reads `/finance/overview`, `/fundraising/pledges`, `/recurring/roster` (Fundraising's Recurring tab is the same view).
- The Volunteers hub header's "conflicts this week" tile still counts this week (it was always this week); only the Schedule's card follows the dates on screen.
- Sign-in, sign-out and two-step sign-in in a browser with several tabs; support sessions (unchanged: a support session never follows a tab).
- Import Undo's confirm: people kept "with activity since" no longer counts a gift's own timeline line.
