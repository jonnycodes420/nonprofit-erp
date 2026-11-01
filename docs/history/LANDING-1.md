## LANDING-1 — the new landing page (2026-09-28)

`docs/landing/landing-mockup.html`, Jonathan's Muse design, in React. The
markup and the CSS are the mockup's; four things are deliberately not.

**1. The pricing section is FIX-4's, not the mockup's table.** Seed, Sapling,
Orchard and Forest, with the donor count under the name, read from
`pricing.json` — the same file the signup route prices against, so the page
and the card cannot disagree about what anything costs.

**2. Volunteers says the checks are TRACKED.** "Track background checks and
get a heads-up before one expires", never "Run Checkr checks from inside
Steward": VOL-1 records that a check happened and warns thirty days before it
lapses, and it does not run one. The walk asserts the word Checkr appears
nowhere on the page.

**3. Journeys is live.** It sits in Relationships as a real feature, not under
"coming soon", because THREAD-2a, THREAD-2b and FIX-4 shipped it.

**4. The Connections band is cream.** In the mockup it was a solid emerald
panel: the only full-bleed block of the ACTION colour on the page, competing
with every button on the screen. Cream, with the logo tiles as white cards,
which is how every other band on this page is built.

**The photographs moved out of the file.** The mockup carried 2MB of base64,
which is 2MB in the JS bundle, parsed on every visit and impossible to cache
separately. Fourteen images now live in `client/public/landing/`, named from
their own alt text.

**Two things the mockup's design assumed a phone would not need.** Its nav hid
every text link below 900px, which left a visitor on a phone unable to reach
Pricing or Lost & Found at all — and Lost & Found is the top of the funnel and
a phone is where most people meet a link to it. The links wrap onto a second
row now instead of disappearing. And `.approval-result { display: none }` was
the mockup script's job to undo; React decides whether that element exists at
all, so the default had to become the visible one.

**One self-inflicted hour, worth writing down.** A comment I added inside the
CSS template literal contained a BACKTICK, which ended the template early and
broke the parse. The build failed, vite kept the previous `dist`, and because
the build output had been sent to `/dev/null` the walk ran against a stale
bundle and the fix "did not work" three times. The lesson is not about
backticks: **never send a build's output to /dev/null.**

**The walk (`scripts/landing1-walk.js`, 90 checks at 1440 and 390)** checks
all six brief items by name plus the two standing rules: no invented social
proof, and no em dash anywhere in the copy. It also asserts every photograph
actually LOADED rather than merely being referenced, that no photo credit is
printed, and that the founder and all three advisors are present with their
organisations.
