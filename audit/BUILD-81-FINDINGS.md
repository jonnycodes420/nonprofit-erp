# BUILD-81 FINDINGS — The Thread: the surface, the nudge, the landing page, and one Home screen

Working record. The build gives the BUILD-76 engine a name, a place, and
insistence; rewrites the landing page around the question; and makes Home say
the same sentence. Four pushes: 2f06f21 (Part 1, the surface), a33b5ac
(Part 2, the nudge), 767bac4 (Part 4, the landing), plus the verification
commit carrying this file.

## THE RULE, APPLIED

Never fight the tasks battle; fight the remembering battle. Nothing in this
build asks the user to create a task. The write path is
`POST /donors/:id/conversations`: one line, and the next-step decision rides
the SAME request — `{type, due}` opens the thread, `{skipped:true}` records
the skip on the interaction (the BUILD-76 rule; never as nothing), and a
request with no decision is a 400. There is no "create thread" button
anywhere in the product.

## DECISIONS RECORDED (the ones the spec left to the build)

- **The next conversation IS the outcome.** Logging a conversation on a donor
  with an open thread closes that thread (`close_kind='outcome'`, pointing at
  the new interaction) and the same request's next-step answer decides
  whether another opens. This unifies "close a thread" with "log a
  conversation" — there is no separate close route to drift from it.
- **No silent close is a DATABASE guarantee, not a route convention.** The
  `threads_close_honest` CHECK refuses any close that is neither an outcome
  (with its interaction) nor a dismissal (with its reason). Proven red in
  tests/threads.test.js §4 by raw UPDATE.
- **Revisit is a snooze, not a close.** "Not now, revisit on [date]" sets
  `snoozed_until` on the OPEN thread; it leaves the list and the stat and
  resurfaces on the date by construction (the read filters on the date; no
  sweep, nothing to fail). Days-open keeps counting from `opened_on` — the
  thread never stopped being open, and the email says so when it returns.
- **A live gift opens a Thank thread (+2d) only when no thread is open** —
  the one-open-thread rule is a partial unique index, decided by the
  database under a race, not a check-then-insert. Excluded: sample donors,
  deceased, do-not-contact, non-person records (orgs/DAFs/anonymous,
  BUILD-80 kind gate), recurring renewals (their thank-you path is
  transactional and automatic; a thread per renewal is noise), and — by
  construction — every import path (bulk inserts never call the hook).
  The event-attendee gift path (`PATCH /events/:id/attendees/:id`) does NOT
  open threads: events are a deprioritized surface with their own follow-up
  flow; noted here rather than silently skipped.
- **The meeting/visit chain is a prefill, not an automation.** The
  thank-you-note thread carries `followon_*` (Follow up, +14 from the touch);
  when that thread closes, the prompt PREFILLS from the follow-on instead of
  the touch default. The user can still change or skip — skipping is
  recorded. A changed type at logging time drops the follow-on (the user's
  decision replaced the plan).
- **Needs Your Attention folds into The Thread as a sub-list.** The stat
  line ("N open · M overdue · oldest K days") counts the threads table
  ONLY — never a blend of two computations (the two-truths class). The
  existing /dashboard/today queue renders inside the Thread card under its
  own quiet label, de-duplicated: a thank item for a donor with an open
  thread never shows twice (the thread IS the item). Drift stays its own
  section below: Drift finds them, the Thread keeps them.
- **The nudge lists EVERY open due-or-overdue thread org-wide, per user** —
  the spec's words ("every open thread that is due or overdue"), and the
  small-shop reality: donor data is org-shared (BUILD-76 Part 5), so both
  staff see the same list and either can act. Oldest first = longest open.
- **Thread ownership** = the donor's assigned officer when set, else the
  actor who logged the touch (or the system actor for webhook gifts). Shown
  on the row; org-wide visibility unchanged.
- **The drift-done inline widget is UNCHANGED** (spec 1.2's word): a line +
  Save/Skip. A saved line opens a thread with the call default (Follow up,
  +7); an API caller can pass an explicit nextStep or {skipped:true}. The
  full prompt UI lives in the Log-a-conversation flow; the drift row stays
  one keystroke.

## PART 2 — the nudge, as built

`processThreadNudges` on the existing 5-minute tick (never a second
scheduler): org-local morning window [6,12), weekday check on the ORG's
civil date (`orgTime.dayOfWeek`; Sat/Sun skipped unless
`orgs.thread_nudge_weekends`), one email per user per day
(`digest_sends` 'thread_nudge' / day:YYYY-MM-DD), per-user
`notify_thread_nudge` (default on, Settings › Account), NO email when
nothing is due — and an empty morning reserves nothing, so threads landing
later the same morning still go out. Subject = the fact:
`3 threads open · Marta Villanueva, day 24` — the day count is the
escalation. Rows read "day N", never a date the reader has to subtract.
Links go to `/donors/:id?conversation=1` — a page load that opens the
log-one-line flow; GET and HEAD are PROVEN to change zero threads
(tests/thread-nudge.test.js §2 snapshots the rows around a fetch of every
link). CAN-SPAM footer carries `legal_name · receipt_address`; a missing
address is said out loud with a link to add it (never a footer that
pretends). Ops hook `POST /nudges/run {today?, dryRun?, force?}` — the
weekday rule applies to the pinned date (that's what makes the schedule
testable); the wall-clock window deliberately doesn't.

## PART 4 — the landing page

### Verifier changes (the §4.5 paper trail — every assertion that changed, and why)

`scripts/landing-prod-verify.js` went 29 → 40 guards. Died WITH their
subject:
- "four fields of 199 dots" and "January 0 · June 31 · December 74 · hero
  74" and "June ⊆ December" — the year section and the every-dot-is-a-person
  section are GONE; one field remains, in the Drift section, asserted as
  199 dots / 74 gold. The nesting MATH is still pinned in
  tests/donor-field.test.js (untouched module, untouched suite except the
  render-count line).
- "all three verticals cards are present" — the Built-for-orgs-like-yours
  section left the page with the BUILD-81 section order (spec §4.4 is
  exhaustive). The `card-*` photos stay committed; ASSETS.md records the
  retirement.
- The old section-order strings — replaced by the BUILD-81 seven.
New guards: the question as THE H1; "The Thread" named on the page; the
thread visual's five knots + role="img" + reduced-motion full-opacity
static; FEP caption asserted IN the Drift section; CLS === 0.0000 at 1440
AND 390 (was ≤0.02 at 390 only); the em-dash ban; CTA semantics (Start
free is a real `<a href=/signup>` everywhere, Talk-to-the-founder stays a
`<button>`; the old page navigated with buttons — cmd-click and crawlers
never saw a link); the © placeholder must render FLAGGED (dashed outline),
never as bare bracket text pretending to be a name — read of the spec's
"assert it is not shipped as literal brackets", which cannot mean "assert
the value is filled" while the same sentence says it stays a placeholder.
- The contrast sweep now COMPOSITES rgba() foregrounds over their ground
  before measuring (the old sweep read the raw channel values, overstating
  translucent-on-dark contrast). It caught a real bug in review: `.lp a
  { color: inherit }` outranked the CTA classes and shipped ink-on-ink
  "Start free" buttons; fixed with scoped selectors.

### Decisions
- The hero and card-stops copy are the spec's, verbatim. The your-data
  section's four sentences are drawn from audit/data-handling.md and each
  is checkable: org-scoped records (tenant battery), staff-only access +
  own-Stripe settlement, CSV export any time incl. lapsed (the export
  convention), leave = export + deletion on request.
- The how-it-works beats are DOM renders of the real Part 1 UI (the
  BUILD-12 rule: never rasters of text), sample-labeled in the section
  footer. Names invented and collision-checked: "R. Harmon" (the spec's
  own) and "L. Okonjo" appear in no fixture, no seed, no prod org;
  tests/threads.test.js renamed its own "Ruth Harmon" → "Ruth Halloran" to
  keep the guarantee airtight. ("Marchetti" was rejected — the v2 fixture
  has two.)
- The record section's one screenshot is a REAL capture of the Donor Map
  over the 25-donor SAMPLE fixture (pins only, no names) — the one raster
  on the page, allowed because a map is imagery, not text; OSM tile
  attribution renders in the caption (ODbL requires it; ASSETS.md records
  it).
- The thread visual: five knots on a single line, DM Sans caps, the brass
  knot 18px and breathing (opacity+transform, 4.5s) under
  no-preference; full opacity static under reduce. `role="img"` reads the
  sequence. Deterministic, in code, no assets.
- reference-desktop.html / reference-mobile.html exported to
  docs/build81/landing/ (rendered DOM + full-page PNGs at 1440/390) — the
  Cowork artifact "Steward Landing Page" is still the design authority and
  will be updated separately (BLOCKED-build81.md); the copy shipped without
  waiting, per §4.6.

## PART 3 — Home

Order: The Thread (stat line = a count, never a dollar figure — a thread
has no honest dollar value and the product does not invent one) → Drift
(unchanged) → the recurring one-line now leads with "N cards stopped this
month." when failedCards > 0 → the rest. The checklist's automation item
(which ticked on a fresh org that had done nothing) became "Log your first
conversation", computed from `threads` count — only a real logged
conversation or a live gift can tick it. The retention tile's sector line:
confirmed still dead (comments only; home.test.js pins it).

## SUITES

threads (56) · thread-nudge (24) · landing-field rewritten (43) ·
setup-checklist updated (40) · brand-allowlist grew the new primary-action
pins · donor-field render-count relaxed with its reason · tenant-matrix
carries `threads` (fixture row + reset + bySeg) · route inventory
regenerated in the same commits as the routes. Full battery: 126 suites
green on every push. The walk: scripts/build81-capture.js (15 asserts,
LOOPBACK_HARDCODED) → docs/build81/ — fresh org, v2 import (zero threads),
empty state as written, one call, the thread back on Home with the stat
line, the checklist tick, the REAL nudge email bytes with subject/day/footer
asserted, READ-ALOUD.md.

## §WORRY — what I'd watch

1. **The thank-queue action and the gift thread are parallel, not wired.**
   A gift opens a Thank thread AND the day view still computes its
   own thank bucket; the Home fold de-duplicates the display, but ACTING
   on the queue's "Log thank-you" button does not close the thread — the
   user still logs the conversation (or dismisses "handled outside
   Steward"). Two half-completions of the same intent on one screen is the
   seam most likely to confuse a real user in week one. The honest fix is
   for the thank action to ALSO run the conversation flow; deliberately not
   bolted on at the tail of this build.
2. **Unowned webhook-gift threads** (donor with no assigned officer) show
   "day N" with no owner name; in a 2+ person shop both get nudged for it
   by design, but nobody is accountable until someone touches it. Fine at
   pilot scale; portfolios make it moot.
3. **The nudge is org-wide per user.** At a Team org with real portfolios
   a 10-officer shop would get identical org-wide emails; an
   officer-scoped variant (owner's threads first, org-wide below) is the
   natural BUILD-82 candidate, and the spec's own subject-line grammar
   already fits it.
4. **The landing's beat-3 mock says "MONDAY'S EMAIL"** while the nudge is
   every weekday. It reads as an example, not a claim, and the beat copy
   says "one weekday-morning email" — but if anyone reads it as
   weekly-only, tighten the mock's eyebrow.

## THE PHOTOGRAPH PASS (FIX, 2026-09-06 — design source docs/build81/landing/proposal.html)

Landing rebuilt to the proposal section for section: the hero's bare thread
line became the INK PANEL (donor + lifetime up top, the conversation as
cream cards down a rail, the brass "Still open. Day 11." card with a real
<a href="/signup"> "Log the call" — same role="img"/aria-label, breathing
brass knot, static under reduced motion); Who-it's-for uses the proposal's
three photographs; How-it-works keeps the REAL product screenshots; When-a-
card-stops gained the chapel (4:5); the RECORD SECTION IS DELETED (headline,
donor map, caption — assets removed); Your-data gained the potter's hands
(4:3); the close gained the doorway photograph at 0.28 opacity under the
ink gradient (decorative: alt="" + aria-hidden). Drift untouched; the FEP
caption byte-identical.

**Verifier guards REMOVED (the §4.5 paper trail):** exactly one — the
SECTIONS entry "Built with a development director" (the record section's
presence-and-order membership), which died with its section. The record
section never had other guards of its own; the donor-map image was covered
by the generic img rules, which now assert the NEW set. Guards ADDED: the
panel (donor + lifetime + the one real anchor to /signup), one photograph
each with dimensions + alt in #card-stops and #your-data, the decorative
close background (alt="" AND aria-hidden AND 0.28 under the gradient, text
stacked above), and the every-img rule (width+height+non-empty alt, one
decorative exception). 49 → 55 guards; grows, never shrinks.

**DEFECT FOUND AND FIXED in the verifier itself:** the strip-FIX edit had
written literal BACKSPACE characters (\x08) into the customers/clients
regexes (a \b that lost its backslash on the way through an edit pipeline),
so /\x08customers?\x08/ could never match and that guard was passing
VACUOUSLY. Replaced with plain /customers?/i · /clients?/i — stricter than
the word-boundary version. The "trusted by" half was always real. Lesson
recorded in memory: never write \b into a file through a python
double-quoted string.

**Photo provenance, stated plainly (client/public/ASSETS.md has the table):**
the three strip photographs are new to this repo (per Jonathan, his own);
the chapel, the potter's hands and the doorway are demonstrably the SAME
photographs as the repo's documented Unsplash set (Mueller / Wilcox /
Wanner — the doorway is a wider crop of the card-arts gallery shot). Every
use is license-safe; the record was kept accurate rather than re-attributed.

Cosmetic note: the hero H1 wraps over a <br>, so innerText carries a
newline — the SECTIONS order check keys on "mean to call back?" while the
H1 guard still asserts the full question via textContent.

## THE PRODUCT MARKS + THE VOICE (FIX, 2026-09-06)

`client/src/components/ProductMark.jsx` — one dependency-free pill (the
landing is the eager entry chunk; the component imports nothing) rendering
The Thread and Drift as NAMED PRODUCTS with their 18×18 glyphs (the knot on
a thread; three dots with the third gone brass), ink and cream variants per
the brief. Placed: the hero panel head (replacing the small-caps cap), the
how-it-works head above the H2, the landing Drift head (replacing the DRIFT
eyebrow), and Home's Thread and Drift section headings (Drift's mark
followed by the existing grey sentence). Literal names asserted inside
`.pm-mark` on the landing (both gates) AND on Home (presentation-wiring).

**The language rule, now asserted:** Steward HOLDS things; it doesn't nag.
"keeps asking" and "until you've done it" are banned and asserted ZERO on
the rendered landing (both gates), on Home (presentation-wiring), and in
the nudge email bytes (thread-nudge). The hero's fragment-list paragraph
("The gala guy. The board member's friend…") was replaced with the
March-donor paragraph verbatim; the panel line became "Back in your inbox
Tuesday morning."; how-it-works became "It stays with you." with the
stops-when-it-closes body. Verifier 55 → 57; guard count up, never down.

