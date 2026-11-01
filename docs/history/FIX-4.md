## FIX-4 — the six things Jonathan found (2026-09-28)

Six unrelated defects and one piece of copy, from one pass through the product.

**1a · the first year is a year.** "New donor, first year" was seven touches
over SEVEN months and then five months of silence, which is the exact stretch a
first-year donor lapses in. Retimed to day 2, week 1, month 3, month 5, month 7,
month 9 and the ask at month 12. The sentence under it is BUILT from the steps
(`touchesSentence`), so it now reads "7 touches over 12 months" without anybody
typing that. `scripts/seed-demo.js` held a SECOND hard-coded copy of the same
seven steps, which is why the demo went on showing the old timing under the new
caption after the first fix: it reads the preset now, and the five demo people's
entry dates are computed from the preset's own offsets rather than typed, so
retiming the journey can never again silently move four of them onto the wrong
step.

**1b · the timeline fits the card.** The spine lived inside the builder's 1.85fr
left column with `minWidth: 900` and `overflowX: auto`. At 1440 that column is
about 680px, so seven steps existed and four were visible behind a SECOND
horizontal scrollbar inside the card. It has moved out of the grid and spans the
whole card; the chain runs the full width, first node to last; the minimum width
is gone. The spine→list breakpoint moved from 900 to 1100, because between those
two the card was wide enough to draw a spine and too narrow to read one.

**1c · who a journey is for.** Seven audience filters on the apply offer —
volunteers, attended an event, members, recurring givers, stage, tag, gift size —
defined once in `shared/journeyShape.js` and translated into SQL in one function
(`audienceClauses`). Every one narrows and none widens. The count re-asks the
server on every change, and the apply sends the SAME audience the count was taken
with, so the confirm can never name a number from a previous set of filters. Two
new triggers, `attended_event` and `became_member`, fired from the single-person
write paths only — never from the membership import, because sweeping a
spreadsheet of members into a welcome journey is the harm, not the feature.

**2 · no hunting.** The profile's rail names the journey somebody is in as a chip
that OPENS it, and offers "Add to a journey" when they are in none: pick one, see
their first step and the real date it falls on (`GET /donors/:id/journey-preview`,
the org's civil date, writes nothing), confirm. Journeys is its own item in the
sidebar under Fundraising; the Settings section is untouched, so both doors open
the same builder and every deep link survives.

**3 · the Agent is a screen, not a room.** FIX-2 gave it an ink margin around a
cream sheet. In the product it read as one screen painted a different colour from
the other eleven. Cream ground, white card, ink text, emerald for the one action.

**4 · a chip is not a tab.** The role chips carried `activeMark(on,"bottom")` —
an inset 3px emerald rule, which is the TAB treatment. On a chip it read as a
green bar that appeared on click and stayed, and on the Donor chip (set by
giving, so the click does nothing) it appeared for a click that changed nothing.
The on-state is now what the comment above the component always claimed it was:
cream, ink text, an emerald hairline.

**5 · the admin console said `no_subscription`.** `adminFetch` threw `d.error` —
the machine CODE — one line before `d.message`, the sentence the server had
already written. Every refusal on that screen arrived as snake_case. Fixed at the
one seam. The $1 test is now hidden on the demo org and on any org with no
subscription (it moves a live subscription; there is nothing to move), and where
it used to sit uselessly there is now **Find subscription**:
`POST /admin/orgs/:id/reconcile-subscription` reads the subscription back from
the close link or from Stripe's own customer record and writes it onto the org.
It creates nothing and charges nothing. **What it does not do is explain the
original miss** — the signup path writes `stripe_subscription_id` correctly and
every suite proves it, so the likeliest cause is a `checkout.session.completed`
that was never delivered. Worth noting while looking: `checkWebhookSubscriptions`
diffs the **/billing/webhook** endpoint using the DONATION Stripe client, and the
two clients are deliberately independent — so if the billing endpoint lives on the
other account, that guard has been reporting it missing (or absent) all along.
Not fixed here; it is a monitoring bug, not this build's item.

**6 · the pricing section, as approved.** `docs/landing/pricing-mockup.html` in
React, with the live checkout wiring kept: cream ground, a centred toggle whose
selected tab is ink, Seed / Sapling (featured) / Orchard cards, the Forest bar,
the four included groups. The tiers have NAMES now — Seed, Sapling, Orchard,
Forest, with the donor count always UNDER the name — everywhere a customer or an
admin sees a plan: the pricing page, the signup quote, Settings → Billing, the
over-band notice, the welcome email and the admin PLAN column (which printed
`t5000_monthly`). The Stripe products and the `STRIPE_PRICE_*` variables are
untouched, deliberately: renaming a product would move real organisations off the
prices they are on. Book a call sits beside Start now in the landing header.

**The walk (`scripts/fix4-walk.js`, 45 checks at 1440 and 390)** is the half a
server suite cannot do, and it caught three things the suites could not: the
pricing page left `body` ink (index.html paints it, and a phone's overscroll
showed a black bar above a cream page); the 390 pricing header overlapped the
wordmark with "Sign in"; and the demo's journey still had the old timing. It also
taught its own lesson twice — a walk that PUTS somebody in a journey cannot pick
"the first donor", or run two tests the same thing only on run one, so it picks
somebody with no active plan and says so if the org has none.
