## GTM-1a — the money path (2026-09-27)

**One plan, priced by how many donors you work.** The page sold two plans "split on a real line":
Core for a small shop, Team if you have gift officers. That line had stopped being real — moves
management, officer portfolios and the Agent are what a small shop most needs, and putting them
behind the bigger number meant the orgs Steward is *for* could not have them. So: one plan,
everything in it, unlimited users, month to month, and the only thing that changes with size is the
price. $199 up to 1,000 active donors, $299 up to 5,000, $499 up to 10,000, a conversation above
that; yearly is two months free. The numbers live in `pricing.json` and nowhere else.

**Why `pricing.json` is JSON.** It was `shared/pricing.js` re-exporting a root CommonJS module for
an hour, and the client build refused it: *"default is not exported by ../pricing.js"* — Rollup's
CommonJS transform only covers `node_modules`. The server needs the catalogue synchronously at
require time (`closeLink.js` builds its plan list before Express starts) and the client needs it in
the bundle. JSON is the one form both read natively. A useful side effect: the $1 internal price is
deliberately NOT in the JSON, so it is not in the browser bundle at all — a stronger guarantee than
any string check that it never reaches a public page.

**Signup reopened, and it is not a second door.** BUILD-87 closed `/signup` because the form sold a
price that had not existed since August and a self-serve door BUILD-39 had shut. Every one of those
reasons is answered rather than avoided: the page quotes the same list the route prices against and
Stripe is checked against, and it is not a new path — `POST /public/signup` mints a BUILD-90 *close
link* for the visitor. Same `close_links` row, same Checkout, same thirty days from signing, same
seven-day reminder, same two-click cancel, same webhook that creates the org. Nothing exists until
the card goes in; a signup that is never paid for leaves two rows saying somebody was interested.

**The click-through agreement stores what was on the screen.** `terms_acceptances` is append-only
and carries the version AND the sha256 of the exact bytes served, so "what did she agree to?" has
an answer after the document has been edited twice. A body whose `termsVersion` is stale is refused
rather than recorded. The document moved from `claude/` to `legal/` for a plain reason:
`.railwayignore` excludes `claude/`, so the backend did not have the document it was about to serve.

**The $1 price, and three locks rather than one.** It is not in `pricing.json`, not in `TIERS`, and
`validateCloseLink` refuses it by name — so no bundle, no estimate, no public route and no close
link can reach it. The one door is `POST /admin/orgs/:id/internal-test-price`, super-admin only, on
an org that already exists, and it is the `$1 test` button on each row of Organizations in the admin
console. The build's one new suite guards exactly that, and it was watched go red twice before the
green was trusted: once with `requireSuperAdmin` removed (§3 failed), once with the price pushed
into `TIERS` (§1 failed).

**THE BROWSER LEGS HAD NEVER RUN IN CI.** `smoke-walk` opens every tab and every donor-profile tab
and fails on a blank screen, an error boundary, a 5xx or a console error; CLAUDE.md names it as the
only coverage screens have. It asserted 104 things on a laptop and **0** in CI, because CI had no
Playwright — and the count ratchet had been *taught* to exempt a suite that skipped, which is
precisely the shape of "green with the coverage missing" the ratchet exists to catch. Every deploy
for months went out on a battery that had never opened a page. CI now installs Chromium (cached,
pinned to the laptop's version) and sets `REQUIRE_BROWSER=1`, under which a leg that cannot run
exits 1 with the same sentence it used to skip with.

**And the exemption was wider than anyone thought.** It keyed on `skips > 0`, which is any line
containing the word SKIP — and `smoke-walk` prints one per tab hidden from the CRM for that org.
So the one suite covering every screen was exempt from its own floor on *every* run, laptop
included, and could have fallen from 104 assertions to 2 without a word. It now keys on `legSkips`,
written from an explicit `[leg-skip]` marker.

**`fix2-a-footing` came back** (retired by CHORE-2). It fetches the rows behind every figure that
carries a source and foots them to it, in cents. Nothing else checked that the drawer behind a
number adds up to the number, and money is going on sale.

**One contradiction on the donor profile, closed.** Last contact said "Never contacted." while the
suggestion beside it said "over four months since the last conversation" — the same record, two
readings, on one screen. `moveUrgency` answers "is this donor late for their stage?" and falls back
to the last GIFT date to do it; that is fine for a colour and it was being read as the figure. It
was also feeding the validator, which is why the sentence survived the guard. `contactGap()` is now
the single reading of the tile's own figure, and when nobody has logged a conversation there is no
contact row at all — so the number cannot be invented.

**A local trap worth the line:** `SHARD_DB_PREFIX` (which is how a worktree gets a database per
shard, as CLAUDE.md requires) produced `steward_g1a_shard_1`, which `seed-demo.js`'s scratch
allowlist refused — and `smoke-walk` then failed with "the demo org is on this database", which
reads exactly like a product defect. The allowlist now accepts `steward_<tag>_shard_<n>`, pinned at
both ends.

Battery: 37 suites, 0 failed, with the browser legs running. `close-link` 56→59, `upgrade-checkout`
29→32, plus `fix2-a-footing` 20 and `gtm1a-internal-price` 21.
