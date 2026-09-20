# BLOCKED — BUILD-92 Track B (frontend)

## 1. Source logos (B2)
Official brand files were NOT fetched. The slot is built and every tile ships
with the provider's name set in type; nothing is drawn, traced or recoloured in
code. Turning logos on is a decision about somebody else's trademark terms and
it is Jonathan's, not a build's.
To turn them on: put the official, unmodified files in
`client/src/assets/sources/` (the repo has no `frontend/` directory; the client
asset dir is `client/src/assets/`), add a `SOURCES.md` there naming the source
URL and date for each, register them in `SOURCE_LOGOS` in
`client/src/components/Settings.jsx`, and flip `SOURCE_LOGOS_ENABLED` to true.

## 2. Vercel preview URL for this branch
Not produced. `BLOCKED-vercel-gate.md` records that this repo's Vercel project
has no CLI token available in this environment and that production deploys from
main are OFF by Jonathan's instruction. A branch preview needs a `VERCEL_TOKEN`
(or an interactive `vercel login`) that this session does not have, so no
preview was deployed and nothing was pushed.
Review locally instead:
```
cd ~/steward-92b/client && VITE_API_URL=http://localhost:5621 npx vite build
cd ~/steward-92b && API=http://localhost:5621 PORT=4183 node scripts/local-preview.js
# then http://localhost:4183  (server recipe in the Track B brief / tests/README.md)
```

## 3. `lastTriedAt` and one-error-per-source (B2)
Track A is adding both to the API. Track B codes against the CURRENT shape and
degrades: `sourceState()` reads an explicit `waiting` flag if it ever arrives
and otherwise infers it from the provider's own sentence, and the tried time
falls back to `lastErrorAt`. Nothing here breaks when the new fields land, but
the "waiting" inference should be replaced by the real flag once it exists.
