# NAV-2 · For the fleet

**Surfaces changed:** the sidebar (Auctions, Peer-to-peer, Memberships and Major Gifts start off for an org that
never set its menu); **Settings → Menu** (two parts side by side: "On your sidebar" with Take off and the arrows,
and "Add to your sidebar" with each entry's icon, one sentence and Add); the sidebar's own **Customize** dialog (the
same two parts, for one person); **Fundraising → Major gifts** (while Major Gifts is off the rail: At a glance,
Proposals, then the Major Gifts views the org shows); **Settings → Major gifts** (one sentence on where the views are
while Major Gifts is off the sidebar); old Major Gifts addresses (`/app/majorgifts`, `?fr=pipeline`, …).

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Settings → Menu. "Add to your sidebar" lists only what is not on the sidebar,
   each with a sentence. Press **Add** on Auctions: Auctions appears in the sidebar under Raise at once, with no
   reload, and leaves the Add list. Press **Take off** on Auctions: it leaves the sidebar and is back in the Add list.
2. **(Needs a write.)** Settings → Menu, Take off on **Grants**: Grants leaves the sidebar. Open
   `/app/grants` by typing it: the Grants page still opens. Add Grants back.
3. **(Needs a write.)** With Major Gifts NOT on the sidebar: Fundraising → Major gifts shows At a glance, Proposals,
   then Portfolios, Pipeline and Plans (and Top 100 only where the Top 100 is on). Type `/app/majorgifts`: the address
   becomes `/app/fundraising?fr=…` and the same view opens inside Fundraising. Then Settings → Menu → Add Major Gifts:
   it is on the sidebar, and `/app/majorgifts` opens its own page with the same tabs and the same numbers as the
   Fundraising parts showed. Take it off again afterwards only if it was off when you started.
4. **(Needs a write.)** Off the happy path: the sidebar's **Customize** (under Settings on the rail). Take off Events,
   then Add it back from "Add to your sidebar". Then **Reset to default**: the sidebar matches the org's menu. An entry
   the org has not added (for example Memberships, if it is off in Settings → Menu) is never offered in Customize.
5. **(Read only, Harborlight.)** The sidebar still shows Auctions, Peer-to-peer, Memberships and Major Gifts (the demo
   seeds all four on). If any is missing, the demo has not been re-seeded since NAV-2: report it, do not change it.

**What could have broken nearby:** every link into Major Gifts (Home's portfolio card, Atlas's Pipeline links, a
person's Top 100 chip, Audience's "Set stages for your top 40"), which now go through the rail check; Fundraising's
strip and its parts (Peer-to-peer still shows only with a peer-to-peer page); the phone's More drawer, which lists the
same visible entries; super-admin → Organizations → an org's Menu (the same editor).

**Needs a write:** checks 1 to 4 run in org_stagewalk only, never Harborlight.
