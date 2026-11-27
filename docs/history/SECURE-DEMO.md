# SECURE-DEMO · the prod demo's password leaves the public repo

2026-11-26. The repo is public, and the Harborlight demo's director password was
written in `scripts/ci/seed-demo.js`, with the prod AI smoke falling back to the
same text. Anyone reading the repo could sign in to the demo on production.

- A production seed run now takes `DEMO_ADMIN_PASSWORD` (Railway, production) and
  refuses without it, or with the public scratch password (`demoPassword`).
  Scratch, CI and staging keep the scratch password, which opens nothing on prod.
- `seed-demo.js --password-only` changes only the two demo staff logins'
  password and signs their sessions out. The app refuses a password change on
  the demo org (a shared login), so this is the rotation path. Only the seed
  writes `org_b72demo`, so it lives in the seed.
- The prod AI smoke reads `PROD_AI_SMOKE_PASSWORD` (GitHub secret) or
  `DEMO_ADMIN_PASSWORD` under `railway run`, with no written-in fallback.
  `npm run status` reports it skipped when neither is set.
- Guard: `tests/script-guards.test.js` (SECURE-DEMO section), red on the code
  before, green after.
