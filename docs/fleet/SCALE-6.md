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
