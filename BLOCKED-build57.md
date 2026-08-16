# BLOCKED — BUILD-57

Genuinely undecidable items parked here so the run could continue; everything
else in the build proceeded on the pre-answered decisions.

## 1. `BUILD-53-staff-recurring.md` does not exist anywhere

The BUILD-57 brief says "Read `BUILD-53-staff-recurring.md` first. Part 1
extends and supersedes it." That file exists nowhere: not in the repo, not in
git history (`git log --all -- "*BUILD-53*"` is empty), not on disk anywhere
under `~`, and not as a pasted spec in any session transcript (searched all of
`~/.claude/projects/.../\*.jsonl` — BUILD-53 appears only as a *reference*
from the BUILD-54/55/56 briefs: "BUILD-53 (staff recurring) is unaffected and
still queued", "a hard prerequisite for BUILD-53"). The spec itself was never
delivered.

**What I did:** built Part 1 from BUILD-57's own spec, which embeds the
BUILD-53 decision table (the invitation-vs-direct rule, the unsuppressible
notification, the 14-day/one-resend proposal shape). FINDINGS §1 records that
nothing could be "deliberately dropped" from BUILD-53 because there was no
BUILD-53 text to drop from — if Jonathan has the spec somewhere else, diff it
against `audit/BUILD-57-FINDINGS.md` §Part-1 scope list.

**Needs from Jonathan:** nothing, unless a real BUILD-53 spec exists outside
this environment — in that case a quick read to confirm Part 1 didn't miss a
requirement only that document carried.
