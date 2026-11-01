## WIRE-1 · Everything talks to everything (2026-10-06)

Jonathan's rule: something done in one place shows up everywhere it matters. Part 0 mapped 23 objects
against 11 places (`docs/wire-1/map.md`, generated from `map.json`): 67 wired, 98 partly, 57 missing, 31
n/a, committed before any fix. Four builders ran in parallel worktrees (calendar and the Thread; search,
Groups and Communications; the timeline and one person; merge and imports) while the lead built Ask.
After: 138 wired, 67 partly, 17 missing. What it added: `GET /search` for every kind (routes/search.js);
fifteen Group rules (attended, registered, member, pledge, recurring, fundraiser, page, bidder, funder,
journey, open task, kind, import, group) and one list of running recurring states; a Group as a
Communication audience and a journey's start; `timelineLine.js` (one writer for a line, deduped by key,
type `activity` so a system line never counts as contact) and `personMatch.js` (email first, then a
unique name); membership, auction and page-end kinds on the calendar and the journey/step double gone;
next steps for a lapsed membership, a missed shift, an unpaid auction win, a page awaiting approval and
import duplicates (`openCareThread`, `openAdminTask`); merge and purge follow every MERGE_REFS pointer
including `calendar_events.person_ids`, with bulk delete undoable; imports carry their run id, campaign
and grant dates; Ask answers "what has [name] done with us?" through `donor-activity`. Found on the way:
the giving-source task had never once been written (it queried columns that do not exist), and the
PROSPECT-1 seed left eleven people at lifetime $0. The one test is `wire-journey` (47 passed, 16 failed
before the fixes; 63 after). CLAUDE.md wins over the brief on two points: one test file, not two, and
six-item build size bent into four parallel builds of five or six items each.
