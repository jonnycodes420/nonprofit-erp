# For the fleet · FRESH-1

**Surfaces changed:** Settings → Trash (the list, its sentence, Empty trash's count); Donors →
Directory (Notes or tags filter, its empty list, Export CSV's message); Fundraising → Overview
(Active goals headline); every page when Steward is updated while it is open.

**Clicks to try for the next three nights**
1. *(needs a write, org_stagewalk)* Add a made-up person, open them, More → Delete donor → Move to
   trash. Settings → Trash shows them and "Trash (n)". Click Empty trash → Delete n for good. Right:
   the row leaves, the sentence says "0 people are in the trash" (or one fewer), the section reads
   "Trash (0)", all with no reload. Off the path: Restore a person instead, then empty; the count
   follows each step.
2. Donors → + Add filter → Notes or tags → type `zzzzqq` → Add filter. Right: "0 people match",
   Everyone 0 / Donors 0 / Contacts 0 and "Nobody's notes or tags mention 'zzzzqq'". Then a real
   word from someone's notes (whole word): they appear, and part of a word (e.g. `gal` for gala)
   finds nobody. Clear filters brings the list back.
3. Donors → Export CSV. Right: a file downloads and a message says "Exported N people in
   donors-YYYY-MM-DD.csv"; N equals the count above the list. Off the path: filter first, then
   export; N is the filtered count.
4. Fundraising → Overview with several active goals: the Active goals headline equals the sum of
   the cards' Raised, to the dollar.
5. Open Donors, wait for a deploy to land on staging, then click Record a gift (or open another
   tab). Right: "Steward was just updated. Reopening…" and the same page opens again, working; never
   "Something went wrong while loading donors".

**What could have broken nearby:** anything that reads `/trash/people` or `/donors/purge-trash/
preview`; Groups and saved views that use the Notes or tags rule (same engine); every lazy tab and
modal (the reopen path); the error boundaries' fallbacks.

**Needs a write:** check 1 (org_stagewalk only).
