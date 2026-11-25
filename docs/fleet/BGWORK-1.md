# For the fleet · BGWORK-1

**Surfaces changed:** Admin → an org's panel ("Run background work for this test org", shown for
Internal test and Fixture orgs); the mailbox numbers in `/health`.

**Clicks to try for the next three nights**
1. Admin → open an Internal test org. Right: a "Run background work for this test org" box, off,
   saying test orgs are skipped. Open a Customer org: no box.
2. Tick it, then untick it. Right: each click shows a sentence, and the box stays as clicked after
   closing and reopening the panel.
3. Read `/health` → mailbox counts. Right: no stale connection belongs to a test org that is off.

**What could have broken nearby:** every SCALE-5 sweep (they read the same live-org list); the
admin org panel's Kind and Demo rows beside the new box.

**Needs a write:** check 2 changes a setting. Use a test org on staging only, and leave it off.
