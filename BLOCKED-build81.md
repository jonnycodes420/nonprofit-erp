# BLOCKED — BUILD-81 (The Thread)

Decisions or steps that need Jonathan; everything else shipped.

1. **`[LEGAL ENTITY NAME]` is still the © placeholder** on the landing
   footer. It renders flagged (dashed outline — the verifier now pins that
   treatment, so it can never ship as bare bracket text pretending to be a
   name), but only Jonathan can fill the registered entity. One edit in
   `client/src/pages/Landing.jsx` (`PLACEHOLDERS.legalEntity`).

2. **The Cowork artifact "Steward Landing Page"** is the design authority
   (§4.6) and still shows the pre-BUILD-81 hero. Built from the spec
   without waiting, as instructed; `docs/build81/landing/reference-desktop.html`
   + `reference-mobile.html` (+ full-page PNGs) are the exports to update
   the artifact from.

3. **Spec reading recorded, veto-able:** §4.4 item 7 says the footer name
   "stays a placeholder until Jonathan fills it" AND "assert it is not
   shipped as literal brackets." Those can't both mean "assert the value is
   filled." Shipped reading: the placeholder must never render as plain
   bracket text in a sentence — it must carry the visibly-unfinished
   dashed treatment (or be filled). If the intent was "block the deploy
   until filled," say so and the guard flips to a hard fail in one line.

4. **The thank-queue button vs. the gift thread** (FINDINGS §worry-1): the
   day view's "Log thank-you" action doesn't close the donor's Thank
   thread; the display is de-duplicated but the actions are parallel.
   Proposed BUILD-82 line: the thank action runs the same conversation
   flow (one line + next step), which closes the thread as its outcome.
   Wants a product call, not a tail-of-build patch.

5. **Live-dial timing:** first dials are Tuesday afternoon. Everything is
   deployed on push via CI; after the last push, `node scripts/status.js`
   must read aligned + smoke green, and
   `node scripts/landing-prod-verify.js` (defaults to prod) should show
   40/40 — both were run at build end, re-run before the dials if anything
   else lands in between.
