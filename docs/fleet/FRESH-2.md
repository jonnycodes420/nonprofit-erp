# FRESH-2 · for the fleet

## Surfaces changed
- Donor profile → Notes tab: the giving line at the top ("… has given $X in all" / "… hasn't given yet.")
- Communications → Overview: Recent sends and the counts beside it; Campaigns list; Sent list
- Volunteers: the header sentence, the counts card and the list; Records → Recent shifts
- Home: the right-hand panel that opens when you click a Thread row (the person's Lifetime giving and Last gift)
- Events list; an event's check-in count and guests
- Settings → Trash and "Trash (n)"; Donors → Team counts
- Atlas: "list them" / "tell me more" after something changed

## Clicks to try for the next three nights
1. **Needs a write.** A person with a note on their record (Edit → notes), no gifts. Notes tab: "X hasn't given yet." Giving → + Add Gift → 100 → Save → Notes tab: "X has given $100 in all, most recently on <today>." No reload. Then Giving → Delete → Delete gift → Notes: "hasn't given yet." again.
2. **Needs a write.** Communications → Campaigns → New campaign, save a draft. Overview: it is in Recent sends. Campaigns → More → Delete → Delete campaign → Overview: gone from Recent sends, no reload. Off the happy path: press Undo on the toast, then Overview: it is back.
3. **Needs a write.** Fundraising → Campaigns & pages: remove a campaign with nothing attached. Look inside the campaign cards, not at the toast: the card is gone at once. The toast still names it ("Deleted the … campaign. Undo"); that is not the list.
4. **Needs a write.** Home: click a Thread row (not the name) so the side panel opens on that person. In another tab, record a gift for them; within a minute (or at once from this tab) the panel's Lifetime giving moves.
5. **Needs a write.** Volunteers open in one tab; in a second tab move one active volunteer to the trash. The first tab's "N active volunteers on the roster" drops by one within a minute (the bell's check), no reload.
6. Atlas: ask "Who gave this month?", then record a gift (needs a write), then "list them" on the same thread: the answer adds "Gifts or people changed after that answer, so these are its rows as they stood then. Ask the question again for today's." Asking again includes the new gift.

## What could have broken nearby
- Communications' campaign editor: save, send, approve and Duplicate all used to reload the list by hand; now the list re-reads on the change. Check the list after each.
- Anything that reads `usePeopleById`: Finance's transaction names, the hand-picked audience picker, Home's queue.
- Volunteers list filters: the list remounts on a person change (as it did on a volunteer change).
- The Tasks badge and other 60-second shared reads (officers, custom fields, team): still one request per screen.
