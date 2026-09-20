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
NOT DEPLOYED, and the blocker is a decision rather than a credential. Being
honest about which:

* A Vercel GIT preview is the normal path and needs the branch PUSHED.
  Track B was told not to push, merge or deploy; the orchestrator owns that.
* A file-tree preview through the Vercel plugin IS possible from here (the
  plugin is authenticated for team `team_bmpIjp9a9Cji8y2NqHsEuewv`, which owns
  the `client` project). It was deliberately not used: it would either upload
  into the real `client` project or create a second project, and a preview
  built without the project's own env would fall back to the PRODUCTION
  Railway API. B1 is a super-admin screen that mints real Stripe Checkout
  sessions, so a preview pointed at production is not a thing to do without
  being asked.

So: push `build-92b` and let the project's own git integration build the
preview (production deploys from main stay off), or review locally:

```
cd ~/steward-92b/client && VITE_API_URL=http://localhost:5621 npx vite build
cd ~/steward-92b && API=http://localhost:5621 PORT=4183 node scripts/local-preview.js
# then http://localhost:4183
# server recipe: the Track B brief, or tests/README.md
```
Local preview URL used for every measurement in this build: http://localhost:4183

## 3. `lastTriedAt` and one-error-per-source (B2)
Track A is adding both to the API. Track B codes against the CURRENT shape and
degrades: `sourceState()` reads an explicit `waiting` flag if it ever arrives
and otherwise infers it from the provider's own sentence, and the tried time
falls back to `lastErrorAt`. Nothing here breaks when the new fields land, but
the "waiting" inference should be replaced by the real flag once it exists.
