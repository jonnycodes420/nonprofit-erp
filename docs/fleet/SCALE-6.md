# SCALE-6 · For the fleet

## Part 1 (PR 1): `GET /donors` under load

**Surfaces changed:** no screen's words or layout. What changed is how fast these answer:
Donors (every status filter: a giving level, a lifecycle, Lapsing, Retained), the counts in
the Donors header and on Re-engage's badge (`/donors/counts`), and every Report and
Fundraising read (JIT is off on every database connection).

**Clicks to try for the next three nights** (Harborlight, read only):
1. Donors → Filters → Giving level: Major. It answers in about a second or less, never
   "This took too long". The count in the header matches the rows when you page to the end.
2. Donors → Filters → Lifecycle: Lapsed, then Lapsing, then Retained. Each answers quickly. Open
   three people from Lapsed: each profile's tag row says Lapsed (or Current, with the pledge or
   linked person that holds them named), the same answer the filter gave.
3. Off the happy path: Donors → Lapsing on, then clear every filter (Clear filters). The full list
   comes back with Everyone's count, and the header's Lapsed / Lapsing numbers are unchanged
   from before the filter.
4. Re-engage's badge number equals Donors → Lifecycle: Lapsed with "may be asked" (no
   do-not-contact, do-not-solicit or deceased), as before.

**What could have broken nearby:** anything that reads `donorStatus.statusSql`: the profile's tag
row, Groups built on a giving level or lifecycle, the starter group counts on Groups, the weekly
email's lapsed list, the "Everyone tagged …" figure rows behind a tag, Communications' quiet
segment, and Re-engage. The answers are proven identical on a test fixture; a different count
anywhere is a defect.

**Needs a write:** none.

## Part 2 (PR 2): busy answers, and the first screen after a save

**Surfaces changed:** Donors → Team (each owner's total); the sidebar Tasks badge after Home's
"They're fine, hide this"; any screen when Steward is very busy ("Steward is busy, try again.").

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Donors → Team: note an owner's total. Record a gift →
   pick one of that owner's people → $25 → Save the gift. Without a reload, that owner's total
   rises by $25.00. Reload: the same figure.
2. **(Needs a write.)** Off the happy path: open that gift on the person's Giving tab and delete
   it. Donors → Team drops back by $25.00 without a reload; the person's header Lifetime and
   Home's portfolio card move with it.
3. **(Needs a write.)** Home → Drifting → "They're fine, hide this" on one row → type a line →
   Save, keeping the suggested next step. The sidebar Tasks badge goes up by one without a
   reload. Reload: the same number. (I could not reach this button on the local fixture's Home,
   so this check is OPEN until the fleet runs it.)
4. **(Needs a write.)** A profile → Giving → Add a pledge → save. The pledge card shows it and
   Fundraising's pledged figure moves, without a reload. Then record a payment on it from its
   schedule: the card's paid amount moves at once.
5. **(Needs a write.)** Volunteers → Records → log 3 hours for a volunteer. The header's
   "hours given so far" goes up by 3 without a reload; the person's profile volunteer hours too.
6. **(Needs a write.)** An event → add a guest. The attendee list and the event's card on the
   Events list both show one more, without a reload.
7. **(Needs a write.)** Tasks → tick a task done. The sidebar badge drops by one at once; Undo
   puts it back.

**What could have broken nearby:** every screen that hears `person`, `gift` or `totals` now also
hears Home's owner assignment and a restored record (more re-reads, never fewer). Donors → Team
and Kanban patch the people a write names; a person whose record changed in another tab still
waits for the next whole-org read, as before. A request that cannot get a database connection
in 3 s now says "Steward is busy, try again." and a read tries once more by itself: if you see
that sentence, note the screen and the time.
