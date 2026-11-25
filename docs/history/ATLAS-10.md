## ATLAS-10 · A person brief always comes, the same facts everywhere, and volunteers can lose a role (2026-11-25)

From Jarvis's power-use sweep (24 Nov) and the lead of 25 Nov. Reproduced on staging (org_stagewalk, the walker) first.

- **The brief was never gated on reading.** `case "about"` runs with AI off. "Brief me on Rufus Tallgrass" answered on
  staging; **"Can you brief me on Rufus Tallgrass?"** fell to `other` and the reading-off refusal. The classifier
  (shared/atlas.js) now reads every brief phrasing, a trailing clause, and "'s". The brief adds "Donor since <first
  gift>", and Tell me more re-reads it in full (`personAnswer({ more })`) instead of closing the answer.
- **One next move.** `server/insights/nextMoveOf.js` is what the profile's Next move and Atlas's brief read (the
  move, else afterMove's "Next: thank Odile for the $1,500 gift on Sep 28, 2026."). `moveSentence` moved to `shared/`.
- **Engagement counts touches** (decisions, WIRE-1); the profile said "Nothing in 24 months" beside a recent gift.
  It now says "No touches in 24 months · last gift <date>".
- **Roles.** Guest was offered by the + menu and refused by the route (`PEOPLE_ROLES` lacked it). Each role has Remove
  with Undo; Volunteer's shifts stay; the last role stays. Applications from active volunteers close themselves;
  ones already waiting are listed apart (a GET never writes) and closed by `scripts/ops/atlas10-close-already-volunteer.js`.
  "Hours in all" says a future shift is not counted until its day.
- **Video claim.** Margaret Chen's draft was backed: a 3-second video Dana recorded on 23 Nov sits in `video_thanks`.
  The guard already refused a video claim with no video; a call or visit she made is now a claim too, and a blank like
  "[add your video link]" is held at send. `scripts/ops/atlas10-draft-claims.js` lists waiting drafts that claim
  what the record can't show.
- **Duplicates.** Osric Ravensmere's two records (two emails, stages lapsed and cultivate) were never a pair: the same
  name with different emails contradicts. Same name, different emails and overlapping giving is now a medium pair.
  **$0.01 rows: OPEN.** None on staging; prod not readable from a build. `scripts/ops/atlas10-penny-rows.js` lists them.
- **One question, one number.** Ask's lapsed counts say "Lapsed 12+ months" in the registry's words, and a place
  ("in Lexington") now filters the count. Several goals running asks which. The reading-off line reads true on Settings
  and opens the refusal. LYBUNT 251/309/299 is prod-only: OPEN.
