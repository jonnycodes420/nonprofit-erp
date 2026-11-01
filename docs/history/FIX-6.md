## FIX-6 — six QA defects from the Harborlight audit (2026-09-28)

Six defects from a read-only pass over the demo. Two of them had already been
fixed at the root and the pass simply predated the re-seed; the other four
were real, and one was a demo blocker.

**1 (the blocker). The approval queue had no way to approve anything.** Five
kinds of item reach "Waiting for you" and exactly one of them could be acted
on: a gift to confirm. Everything else — thank-yous, tribute notices, notes on
a follow-up, notes Steward drafted — rendered its words, its "why this
matters", and then one control: "Open the record". Two of the four had no
server route at all. The count never moved and the only way to clear anything
was to go somewhere else and do it there.

Every item has **Approve** and **Skip** now, and the dispatcher CONTAINS NO
SEND: each kind is handed to the path that already exists for it, so there is
no second place a thank-you can be marked sent. Approve on a thank-you logs
the interaction in HER name, marks the gift acknowledged and closes the
thank-you thread. A GIFT is refused by name, in both halves: money is
confirmed by running its plan, and a general approve button over a queue is
the exact shortcut that rule exists to prevent.

**And the result stays on the row.** Reloading the queue makes the item
vanish, and a row that disappears is indistinguishable from a press that did
nothing — which is how the first version of this shipped internally for about
ten minutes before the browser said `result lines 0`. The row is settled in
place with the server's own sentence and goes on the next full load.

**2 and 3. Already fixed, and the brief's hypothesis was wrong.** The duplicate
journeys and the duplicate Verity Underhill are both gone, verified on a fresh
local seed AND on production. The brief guessed the seed was not idempotent;
it is, proved by running it twice and diffing (1,144 donors, 3,933 gifts, one
journey, both times). The real causes were FIX-5's: the preset button used to
POST whatever you pressed, and the seed used to enforce name uniqueness on a
derived email inside one generator. Nothing to fix; something to verify, and
the walk verifies it.

**4. The export said nothing.** It built the zip, clicked a hidden link,
revoked the object URL and put the button back. If the browser saved the file
quietly, nothing on screen said so; if it blocked the download, nothing said
that either, and the two were indistinguishable. The row counts already
existed server-side for the README, so they ride out on a header (exposed for
CORS, or the page cannot read it) and the screen reports the same numbers the
zip contains, with a link that still works because the object URL is no longer
revoked while it is on screen.

**5. The campaign figures were blank because Communications was listing
fundraising goals.** `campaigns` is one table doing two jobs: an email campaign
(subject, body, sent_at, open_count) and a fundraising goal (goal_amount,
start_date, goal_category). They share a table because a goal and the appeal
that raises it are one thing to a fundraiser. They are not one thing to
Communications, and Harborlight's two rows are the Annual Fund and the gala —
so the list showed two goals as "Draft" with nothing in Sent, Open Rate or
Date, and the pills above read 0 because no row had ever been sent.

`shared/campaignKind.js` splits them, and the rule defaults to EMAIL on
purpose: a brand new draft from the composer has no subject yet, and a rule
that demanded one would make the campaign you are writing disappear from the
list you are writing it in. Zero now shows "0" and means it; a campaign that
has not gone out says "Not sent yet" rather than "0%", which would be a claim
that nobody opened it. Each figure opens its rows, from the same computation.

**6. The sidebar was dead on a donor record — all of it, not just Agent.** The
donor profile is `position: fixed; z-index: 200` and the sidebar is `z-index:
120`, so `left: 0` put the profile over the entire nav. You could see every
item through the transparent gutter and click none of them; the keyboard
worked, which is why it read as an Agent-item problem. None of the three
suspects in the brief was involved. `.fullscreen-takeover` reads `--sidebar-w`
now, published on `.app-root`, so it starts where the content starts and
follows the sidebar when it collapses; the mobile block resets it to 0 where
there is no sidebar to clear. The grant profile had the same bug and is fixed
by the same line. Verified on four screens, two widths, collapsed, and at 390.

**7. Not reproducible.** The disabled "Thinking…" button under Quick actions
does not appear on this build: sampling every 100ms through a six-second load
of a donor record found no such button at any point, and the four quick
actions settle enabled with their own labels. Left alone rather than
"fixed" speculatively, with the method written down so the next sighting can
say what was different.

**8. The identical thank-yous were the template, not the AI.** `thankYouDraft`
was one sentence with the amount swapped, so every draft an org without voice
samples ever got was the same line — with the Anthropic key on or off. It now
chooses from facts the CALLER passes: first gift, monthly, months since the
last gift, how many came before, the fund or campaign. Nothing is invented,
and that constraint shapes all of it: a fact it is not given is a fact the
letter does not mention, so there is no "your continued support" for somebody
whose history we were not told.

The demo then still showed three identical drafts for a TRUE reason — all
three of its most recent online gifts were genuine first-time givers — so the
seed picks three different shapes now: somebody new, somebody who gives
regularly and has not been away, and somebody who had gone quiet and came
back. The regular giver has to be excluded from the returners explicitly,
because the template puts a year of silence above loyalty and a giver who is
both reads as a returner.

**What the run cost.** A comment containing backticks went inside a template
literal and ended the string, so `takeover` became an undefined identifier and
the whole client build failed on one lint error. The tenant matrix refused the
build twice for the right reason, both times over new parameterised routes
nobody had probed across the org wall. And this suite's own assertion said
"SKIPPED", which the battery's skip scanner greps for by token, so a suite
with no skips reported one — a false positive in the "no silent skips" signal
is worth more than the emphasis.
