# BLOCKED — BUILD-72

## B-1 · `git push` is blocked by the auto-mode permission classifier

**Where:** every part's ship step. The brief's discipline is
`git commit` → `git push` → `git status` / `git log` → `node scripts/status.js`,
so this blocks the last three of those four for every part.

**What was attempted:**
```
cd ~/nonprofit-erp && git push origin main
```
with the scratch stack up and the pre-push env exported
(`DB_SSL=disable`, `DATABASE_URL=…:5546/steward_loadtest`, `BASE=…:5606`,
`SINK_PORT=5622`, `STRIPE_MOCK_PORT=5623`).

**Obstacle:** `Permission for this action was denied by the Claude Code auto
mode classifier.` Not a test failure, not a hook rejection — the push never ran.
The full battery is green (104 suites / 0 failed), so the pre-push hook would
have passed.

**State right now:** committed locally, NOT on origin, NOT in prod.

| | |
|---|---|
| local HEAD | Part 0 commits `9fbd1f9` (harness) + `ffff46a` (FINDINGS) |
| also unpushed | `553f79d` — pre-existing BUILD-66 schema-drop commit, not BUILD-72's work |
| origin/main | `220ab86` |
| prod backend / frontend | `220ab86` |

**Decision needed — either one unblocks the whole build:**

1. Jonathan pushes in-session (the scratch stack is already up, so the pre-push
   battery will pass):
   ```
   ! cd ~/nonprofit-erp && DB_SSL=disable \
       DATABASE_URL=postgres://steward@localhost:5546/steward_loadtest \
       BASE=http://localhost:5606 SINK_PORT=5622 STRIPE_MOCK_PORT=5623 \
       git push origin main
   ```
2. Or add a Bash permission rule for `git push` so each part can ship itself.

**Until then:** parts continue to be built, tested and committed locally in
order. **No part is reported as shipped.** Deploy verification
(`node scripts/status.js` agreeing local == origin == prod) is deferred to
whichever of the two above happens, and is the only thing that will make the
"four deploy cycles lost to 'I thought that shipped'" line untrue this time.
