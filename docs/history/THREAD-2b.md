## THREAD-2b — the screens, in Direction A (2026-09-27)

Jonathan picked **A, the spine**. The journey is one horizontal line and the line is *time*, the
drawer opens under it, and the journey chip lives in the donor profile's ink right rail.

**The builder** (Settings → Journeys, linked from Fundraising). Seven nodes on a spine at 1440,
the same seven as a vertical list at 390 — Direction A's idea is that time is a line you can see,
and on a phone that line is vertical. Drag to reorder, and a dropped step *retimes itself* to sit
between its new neighbours, because a spine where order and time disagree is a spine that lies
(and `planShape` refuses a step due before the one it follows, so this keeps the draft valid by
construction rather than by a later error). Add a step between any two and it lands halfway
between their offsets, which is what "between" means on a spine.

**The one compromise, and the walk that forced it.** Taken literally, "position is the offset as a
fraction of the journey" breaks: day 2 and week 1 land at 6.8% and 8.9% and their labels overlap
into "DAWEEK 1". Making every gap equal would have thrown away the only idea Direction A has, so
positions are proportional **and** spaced — a left-to-right pass pushes anything closer than 11.5%
apart, then scales the run back inside the track. The week-1→month-3 jump is still 25.4% against
11.5% elsewhere, so the unequal gaps survive where they matter. A second walk showed the node
*boxes* still overlapping at a 620px spine (71px of gap against a 92px node), which the first
check had missed by measuring the wrong thing: the spine is 900px minimum now and scrolls inside
its own container, which is the right place for a sideways scroll and is never the page.

**The live preview is on a real donor with the real trigger date**, not on today. A first gift in
October means month 3 is January, and a preview counting from today would be showing a different
journey from the one that runs. A GET that writes nothing — no plan, no steps, no thread.

**The onboarding step** sits after the import, because asking how you look after a new donor
before there is anybody to look after is asking in the abstract. Pick one of five, see it on one
of *your* donors with real dates, done. Skipping leaves **one** calm card on Home — cream, not
brass, because nothing is wrong — and the card re-checks whether a journey now exists, so setting
one up anywhere else makes it disappear rather than linger as a lie.

**Every number on a journey opens its donors**, each with the sentence that defines it, and the
caveat is said by the ROUTE rather than by a caption a redesign could drop: these are counts of
what happened, not a measure of what the journey caused. There is no comparison group, so no
number here can say what would have happened without it.

Battery: 39 suites, 0 failed.
