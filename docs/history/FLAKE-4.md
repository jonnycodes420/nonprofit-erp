## FLAKE-4 · A flaky test retries once inside the run instead of stopping the build (2026-11-10)

On 10 Nov, suites sensitive to timing stopped about five builds that had not touched what they test.
Each stop cost a rerun of a whole shard job and a person's attention. A real bug fails twice; a
flake passes on the second try. So the shard now runs a failed suite once more, in the same job,
against the same server and database (`tests/lib/run-suite.sh`, sourced by `tests/shard.sh`).

Before this, `shard.sh` said "NO RETRIES: hiding a flake is how a flake becomes a habit." That
reason still holds, so the retry never hides anything: a pass on the retry is written into the
shard's result (`tries`, `flaky`, the first run's last line), kept as `<suite>.try1.log`, collected
by the `test` gate into `flaky.json` (an artifact) with a `FLAKY: <name> passed on retry` line, and
posted on the PR. Each night `flaky-nightly.yml` counts the last seven days of those files
(`scripts/ci/flaky-week.js`) and keeps one issue, "Flaky suites (nightly)", listing every suite that
needed its retry in three or more runs. That list is the next FLAKE build's input.

Some suites are never retried, because a red that comes and goes there is still a hole:
`tenant-matrix` and `security` by name, and any suite whose file says `@no-retry`
(`tests/lib/retryPolicy.js`). `tenant-isolation` and the new `flake4-retry` carry the tag. The
Repeat workflow sets `SHARD_RETRY=0`, since its whole job is to count red runs.

Reproduced on the real runner before the change: two fixture suites (one red then green, one red
twice) run through `tests/shard.sh` on main with its own database and server both failed the shard.
On the branch the first passed and was named FLAKY, and the second still failed after two runs.
`tests/flake4-retry.test.js` covers the three cases; each of four planted defects (no retry, a
second failure read as green, the policy ignored, `SHARD_RETRY` ignored) turned it red.
