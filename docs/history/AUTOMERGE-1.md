## AUTOMERGE-1 · Green PRs merge themselves, one at a time, without --admin (2026-11-09)

On 8 Nov four builds sat green for hours. Claude Code's auto-mode check refuses `gh pr merge`, and once the merges were done by hand they raced: each one put the others behind main and reran their CI.

- **`automerge.yml`** turns on GitHub's auto-merge (squash, delete branch) for every non-draft PR from this repo that isn't labelled `no-automerge`. GitHub merges it when the required `test` check is green. Nothing here merges a PR itself or skips a check.
- **`keep-current.yml`** runs on each push to main. In one concurrency group that never cancels, it pulls main into every auto-merge PR, oldest first. One PR that can't update (a conflict) doesn't stop the rest.
- **A personal token, not GITHUB_TOKEN.** GitHub doesn't start workflows from events GITHUB_TOKEN causes. A squash made with it would skip main's CI and the deploy, and a branch update made with it would never get a CI run, so the PR would never go green.
- **A guard the brief didn't ask for.** `gh pr merge --auto` merges at once when nothing on the branch is required. Classic protection on main is off; the requirement lives in the `main-protection` ruleset. So the workflow reads `rules/branches/main` first and stays off if no status check is required.
- **Deploys are unchanged.** A squash that lands on main runs the full main CI and the ordered deploy (deploy-turnstile). Because keep-current keeps the PR's tree equal to the tree that merges, CHORE-2's tree check usually trusts the PR run and skips the battery on main.
