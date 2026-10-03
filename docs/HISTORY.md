# Steward — build history

Every dated build entry from the old CLAUDE.md, verbatim, newest first (CHORE-1, 2026-09-25).
Nothing here is an instruction. The standing rules were copied out into CLAUDE.md and
`docs/decisions/`. Read an entry here when you want the story behind a rule.

The note that headed the old CLAUDE.md, kept because the entries below still cite `BLOCKED-*.md` files:


> **`BLOCKED-*.md` NO LONGER EXISTS (2026-09-25).** All 53 of those files were
> deleted and replaced by **one** `NEEDS-JONATHAN.md` at the repo root, which
> holds ONLY what physically requires him — a credential, a password, a real
> customer's file or token, a payment, or a legal signature — one line each with
> the exact click or paste. **Everything else was decided**, and each decision is
> recorded in the commit that made it.
>
> The dated build entries further down still cite the old filenames. They are a
> historical log and have deliberately not been rewritten; read any
> `BLOCKED-…md` reference below as "see NEEDS-JONATHAN.md, or the item was
> decided". Do not create a new `BLOCKED-*.md`: decide it, or put it in
> `NEEDS-JONATHAN.md` if it genuinely cannot be decided without him.






## PARITY-3 · Match the leader's volunteer module (2026-10-02 to 10-03)

Six parts, five PRs: Part 6 (#110), Part 4 (#117), Part 1 (#118), Parts 2, 3 and 5 (this one).
- **The volunteer record is on the person**, not in a second app: hours, filters, CSV, qualifications,
  answers, notes internal or for the volunteer, Volunteer service on the timeline, a glance line.
- **A shift has roles**, and capacity and the waiting list are decided per role inside the same locked
  `signUp`. Footer numbers come from one function. Calendar, roster mode, bulk, conflicts.
- **Reminders stopped sending themselves.** VOL-2's sweep mailed confirmed volunteers for an org that
  turned it on (and FIX-14 listed it as a confirmed automatic send). The brief's rule is that nothing
  reaches a volunteer without a person pressing Send, so the sweep drafts, check-in drafts the
  thank-you, and To send sends in one tap through `sendMilestoneDraft`.
- **A recruitment page and applications**: rich text rebuilt from an allowlist (`shared/richText.js`),
  questions of four kinds, a waiver upload that never appears on a public page, Approve matching by
  email under the per-email lock so a donor who applies stays one record.
- **The Volunteers list is the donor list's filter** with volunteer rules (groups.js), so a Group saved
  from it is the same rows; the default Volunteers group's page says who has never given; WHY-1's
  "Which volunteers should we ask to give?" is a button on the list.
- **Speed (6b)**: a fresh database planned the giving-level aggregate once per gift. 31.8s cold to 0.29s
  after ANALYZE (now at the end of every import and the seed), and 2.04s even with no statistics.
- **What it cost**: PARITY-2 merged five times while #110 waited, and every merge conflicted on the
  regenerated `audit/route-inventory.json` (its timestamp and count lines always collide). Rebase,
  regenerate, merge the moment CI is green.
- **Found, not fixed (next brief)**: `/portal-assets/:id` serves every asset kind publicly to anyone
  with the id, including PARITY-1's conversation attachments (ids are 96-bit, never linked publicly).
  Check-in briefly dated hours on the shift's planned date in #117; fixed here to the org's today.

## PARITY-2 · Match the leader's public pages and books sync (2026-10-02)

Jonathan walked the leading platform's tours of membership signup, books sync, peer-to-peer, event and
auction pages; the call, as in PARITY-1, was to be just as good at a better price. Five parts built in
parallel worktrees, merged one PR each (#111 to #115), every battery green before its merge.

- **Peer-to-peer (#111):** the thermometer gained a donor count and a countdown; Individuals and Teams
  leaderboards (top 10, See all, one query per board); fundraiser pages with recent donors (first name
  only when the donor chose it), a team badge and UTM share links; a public team page (`?team=`) with
  captain, members, goal and total; an optional approval step; staff edits; each fundraiser's gifts as
  a Figure; four coaching drafts per fundraiser that Steward never sends.
- **Event page (#112):** hero image or video (YouTube or Vimeo, rebuilt from the id), start and end
  times in the org's zone, sponsor cards with benefits, a Donate button for people who can't come
  through the same `donateHandler`, a share row, a gallery shown after the event, a timed .ics, and
  staff can finally publish the page and edit its address. EVENTS-2's phone check-in was already
  built; it is now reachable from the guest list.
- **Membership page and Give hub (#113):** `/give/:slug?memberships` lists every level as a card with
  Join straight to that level's checkout; a signed-in member sees their level, expiry and Renew; a
  monthly term with no renewal thread; edit, hide and reorder on the Members screen. The org's give
  page now ends with "More ways to give" from one helper (`waysToGive.js`).
- **Auctions (#114):** items, bidders, bids, closing to the second on the database clock, ties to the
  earliest bid, winners, pay links through the org's own Stripe Checkout, the deductible part on the
  receipt as winning bid minus FMV, the donated item as an in-kind gift on a staff press, drafts for
  the closing note and the winners' emails, and five report Figures. Test 1 is
  `tests/parity2-auction.test.js`.
- **QuickBooks Online (#115):** per-org flag, mapping from the company's real accounts and classes,
  Pending with Sync, Sync all and Skip, one sales receipt per gift (or a deposit per payout), sent once
  by a unique row plus a RequestId, plain-word errors with Retry, disconnect revokes and keeps the
  history. Test 2 is `tests/parity2-qbo-sync.test.js`. The assessment answers are in
  `docs/integrations/quickbooks.md`.

What the build learned:
- The brief said "the existing Payment Element". There is none: every online payment is a Stripe
  Checkout Session on the org's connected account, and every part reused that one path.
- Nothing in the product could mint an event's public address before this build; only the seed did.
- A rebased branch carries the client bundle built before the rebase. Rebuild `client/dist` before the
  battery, or smoke-walk walks the old screens and passes.
- The Xero "send" from INT-2 posts to an endpoint Xero does not have and nothing calls it. QuickBooks
  now has a real per-gift path; Xero's is for a later build.

## PARITY-1 · Match the leader screen for screen (2026-10-02)

Jonathan walked the leading mid-market platform's product tours; the call was to win on being as good,
at a better price, with better service. Six PRs (#103 to #108), built in parallel worktrees.

- **Profile (#104, #105, #106):** giving level, lifecycle and Retained tags under the name, each opening
  its donors (`donorStatus.js`, Settings, Giving levels); the closeness word (ENGAGE-1's band in words)
  with the facts that put them there; at a glance (first, largest and average gift beside the four
  tiles, Giving by year in the same block); highlights; "Next: ... Suggested ask: ..." with Why?.
  Timeline filters All, Gifts, Conversations, Tasks, Notes, Emails (hide mass emails), Attachments, and
  a list view; files on conversations and notes (10 MB, assetStore, no virus scan on the host). Video
  thank-yous recorded on the profile become a draft email linking a page that plays them; the view is
  logged by a POST.
- **Home and dashboards (#107):** Calls to make in Home's right column (first-time and over-the-floor
  gifts not yet thanked by phone, Mark called, Snooze) and the annual goal bar. Fundraising dashboard:
  totals by giving level, month over month against the last two years, retention with a choice of
  definition, goal progress.
- **Groups and journeys (#108):** static and dynamic Groups on the one `audiences` store, with a page and
  wiring into email tags, journeys, surveys and the board pack. Journey triggers: first recurring gift,
  next gift, membership payment, becomes a prospect, joins a group, giving anniversary, with amount,
  fund and campaign filters, live audience checks, four states and entered/in/exited/completed counts.
- **Forms and email (#103):** "Sign in" for returning donors, tribute on step one, a share row after
  giving, an optional exit nudge (off by default); a monthly giving appeal starter and "Not yet
  reviewed" on starters until someone edits them.
- **Agent (#106):** "thank-you calls for every gift this week" plans one task per gift with server-side
  due dates; a truncated plan is refused.
- Tests: `parity1-donor-tags` (red with the Major cut planted as >) and `parity1-groups-journeys` (red with
  the event key nulled, and with a frozen dynamic group).
- Remaining gaps: room to give (PROSPECT-1), PayPal and Venmo (partner program), birthday trigger (no
  birth date field), membership signup page, peer-to-peer pages, event page, auctions and QuickBooks
  Online sync (PARITY-2).

## FIX-19 · Small leftovers from WHY-1 (2026-10-02)

- **A user id from the request belongs to the org.** `POST /donors/:id/threads` stored any `ownerId` it was
  handed. `orgUsers.js` is now the one check: an id that is not an active user of the caller's org is refused
  with a 400 (`user_not_in_org`) before anything is written. It covers donor create, assign and bulk assign,
  tasks (create, update), threads, proposals (`POST /donors/:id/proposals`, `PUT /proposals/:id`), grants (`POST /funders/:donorId/grants`), and journey step owners
  (create, update). The read filters (`GET /donors`, the CSV export, `/pipeline`, `/proposals`,
  `/grants/pipeline`) refuse a foreign id too but accept a deactivated colleague, so a former officer's old
  portfolio can still be looked at. The import's owner resolver now drops deactivated users as well. The
  tenant battery's §10 plants a B user as the owner of an A thread; with the old route it went red (201, one
  thread owned by B).
- Drift's profile sentences lost their em dash ("Gave every May since 2019, usually around $500.").
- `BLOCKED-landing-2.md` is gone: both items were fixed by FIX-13. What is still true about the demo form is in
  `docs/decisions/accounts-and-billing.md`.

## WHY-1 Parts 7 and 8 · Journey, not Rhythm; honest "sent", the last three (2026-10-02)

- **The profile rail's Rhythm panel is now Journey.** The twelve-month touch strip and its legend left the
  profile (the timeline is where touch history lives). No journey: a pitch line, the journey Steward suggests
  from simple facts (`GET /donors/:id/journey-suggestion`: monthly, lapsed or drifting, first year, generosity
  80 or more, met in the last month) with its first three steps, an emerald "Start a journey" picker, and a
  link to every journey. Running: step N of M, Mark done and Skip, the next two steps faded, a progress bar,
  Change journey and Stop under "...", confirmed inline. Finished: the date, and the next suggestion. ENGAGE-1's
  scores did not change.
- **Honest "sent".** A campaign nobody received is `failed`; a partial one reads "Sent to N of M" and opens its
  failed rows; no provider is a failure, not a delivery. Onboarding emails, sequence steps and volunteer shift
  reminders are sent only when the provider accepts them; a refusal keeps its reason and waits a day (it used
  to retry on every hourly tick). Harborlight's receipts and statements carry DEMO on every page.
  `mail-suppression` §8 pins all of it.

## WHY-1 · Ask Steward why, and who to call tomorrow (2026-10-02)

- **The thesis** went into CLAUDE.md ("How Steward is built") and `docs/decisions/why.md`: Steward answers
  why it happened and what to do next; every reason opens its rows; AI writes the sentence, never the facts.
- **Seven questions, one answer shape** (`why.js`, `routes/why.js`, `shared/whyShape.js`, `WhyAnswer.jsx`):
  appeal variance, who to call tomorrow, retention, why one donor stopped, who is about to lapse, which
  volunteers to ask, which first-time donors need a second ask. Each reason opens its rows (figure source `why`).
- **Where people ask:** Home's Thread ("Ask why"), a "Why?" on report numbers that are down, the campaign's
  "Why did this come in where it did?" (replacing ENGAGE-1's reasons and who-to-call), and "Why did they
  stop?" in a lapsed donor's More menu.
- **The question log** takes surface `why` and an `answered` flag; super-admin lists the unanswered by topic.
- **Found on the way:** ENGAGE-1's "new donor" test read a prior gift with no campaign as NULL and dropped
  it, so a returning donor counted as new. Fixed in `appealWhy.js` and `why.js`; test 1 pins it.
- **Harborlight:** the spring appeal is eleven lapsed, two late (the letter went out twelve days later),
  four down, seven up and three new; an overdue $10,000 ask and three unarmed journeys were added.
- Tests: `why1-appeal-variance` (reasons foot to the variance and to their rows), `why1-sentence-check`
  (an invented number never shows; AI off asks no model).

## COMMS-2 · templates in the org's voice, and better statements (2026-10-02)

- **Brand kit** (Settings → Brand kit): two colours from the safe palette in `shared/brandKit.js`, the
  signature block, the address and the tax language. The logo, signer and address are the columns
  receipts already read, so there is still one store for each. The tax language replaces the
  default footer sentence on receipts and statements; the EIN always follows it.
- **Template library** (Communications → Templates): ten kinds with Steward's plain starting words in
  `shared/brandKit.js`, saved per org in `message_templates`. A template is "Not yet reviewed" until
  someone saves it, and cannot be used until then. An email becomes a draft in Drafts to review; a
  letter prints in the kit's colours. Live preview against any person; unknown merge fields are
  refused at save, and a field the person has no value for blocks use rather than printing a gap.
- **Statement money is one function**, `statementTotals.js`, in cents. It fixed two real defects: a
  partially refunded gift kept its old `deductible_amount`, so both a statement and the gift's own
  receipt could claim more was deductible than was given; and a gift whose dispute was lost stayed
  on the statement. The gift receipt now uses the same function.
- **"Your year with us"** on the year-end statement: hours volunteered and events attended that year,
  on by default, off in the brand kit. Facts only; never part of a total.
- **Seed:** the kit filled in, receipts switched on for the demo (its mail stays off), and three
  templates reviewed in Harborlight's own words.

## SURVEY-1 · ask donors and volunteers, keep the answers (2026-10-02)

- **Surveys** live in Communications → Surveys. `shared/surveyShape.js` is the one definition of a
  question type, the answer validation and the privacy sentence the page prints at the top.
- **The public page** is `/survey/:orgSlug/:slug`, server-rendered in the shared public shell
  (`shared/publicPage.js`), framable, proxied by vercel.json like `/e/` and `/volunteer/`.
- **Anonymous means anonymous**, held in four places: the anonymous path never reads the personal
  link, `survey_responses` has no IP column, a CHECK refuses a person, name or email on an anonymous
  row, and the audit row is written without the IP (`req.audit.withoutIp()`, new). The test sends an
  anonymous answer carrying a valid personal link and the donor's own name and email.
- **Named answers** reach a person by a signed personal link (`surveyLinks.js`) or a matched email,
  write a `survey` line on the timeline, and count as an engagement touch (ENGAGE-1 already read them).
- **Send this survey** writes `milestone_drafts` (Drafts to review), at most 200, one per person.
- **Volunteer follow-up:** there is no per-shift thank-you that staff send. The one that exists is
  the hours-milestone thank-you draft, so the chosen volunteer survey's link rides on that.
## REPORTS-3 · saved dashboards and the board pack (2026-10-02)

The ED stops rebuilding the same report every month, and the board gets the same numbers on the same day
without anyone exporting anything.

**A saved dashboard is tiles she picked.** A tile is one of three things the product already had: a number
(any of the 44 named sources in `figureSources.js`), the one chart (`givingByMonth`), or a list (any standard
or saved report). It is a DECLARATION validated by `shared/boardPack.js`, never SQL, exactly as a saved report
is. Nothing on it is a number computed beside its rows: every figure carries the `source` it came from, so it
opens, and the rows foot to it. The date range, fund, campaign and owner save with the dashboard and live in
the URL. They sit in the Dashboards group of Reports' one rail, prefixed `sdash:`, beside the board pack and
the tile picker. No second list, no second button: FIX-2 B took those out of Reports and this build did not
put them back.

**The board pack is one composition.** `composeBoardPack` builds the pack as data and `renderBoardPackPdf`
draws that same object, so the screen and the paper cannot disagree. Six sections: giving this period against
last year, donors and retention, top gifts, campaign progress, volunteer hours, and a page defining every
number on it, under the org's own name and logo with page numbers, the period and the day it was produced.
Volunteer hours needed two new sources (`volunteer-hours`, `volunteers-served`) because the only place hours
had ever existed was a report-builder column, which cannot be opened and cannot be footed.

**Its definitions are written for an arbitrary period, and that is deliberate.** The first instinct was to
reuse the dashboard metrics' definitions rather than keep a second copy of each sentence. They cannot be
reused: they are written for the fiscal year ("between the first day of your fiscal year and today"), and a
pack's period is a month or a quarter. Printing the fiscal-year sentence over a quarter's number would put a
definition on the definitions page that the number does not obey, which is the one thing that page is for.

**The schedule is off until somebody turns it on.** One row per org, monthly or quarterly, on a day between
1 and 28 (29, 30 and 31 do not exist in every month, and a pack that silently skips February is a pack
nobody trusts). It reports on the last COMPLETE period through `orgPeriodBounds(org, period, -1)` — a pack
sent on the 5th is about the month that finished. It reserves `board_pack_sends` before the first send and
releases it when nothing was accepted, and it rides the existing 5-minute tick. Recipients are the org's own
`board_pack_emails` from Settings, and the server refuses an address that is on file as a donor: "your staff
and board, never a donor" is the rule the list exists under, and a typo would otherwise mail a major donor the
organisation's retention figures. "Send a test to me" goes to the caller alone and reserves nothing.

**The one test reads the numbers back out of the PDF.** A board pack is a document that leaves the building:
attached, forwarded, printed, read at a meeting six weeks later by people who cannot click anything on it. So
`tests/reports3-board-pack.test.js` does not check the composer against itself. The renderer passes
`compress: false`, the suite pulls every text run out of the file, and each number is footed against
`GET /figures/:source/rows` — the live report's own rows, paged, summed in integer cents. Proven able to fail
three times: a figure one cent off its rows, a `source` naming a window one day off from the number it
describes, and the renderer printing every money figure a cent high.

### What this build got wrong first

- **An uncompressed pdfkit PDF writes text as a kerned array (`[<hex> -20 <hex>] TJ`), not as `(…) Tj`.** The
  first reader looked only for the second form, found nothing, and every "is this printed" assertion passed
  vacuously — an extractor that returns nothing agrees with everything. §6 now checks the reader can tell
  $7,477.80 from $7,477.81 before anything it says is believed.
- **"Somewhere on the page" is not where a number belongs.** With every money figure printed a cent high, only
  one of six was caught: the right value still appeared elsewhere in the document, because the Top gifts total
  is the same number as giving this period. A figure's value must appear beside its own LABEL.
- **A ratio source has no `measure` function.** `retention` is computed from its two parts, so
  `sDef.measure(p)` threw — and because one tile's crash was the whole composition's crash it took the entire
  dashboard down: a blank screen with a 500 behind it. Found by opening the seeded dashboard in a browser on
  the first walk, not by any server test, because the default pack is all sums and counts. One tile's failure
  now costs that tile, and §7 covers all three tile kinds.
- **A screen that swaps itself for a spinner unmounts the control being typed in.** The saved dashboard
  returned a bare spinner on every filter change, destroying the date input mid-keystroke: the filters could
  not be typed at all. Found by typing a date in a browser; no server test can see it.
- **The Settings card followed the wrong card's pattern** and landed under Giving Pages instead of
  Organization, because `TimezoneCard` lives there. The walk found it missing from the tab the product links to.
- **A stale server held the port.** `kill` on the boot wrapper left its `node` child listening, the new server
  never bound, and twelve new routes answered 404 while the file plainly declared them. Kill the PID that is
  listening, not the shell that started it.

## ENGAGE-1 · who's warm, who's slipping, and what to ask (2026-10-02)

- **Two scores, one file of weights.** `shared/engagementWeights.js` holds every weight, window and
  cut point next to the words the "See why" panel prints. `engagement.js` is the one row builder:
  the six-hour tick and the after-a-write recompute run it for the whole org, "See why" runs it for
  one person, so a part's rows are the rows it counted (`tests/engage1-score-breakdown`).
- **Engagement** is the mid-rank percentile of recency-weighted touch points among the people with any
  touch in 24 months (meeting 5, event 4, call 3, reply 3, named survey 3, shift 2, newsletter click 1,
  open 0.5; full weight to 90 days, fading to nothing at 24 months). **Generosity** is
  0.30 lifetime + 0.30 last 24 months + 0.20 years given of five + 0.10 monthly + 0.10 giving more,
  each a mid-rank percentile among givers. Parts are apportioned by largest remainder so they add to
  the score exactly. Bands: Close 67+, Warm 34 to 66, Distant 33 and below.
- **Mid-rank, not at-or-below.** The first cut gave 70 people tied on one newsletter open a 79 each
  and nobody a Warm; half the ties now count, and the same file reads 25 Close and 70 Warm.
- **Why the test first stayed green on a planted rounding bug:** with five givers every percentile is a
  multiple of 10, so 0.3 x pct is always whole. A sixth giver made it bite.
- **Suggested ask** is `shared/smartAmounts.suggestedAskCents` (GIVE-2 already wrote it): the profile's
  "The ask" and any Thread step that is an ask.
- **APPEAL-WHY** lives in the campaign's own edit panel; `appealWhy.js` is the one gift set per
  campaign, by `campaign_id` or name, and every number opens its rows (`appeal-why` source).
- **Seed:** Spring Appeal this year and last; the eight biggest givers last spring are not back yet,
  five of them recently in touch.

## FIX-15 · the leftovers from FIX-14, GIVE-2 and CAMPAIGN-2 (2026-10-02)

- **Two tabs, two batteries.** Shard databases were `steward_shard_<n>` in every worktree, so a
  second session's battery dropped the first one's mid-run. run-all.sh now takes a tag from the
  worktree folder: databases `steward_<tag>_shard_<n>`, logs `/tmp/steward-suite-logs-<tag>`, and a
  port block claimed with an atomic `mkdir` lock (`/tmp/steward-portblock-<base>.lock`, stale when
  its pid is gone). The two in-process suites (tenant-matrix, fix11-audit-trail) take their port
  from the shard block. The one test, `fix15-two-worktrees`, runs two batteries at once beside a
  bystander database; giving both runs one prefix (`FIX15_PLANT=1`) turns it red.
- **The pre-push hook** starts its own server and database (`SHARD_SELF=1`) when nothing answers on
  `$BASE`, instead of failing to connect.
- **Honest "sent".** The Resend client answers a refusal with `{ error }` and does not throw, and
  about twenty places read only the throw. Fixed: the volunteer link, the your-page link (stamped
  and audited only when sent), pledge reminders (no step forward, no "sent" note on a refusal),
  digests (`provider_refused` instead of `sent`), two-step codes and the owner reset, support
  ticket mail (and `replyTo`, which was spelled `reply_to` and dropped), the waitlist offer,
  recurring proposals (a refused resend no longer spends the one resend), recurring notices
  (`donorNotified`), the receipt badge ("not emailed" in brass), the import invite, the test send,
  and "Email sent!" for a send that is only queued. The express giving link spread an unresolved
  Promise, so it went with no From at all.
- Left as they are, and why: a campaign whose every recipient failed still reads `sent` as a status,
  but its row shows the failed count beside it; onboarding emails and volunteer shift reminders are
  claimed before they send and are not retried. Next build's brief.
- **The morning meetings email** was checked against a local mail sink (a fixture org, one logged
  and one calendar meeting, both in the body). The real send to jonathan@stewardapp.dev needs the
  production Resend key, which this session was not permitted to read.

## CAMPAIGN-2 · campaign pages, GivingTuesday and year-end (2026-10-02)

- **A campaign's public page is a GIVING PAGE.** BUILD-95 §5B settled that a
  public page is `giving_pages` plus a widget list; `giving_pages.campaign_id`
  already made the thermometer the campaign's; BUILD-103's peer-to-peer
  fundraisers already rolled into the page's own total. So linking the page to
  the campaign is what makes a cheque somebody posted, a gift through the appeal
  page and a gift through a supporter's own fundraising page all count toward
  one bar, with no aggregation written anywhere. There is no second page system.
- **Three widgets, each of which renders nothing when there is nothing true to
  say:** a countdown that reads the CAMPAIGN's end date (so there is one answer
  to "when does this close"), a matching challenge that appears only once
  somebody has entered one, and a recent-gifts list.
- **The recent-gifts list is the one that carries a rule.** `show_name_publicly`
  is FALSE by default and the default IS the decision — BUILD-103's rule applied
  to a public page. It is a separate column from `show_name_to_fundraiser`
  because they are two different audiences. `publicGiftLine` is the one function
  that turns a gift row into something a stranger reads, and with amounts off it
  emits no number at all, so the page cannot leak one by rendering a field it
  was handed.
- **The goal bar says what it counts**, in a sentence computed from the same two
  figures the bar is drawn from. It names the two things people assume it leaves
  out, because those are the two it would be most damaging to be wrong about.
- **Two templates, and GivingTuesday is computed.** It is the Tuesday after the
  fourth Thursday of November; a hard-coded table would silently stop being true
  on the date the whole campaign is about. A template whose day has gone rolls
  forward a year, and pressing the button twice is refused with the campaign it
  already made.
- **A template's plan is dated TASKS and not Threads**, and that is a decision:
  a Thread is one person's list and requires a donor by construction, while
  "line up the match" belongs to the campaign and to nobody in particular until
  somebody takes it. Nothing a template creates sends anything, and the suite
  asserts that nothing anywhere recorded a send.
- **The match's clock starts when the match does.** Money that arrived before
  anybody promised to double it was never part of the promise. A gift on the day
  it began does count, because `gifts.date` is a civil date and counting the
  whole day can only say LESS is left than really is — which errs against the
  organisation rather than against a donor deciding whether their gift will be
  doubled.
- **Two defects the browser walk caught**, neither of which a suite would have:
  a template-created page had no `form_config`, so it rendered the legacy form
  and a donor on a page with a recent-gifts list had no way to join it; and
  GIVE-2's own suggested-amount ladder, seen for the first time against
  Harborlight's real distribution, read $150 / $500 / $3,500 / $5,000 — a median
  of $126 and a 90th percentile in the thousands is not a ladder. It is capped
  at ten times the first rung now, and the first fix capped the percentiles and
  then let the padding rungs walk past the cap, which caps nothing.
- **The one test**, `tests/campaign2-goal-bar.test.js`: the bar equals the sum of
  the campaign's recorded gifts to the cent, counting a posted cheque and a
  peer-to-peer gift and excluding the part of a charge the donor added to cover
  the fee; the match claims nothing promised after the money arrived; and a name
  reaches the page only where that donor chose it, first name only, with no
  amount and no email anywhere in the payload.

## GIVE-2 · donation forms that raise more (2026-10-02)

- **The form stopped pinning Checkout to cards.** `payment_method_types: ["card"]`
  was one line in `donateHandler` and it is why a donor on an iPhone had to type
  sixteen digits. Omitting it turns on Stripe's dynamic payment methods, so the
  CONNECTED ACCOUNT decides: Apple Pay, Google Pay, Link, US bank account and
  PayPal where the org has them on, and nothing it cannot take. That guarantee is
  by construction, not by a capability check of ours — a list Steward computed
  could be stale the moment a capability changed.
- **Venmo is not on offer and the settings card says why.** Steward takes
  payments on the org's own Stripe account, Stripe does not offer Venmo, and the
  PayPal connection reads a statement rather than taking a payment. Saying so
  beats a row that never lights up.
- **The processing rate became the org's** (`shared/processingRates.js`). It had
  been Stripe's published card rate hard-coded in `routes/give.js` and
  hand-copied into `Donate.jsx` and `EmbeddedForm.jsx` — three copies of one
  number, wrong in the expensive direction for an org on Stripe's nonprofit rate
  (2.2%) and for every bank transfer (0.8% capped at $5). A NULL column still
  answers with the published default, so nobody's arithmetic moved by a cent
  until they typed a number.
- **Four figures on an online gift, footing to the cent** (`shared/giftFooting.js`):
  gross, covered, fee, net. The FEE is read off the charge's own balance
  transaction rather than computed from a rate — the configured rate is what the
  form asked for, the balance transaction is what happened, and it is the number
  that reconciles against a payout. `processor_fee_amount` has defaulted to 0
  since BUILD-89S, so `processor_fee_source` is what tells "nothing was taken"
  from "nobody has told us yet".
- **And the method came off the charge too.** `paymentMethod: "Card"` was
  hard-coded in the webhook, so every bank transfer was recorded as a card gift
  in the column the deposit sheet and every method breakdown read.
- **Smart amounts** (`shared/smartAmounts.js`): a returning donor on their own
  personal link sees amounts starting from their own last gift, unrounded;
  everybody else sees amounts drawn from the org's own gifts through that form.
  From the org's own data and nothing else — no wealth, no capacity, nothing
  bought from anybody. Off by default, because a fundraiser who typed four
  numbers is not overruled by a median, and silent below eight gifts, because
  that is not a distribution.
- **Express giving**: "remember me" saves the method on the org's own Stripe
  customer, and an email sign-in link gives again in one tap. Steward holds two
  Stripe ids and four digits; no card number, no expiry, no CVC, at any point.
  The link lives in `portal_magic_links` with a `purpose`, which is load-bearing
  and filtered in SQL at both ends: an express link may not open the portal and a
  portal link may not charge a card. It is consumed by a POST, because a GET
  never changes state.
- **Failed-card recovery, shown.** The engine has run since BUILD-63 and the only
  thing it showed for its work was a percentage. Three figures for the year, each
  opening its rows; the money figure's rows are gifts, so it foots against
  Reports rather than standing beside it.
- **Matching gifts** stayed honest: the adapter shape exists behind
  `MATCHING_LOOKUP_ENABLED` with no provider registered and no vendor named, and
  what ships is each org's own typed list of employers with the company's own
  form link, shown on the page a donor lands on after giving.
- **The three defects the browser walk caught**, none of which a suite would
  have: `withSmartAmounts` was wired into `/forms/:id/public` and NOT into the
  giving-page payload the public page actually reads, so the ladder was still
  Steward's guess; `FRIENDLY_CENTS` skipped $2,000 and $3,000, so a donor whose
  largest gift was $2,000 was asked for $5,000; and `expressDonorByEmail` selected
  a `first_name` column that `donors` does not have, which 500'd the whole
  one-tap open. A fourth, in the seed: the recovered subscription's gifts already
  carried their subscription id, so an `IS NULL` guard matched nothing and the
  panel showed a recovery with no gifts behind its money figure.
- **The one test**, `tests/give2-fee-footing.test.js`: the four figures foot for a
  card gift and an ACH gift, the gross-up follows the org's rate, an unreadable
  fee is not a fee of zero, and the panel's dollars equal the sum of the rows it
  opens. Three defects were planted (the hard-coded rate, no fee read, the
  hard-coded method) and each went red before the green was trusted.
## FIX-14 · meetings that count, edit everything, a calmer profile (2026-10-02)

- **The date was UTC.** "Log a conversation" defaulted to `toISOString()`, so after 8pm New York a meeting logged tonight was tomorrow, and the server's "today" was UTC too. Fixed at about 30 sites in Part 1 and about 25 more in Part 2b. The client reads the org's today from `client/src/lib/orgToday.js`; the server uses `orgToday(orgTz)` and `civilDateIn`.
- **One meetings source**, `meetings.js`: calendar meetings plus meetings logged by hand. Last met, the rhythm, the Meetings chip, Coming up, "No meeting in 90 days", meetings per staff and the morning brief all read it. Emails already counted every source.
- **A logged conversation reads** as "Meeting at <place>", keeps its line breaks and shows "Label: value" lines as rows. The chips (next step, spouse to household, planned-giving prospect) do nothing without a yes.
- **Edit everything.** Conversations, next steps, tasks, asks, pledges, relationships and households edit in the form they were made with. Deletes move the row into `deleted_records`, and Undo restores it with the same id. A pledge with payments applied refuses deletion. "Edited by" opens the previous versions. A calendar meeting sends time and place to the calendar.
- **The audit log says what happened.** Sentences are built when the log is read (`describeAuditRow`), so old rows read too. Its home is Settings, Audit log. Each donor has History, visible to every member (Jonathan, 2026-10-02).
- **The profile, one of each:** one timeline, one next step in the rail, one "The ask", one Rhythm panel (12 months of touches plus 6 planned), empty sections on one line, and Erase and Delete under More.
- **Volunteer mail goes through donorMailDecision** (`volunteer_reminder`, `volunteer_link`). Volunteer reminders are a confirmed automatic send, opt-in per org.
- **Real links finished** for events, campaigns, funds, journeys, gifts, households, grant cards and volunteers. Sort and sections live in the URL.
- **import-messy was a time bomb.** Its key counted "stopped >60 days" against 2026-09-03 while the server counts against today, so the count drifted every day. It now checks the key's people, allows for future-dated gifts that have since arrived, and bounds anyone extra by date.
- **Shard database names are shared across worktrees** (`steward_shard_<n>`). Another session's battery was holding them mid-build, and the run had to wait.

## FIX-13 · the website's dead ends, and the Zapier tail (2026-10-01)

- **LANDING-3 had already merged** (PR #80, 4543366, and its fix #81), so this build ran on top of it.
- **Lost & Found runs on its own page.** The audit lived only at /lost-and-found, and every marketing link went to /tools/lost-and-found, a hero with nothing to drop a file on. The drop zone is now `LostAndFoundAudit` in `pages/LostAndFound.jsx`, rendered on both. The page says "Your donor file never leaves your browser. Nothing is uploaded." That is true because the file goes through FileReader to a Web Worker that has no network path; lf1 checks the source and runs the audit with every network path stubbed.
- **The demo form kept two of its answers and threw them away.** org_size and current_system are now stored on the lead, the mail says "Demo request: <org>", and a failed submit shows jonathan@stewardapp.dev. Super-admin got a Leads screen (there was none).
- **The research strip is a static row**: the marquee drew three copies of every card. Forest says Talk to us. Yearly Start links now carry the interval. Leadership is `LEADERSHIP_SHOWN` in `marketing/data/team.js`.
- **GET /api/v1/funds** behind a new read:funds scope. Owners can now pick scopes on a key (the panel had no checklist at all). Zapier 1.0.1: fundId is a dropdown, the baseUrl field is gone, and the host is pinned to the Railway API.
- **One Connections page in Settings.** Integrations is gone and its links redirect, keeping the #anchor (`parseAppUrl` passes the hash through as the focus). The donation form embed and QR moved to Fundraising, Giving pages and forms.
- **Real links.** Every tab and record has a URL (`lib/appUrls.js` builds and reads them, so they cannot drift). Donor names everywhere are `DonorLink`. A signed-out deep link goes through /login?next= and comes back to the same page. The Donors filters live in the query. Still onClick: events, campaigns, funds, journeys list, gift rows, households, and grant cards on the board.
- **Volunteer reminders never sent**: the sweep checked `decision.allowed` on a result that only has `send`. The magic-link email had the same bug. The admins-must-use-two-factor rule now has its checkbox. The Terms subprocessor table is hand-written, so OpenAI is left for the attorney.

## FIX-12 · what HELP-1 turned up, and the loose ends (2026-10-01)

- **Recipes draft, they never send.** First-gift thank-you, failed-card note and the lapse
  re-engagement email now write to `milestone_drafts` (Communications → Drafts to review) with
  Send, Mark reviewed and Send all reviewed. Every saved recipe row migrated to `draft_email`, and a
  leftover `send_email` drafts too. Test: `fix12-recipe-drafts`.
- **One AI door.** `aiClient.js` holds the only Anthropic client and the only OpenAI URL, and asks the
  org's switch on every call. Before this, the score rationale, board summary, voice memo and
  column mapper ignored the switch. OpenAI added to the subprocessor list and DPA. Test: `fix12-ai-switch`.
- **The board report had never worked since the FIX-1 split** (`now` undefined, every call 500).
- **HELP-1's list:** Finance opens the deposit sheet; delete-donor copy is true; Stripe Connected
  is Stripe's `charges_enabled`, with a Finish setting up state on the same account; Connections'
  Set this up opens Integrations (a bare string was passed as the nav intent); grant delete confirms.
- **The audit log stores people by id.** Actor, person label and person fields are ids or
  `[person]`; names resolve on read and an erased donor reads "Erased person". Prod held 107 rows
  before this build, every one naming the staff member who acted by email address, none naming a donor.
- **One audit log, seven years.** `user_admin_audit` merged in with its original times and dropped.
  The org cascade is gone, closing an account keeps the audit rows, and the purge flag reaches only
  rows older than seven years.
- **Optional "Your meetings today" email** (off by default, own address only) and **after-meeting
  chips from the Agent engine** (quotes validated against the note; the simple reader when AI is off).
- **Automatic donor-facing sends still left** (for Jonathan to confirm, one by one): per-gift tax
  receipt (org opt-in, default off); dunning, card-expiring and recovered-card emails (default on);
  paid event ticket confirmation; recurring-change and portal self-service confirmations; portal
  magic link, donor-account emails, "your page" and fundraiser manage links (asked for by the
  donor); legacy and tracked sequences, pledge reminders (default on, Steward's default wording) and
  scheduled campaigns (staff-written, sent on schedule); the retry of failed lifecycle emails.
  (Added in FIX-14: volunteer shift reminders, org opt-in, confirmed by Jonathan on 2026-10-02.)

## HELP-1 · help centre and Ask Steward (2026-10-01)

31 articles, one per app screen (14), the donor profile, the Settings sections
and seven tasks, written from what each screen does today; a guard in
landing2-marketing fails the battery when a routed screen has no article. The
"?" opens the article for the current screen beside the page. Ask Steward is
the Agent engine's help persona with no tools, and its prompt comes only from
buildHelpPrompt(question, articles) (help1-ask holds the route to that, byte
for byte, against a stand-in for the API). Questions to Ask Steward, the Agent
and the Analyst are logged as text only for twelve months. Ask a person makes
a ticket in super-admin and emails the support address; the reply promise and
the address are settings (SUPPORT_REPLY_PROMISE, SUPPORT_EMAIL) and Jonathan's
call. Writing the articles from the code surfaced real issues (workflow
recipes that email donors with no per-send review, a deposit link that opens
the donor import, a Delete donor that says it cannot be undone and can), which
are listed in the build report rather than fixed here.

## TRUST-2 · status, what's new, the data agreement and privacy rights (2026-10-01)

Erase keeps the money and loses the person (personData.js): gifts, pledges,
receipts and ledger lines stay with their amounts, attached to "Erased person",
and every copy of the name the money record kept (the ledger description, the
receipt snapshot and PDF, the cheque photo) goes with the rest. Two things stay
on purpose and the /your-data page says so: an address on the do-not-email
list, and the append-only audit log's earlier rows. Whether those audit rows
should be redacted is Jonathan's decision, because it breaks a standing rule.

/status reads only stored checks (one per service per minute) and says
"not measured yet" rather than counting an unrun check as up. What's new is
docs/changelog/, one file per build, and the old hand-kept list became one
dated entry. The subprocessor list was built from the code; it found that most
AI features call Anthropic without the org's off switch and that the donor map
fetches OpenStreetMap tiles, both of which the docs said otherwise.

## SEC-1 · two-factor sign-in and sessions (2026-10-01)

BUILD-98 had the authenticator code and an admins-only switch. SEC-1 is the
rest: a code by email, ten recovery codes shown once and stored hashed, trust
this browser for 30 days (off by default), five wrong codes lock code entry for
15 minutes and email the person, an owner switch that requires two-factor for
everyone, super-admins always, an owner reset that emails the teammate who and
when, and sessions as rows. Every token carries its session id and auth.js
checks it on every request, so a session signed out in Settings is refused on
its very next request (sec1-two-factor). TOTP stays on Node's crypto
(totp.js, RFC vectors); no library was added.

**THE INT2-SEND-ONCE FLAKE WAS THE SUITE REVOKING ITSELF.** Its reset() deletes
and re-creates its admin, and a new users row's `sessions_valid_after` defaults
to now, so the token from the first sign-in died whenever the run had crossed
two seconds by section 7. A loaded CI shard crossed it; a quiet laptop did not.
It signs in again after every reset now. With sessions as rows the old version
fails at once, which is the same bug made deterministic.

Two things the battery taught: a table that references `orgs` must cascade or
every suite that deletes its fixture org dies in teardown; and a fixture
super-admin now enrolls in two-factor through the real setup flow in
tests/helpers.js rather than any test-only bypass.

## INT-BUILD-1 · inbox and calendar, built in (2026-10-01)

Nobody could find inbox connect because there was nowhere to find it: one
Gmail-only card halfway down Integrations, no Outlook button at all, a "profile
menu" that did not exist, and nothing on Connections. Part 0 put one card in
four doors. It also found the 15-minute sync reading `gmail_connections`, a
table nothing has written since INT-4, so new mailboxes only synced on the
button and Outlook never synced.

The calendar rides the same consent (`calendar.events` on Google,
`Calendars.ReadWrite` on Microsoft) under the inbox's rule, tightened: an event
with nobody on file leaves no row, no count and no log line, and a matched one
keeps six fields (`shared/calendarLog.js`, guarded by intb1-calendar-store).
The profile follows docs/int-build-1/Profile.html: Last met and Last email in
the header, the meeting card with its four-line brief, one timeline, and the
rail's rhythm strip. "How did it go" records nothing until save, and then only
through the ordinary gift, pledge and thread routes.

Margaret Chen in the demo is now the mockup's major donor. She could not also
be the drift example (silent for 14 months), so that story is Eleanor
Whitcombe's, with the same numbers. The tenant matrix never deleted the
webhook rows it inserts, so it passed once per fresh database; it does now.

## LANDING-2 · the full marketing site (2026-09-30 → 2026-10-01)

The single landing page became the 59-route site from the approved reference
(`docs/landing/steward-site.html`), on real paths instead of hash routes. One
shell (three mega menus, Pricing, the mobile drawer, the five-column footer),
breadcrumbs on every inner page, and every page's copy in data modules under
`client/src/marketing/data/` the way the reference keeps FEAT, AUD, GUIDES,
GLOSS, TEMPL, STATS, QUOTES and SRC. The reference's stylesheet is copied value
for value and scoped under `.mk`, so none of it reaches the app.

Collisions were left to the app: `/pricing` (live checkout, the upgrade modal
and Settings use it) and `/lost-and-found` stay app pages and the site links to
them; `/privacy` and `/terms` stay the live documents while `/legal/*` ship as
attorney drafts. `/developers` was named in the brief but does not exist, so
Open API links point at the Open API row on `/connections`.

45 real photographs replaced every stand-in (free Unsplash, each checked
against its caption, logged in `docs/landing/photo-credits.md`); the four
people use the portraits the old landing page already shipped. The demo form
stores a lead through the existing Lost & Found lead route (`ref` book-a-demo);
storing its two optional fields needs app code and is in `BLOCKED-landing-2.md`.
Guards: `tests/landing2-marketing.test.js` (source) and the rebuilt
`scripts/landing-prod-verify.js`, which crawls every route at 1440 and 390.
## FIX-11 Part 6 follow-up — the icons are 20px again (2026-10-01)

Jonathan looked at the 24px rail and reverted it the same night: too big. Back
to 20px and stroke 1.75, exactly as NAV-1 shipped them, and the phone back to
18 and 19.

The measurement below is kept because it is the answer to "why do they look
slightly soft", and the next person should not have to redo it. The size is the
thing that matters more, so a small amount of antialiasing is now a deliberate
accepted cost rather than an unknown.

## FIX-11 Part 6 — the icons were grainy, and it was the stroke (2026-09-30)

Jonathan saw the new sidebar icons as slightly grainy. Measured on a retina
screenshot rather than guessed at: **nothing scales them, nothing dims them**,
no ancestor carries a transform, a filter, an opacity or a fractional width,
and all thirteen sat exactly on the device-pixel grid at 20x20.

The softness was the STROKE, and the arithmetic is the whole story. An SVG
stroke is centred on its path, so at device-pixel ratio 2 it is crisp only when
it covers an EVEN number of device pixels. The coverage of one vertical stroke,
read straight across:

```
20px / 1.75  = 2.917 device px   116 255 255 116   two half-lit pixels
20px / 1.8   = 3.000 device px   127 255 255 127   two half-lit pixels
20px / 1.5   = 2.500 device px    63 255 255  63   two half-lit pixels
20px / 1.2   = 2.000 device px       255 255       clean
24px / 2     = 4.000 device px   255 255 255 255   clean
```

So "a whole number of device pixels" is not the rule, which is where the first
guess went: 1.8 gives exactly 3.0 and is still soft, because 3 centred on a
boundary is 1.5 either side.

At 20px the only clean strokes are 1.2 (31% less ink, dimmer on a dark rail)
and 2.4 (38% more, noticeably bolder). Neither keeps the weight. **24px with
stroke 2** is clean and keeps the proportion: 2/24 is 0.083 where 1.75/20 was
0.088. The icon is 20% bigger, which is the visible part of this change and
the part to reject if it is wrong. The phone's two sizes (18 and 19, neither
even in device pixels) became the same one size.

NAV-1's walk passes at the new size with fresh screenshots in `docs/nav1`.

### The tail: the two holes Part 1's census named

**The Agent is the actor, and a person approved it.** Part 1's middleware
supported `req.audit.actor(...)` and no route set it, so an action a model
drafted and a person merely approved was logged as that person's own work. The
row was right about who authorised it and silent about the fact a model wrote
it, which is the one thing oversight of a model exists to record. Declared by
route pattern in `auditTrail.js` — one visible list, not a line added to each
of twenty-nine agent routes and forgotten on the thirtieth — and the row now
reads "Agent, approved by Dana Reyes", by name, because an email address reads
as the software talking to itself. An instruction a person wrote, and a person
undoing the agent, stay theirs.

**Background jobs have the guarantee routes have.** A periodic sweep does not
pass through Express, and the sweeps that logged called `writeAuditLog` by hand
— the same arrangement that left four hundred and thirty-four routes unlogged
for a year. `recordTick` is the one seam every job passes through, so the rule
lives there: a job is declared in `jobAudit.js` as one that WRITES (donor data,
money, mail) or one that only READS, and **a job in neither list throws rather
than running**. Forgetting is not a silent option. A writing job returns its
orgs and gets one audit row in each, through the same insert the request
middleware uses, so a job's row and a person's row are the same kind of row.
Eighteen jobs declared writing, eight read-only, each with a sentence saying
what it writes or why it does not — checked, so the read-only list cannot
become a place to park a job nobody wants to think about.

## FIX-11 Part 5 — the Resend inbound actually lands on the donor (2026-09-30)

On 30 September Muse wired Resend inbound on log.stewardapp.dev: receiving on,
MX and DKIM at Vercel, Railway variables set, the webhook pointed at
`/inbound-email` with the shared secret. **It would have received nothing**,
for two reasons, and both were silent.

**Resend nests the whole message under `data`.** The payload is
`{ type: "email.received", created_at, data: { email_id, from, to, cc, bcc,
message_id, subject, attachments } }`, and the route reads `to` and `from` at
the top level. So `orgSlugFromPayload` found no recipient, every message was
dropped as "no_org", and the drop counter would have been the only trace. The
suite proves it from the other end: asked for the org, the unadapted payload
answers `null`.

**And Resend's inbound webhook carries no body at all.** Not the text, not the
html, not the headers: metadata and an `email_id`. The body is a second call,
`GET https://api.resend.com/emails/receiving/{id}` with the API key. So even a
flattened payload would have filed a subject with an empty note. A message
whose body cannot be fetched now stores nothing, because a half-record on a
donor's timeline cannot be told from a donor who wrote nothing.

**A no-match stored the subject and the body, and should not have.** The brief
said "same storage rules as INT-4: only messages involving someone already on
file are stored". It turned out INT-4 disagreed with itself. The Gmail and
Outlook half (`shared/mailboxLog.js`) drops a no-match and its decision carries
no subject, no body and no address, which `tests/int4-mailbox.test.js` §1 pins
byte-wise. The BCC half HELD, with all three, on the Unmatched list. Two paths
handling the same kind of data, and the looser one was the one receiving mail
from the open internet.

The strict one is right: a message that names nobody on file is correspondence
with somebody Steward has no relationship with — a vendor, a friend, a
journalist, a doctor. Keeping its subject and body so staff MIGHT file it later
means a donor CRM holding the contents of mail about people who never consented
to be in it. The count is kept, because "eleven messages arrived that Steward
stored nothing from" is true and useful. `multiple` and `self_test` still hold:
everybody involved in those IS on file.

**A signature where there is one.** The shared secret rides in the webhook URL,
which works and puts the secret in every proxy log between Resend and here.
Resend signs with Svix and `RESEND_WEBHOOK_SECRET` is already set for the
delivery webhook, so `/inbound-email` now keeps its raw bytes (one scoped
`express.raw` above the JSON parser, the same pattern the other webhooks use)
and verifies a signature when one is present. A request that CLAIMS to be
signed and is not is refused outright rather than falling through to the
secret, which would otherwise let anybody who learned the URL bypass the
signature by sending a bad one.

**The address is on a screen now.** Settings, Account — which is where the user
chip in the top bar already leads, so it is the profile menu's destination —
with a copy button and the honest sentence: it is ONE address for the
organisation, Steward knows it came from you because you sent it, and a message
naming nobody is stored nowhere at all.

**BCC logging is per organisation** (`orgs.inbound_email_enabled`, default
true), and the demo org is opted out by the one script that writes it. Its
people are fictional and strangers look at its screens.

`RESEND_RECEIVING_BASE_URL` is a second Resend seam, separate from
`RESEND_BASE_URL`: sending goes to the local mail sink and the receiving API is
a different API, which the suite stands up itself. Both are in `tests/shard.sh`
so the suite RUNS in CI rather than skipping, because a suite that skips is
coverage that is not there.

NEEDS-JONATHAN.md §0-INBOX named the wrong route (`/resend/inbound`, which does
not exist) and the wrong authentication, and called the adapter done. Corrected,
along with the Google note: the consent screen is In production, not Testing,
and publishing it is not the same as passing verification.

## FIX-11 Part 4 — a gift file with no donors is not a dead end (2026-09-30)

On 30 September Jonathan imported a 40-gift file into an org where those donors
did not exist. The screen said "0 gifts ready to import, attaching to 0 donors ·
40 unmatched (will skip)", offered a grey "Import 0 Gifts" button, and told him
to "use combined mode later", which is not a place. A customer arriving with a
gift file from another system hits exactly that, and the only answer the product
had was: go away, split the file, come back.

**It is an offer now.** The unmatched rows become a count of PEOPLE, named
before anything is written, beside two buttons: "Create 5 new donors and import
their gifts" in emerald, and "Import only the 3 that match" — which says "No
gifts match somebody on file" and is disabled when nothing does, rather than
reading "Import 0 Gifts" as the only button on the screen.

One person per identity: by email where there is one, lower-cased, otherwise by
exact normalised name. A row with neither a name nor an email is counted and
left out rather than becoming a donor called "". It goes through
`/donors/import-combined`, the combined import that already existed, under one
run id. There is no second import path.

**The whole thing undoes as one import**, and that is a deliberate widening of
"only a deposit can be reversed as a whole. An import is undone gift by gift,
on the record." That rule is right for an ordinary import: those gifts landed
on donors who already existed and have a history of their own. A gift file
imported where NONE of those donors existed is the opposite case: every gift
and every person came out of one file, there is no prior history to disturb,
and the thing a customer needs when they have imported the wrong file is one
undo. The safety is the machinery that was already there, unchanged: gifts by
`import_id`, and people only where `created_import_id` is this run AND they
have no other gift and no other interaction. A created donor who has since
acquired a gift is kept.

The route stopped being admin-only, which is the one gate this changed.
Importing takes `checkWriteAccess`, so a staff member can import; if undoing it
took an admin, the person who had just put forty gifts on the wrong org would
be shown an Undo button and refused by it. An admin may undo any whole-import
run; anybody may undo their own.

**THE GIFT-HISTORY IMPORTER WAS ROUNDING EVERY AMOUNT TO WHOLE DOLLARS.**
`Math.round(amtVal || 0)`, in both parse paths, since the surface was written.
A $250.50 gift was imported as $251.00 and a $33.33 one as $33.00, so every
gift-history import had been quietly wrong by up to 49 cents a row and no file
had ever reconciled against its own source. The browser walk found it: the
server-side suite posts amounts directly to the route and could never have
seen it. Widening the guard to the whole file then found a THIRD site, in the
year-column branch of the recommended "Import + History" path, so the import
Steward pushes hardest was rounding too.

Also found: calling `onImported()` on success dismissed the result screen the
instant the import finished, because the parent wires that callback to closing
the modal. The undo went with it.

## FIX-11 Part 3 — a bookkeeper export a bookkeeper can use (2026-09-30)

Jonathan exported `bookkeeper-2026-08.csv` from the demo org on 30 September.
The arithmetic was right — 243 gifts, $240,853.00, the fund totals footed — and
a bookkeeper still could not use it.

**The three format buttons were `<span>`s.** Steward / QuickBooks / Xero looked
like buttons, had a tooltip each, and had never been clickable: the column sets
lived in `routes/finance.js` and the download lives in `routes/crm.js`, so the
choice had nowhere to go. The sets moved to `bookkeeper.js`, declared once, and
the download honours `flavour`. A format Steward does not know is refused by
name rather than quietly falling back to one that looks similar.

**The totals rows were inside the CSV body.** A blank row, a TOTAL row, another
blank, a "TOTALS BY FUND" heading, a line per fund and a second TOTAL — under
the gift columns. It reads beautifully in a spreadsheet and it is the reason a
QuickBooks import of the August file would have booked six phantom
transactions, one of them for $240,853: an importer reads rows, not layout.
They are on the payload the screen shows instead.

**Two files now, from the same query.** The gift detail is one row per gift, for
the record, and it gained the four columns a reconciliation cannot be done
without: processing fee, net, which deposit the gift arrived in, and whether it
was cash. The deposits file is one row per deposit LINE, which is the shape a
bank statement has and the shape both vendors' bank-deposit imports take:
date, deposit account, a line per fund, ONE negative fee line, and a net that
equals what hit the bank. Non-cash gifts (stock, in kind) are their own file,
never a section inside a file somebody imports as bank transactions.

**A cheque number was never a column.** 0 of 51 cheques in the August file
carried one, and the reason was not a missing export column: the deposit sheet
wrote the number into the gift's NOTES, and the export reads `reference`, which
is an external or Stripe id. `gifts.check_number` exists, and a one-shot
backfill recovers every number already written into a note.

**The seed was worse than the brief recorded.** Not one gift with no fund:
every gift in the demo had `fund_id` NULL — all 3,942 of them — because the
seed writes gifts in bulk and bypasses `recordGift`, which is the one place
that assigns the unrestricted fund. So "TOTALS BY FUND" had exactly one line,
called "(no fund)", and it footed, which is how it went unnoticed. No gift
anywhere carried a processor fee either. Every seeded gift now has a fund, a
method, a deposit, a fee if it was a card, and two cheques in three have a
number — not all of them, because a seed where every cheque has a number hides
the screen's own "a cheque with no number" flag.

**What is missing is said before the file is written.** Four counts — no
payment method, no fund, a cheque with no number, not matched to a deposit —
each one opening its rows, each with the fix. The August file had four gifts
worth $57,500 with no method and nothing said so: correct, and quietly
incomplete, which is the worse of the two ways a file can be wrong.

**The defect the footing check caught.** The QuickBooks deposits file's fee
lines went out as `'-3.68`. `reportCsvCell` prefixes any TEXT cell beginning
with `-` with an apostrophe, correctly, because `-2+3` is a formula — but its
own comment always said numbers pass through, and it only recognised a number
when the value was typed as one. QuickBooks reads `'-3.68` as text. The guard
was narrowed (`CSV_PLAIN_NUMBER`), not worked around; emitting a JS number
instead would have written `-8.3` into a money column. Found by adding the
file's own Amount column up and getting NaN, which is the cheapest possible
check and is now §1 and §2 of the suite.

## FIX-11 Part 1 — everything leaves a trail (2026-09-30)

On 30 September Jonathan recorded a $100,000 gift by hand on the Creo demo
record and the audit log did not mention it. The cause was not a filter, a
delay or the demo org: **no gift path wrote an audit row at all.** Thirty-three
`writeAuditLog(...)` calls existed, every one hand-placed in a finance or
settings route, and the other four hundred and thirty-four mutating routes
wrote nothing. A list of audit calls is a list somebody forgets to add to, and
what they forget is a record of whose money moved.

**The shared layer.** `middleware/auditTrail.js`, mounted above every one of
the app's routers in `server.js` — above the raw-body webhook routers, so there
is no route a change can reach without passing through it. A route does not opt
in; a route written tomorrow is logged with its author doing nothing. 467
mutating routes, 0 uncovered, 1 declared read-only
(`auditTrail.READ_ONLY_POSTS`), and `tests/fix11-audit-trail.test.js` reads
that off the live Express router rather than a hand-kept list.

**Before and after, with nothing written per route.** The middleware reads the
record before the handler and again after, and stores only the fields that
moved. Two things about that cost a silent half-feature each, and both were
found by verifying rather than by reasoning:

- The before-read happens before `requireAuth`, so there is no `req.user` and
  no org to scope it to. The first version scoped it to the org anyway, got
  null every time, and recorded no before/after on a single edit in the
  application. It now reads by primary key and checks the org at finish time.
- The resource name does not identify a table. `/finance/funds/:id` is
  `fin_funds`, and there is ALSO a table called `funds`. Picking by name picked
  the wrong one. The name now only proposes candidates and the right table is
  the one that actually holds the id.

**The thirty-three hand-placed calls are not deleted.** Several of them know
something a route pattern cannot ("api_key_created", "oauth_tenant_chosen").
`writeAuditLog` now finds the request it is inside (an `AsyncLocalStorage`) and
*improves* the row the middleware is already writing instead of inserting a
second one beside it. One action, one row, and the better name wins. Outside a
request — a background sweep — it inserts as it always did.

**Append-only, enforced by the database, on the application's own connections.**
Every connection `db.js` opens carries `steward.app_connection=on` as a startup
option, and a trigger refuses UPDATE and DELETE from such a connection. The
polarity is deliberate: refusing everything and letting the one legitimate
purge announce itself would also stop twenty test teardowns and every
maintenance script clearing a scratch database, for no extra safety — a psql
session can drop the trigger either way. What matters is that no screen and no
route can touch history, and that is what this enforces. The one path that may
is closing an organisation's account, which sets `steward.audit_purge`
transaction-locally and says so out loud (`routes/billing.js`). The org foreign
key became `ON DELETE CASCADE` in the same breath: an org's history goes with
the org, said once where the relationship is declared rather than in four test
teardowns.

**"+ Log → Gift" made a note and no gift.** The modal posted the typed fields
as a key:value blob to `/donors/:id/interactions` AND posted a gift whose
`notes` was that same blob; `recordGift` writes one linked timeline entry of
its own, so the record carried two entries, identical text, same day — which is
exactly what Jonathan saw. The Amount, Designation and Payment Method he typed
were prose in a note rather than a fund and a method on the gift, so the money
reached no total, no receipt, no bookkeeper export and no audit row. The gift
type now collects nothing and hands off to the gift form on the Giving tab: one
gift path, a real fund, a real method, an acknowledgement flag, one timeline
entry. A gift reads as `$100,000 · General Operating · ACH · not yet thanked`,
from one formatter both timeline modes call.

**What only the browser caught** (`scripts/fix11-audit-walk.js`, 25 assertions
at 1440 and 390):

- The hand-off did nothing when the profile was already open. React keys the
  profile by donor id, nothing remounted, and the initial state that opens the
  gift form never ran again. No test of the modal in isolation could see it.
- A gift posted with `payment_method` — the spelling the form, the gift EDIT
  route and the bookkeeper export all use — was stored with NO method, because
  the create route read only `paymentMethod`. That is one of the blank-method
  rows Part 3 is about, and it was being created on the way in.
- The timeline printed "Needs you", the sentinel for a missing method, as
  though it were a payment method.
- An audit row for a CREATE showed nothing about what was created, so a
  recorded $100,000 gift was a row with no amount in it.

Also noted, older than this build and not touched: reaching `/settings` by URL
at 390 lands on Home, which is why the phone leg of the walk goes through the
More drawer.

## NAV-1 — a sidebar you can scan (2026-09-30)

Thirteen items in one flat list, plus a "More" fold. Events and Volunteers shared
one icon and Reports and Dashboards shared another, so the one place an icon has
a job — telling two rows apart at a glance — was the one place it could not do
it. The icons were abstract shapes: a diamond for Home. Tasks and Communications,
both used daily, were behind the fold. Jonathan, 30 September: "I wish we could
organize this" and "make the icons make sense, like an actual house for Home."

**GROUPS, NOT A FOLD.** Five short labelled lists and a pinned pair: Home and
Tasks with no label, then RELATIONSHIPS, RAISE, VOLUNTEERS (its own product, its
own group), MONEY, and Agent and Settings separated at the bottom. Nothing is
behind a disclosure any more, at the same height. The shape moved into one
JSX-free module, `client/src/lib/navGroups.js`, that the desktop rail, the
collapsed rail and the phone's More drawer all read — it used to be three
separately-kept lists, which is how the phone twice came to teach a different
product from the desktop (FIX-9 Part E, BUILD-87 F.3.5).

**DASHBOARDS FOLDED INTO REPORTS.** They were two nav items sharing one glyph and
one question. The four dashboards are the first group of Reports' one rail,
filled from the server's own `/dashboards` list so the rail cannot drift from
what exists, and `Dashboards.jsx` draws no rail of its own in there — two left
rails side by side is the scanning problem this build set out to fix. Nothing is
deleted: `navigateTo("board")` is kept as a synonym, `/dashboards` redirects,
and `smoke-walk` opens the dashboards from inside Reports on every run, so
folding them in did not quietly stop walking them.

**CUSTOMIZE, PER PERSON.** `users.nav_layout` + `/me/nav-layout`, the same shape
and the same three verbs as the Home layout (BUILD-34), per user and not per org
because two people share an organisation and not a job. Hide or reorder within a
group, never across one. Home and Settings cannot be hidden, and the server
refuses it too — the half a stale client cannot get past. A role default applies
only to somebody who has never saved a layout: a volunteer coordinator starts
with Finance hidden, because that role sees no giving anywhere else.

**THE DEFECTS THE WALK FOUND, in the order it found them.** Each of these was
green in the source and wrong on the page or in the product.

1. **A volunteer coordinator could not sign in at all.** Four of the shell's
   seven opening reads are refused for that role by the VOL-1 allowlist,
   correctly and by design, and one rejection threw in `loadData` — so the whole
   app rendered "Failed to connect" with the coordinator's own refusal sentence
   under it. The role had a rail, a hub and a roster and no way to reach any of
   them. `coordinator_scope` is the same KIND of answer as `portal_tier` (the
   server saying "not for you", not the server failing) and now gets the same
   empty fallback. Nobody had walked that login; the brief's one line about that
   role's default is what sent somebody to look.
2. **The expiring-card screen and the expiring-card email read different
   clocks.** The sweep picks candidates in UTC; the two staff counts used
   Postgres `CURRENT_DATE`, which is the DATABASE SESSION's timezone. The
   battery went red at 20:30 local on 30 September — the hours where a non-UTC
   database and UTC disagree about which month it is — meaning Steward emails
   donors about cards the screen counts as zero. Production's Postgres is UTC so
   nothing had gone wrong there, which is exactly why only the scratch Postgres
   (America/New_York) could find it. Both queries read UTC now. Whether the right
   basis is UTC or the ORG's timezone is a later build's question; agreeing with
   the email is not.
3. **The Customize dialog offered to hide a tab the org does not have.** Donor
   Portal is hidden from every CRM org and was listed anyway. The dialog now
   lists what this org's plan HAS — and a save is written against the full
   layout, so a preference about a plan-hidden item is kept rather than dropped.
4. **A reorder that saved nothing.** `queue.shift()` inlined into a `find()`
   callback shifts on every comparison instead of once per slot, which leaves the
   order untouched and looks exactly like a save that did not land.
5. **Two nav lists in the DOM at once.** The mobile bottom bar is `display:none`
   at 1440, not absent, so the first walk read every nav item twice and the
   active-tab assertion matched the wrong button. A walk that queries the page
   has to say WHICH nav it means.
6. **Uppercase in CSS is not uppercase in `textContent`.** The group labels are
   `text-transform: uppercase`; the walk read `textContent` and saw
   "Volunteers". `innerText` is what the reader actually sees. (The same trap
   BUILD-82 recorded, in a new place.)

**WHAT THE RULE ABOUT TESTS BOUGHT.** No new suite. One classification line in
`script-guards`, one leg added to `smoke-walk` so the folded dashboards keep
being opened, and a throwaway walk (`scripts/nav1-walk.js`, 40 assertions at
1440 and 390) that found all six of the above. Five of them were proven by
watching the assertion go red first.

## INT-5 — a key does exactly what was ticked (2026-09-30)

BUILD-98 Part 6 shipped API keys that were read-only by construction: there were
no write routes, so `scopes: ["read"]` was a placeholder for a decision nobody
had to make. INT-5 adds writes, so the decision arrives.

**A KEY GRANTS EXACTLY WHAT SOMEBODY TICKED.** Not "read implies read everything
added later", not "write implies read". Each scope is one verb over one kind of
thing, because the person holding the key is, by definition, not the person who
has to live with the consequences: it goes to Zapier, to a consultant for one
afternoon, to a contractor's script.

**AND EVERY KEY ALREADY ISSUED KEEPS WORKING AND GAINS NOTHING.** Those keys hold
the literal scope `read` and they are sitting in somebody's Zapier account right
now. `read` stays for ever as a legacy scope that expands to every READ scope and
to no write scope, whatever is added to the registry later. Widening it would
hand write access to keys somebody granted for reading, silently, on a deploy.

**EVERY WRITE GOES THROUGH THE FUNCTION THE APP USES.** A gift recorded through
the API is written by `recordGift`, so the rollup, the fund, the receipt and the
duplicate handling all behave exactly as they do inside Steward. The actor names
the KEY (`system:api/<id>`), because "which integration created this record" is
the first question anybody asks of a row they did not expect.

**THE CALL LOG RECORDS THE ROUTE, NEVER THE FILLED PATH.** Logging
`/api/v1/people/d_abc123` would be keeping a list of donor ids in a table nobody
guards. The route is stored, the id is its own column, and the contents of a
request are never stored at all. Refusals are logged as well as successes, which
is the half somebody debugging actually needs.

**A WEBHOOK SIGNATURE WITHOUT A TIMESTAMP IS A PASSWORD SOMEBODY CAN
PHOTOGRAPH.** A bare HMAC of the body proves where a delivery came from and
nothing about when, so anyone who captures one can replay it for ever. The
timestamp is signed with the body and receivers are told to reject anything
older than five minutes. Deliveries retry with backoff for a day, every ATTEMPT
is kept (so "it failed four times and then worked" is visible), and an endpoint
that fails five times running is paused AND opens a Thread step, because a
webhook that died quietly is how an organisation finds out in March that its
automation stopped in January.

**The teardown is asked of the database rather than remembered.** `recordGift`
writes a ledger entry and a finance audit row against the org's chart of
accounts, so `accounts` outlives the gifts and blocks `DELETE FROM orgs` on the
SECOND run with an FK error that reads like a product bug. This suite was bitten
by that twice in one afternoon, so its teardown now asks the schema for every
table referencing `orgs` and deletes them in several passes. Adding a table to
the product cannot break it again.

## INT-4 — her own inbox, and the line around it (2026-09-30)

A development director's conversations with donors live in one person's
mailbox, and when she leaves they leave with her. Steward logs them onto the
donor's record so the organisation keeps its own history. `shared/mailboxLog.js`
holds the whole decision, pure, and Gmail and Outlook are two fetchers under it.

**THE RULE THAT MAKES IT ACCEPTABLE AT ALL.** Only messages to or from a person
already in that org's Steward. Everything else is never stored: not the subject,
not the address, not the body, not a count of how many there were. This is a
personal mailbox, with her doctor and her children's school and her job
applications in it, so "not stored" is the DEFAULT and logging is the narrow
exception. The provider is asked only for messages involving an address already
on file, and what comes back still has to pass the decision before one field of
it is written.

**WHAT THE FIRST GMAIL INTEGRATION WAS DOING, FOUND WHILE SURVEYING IT.** Three
things, all live in production until this build:
· `state` was the bare user id, unsigned, and the public callback believed it.
  Whoever completed a Google consent decided, by typing a different id into the
  URL, whose Steward record the mailbox was filed against. Nothing proved the
  person finishing the flow was the person who started it. This is exactly the
  hole INT-OAUTH's signed state closed for Xero, Intuit and Square, still open
  on the one connection that reads somebody's mail.
· The tokens were stored in PLAINTEXT: `access_token` and `refresh_token` as
  bare TEXT columns, a staff member's whole mailbox, while every other
  connection in the product sealed its credentials with the org as AAD.
· It asked for `gmail.send`, and had a `/gmail/send` route. Nothing in Steward
  should hold send access to a fundraiser's personal mailbox: the product's
  whole promise is that a human sends.

All three are fixed. The flow runs through `shared/oauth.js`; the tokens are
sealed and the old rows are migrated into the sealed table with their plaintext
columns emptied (and it FAILS CLOSED: without the key it leaves them alone and
says so, rather than inventing a fallback or deleting a working connection). The
scope is `gmail.readonly` and nothing else, and the send route is gone. The old
`/gmail/callback` survives as a forward-only route that writes nothing, so the
redirect URI already registered with Google keeps working and the deploy breaks
nobody.

**HER SWITCHES, NOT THE ORGANISATION'S.** A never-log list of addresses and
domains, a pause, and "do not log this one". Every route behind them is scoped
to her user id: an admin colleague in the same org cannot see, pause,
disconnect or purge her mailbox, and the one test pins that. A domain entry
matches on whole labels, so `example.com` covers `mail.example.com` and never
`notexample.com`.

**A CONVERSATION IS A TOUCH AND NEVER A GIFT.** It feeds last contact and it can
close a Thread step that asked for exactly this contact, as an OUTCOME naming
the conversation that closed it, which is what `threads_close_honest` requires.
The closeable step types are a deliberate SUBSET: a pledge reminder and a
membership renewal close when the money or the renewal arrives, not when
somebody was written to, and closing those on an email would mark a thing done
that has not happened.

Two things the work turned up on the way: the old writer left `created_by` NULL
on every interaction it wrote, against the standing actor rule; and the tenant
matrix's teardown list was two tables short of the tables INT-3 and INT-4 add,
which is the "a teardown list one table short is a suite that passes once"
failure it already carries a note about.

## INT-3 — Mailchimp and Constant Contact, and Steward still never sends (2026-09-30)

The premise is that she keeps paying Mailchimp and keeps sending from it. Steward
reads the one thing the tool knows and the CRM does not: who opened, who clicked
and who asked to stop. `shared/emailMarketing.js` holds all of that judgement
once, and the two providers are registry entries: Mailchimp's own word is
"audience" and Constant Contact's is "list", Mailchimp's token never expires and
Constant Contact's lasts a day, Mailchimp pushes unsubscribe webhooks and
Constant Contact has none. None of those differences reach the judgement.

**NO SECOND OPTED-OUT FLAG.** BUILD-94 already owns the opt-out truth
(`email_suppressions` plus `do_not_email`, read by `donorMailDecision`), so an
unsubscribe arriving from Mailchimp is written by BUILD-94's own
`recordUnsubscribe`, published out of `routes/webhooks.js` for the purpose. Two
flags would eventually disagree and the half that lost would mail somebody who
asked to stop.

**A BOUNCE IS NOT AN UNSUBSCRIBE, and the one test caught it.** Mailchimp's
`cleaned` means the mailbox stopped working; the first draft wrote it as an
`unsubscribed` suppression as well, which puts "she asked to stop" on a donor's
record about somebody who never said it, and outranks the bounce in every later
reading. `unsubscribe` writes the suppression, `cleaned` writes unreachable, and
neither writes the other.

**The order of a sync is the safety.** Opt-outs come IN before the push goes OUT.
Reversed, somebody who unsubscribed an hour ago is read as eligible, pushed back,
and only then read as unsubscribed. Mailchimp's upsert uses `status_if_new` for
the same reason: sending `status` would re-subscribe an existing contact, which is
the one thing this build must never do. And when Steward and the tool disagree,
the MORE RESTRICTIVE answer wins, never the newest.

**FIVE DEFECTS ONLY THE BROWSER WALK FOUND**, four of them things the screen said
that were not true:
· The Mailchimp card read "the last gift through it arrived 17 days ago, 3 gifts
  so far". `assessConnection` decides the STATUS for every connection and that
  shared judgement is right, but its SENTENCES are about money and Mailchimp has
  never carried a gift. The status still comes from the shared layer; the words
  are counted from campaigns. This is the FIX-9 A.3 mistake in a new place.
· Opening the mapping panel turned the demo's healthy card BROKEN, and left it
  there. A connection with no stored credentials cannot be asked anything, and
  Steward declining to call out is a state, not an incident: a 409 or 503 refusal
  no longer records `status='error'`.
· The same panel then said "Mailchimp reports no audiences on this account yet",
  which sends somebody into another company's settings to fix nothing. "Steward
  could not ask" and "there are none there" are different sentences now.
· The Sent column printed `$0` for every campaign: `fmtFull` is a MONEY
  formatter, so a date rendered as nothing, and `$0` also reads as a campaign
  that raised nothing.
· The gifts column counted every gift the organisation took within thirty days
  and put "131 gifts, $149,715" beside a newsletter. A footnote cannot outrun a
  number that big. It is scoped to the people who opened or clicked THAT
  campaign, which is the honest version of "a gift after a click".

**A figure that opens onto fewer rows than it claims must say why.** Mailchimp
counts 188 opens; Steward can name the ones whose address belongs to somebody on
file. Opening 188 onto three rows does not foot, so the drill-down says both
numbers, and the gap is itself worth knowing: it is how many people are on her
list and not in her CRM.

Also: `accessTokenFor` wrote a rotated token to the bookkeeping or giving table
only, so a Constant Contact refresh would have changed no rows, silently, and
locked the connection out at the next renewal. Three kinds, three tables, one
switch. The daily pull rides the existing tick; Mailchimp's webhook secret lives
in the URL because that is the only verification Mailchimp offers, and a wrong
one gets the same flat 200 a good one does so the path cannot be probed.

## FIX-10 — a new customer's first hour tells the truth (2026-09-30)

From Muse's walk of a fresh org: Bluegrass Literacy Project, 14 donors, 23
gifts, $19,750, imported an hour earlier. Every finding was rechecked on main
after TRANS-1 first. TRANS-1 had fixed none of them.

**Home said "No donors drifting" while five donors were drifting.** They were
medium confidence, and the product had no way to show them: "See all" sent
`?all=1`, which lifts the cap on the HIGH-confidence list and never asks for the
medium ones. Three surfaces each had their own answer because each had its own
words. `shared/driftWords.js` is now the one place drift is counted and named.
The rule that came out of it: the headline dollars stay high-confidence only,
because a number that includes guesses is not a number a director repeats, and
no surface says "no donors drifting" while anyone is drifting at any confidence.
A medium row may not label its dollars "at risk" either, because that money is
not in the number above it.

**"$0 RAISED · FY 2026-27" over a file holding $19,750.** True, and useless. The
fiscal year had turned in July and every imported gift predated it. Finance had
already solved exactly this, and the fix was to copy Finance rather than invent
a second answer. Two implementations of a fiscal-year LABEL was the deeper bug:
Reports built one from the browser clock, the server built another, and Reports
quietly defaults to LAST year when the current one is thin, under a chip reading
"Last FY" with no year on it. A total for a year the reader never chose and was
never told. Every chip carries its year now, from `shared/fiscalPeriod.js`.

**A deleted gift left its own thank-you standing.** The fix is an explicit link,
`tasks.source_gift_id`, not a heuristic: the rule "a task a person wrote by hand
is never touched" is then true by CONSTRUCTION, because a hand-written task has
no source gift for the void to reach. A predicate on `donor_id` would have been
one character shorter and would have voided her own task; that is the first of
the three defects planted to prove the new suite can fail.

**The test that ran nowhere.** The first full battery was 52 suites green with
the new suite absent: `tests/run-all.sh` takes an explicit CORE list, not a
glob, and CI runs that same list. A test that never runs guards nothing, and a
battery green WITHOUT it says nothing about the thing it guards. Check that a
new suite appears in the run, by name, before believing the green.

**Only the browser caught three of them.** The API assertions were 31 of 31 and
grep was clean while Home printed "5 early signs" twice on one card, once as the
new quiet line and once in the empty state, because both render when there are
no high-confidence drifters. Also: `/fundraising` and `/reports` are NOT routes
(only `/dashboard` and `/donors/:id` are), so the first walk fell through the
catch-all and read Home three times while reporting nothing wrong, which is the
exact trap `smoke-walk` documents in its own header. Navigate by clicking the
nav, and assert the nav moved.

**Shipped incomplete, and said so.** Part D's em dash class was censused and NOT
fixed: about 800 remain in customer-facing copy. Seven were fixed, in strings
this build touched. Rewriting 800 strings mid-build is how a suite goes red for
a reason nobody can find. It wants its own brief.

## CKRH-1 — THE FIRST CUSTOMER, AND A GREETING MADE FOR THEM (2026-09-29)
Central Kentucky Riding for Hope (Lexington, KY) is Steward's first real customer. `scripts/ckrh-provision.js` provisions them: the org, Sarah Fishback's login, their real logo and brand blue, three funds they actually have, and a first-run greeting written for them. **No donors, no gifts, no sample anything** — the account stays empty until her own Salesforce export is imported, because the first wrong number she ever sees is the one she will not trust the product about again.
- **A PROVISIONED ORG HAS ALREADY BEEN ONBOARDED, BY WHOEVER PROVISIONED IT.** `register-org` with `provisioned:true` now writes `onboarding_complete = 1`. The wizard collects name, mission, timezone and first funds; a handover arrives with all four already filled in from the customer's own website, so the wizard would ask her to retype the screen behind it. Worse: **`POST /onboarding/complete` calls `seedOrgData`**, so the only way she could have got out of the wizard was by putting invented donors and gifts into a real organisation's account. The greeting is what a provisioned org opens on instead, which is the whole point of arming it. A self-serve signup is untouched and still onboards.
- **The greeting carries the org's own SENTENCE, not its mission statement.** `orgs.welcome_line` and `orgs.welcome_next_step` join `welcome_motif`/`welcome_words` on the same opt-in PATCH. The first build rendered the mission AND the line; at 390 the mission ran to **seven lines** and buried the warm sentence under a paragraph written for funders. A mission is what an org says to a grant committee; the line is what it says to its own development director. When there is a line, the mission does not appear.
- **"CREATED FOR SOMEBODY" AND "FULL OF FICTION" ARE TWO DIFFERENT FACTS.** `provisioned:true` set `is_demo_org`, which is not a bookkeeping bit: it puts a **non-dismissible banner** across every screen reading *"This is a demonstration organisation. Everything in it is invented."* On CKRH's first sign-in that sentence is false, and it would have been the first thing Sarah read after her welcome. `register-org` now takes `demoData` — still defaulting to `provisioned`, so no future demo goes unmarked, but a handover that holds nothing invented can say so. **Mail is off either way**, so this changes what she is told, never what is sent.
- **ONE next step, never a list.** A first run that opens with three things to do is a to-do list, and she has not seen the product yet.
- **Their logo sits on a light plaque.** Drawn straight onto the ink, every dark colour in a logo disappears, and most nonprofit logos have one. The plaque is also what keeps the screen inside the four colours while the only brand on it is genuinely theirs. `docs/ASSETS.md` carries the row, with the source URL and the date, in the same commit as the file — the step the horse row records as missing.
- **`change-plan`'s plan list had gone stale and nobody could see it.** It predates the tiers, so a super admin could not name Seed, Sapling or Orchard — the three plans the pricing page actually sells. It now reads `pricing.json`, so the one price list stays the one price list. **And granting a plan no longer ends a free trial that is still running**: an invoice-only customer is put on their plan on day ONE, and flattening `trialing` to `active` there told Settings, the band check and `orgPlanTier` that the free period was over on the day it began.
- **Gotchas this build paid for:** `PRICING.TIERS` is uppercase, and `PRICING.tiers` silently yielded an empty tier list — a 400 "Invalid plan" that looked like a bad request and was a bad property name. And **script-guards was right**: a script that creates a real customer's org off a mistyped `BASE` is exactly what `prodGuard` exists to prevent, so it defaults to loopback and prod needs the confirm flag (proven by running it and watching the refusal).
## HOME-CALM — the corrected Part E (2026-09-29)

FIX-8 Part E added a first thing and folded the rest. It did not take anything
away, and the point of the brief was in its title: HOME-CALM removes, it does
not add. So Home opened with five blocks before the work — an alert box, a
nudge card with a green bar, a heading with a brass rule under it, a counts
line, and a summary paragraph — and then hid the list behind two "Show them"
links. Jonathan named all five and the summary sentence with them. This is that
screen, deleted.

**What is left is the date, First thing, and the list.** First thing is
unchanged: `threadList[0]`, said in a sentence, with the three things you can
do to it. Then the rest of the list is ROWS again — everything overdue and
everything due today — because the list she opens Home for has to be on the
screen. Next week is still one folded line, because next week is not this
morning's work. The band headers came off with the counts line: OVERDUE 4 above
four rows that each state their own age is the same tally in another typeface.
The Dashboard keeps all of it — the bands, the counts, the crossover, the
recurring line — because the board's screen is read once a month by somebody
who wants the sections marked off.

**The stopped card became a row, and that is the part worth keeping.** It was
an alert above everything, carrying a count and naming nobody: "1 card stopped
this month." A stopped card is money that was already moving and quietly
stopped, which makes it the most actionable thing on the screen. It now names
her, says what to do, and takes its place in the list by age. It borrows the
row's shape and none of its controls — there is no thread id, no Done, no
snooze, because logging a conversation is not what fixes a declined card.
`/recurring/exceptions` already returned `donorName`; only the count was being
kept.

**Two defects the browser caught that nothing else would have.** The first was
the TDZ rule for the FOURTH time: `homeCalm` reads `threadAllOpen`, whose
`useState` sat two hundred lines below beside the crossover's fetch. That is
not a lint error, it is a blank Home and "Cannot access 'ys' before
initialization" in a minified bundle. `tdz-scan` had said "15 reads-above" and
was not re-run with `--all`. The second: the demo's stopped card has no
`last_failed_at`, only a `first_failed_at` in July, so the row printed "Today"
— a date nothing in the data supports, on a card that stopped two months ago.
It falls back to the first failure, reads "60 days · stopped", and with neither
date prints no figure at all rather than guessing one.

51 suites green, one known skip (the portal tab, hidden from the CRM). No new
test: this is a screen, and screens are covered by the smoke walk.

Still open, and deliberately untouched: at 390 the Today rail still stacks
first, so the phone opens on three counts before the date. That is BUILD-89's
decision, not Part E's, and it was not on the list.

## INT-OAUTH — the Connect buttons actually connect (2026-09-29)

INT-1, INT-POS and INT-2 each shipped the data side of a connection and stopped
at the handshake, because the handshake needed a developer account nobody had
yet. FIX-8 Part F went looking for the authorize route and found there wasn't
one, for any provider. This build is that one missing piece: `shared/oauth.js`
is one registry (Xero, Intuit, Square) with one state format, one authorize-URL
builder and one token exchange, so a fifth provider is an entry and nothing
else. A request cannot widen what is asked for, because the scopes come from
the registry and not from the caller. Square's are five read-only scopes and
nothing with WRITE in its name.

**The callback could never have fired as first written, and the reason is worth
keeping.** It was `GET /oauth/:provider/callback` behind `requireAuth`. A
provider's redirect is a plain browser navigation with no Authorization header,
so it would have been a 401 every time; and it wrote, which the standing rule
forbids on a GET. Both problems have one answer: the provider lands the person
on the **app** (`/oauth/:provider/callback`, a real page), and the app finishes
the job with an authenticated POST to `/oauth/:provider/complete`. That is not
a workaround. It is what makes the wall mean anything — by the time the server
checks the signed state against a signed-in admin, there is one to check.

**The state carries three facts and is signed: the org, the admin, and a
nonce.** Without the org, an admin of org A could start a flow and have org B's
tokens land on A's row. `tests/oauth-state.test.js` is the one test this build
earned and it pins exactly that: a missing, unsigned or wrongly signed state is
refused; a validly signed state replayed by another org is refused; a colleague
in the same org cannot finish somebody else's sign-in; the state is single-use
and expires; after every refusal no connection row and no token exists anywhere;
and org A's sealed tokens will not open under org B's binding, so a row copied
between tenants is unreadable rather than useful. Proven able to fail twice:
removing the org/user check turns §2 and §3 red, and fixing the AAD to a
constant turns §7 red.

**Three defects the build found in its own earlier work.** The provider key and
the stored vendor key disagreed — OAuth calls it `intuit`, `shared/bookkeeping.js`
calls it `quickbooks` — so a finished connection would have been filed under a
vendor no screen reads; the registry now spells the stored key out. The Xero
tenant was going to be guessed: a Xero login can hold several organisations and
consent does not say which, so one is chosen for you and more than one is a
question, checked against Xero's own live list rather than taken from the
browser. And the send path had no Authorization header at all, because until
today there was no token to put in one; it now asks `accessTokenFor`, which
refreshes five minutes before expiry and once more on a 401, re-sealing the
whole bag because a refresh usually rotates the refresh token too.

**A connection that holds no sealed credentials still sends unauthenticated**,
which is how INT-2's mock and every sandbox works, and how every org sat before
today. Making the token unconditional turned `int2-send-once` red, which is the
suite doing its job. The demo is the same shape on purpose and now asserts it:
`seed-demo.js` refuses outright if `org_b72demo` holds a single set of provider
credentials, because a real token reaching the demo org would be a real
organisation's books behind a public login.

The tenant matrix's §1 coverage gate caught the three new parameterized routes
on the first run, which is FIX-9's repair of `readSource.js` paying for itself a
second time. `:provider` is an enum from a fixed registry, not a row id, so it
took a reasoned `PARAM_EXEMPT` entry pointing at the suite that actually proves
the tenancy. 51 suites green, tenant matrix 47/47, one known skip (the portal
tab, hidden from the CRM).

Also fixed: `OAuthCallback.jsx` hand-rolled a palette and the brand guard caught
two hexes inside a minute — `publicTheme.js` exists precisely to stop that, and
the page takes its tokens from there now. A stale `node server.js` from the
finished AGENTS-1 worktree was holding the mail sink's port and made two suites
red for reasons that had nothing to do with the code; that is the `:4173`
squatter again, wearing a different port.

## TRANS-1 — moving takes about a day, and there is nothing to learn (2026-09-29)

Demos were closing and the objection had stopped being the product. Primate
Rescue loved it and chose January because she will not switch during giving
season. CKRH signed and is keeping Salesforce while she eases in. The line
Jonathan needs to be able to say, and have be true: moving takes about a day,
you keep your old system until you trust us, and there is nothing new to learn.

Census first, and most of it already existed: the mapper, dedupe, named
imports, the import moment, and BUILD-98's eight vendor presets with their
checklists and their "what does not come across". What was missing was the
FRONT of it — the question is now asked BEFORE the file ("Where are your
donors today?", eleven tiles), each tile opens a printable page in the
vendor's own menu names, and after the commit one page proves nothing was
lost. eKYROS takes the spreadsheet path and its tile says so in as many
words: it is a client-services system, it holds clients rather than donors,
and no donor export format is published.

**The bug under the whole brief.** An import wrote `external_donor_id` on the
way in and never read it again. Matching was by email and nothing else, so the
one thing a fundraiser actually does mid-move — correct a typo'd address in
the old system, then export again — produced a SECOND record, because the only
key Steward matched on was the one she had just changed.

**And then the walk.** Every part was green in tests and five things were
still wrong on the screen, which is the entry worth keeping:

1. A real DonorPerfect gift export landed NO MONEY. The shape detector called
   it "one row per donor (totals)" — reason, in full, "no per-gift date
   column" — about a file whose fifth column is `gift_date`. The preset had
   already mapped date and amount, but the SHAPE decides which mapper renders.
2. The source id never reached the record, so the fix above was inert on the
   main path. `isDonorIdHdr` ran `\s*` over the RAW header: it knew "Donor ID"
   and missed "donor_id". That is the BUILD-84 rule, written down in
   `docs/decisions/imports.md`, applied where it had not been — and a fixture
   spelling the header "Donor ID" could never have caught it.
3. The CSV path recorded no run at all, so the files every tile leads to had
   no named import and no Move Report.
4. The re-import's Move Report accused itself: "8 fewer gifts than your file
   and $3,124.84 less than your file", about a move in which nothing had been
   lost.
5. A run excluded itself from its own list, because Postgres keeps
   microseconds and a JavaScript Date holds milliseconds.

The one new test is the brief's own sentence: the same export twice, then an
updated export with five new gifts, leaves exactly the original plus five,
footing to the cent. It was proven able to fail before it was trusted —
reverting the match order splits Ivy Chen into two people — and it was written,
green, and NOT in `run-all.sh`'s CORE list, which is its own small lesson.

## FIX-AUTH — a revoked session is refused, and the client acts on it (2026-09-28)

Jonathan opened stewardapp.dev and got "Failed to connect · Your session is
no longer valid — please log in again · Retry". The server was fine. Health
was ok, CORS answered for both the apex and www, the login route worked and
`requireAuth` returned every code correctly. The words on that screen were
`requireAuth`'s own `session_revoked` message, rendered on the OUTAGE screen.

**The client held an allowlist of three codes and the server returns six.**
`token_expired`, `invalid_token` and `no_token` were on it; `session_revoked`,
`user_not_found` and `account_deactivated` were not. For those three the stale
token was never cleared and nobody was ever sent to `/login`, so the app sat on
a screen whose Retry button could not possibly work. `sessions_valid_after` is
a SECURITY CONTROL — a password change, a role change, a removal and a
deactivation all bump it — and the product was declining to act on it.

**So the rule is inverted, and it cannot rot.** If we sent a token and the
answer was 401, that token cannot be used, whatever the server chose to call
the reason. A seventh code tomorrow is handled the day it ships. The codes now
choose only the wording, and an unknown one falls through to a general
sentence.

**And a sign-out is not an outage.** The 401 cleared the session and started
the navigation to `/login`, and then `apiFetch` threw anyway; the throw landed
in `loadData`'s catch, which set `loadErr`, which painted "Failed to connect"
over a redirect that was already on its way. `App.jsx` checks
`leavingForLogin()` BEFORE that branch now and says "Taking you to the login
page", which is what is actually happening.

**Reproduced before it was fixed, and after.** A real signed token, revoked the
way a password change revokes one, driven through a browser at 390 and 1440:
before, both widths showed the screenshot byte for byte with the token still in
storage; after, both land on `/login` with the session cleared and the
explanation on the login page where it belongs.

**What the suite caught about itself.** "Failed to connect" appears in a
comment four hundred lines above the branch that renders it, so an assertion on
the string was red for a reason that had nothing to do with the order of the
branches. It pins the branch, not the words.

## BUILD-103 — peer-to-peer (2026-09-28)

Supporters raising money for the org from their own networks: a walk, a ride,
a birthday, a church team. Most of the machinery already existed and this
build did not start over. Steward already had `peer_fundraisers` under a
giving page, a token-only manage link, rollup for free (a fundraiser's gift
carries BOTH `peer_fundraiser_id` and the parent `giving_page_id`), a public
leaderboard and admin takedown. What it did not have was teams, anything worth
calling a dashboard, words a fundraiser could send, a soft credit, or a screen
an org could run an event from.

**Teams, and arithmetic that cannot drift.** A team is a row under the page. A
team's total is a live SUM over the same gift rows everything else sums, never
a stored counter, so page = teams + solo fundraisers + direct gifts in cents BY
CONSTRUCTION. The screen prints that identity rather than assuming it:
"$1,775 through teams + $125 through fundraisers with no team + $0 given to the
page directly = $1,900." Archiving a team takes it off the leaderboard and
leaves its gifts counted on the campaign, because the money did arrive.

**What a fundraiser may read of a gift, and the one function that decides.** A
first name and an amount, and only where the donor chose it.
`gifts.show_name_to_fundraiser` is FALSE by default and the default is the
decision: a gift given through a friend's page is still a gift to the
organisation, and the friend is not entitled to a list of who gave. The
dashboard's SELECT has no email column and is not going to have one.

**Words the fundraiser sends themselves.** Three drafts written from the
fundraiser's own page data: the ask, the nudge, the thank-you. They copy them,
or open them in their own mail client through a `mailto:`, and they go from
their inbox with their name on them. Steward sends nothing to a fundraiser's
contacts and never will: the drafts function takes no donor argument, which is
why it cannot leak one.

**Soft credit, and the two ways it could land on the wrong person.** Every gift
through a fundraiser page writes a `gift_soft_credits` row at 100% inside
`recordGift`. Hard credit stays on the donor and no giving total anywhere
moves. The fundraiser is matched to the CRM by EXACT EMAIL at sign-up and never
by name, and somebody nobody has heard of becomes a person typed VOLUNTEER,
never a donor: they are not a donor until they give, and typing them as one
would put somebody who has never given a penny into every donor list the office
reads. The one test plants a namesake at a different address and watches the
credit refuse to land on them.

**The manage link is hashed now.** It was the whole auth model and it was
stored in the clear. A row from before this build is migrated on its first use,
so every link already in somebody's inbox keeps working and stops being
readable in the database afterwards.

**The org's event view.** One screen per campaign: the totals with the identity
they foot to, every team and fundraiser against their goal, the leaderboard the
public sees, takedown per fundraiser and per team, a CSV through the one
`sendReportCsv`, and two saved reports over the same rows. First on the screen,
above all of it, is WHO HAS NOT RAISED ANYTHING YET, because that is the only
list on it anybody does something about.

**What the walk caught.** A new Fundraising part id that is not in `FR_LEGACY`
silently opens the Overview: `/dashboard?fr=p2p` landed on the wrong screen
until the id was registered. And `cents` inside `recordGift` is declared inside
a block, so the soft credit read an out-of-scope binding and wrote nothing at
all, quietly, with the gift itself landing perfectly.

Nothing about peer-to-peer goes on the marketing page until one real org has
run a campaign through it.

## EVENTS-2 — tickets people can buy, and the attendee side (2026-09-28)

EVENTS-1 built the hub and a public page that could not take a card, and said
so on the page and in the code: "a page that takes a card and does not
reliably finish the registration charges somebody for a seat they do not get."
This is the other half.

**The page takes a card, and it is the donation checkout.** `POST
/e/:slug/checkout` calls the same named `donateHandler` every gift goes
through, and a small shim turns its one success shape into a 303 to Stripe. It
is a plain form POST, so the page needs no JavaScript to take money. The
money settles in the org's own connected account, the server prices every line
from the level, and the gift carries the ticket's fair-market split so the
receipt states the deductible part. Apple Pay and Google Pay come with
Checkout; nothing was added for them.

**A seat is held for fifteen minutes, and a registration is confirmed only by
the webhook.** Capacity is registrations PLUS live holds, computed in one
place, so the page, the checkout and the staff registration cannot disagree
about what is left. An abandoned checkout reaches nothing: its hold runs out
and the seats are on sale again without anybody doing anything.

**The member price is the server's decision.** A ticket type may carry one; a
buyer gets it when the server itself finds a current membership on that email
in that org. The page never says which price applies, and a request claiming
to be a member changes nothing — the suite posts that claim straight at
`/donate` and watches it fail to move the price.

**The attendee's side.** A confirmation page that writes nothing and says
plainly when it is still waiting for the webhook rather than telling somebody
who has just been charged that there is no record of them. A ticket QR, add to
calendar in three formats, directions, and an email carrying the code as an
IMAGE URL, because no email client renders a `data:` URI. The ticket then
lives in the Events section of MEMBERS-2's "Your page".

**One code, one scanner.** The door reads a ticket or a member card through
`shared/passCode.js`. A member card is NOT a ticket, so scanning one never
invents a registration: it names the person, says whether they are on the
list, and lets the person at the door decide. A code signed for another
organisation is refused by name, not only by signature.

**The waiting list.** A sold-out ticket type takes a name instead of a
payment, and a place is OFFERED by a person pressing a button. Nothing is held
and nothing is charged: it is an invitation to come and buy, in order.

**What the build caught that was already live.** `registerForEvent` stamped
`gifts.event_id` only on a gift it wrote itself, so every ticket bought online
— where the webhook writes the gift and hands the id in — left its money
unstamped, and the event's raised figure counted nothing that had actually
been paid for on the public page. That is the whole of what this build sells.
`GET /events/:id/waitlist` answered 200 on another org's event id until the
tenant matrix said so. And `/e/:slug` was missing from `vercel.json`
altogether: EVENTS-1's public page has been unreachable from
www.stewardapp.dev since it shipped.

**Harborlight is a US organisation.** "Harbour" is "Harbor" everywhere in the
seed, the 5K is `/e/harbor-run` with `/e/harbour-run` redirecting through a new
`events.previous_slug` (a link on a poster is not the org's to take back), and
`fmtFull` names its locale: `toLocaleString(undefined, …)` takes the browser's,
and in half of Europe `$25.000` beside a dollar sign reads as twenty-five
dollars.

## MEMBERS-2 — the member side, and one page for every supporter (2026-09-28)

Memberships were live on the staff side and could be bought online, and the
member had nowhere to go. Neither did the ticket buyer, the volunteer or the
fundraiser: each was heading for its own surface with its own link and its own
idea of what the organisation looks like.

**One page, at `/you/:orgSlug`.** A member, a ticket buyer, a fundraiser and a
volunteer all land on the same page and see exactly what they have. It is
server-rendered HTML on `shared/publicPage.js` — the shell the volunteer
sign-up and the event registration already wear — so it is one request, no
bundle, the org's own band, and 16px inputs that do not zoom a phone. The
volunteer's own page and the donor portal are SECTIONS of it now, and a live
`/volunteer/me?t=` link in somebody's inbox is exchanged for a session here
rather than opening a second page.

**A section with nothing in it does not render.** Not an empty state, not a
"you have no tickets" card — nothing. A member who has never volunteered
should not be told, on their own page, about a part of the organisation they
have no relationship with, and a page that is four empty boxes and one real
one reads as a page that is broken.

**Nobody ever has a password.** They type their email and a link arrives:
CSPRNG, hashed at rest, fifteen minutes, spent on arrival. Spending it mints a
thirty-day session in its own cookie, so a link forwarded on, or read out of a
mailbox next year, opens nothing. The token rides the URL FRAGMENT, which never
reaches a server log or a Referer header, and the GET it lands on writes
nothing at all: the page reads the fragment and POSTs it, and the POST is what
consumes the link. Known and unknown addresses get the same answer, always.

**The wall, and the one test.** A session is (org, person), and every query on
the page is scoped by both — from the session, never from the URL or a form
field. The one guard this build earned plants the three ways that could break
(another person in the same org, a person in another org, a spent or expired
link) and checks the rendered PAGE, because a page that 200s and prints the
wrong name is the failure worth catching. Verified able to fail: dropping the
cross-org check and loosening the gift query turned four assertions red.

**One QR for every door.** `shared/passCode.js`:
`STW1.<kind>.<org>.<id>.<exp>.<sig>`, HMAC-signed. A member card and (EVENTS-2)
an event ticket are the same string with a different kind, so there is one
scanner rather than two, and the second one is always the one that is out of
date on the night. The org is IN the signed body, so a code from another
organisation is refused by name and not only by signature.

**No second money path.** Renewing prices from the level through the existing
`?membership=` path. A recurring change goes to the donor portal's own routes,
which is where those Stripe calls live. Turning auto-renew off is the existing
`cancel_at_period_end`: the term already paid for runs to its end.

**It installs.** One manifest per org, `display: standalone`, and the thing on
the home screen is the ORG's — its name, its colour, its logo. One icon, an
SVG tile, `sizes: "any"`: declaring `192x192` for a logo whose real dimensions
nobody checked is how an installed app ends up with a blurred tile.

**What the wiring caught.** `gifts` has no `designation` column and
`recurring_subscriptions` has no `next_charge_date` — both were written from
memory of what those tables ought to hold, and both 500'd the page on the
first request by a person who actually had gifts. And `/e/:slug`, EVENTS-1's
public registration page, is missing from `vercel.json`: it is unreachable
from www.stewardapp.dev today. EVENTS-2 fixes that.

## EVENTS-1 — the events hub (2026-09-28)

An ED runs a gala or a 5K from Steward, and every guest leaves with a next
step. Much of the spine already existed and was unreachable: the model, the
levels with fair-market value, the guest list, tables, attendance, and the
money path. `registerForEvent` already wrote every payment as a gift through
`recordGift` with the quid-pro-quo split, so the receipt already stated the
deductible part. What was missing was a door, a goal, and the night itself.

**1. Events is its own room.** It was commented out of the nav. It is in the
rail beside Journeys now, for the same reason Journeys is: an organisation
lives inside a gala for six weeks and it does not belong behind a More menu
during them. Each card shows date, GOAL, RAISED and REGISTERED, and every one
of those numbers opens its rows.

**2. A goal, and a raised that is not typed.** `events.goal_amount` is what
the night is measured against. Raised is summed from gifts stamped with
`gifts.event_id`, which registration now sets: the only link before was the
campaign NAME, so a renamed event lost its money.

**4. Tables, and the people without one.** Drag a guest onto a table. The
unseated keep their own column rather than being hidden, because the people
without a seat are the ones the chart exists to find. Printing gives the
seating chart with dietary notes and the name tags, and a name tag carries a
name and a table and nothing else: a badge that prints somebody's giving level
tells the room what they gave.

**5. The door.** VOL-1's kiosk shape for a guest list: one big search box, one
big list, 16px type, because it is used standing up holding a pen.

**6. The morning after.** Raised against goal, came against registered,
first-time givers, sponsors. Every figure opens its rows and the raised rows
foot to the figure to the cent. The caveat is in the payload, not a caption:
an event is not the reason anybody gave. Attendance already fired the
"attended an event" journey trigger, so each guest already got a next step on
the Thread. A thank-you per sponsor is DRAFTED into the queue FIX-6 gave an
Approve button, so it goes out the same way every other one does.

**3. The public page, and the line it does not cross.** `/e/:slug` on the
org's own band, framing like a donation form, working on a phone: 16px inputs
so nothing zooms, a 48px button, the deductible part stated before the button.
It takes tickets with the names of everybody coming, sponsorships, and sends
somebody who cannot come to the giving page.

**It does not take a card, and it says so on the page.** A registration
arrives as a request the office confirms, and confirming runs the same
`registerForEvent` every other registration runs, so there is no second money
path. Taking the card inline means a Connect checkout session AND a webhook
branch that completes the registration, and half of that is worse than none: a
page that takes a card and does not reliably finish the registration charges
somebody for a seat they do not get. That is EVENTS-1b.

**One shell, two public surfaces.** The volunteer page's renderer moved to
`shared/publicPage.js` so the registration page wears the same band, cards and
inputs. A second copy is how two public surfaces end up on different versions
of one brand. The move exposed a race worth keeping: the shell arrives by
dynamic import, and the routes awaited only `VS_READY`, so a request landing
between boot and resolution would have read it as null. They await both now.

**What the walk caught.** Counting registrations as `Number(quantity) || 1`
turns a zero into a one, and a named guest carries quantity 0 on purpose — a
seat and a name tag, not a second place. Three places and two guests reported
as five. And the public page printed "Sat Dec 05 2026 00:00:00 GMT-0500
(Eastern Standard Time)" as its date, because `events.date` is a DATE column
that pg hands back as a Date OBJECT and ten characters of that is "Sat Dec 0".

**A note on the battery run.** `pledge-math` took 1,035 seconds in the final
run and one second on its own straight afterwards. It was starved by this
session's own parallel seeds and walks against the same scratch Postgres, not
a regression. Worth knowing before somebody chases it.

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

## VOL-2 — Volunteers stands on its own (2026-09-28)

VOL-1 built the machinery: opportunities, slots, sign-ups, capacity decided by
the database, check-in, waivers and checks, the coordinator boundary. What it
did not build was a way IN. The only route onto the roster was "go to Donors
and tag somebody Volunteer", which is the donor way in, on a screen that says
donor everywhere, discovered by accident.

**1. The two actions are up front.** "Add a volunteer" in emerald and "Import
volunteers" outlined, at the top of Volunteers → People, empty roster or full.
Adding one by hand is three fields, because that is what a coordinator has
when somebody signs up at a table. If the email is already on file the answer
says so, by name: one person, one record, and she finds out at the moment it
happens rather than from a duplicate she meets next week.

**2. The import reads a volunteer file, not an hours file.** VOL-1 could read
one column family. A real export has four: people, contact details, hours
history, and the two dated things that decide whether somebody may work at
all. `shared/volunteerImport.js` reads all four, with five presets
(VolunteerHub, SignUpGenius, Wranglr, Bloomerang Volunteer, and a plain
spreadsheet, which is what a small organisation usually actually has). It is a
preset on the ONE mapper: the browser parses with `parseFileToSheets`, so CSV
and XLSX both work, and the SERVER decides everything in a preview that writes
nothing.

**The first test file it was given found a defect in it.** A vendor preset
only lists the columns that vendor ships, and a real export has been edited:
somebody had added a "Waiver Signed" column to their SignUpGenius report,
because SignUpGenius does not have one. Mapping with the vendor preset alone
dropped it silently and the waivers arrived as nothing. The vendor preset maps
first and the plain reader now fills what it did not name, filling gaps only
and never overriding.

**And a tick is not a date.** A credential cell reading "yes" or "signed" is
refused by line and reason rather than given today's date, because what a
screening is worth is entirely its date. A shift dated in the future is a
sign-up, not hours worked, and is refused too: hours somebody has not given
yet are the fastest way to a grant report that lies.

**3. The undo is exact.** Every row an import creates is stamped with its own
`imports.id` across the three tables it writes, and the undo deletes by that
id alone. A "remove everything from the last five minutes" undo would take the
shift a coordinator logged by hand while the import ran. A person the import
merely MATCHED is never removed: they were here before the file arrived. A
person it created who has since given, or who has a shift it did not write, is
KEPT and named with the reason, which was proved by planting a gift on one and
watching the undo refuse to take them.

**4. Nobody who arrives this way is a donor.** Add and import both write
`person_types ["volunteer"]` and nothing else: no gift, no donor tag, no stage
that implies one. The empty state was rewritten to lead with the three
volunteer ways in as buttons ("Add your first volunteer, import from
VolunteerHub, SignUpGenius or a spreadsheet, or share your sign-up link"), and
tagging on a donor record is mentioned last, in small text, because it is
still true and it is still not the answer.

**5. Opened from Volunteers, a person is a volunteer first.** Upcoming shifts,
hours, waivers and checks, groups. Giving is the LAST field, present only when
they have actually given, and the server does not put it in the payload at all
for a volunteer coordinator: that role is a security boundary, so the server
decides it rather than the screen choosing what to draw.

**6. The two VOL-1 leftovers.** The group sign-up screen exists now (a group
is a LABEL on a set of sign-ups, never a person; capacity is still the
database's, so twelve people at an eight-place shift get eight confirmed and
four waitlisted, and the answer says which). And the reminder sweep has a
timer: hourly, off under DISABLE_BACKGROUND_TICKS, with nothing about who gets
mail changed. Hourly rather than daily because "tomorrow" is a different
instant in every org's timezone, and the per-row claim makes the extra passes
free.

**7. The stray brass bar.** Jonathan saw it; two pixel scans for brass near
both tab strips found nothing, so the answer came from asking rather than from
guessing, and it was not brass at all: the tab strip was a full-width flex row
with a border-bottom, so the rule carried on past the last tab to the right
edge — 835px of bare tan line on cream at 1440, which reads as a stray brass
bar because that is what a bare warm line on cream looks like. `fit-content`
with `max-width: 100%` ends the rule where the tabs end and keeps the phone
overflow-scroll.

**What the run cost, and what it taught.** The ALTER TABLE block went in beside
the shifts indexes and ABOVE the CREATE for `volunteer_credentials`: it worked
on every database that already had the table and killed all three battery
shards on a fresh one with `relation "volunteer_credentials" does not exist`.
An ALTER goes below the CREATE it alters, always, and a fresh database was
booted afterwards to prove it rather than assumed.

The tenant matrix then refused the build for a better reason: two new
parameterised routes nobody had probed across the org wall. Wiring them found
the trap underneath — the existing fixture's import row is shape `workbook`
and the volunteer undo only answers for shape `volunteers`, so probing with it
would have 404'd because of the SHAPE and gone green without touching the wall
at all. The fixture got a volunteers-shaped row per org.

`scripts/vol2-walk.js` is 59 assertions at 1440 and 390 plus a fresh empty org.
Three of its own assertions were wrong before they were right: it expected two
people from a three-person file, it used a fixed email so its second run met
its own last run, and it matched the empty state's text and found the BOX that
holds both lines, so "is it smaller and lower" compared the box with itself.

## FIX-5 — Journeys, premium and yours (2026-09-28)

Six items, and the theme is that a journey stops being one of five fixed
shapes and becomes a thing an organisation writes.

**1. You can make one.** There was no way to create a journey except pressing
a preset, so every org's journeys were the same five shapes with edited step
labels. "Create a journey" is the emerald action at the top of the page: name
it, pick any trigger and its conditions (amount, stage, tag and the audience
filters, now STORED WITH the journey rather than re-picked inside the apply
dialog every time), then build the steps. Presets stay as "Start from one of
these", and pressing one the org already has now asks "You already have New
donor, first year. Open it, or make a copy?" instead of minting a second row
with the same name. Harborlight's duplicate went with the re-seed.

**2. It opens on arrival.** The most recently edited journey, or the first
that is On. A page whose whole job is a chain should not open as a list of
shut rows.

**3. The chain is a grid now, and that is the whole fix.** It was absolutely
positioned nodes inside a `height: 138` box: a step label that wrapped
overflowed the box and the dark preview panel below rode up through the
names. It is now one CSS grid, one column per node, four rows shared by every
column (timing caption, node, name, date). The shared baselines are not
arranged, they are the same grid rows; a wrapped name grows the name row for
every column at once, so no date is ever pushed down past its neighbours. The
one line sits IN the node row, centred, with negative margins carrying it to
both edges of the card, so it passes through the node centres instead of
floating above them. Column widths still carry real time but are clamped to
0.85-1.6, which is the answer to "reflects real time only as far as it stays
legible". Done is filled ink, today is an emerald ring, upcoming is outlined,
the selected node is raised, and the motion is 180ms and off for anybody who
asked for no motion.

**The preview earns those words.** "Done" has to mean done, so the preview
now prefers somebody ACTUALLY in the journey and shows their real step
statuses. Only when nobody is in it does it fall back to the arithmetic on a
trigger date, and then the states are past / today / upcoming and the caption
says which it is showing.

**4. Nothing bleeds.** The card is three flow rows: chain, then editor and
preview side by side, then the actions. None of them is positioned, which is
why they cannot overlap. At 390 everything stacks and the chain is a list.

**5. Everything is editable in place.** Name, one-line description, trigger,
conditions, priority, On/Off; and per step: what happens, its type, its
timing (days, weeks or months after the trigger OR after the previous step),
its owner, an optional draft, and a note. Drag reorders and retimes,
duplicate a step, duplicate a whole journey, remove one with an undo that
puts the same row back.

**Timing is input; `offsetDays` is storage.** "Two weeks after the previous
step" is resolved left to right into the one number the engine computes dates
from, and the words are stored beside it only so the screen can show her back
what she chose. A second unit would have been a second source of truth for a
date.

**And saving an On journey tells the truth about who it reaches.** The
existing rule is that changing a journey does NOT rewrite the people already
in it, on purpose. So the confirm says exactly that, names the count, opens
the rows behind it, and offers the opt-in: "Save and move the 4 already in
it", which moves PENDING steps only. Open, done and skipped steps have
already happened to somebody and are not ours to rewrite.

**6. Major donor stopped being an error.** Choosing it POSTed, failed
validation and printed "Set the amount that counts as a big gift" in
terracotta: an error for not having answered a question nobody had asked. It
now opens with "A big gift for us is $____", prefilled from their own gifts
(the 90th percentile single gift, rounded to a figure a person would say out
loud) with the sentence that says where the number came from and the 200
gifts behind it one click away. Red on this screen is for a destructive
confirm and nothing else, and the walk measures that rather than trusting it.

**Two additions, asked for mid-build.**

Every demo person has their own name. The pool was 30 x 30 = 900 pairs for a
file of about 1,150 people, so the draw ran out and minted 205 people called
"Donor 1002 Ashgrove", in the donor list of the screen the product is sold
on. Uniqueness was enforced on the derived EMAIL and only inside the tail
generator, which meant the hand-written people, the eleven, the volunteers
(their own separate pool, overlapping the donor one on both sides) and the
staff could all collide with the generated file and nothing noticed. There is
one registry now, every person goes through it, the pool is 64 x 72, the
filler-name fallback is gone, and the seed ASSERTS uniqueness against the
database at the end rather than against the registry that built it. It caught
two real collisions on its first two runs ("Fenwick Ravensmere", then
"Henrietta Stonebridge", who the tail had already minted before the household
fixture asked for her). The one repeated name that stays is the merge
fixture: ONE person with TWO records, which is the point of it, and it is
named in the assertion rather than allowed as a count.

And the donor profile's rail said "Before you go" twice, once as the rail
section's heading and once inside the panel underneath it. A section has one
heading and it belongs to the section.

**What the walk caught that the suites could not.** `scripts/fix5-walk.js`
measures the geometry at 1440 and 390: 63 assertions. Two of them were wrong
before they were right. The line-through-the-centres check passed against a
planted defect because `Math.max()` of an empty list is `-Infinity` and every
node in the one-step journey the walk had itself created was the selected
one, so the filtered list was empty: a guard that answers a question it
cannot see. It now refuses to answer below two resting nodes, and it opens
the seven-step journey deliberately rather than measuring whatever opened.
The second was the same class: clicking a row header TOGGLES, so "open the
seven-step journey" shut the one that was already open and measured a chain
of nothing.

The money guard caught the other one. The rows behind the big-gift suggestion
formatted a real gift with `Math.round`, which would have shown $4,000.50 as
$4,001 in the rows behind a number. `sentenceMoney`, like everywhere else.

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

## LOST & FOUND — the free donor audit (2026-09-28)

A consultant charges $500 to $2,000 to tell a nonprofit which donors are
slipping away. `stewardapp.dev/lost-and-found` does it in two minutes, free,
with no account, and it is Steward's best salesperson.

**The promise, and how it is kept.** "Your donor file never leaves your
computer" is not a policy, it is an architecture. The file is read into an
ArrayBuffer and handed to a Web Worker; the worker returns an audit. The
worker and the audit module contain no `fetch`, no `XMLHttpRequest`, no
`sendBeacon`, no `WebSocket` and no import of anything that has one, and that
is checked by reading the files rather than promised in a comment.

**Exactly two things reach a server**, and both are built by name in one place
each: the three fields she types to get the PDF, and four aggregate numbers if
she ticks the benchmark box. The benchmark route REFUSES a fifth field rather
than ignoring it, because a page that started sending more should fail loudly
here and not succeed quietly in production. The two tables enforce the same
thing structurally: `lost_and_found_leads` has no column that could hold a
donor, and `lost_and_found_benchmarks` has no column that could join it back
to a lead.

**The audit** is five questions a development director cannot answer from a
spreadsheet without a day of pivot tables: who gave last year and not this
one, who has gone quiet in any year, who is still giving and down 40% or
more, which recurring gifts stopped, and the top 25 at risk by dollars, plus
the retention rate and the dollars at risk. Every number opens its donors on
the page and carries the sentence that defines it. Somebody who stopped
entirely is counted as QUIET and not as drifting; counting them in both is how
a free audit inflates its own headline.

**The parse is Steward's own.** `shared/importShape.js` already solves the
three things every real donor export gets wrong — where the header row
actually is, whether 03/04 is March or April, and whether 1.234,56 is a
thousand or a decimal — so Lost & Found reuses it rather than growing a
second, worse copy. The fixture it is tested on has a title row above the
header, a blank row, two name columns, money with symbols, a mixed Recurring
column, rows with no amount, and a trailing TOTAL row.

**The funnel is honest.** The results are free and complete with no email at
all, and the page says so before she uploads. The form is only on the PDF.
`?ref=` rides the lead so an affiliate gets credit. "Start Steward with this
file" cannot carry the file — it never left her browser, and putting it in
storage would break the promise — so what travels is the intent, and the
import step after signup says "You ran a Lost & Found audit on X. Use the same
file here."

**The one new test** (`tests/lf1-no-donor-data-leaves.test.js`) runs the real
fixture through the real parse and the real audit with every network primitive
replaced by a recorder, then asserts the recorder is empty, that the benchmark
payload's every value is a band label or a whole percentage, that the worker's
source contains no way to make a call, and that the two routes refuse a field
carrying a donor. Four defects were planted and each watched go red.

**Two things the build got wrong and the tests caught.** `normalizeDate` and
`normalizeEmail` return `{ value, warn }`, not the bare value — reading
`.iso` compiled fine and produced an audit of zero gifts on a perfectly good
file. And the first fixture generated 140 people who shared twenty names
between them, because `i % 20` and `(i * 7) % 20` have the same period; the
walk was grepping the network for one string instead of a hundred and forty.

**The walk (`scripts/lf1-walk.js`, 56 checks at 1440 and 390)** is the half
the Node suite cannot do: it uploads the messy file in a real browser, records
EVERY request for the whole session, and greps each one's method, URL, headers
and body for all 140 names and all 140 emails. Zero. Exactly two posts reach
the API and the walk prints both bodies in full.

## FIN-1 — the Finance facelift (2026-09-28)

Finance worked and answered nothing. Eight sub-tabs in a flat strip, every one
of them equally loud, four figures that were period totals of a ledger most of
the org's giving never reaches, and a restricted balance of zero on the demo —
so the one screen that exists to answer "how much of this is not ours to
spend" said less than the bank statement.

**The shape.** Five sections, each one a question, with all eight old views
folded in underneath as parts: Overview (This month, Transactions), Funds
(Funds, Budgets), Deposits and payouts (Payouts, Deposit sheet), Grants money
(Restricted), Exports (Month close, Year-end statements, Audit log). Nothing
was dropped and every deep link that named a sub-tab still resolves, because
`PART_SECTION` maps an old id to the section it now lives in. The title is
"Your money.": finances is what an accountant calls it.

**The four figures, and they open.** Money in this month, restricted balance,
unrestricted balance, deposits not yet matched. Each one opens its rows, and
the rows SAY OUT LOUD whether they add up: "129 rows, $138,543. They add up to
the figure, to the cent." That sentence is the whole point — a number a
bookkeeper cannot get behind is a number she will not sign, and "trust me" is
exactly what she will not do. The figure and its rows are the same query run
twice, so they cannot drift.

**Money in by month** is twelve bars that each open their gifts, with empty
months drawn as zeros rather than skipped: a chart that skips them makes a
quiet year look like a busy one.

**Needs you** is three things at most and every one is a thing somebody can do
today — gifts with no fund, cheques not on a deposit, restricted money with a
report due inside sixty days. Not a health score, not a progress bar, and not
a warning: a count, a sentence, and the rows.

**Funds** is one card per fund with the balance, in and out this period, the
restriction, and WHO restricted it — read from three places (a grant whose
money was posted to the fund, a gift that named it, and a ledger line carrying
the body it came from) rather than guessed from the fund's name. The third one
matters because most restricted money in a small shop arrives as a transaction
somebody typed.

**Exports** gathers what a bookkeeper needs into one place: the month-close
checklist (five things, each open or done, each saying what to do), the
existing bookkeeper file with its cents assertion, the QuickBooks and Xero
column sets, and the year-end statement run. The QuickBooks and Xero mappings
are a RESHAPE of the same rows, not a second export — nothing there adds
anything up — and both are marked documented-not-walked on the screen itself,
because neither has been through a real import.

**Three bugs this build wrote and then found**, all three in SQL against
columns that do not exist, and all three would have shipped looking fine:
`grants.funder_id` (there is none; `funder` is TEXT and the grant's title is
`program`) inside a `.catch(() => [])` that turned a wrong column name into a
silently empty Needs-you list; `gifts.receipt_number` (a receipt is a row in
`receipts`) which would have counted every gift as un-receipted for ever; and
`gifts.deposit_id` (a deposit is an `imports` row with shape='deposit' and its
gifts carry `import_id`). The catch is the lesson: a catch that swallows a
query error is a catch that turns a typo into an answer.

**The demo now has a finance month.** Three funds, a restricted grant whose
$55,000 first instalment sits in its own fund with $27,350 left and a report
due in 41 days, a scholarship fund restricted by three named donors, and the
month's operating expenses so the bars and the funds are not one-sided.

**The walk (`scripts/fin1-walk.js`, 107 checks at 1440 and 390)** opens every
section and every part, checks each figure foots through the real route before
it looks at a screen, and asserts NO DARK GROUND anywhere in the content
column. Its first version flagged three correct pages, because it counted a
filled ink button and a twelve-percent tint as a ground; a ground is large,
opaque, and not a button.

## VOL-1 — Steward Volunteer (2026-09-28)

Steward already knew who volunteered and how many hours they had given
(BUILD-98, FIX-1). What it could not do is the job a volunteer coordinator
does every week: put a shift on a page, let people sign up for it, know who
turned up, and keep a waiver from quietly lapsing.

**The four nouns, and why they are four.** An OPPORTUNITY is a standing thing
to do ("Saturday harbour clean-up"); a SLOT is one dated occurrence of it with
a capacity; a SIGN-UP is one person on one slot; a SHIFT is hours that were
WORKED, which is the table BUILD-98 already had. A slot becomes a shift at
CHECK-OUT and never before, because a sign-up nobody attended is not hours
anybody gave, and a tool that counts it as hours produces a grant report that
is a lie.

**Capacity is decided by the database.** The failure mode of every volunteer
tool is a capacity that is advisory: twelve people confirmed for eight places,
four of them driving across town on a Saturday morning and finding out at the
door. Signing up takes a row lock on the slot and re-reads the confirmed count
inside the transaction, so two people pressing the button in the same second
cannot both take the last place; the second waits, re-reads, and is waitlisted
with the sentence that says so. Cancelling frees the place and promotes the
first person waiting in the same transaction. `slotState` in
`shared/volunteerShifts.js` is the one piece of arithmetic the public page,
the coordinator's screen and the route all read, so none of them can disagree
about whether a shift is full.

**The public page is the org's, and it is embeddable.** Its band carries the
colour and logo that `resolveOrgBrandTheme` already gives the receipt, the
portal and every donor-facing artifact, so a volunteer page cannot be the one
surface wearing a different brand. It frames (`frame-ancestors *`), like a
donation form. Signing up takes no account and no password, and it NAMES
NOBODY who already signed up: a volunteer list is names, addresses and
availability, and it is not public because the shift is.

**The volunteer's own page** is a magic link in its own family, deliberately
separate from the donor portal's: a volunteer is not a donor account, and a
link that opens a roster must never open a giving history. Thirty days,
because somebody signs up in September for a shift in October.

**Check-in** is a tablet at the door or a phone in your hand: tap a name to
check in, tap again to check out, and the hours are the difference, rounded to
the nearest quarter hour because nobody's day is 3.7166 hours. The hours are
dated THE DAY THEY WERE HERE, not the day the slot was planned for; those are
the same date almost always and different in the one case that matters.

**Waivers and background checks** are one table, because they are the same
shape: a thing done on a date that stops being true on another date. An expiry
is not a deadline. The warning is thirty days, not seven, because a background
check takes two to three weeks to come back, and the Thread step it raises is
addressed to the coordinator and phrased as the thing to do: "Book the next
background check for Bertie Delacroix", never "Bertie's check has expired".

**The volunteer coordinator role is a SECURITY boundary**, decided in
`auth.js` at the one place every authenticated request passes, reading the
LIVE role rather than the JWT's. It is an ALLOWLIST, matched on the first path
SEGMENT: a deny-list of money routes is a list somebody forgets to add to, and
the thing they forget is a donor's giving history. The first version used raw
string prefixes and `/volunteer` matched `/volunteers-of-other-things` — the
new suite caught it, which is the whole reason it exists. The roster read
strips the giving columns for that role, and the VOL-1 walk caught that the
ROWS were stripped while the summary sentence still said "and three of them
also give", which is a count of donors on a screen that must not have one.

**Nothing is sent that the org did not turn on.** Shift reminders are off by
default per org and the demo org never sends at all, proven both ways. An hour
milestone (25, 50, 100) writes a DRAFT into `milestone_drafts`, the table the
review queue already reads, and fires once.

**Two things that were the ENVIRONMENT, not the build,** and both cost real
time, so both are fixed rather than remembered: `scripts/build-local-dist.sh`
baked `:5601` into every dist, so a second worktree's browser legs talked to
the FIRST worktree's server and read its database — a fully working app
showing another build's data, with the walk failing on what looked like
product defects. It takes `API=` now. And `seed-demo.js`'s scratch-database
allowlist had grown one prefix per build family, so every new family met a
refusal that read as a product bug; it is one pattern, still incapable of
matching `postgres` or a Kingdom Builders database.

**The walk (`scripts/vol1-walk.js`, 75 checks at 1440 and 390)** drives the
public page, a real sign-up, the volunteer's own page on a phone, kiosk
check-in end to end, every part of the hub, Home, a record with both halves on
it, and the coordinator boundary through the real routes with the role
switched in the database and switched back. It taught the same lesson FIX-4's
did, for the second time: a walk that WRITES cannot pick "the first one" — its
second run met a kiosk tile already checked out and hung for thirty seconds on
what looked like a broken kiosk.

**What VOL-1 did not finish**, and is in the next brief rather than half-built:
the group sign-up has its route and its seed but no screen of its own (a
coordinator adds a group through the API or one person at a time); the
SignUpGenius/VolunteerHub/Wranglr import reads the new preset but the hub
still offers only the existing hours-import modal; and the reminder sweep is
driven by its admin route rather than by a timer.

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

## THREAD-2b — the screens, in Direction A (2026-09-27)

Jonathan picked **A, the spine**. The journey is one horizontal line and the line is *time*, the
drawer opens under it, and the journey chip lives in the donor profile's ink right rail.

**The builder** (Settings → Journeys, linked from Fundraising). Seven nodes on a spine at 1440,
the same seven as a vertical list at 390 — Direction A's idea is that time is a line you can see,
and on a phone that line is vertical. Drag to reorder, and a dropped step *retimes itself* to sit
between its new neighbours, because a spine where order and time disagree is a spine that lies
(and `planShape` refuses a step due before the one it follows, so this keeps the draft valid by
construction rather than by a later error). Add a step between any two and it lands halfway
between their offsets, which is what "between" means on a spine.

**The one compromise, and the walk that forced it.** Taken literally, "position is the offset as a
fraction of the journey" breaks: day 2 and week 1 land at 6.8% and 8.9% and their labels overlap
into "DAWEEK 1". Making every gap equal would have thrown away the only idea Direction A has, so
positions are proportional **and** spaced — a left-to-right pass pushes anything closer than 11.5%
apart, then scales the run back inside the track. The week-1→month-3 jump is still 25.4% against
11.5% elsewhere, so the unequal gaps survive where they matter. A second walk showed the node
*boxes* still overlapping at a 620px spine (71px of gap against a 92px node), which the first
check had missed by measuring the wrong thing: the spine is 900px minimum now and scrolls inside
its own container, which is the right place for a sideways scroll and is never the page.

**The live preview is on a real donor with the real trigger date**, not on today. A first gift in
October means month 3 is January, and a preview counting from today would be showing a different
journey from the one that runs. A GET that writes nothing — no plan, no steps, no thread.

**The onboarding step** sits after the import, because asking how you look after a new donor
before there is anybody to look after is asking in the abstract. Pick one of five, see it on one
of *your* donors with real dates, done. Skipping leaves **one** calm card on Home — cream, not
brass, because nothing is wrong — and the card re-checks whether a journey now exists, so setting
one up anywhere else makes it disappear rather than linger as a lie.

**Every number on a journey opens its donors**, each with the sentence that defines it, and the
caveat is said by the ROUTE rather than by a caption a redesign could drop: these are counts of
what happened, not a measure of what the journey caused. There is no comparison group, so no
number here can say what would have happened without it.

Battery: 39 suites, 0 failed.

## THREAD-2a — journeys, as an extension of Plans (2026-09-27)

**Two design directions first** (`docs/thread-2/directions/`), pushed inside the timebox so
Jonathan could pick while the engine was built. A · the spine: one horizontal line and the line
is time. B · the playbook: one plain sentence per step, edited in place. The real split is
whether a journey is a *schedule* or a *promise in words* — which is also what decides where it
lands on the donor profile.

**A journey is a Plan with a trigger, and that is the whole design.** BUILD-99 already built
ordered steps that each become a thread, one open at a time, with a partial unique index
enforcing it and a `cultivation_plans_one_active` index enforcing one plan per person. A journey
adds exactly two columns' worth of idea — the event that starts it, and which one wins when a
donor qualifies for two. No new tables, no parallel engine, and every screen that already reads
plans reads journeys for free. Old plans and sequences keep working because there is nothing new
for them to break against.

**One way in.** `maybeStartJourney` is called by all six triggers and by the by-hand apply, which
is what makes "a donor is in at most one journey" true rather than aspirational. It is registered
back to server.js at mount time, because `recordGift` lives there and is the only honest place to
know a gift was somebody's first — requiring crm.js from server.js would be a cycle. A null
engine is a no-op and never a throw: a broken journey must not be able to refuse a donation.

**The priority behaviour falls out rather than being special-cased.** A $25,000 first gift fires
`first_gift` and then `gift_over`; the first starts the welcome journey and the second replaces
it, because major donor (90) outranks the first-year welcome (50). The replaced plan is
*abandoned*, not deleted, and one sentence — written by the shape module, so the stored reason
and the displayed one are the same string — goes on the row and on the donor's timeline.

**THE ONE TEST, and it guards the line that is never crossed.** A journey is the most dangerous
thing in this product to get wrong: it fires on its own, writes seven steps against a real
person, with nobody watching. So the suite runs the whole path — arm two journeys, record a real
gift through `recordGift`, watch seven steps appear, mark one done, skip one, then land a $25,000
gift and watch the replacement — against a **live mail sink**, with the fixture org's mail
switched **ON**, and asserts the sink saw nothing at all. Mail on is the point: proving "nothing
was sent" against an org whose mail is off proves only that the gate works. Planted a send in the
engine and watched §3 and §5 go red.

**Two things the database caught that a test would not have.** `threads_close_honest` refused
`close_kind='done'`: a thread closes as an *outcome naming its interaction*, or a *dismissal with
a reason*, and nothing else. Mark-done is the most tempting place in the product to punch through
that, and the constraint was right — the line is now written as a real interaction first and the
thread closes onto it, which is also what makes a completed step count towards Last contact. And
`tenant-matrix` refused the three new `/journeys/:id` routes for having no cross-tenant probe;
`POST /journeys/:id/apply` reaching another org's journey could start seven steps against their
donors, so that refusal earned its keep.

**A fixture that did not clean up after itself** failed the suite's own second run on
`orgs_pkey`: every org is born with a ledger, and `accounts`/`fin_funds` hold a foreign key, so
the org row could not be deleted. It reads exactly like a product bug.

Battery: 39 suites, 0 failed.

## GTM-1b — after they sign up (2026-09-27)

**Growing past your band is a conversation, not a surprise.** Steward counts active donors after
every import — the count is `pricing.json`'s own sentence in SQL, a distinct non-deleted donor with
a gift *or* a logged conversation inside twenty-four months — and compares it to the band the org
pays for. Over it, one notice is recorded, the admin is told in the product and by email, and the
date attached is at least thirty days out. **It never writes `orgs.plan`, never calls Stripe and
never changes an amount.** That is the whole promise, and it is what the build's one new test
guards; the test was watched go red twice, once with the notice quietly bumping the plan and once
with the thirty days cut to seven.

A second import that finds the same band is the *same* notice — it does not restart the clock or
send a second email. Falling back inside the band withdraws the notice rather than leaving a
warning standing that is no longer true. Dismissing hides the banner and keeps the notice: a price
change somebody has been told about cannot be un-told by closing a card. A legacy Core/Team/Founding
org has no band in the new catalogue and is never measured against one — those organisations bought
a price that was never sold by size, and inventing a band for them would be inventing a bill.

**The Agent's free thirty days allow twenty-five plans.** A paid model on somebody else's key with
no ceiling is an invoice waiting to happen. The unit is the PLAN — the instruction she wrote, which
is the unit she thinks in — counted per org for ever, not per day, and a plan she wrote and deleted
still counts, because it was still a model call and refunding on delete makes a cap advisory. The
check sits ABOVE `agentBuildPlan`: a refusal after the model has answered has already spent the
thing the cap exists to prevent. The cap lifts entirely at `subscription_status = 'active'`.

**Before the import, the Agent shows itself on Harborlight.** An org with no donors opened the
Agent to an empty room and a prompt to write an instruction about nobody. It now shows a worked
example on the demo organisation: real rows read live (so the example cannot drift from what the
demo contains), no model call at all (so the tour costs nothing and spends none of the allowance),
and labelled as Harborlight's by the route rather than by copy a page could forget to render.

**The start page.** The first thing after signing up is a choice, not a form: bring your file, or
look around. Both doors are the same size because both are real answers — an ED who has just put a
card in and wants to see the thing work before hunting for her spreadsheet is behaving sensibly.

**Founding partners keep their $50 on any band.** It used to be a PRICE, and a price cannot follow
an org that grows: the day a founding partner moved off it they would lose what they were promised.
It is a Stripe coupon now (`Gv9E1KkK`), applied at checkout, backfilled from `plan='founding'`.

**The sidebar folds.** 240px to 64px, icons kept — a rail, not a disappearance. Remembered per USER
(the localStorage key carries the user id, so two people sharing a laptop do not fight over it),
⌘\ toggles it, and the panel button says the shortcut so it is discoverable from the button.

**The defect only the browser caught:** the "More" disclosure is a word with a chevron, and 64px of
rail truncated it to "MO…". A rail that is only icons cannot carry a heading, so collapsing now
shows that group's items inline as icons. `navMoreOpen` is untouched, so expanding returns the
sidebar to exactly the state it was left in.

Battery: 38 suites, 0 failed, browser legs running.

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

## FIX-3 — HOME'S BOTTOM HALF AND THE AGENT'S ASK (2026-09-27)
Jonathan walked FIX-2 and found Home's lower half unfinished, the Agent's ask without a go button and reading the whole file for "ada just became a volunteer…", a real name in the demo, a profile that flashed "locked", a suggestion that invented facts, a Reports rail in the wrong groups and a giving summary comparing unlike periods. Five parallel workstreams (A Home, B Agent, C demo, D profile, E Reports) fixed all 14. The profile was rebuilt as Direction 1 after Jonathan picked it from two mockups. Lessons: a first name alone named nobody (the two-word match), so "nobody named" silently meant "everybody"; an unknown plan must be its own state, never "core"; the demo seed never set `stripe_payment_id`, so "online" read $2. The ratchets (test-clock-seam, script-guards) went red only on the merged tree, and CodeQL flagged a LIKE escape on the PR. Handoff: `docs/fix3-lead-handoff.md`.

## FIX-2 — EVERY NUMBER OPENS (2026-09-27)
Jonathan walked FIX-1 and found the dashboards thin and unopenable, Reports with two navigations, the app too green and the Agent a dead end. FIX-2 made every dashboard figure a `<Figure>` with a `source` whose rows foot to it in cents (`figureSources.js`, `GET /figures/:source/rows`, guarded by the census and a footing suite); Reports became one rail with footed, human results; colour became tokens only with one active treatment; the Agent became the Direction 2 run sheet that can be turned on and answers reads without drafting; and one display-date formatter replaced ISO everywhere. It also closed the four CodeQL warnings FIX-1 left (three fixed in code, `hashApiKey` dismissed as a false positive). Five workstreams in parallel worktrees; the merged battery caught two ratchets no single workstream tripped, and the end walk found two defects no suite saw (a chart point hidden under another, a column clipped by an undrawn scrollbar). Merged `7c18bac`, PR #17. Handoff: `docs/fix2-lead-handoff.md`.

## BUILD-99 (major gifts) — MOVES MANAGEMENT ON THE STAGES WE ALREADY HAD (2026-09-25)
**The BUILD-99 label was already used** by a one-off fix (`tests/build99-grant-timeline.test.js`, "a touchpoint you cannot read is not a record"), the way BUILD-98's was used twice — so this build is **BUILD-99 (major gifts)** everywhere, brief committed at `claude/BUILD-99-major-gifts.md`. Built in worktree `~/steward-99`, branch `build-99`, ports 5661/4203. Suites `build99-proposals` (103, browser leg) · `build99-portfolios` (65) · `build99-plans` (69) · `build99-brief` (73) · `build99-dashboard` (46) · `build99-import` (76), all in run-all. Walk `scripts/build99-walk.js` (36, ALL GREEN).

- **THERE IS NO `proposals` TABLE, AND THAT IS THE DECISION (`shared/proposalShape.js`).** BUILD-15's `opportunities` already held an ask amount, an expected close, an officer and won/lost/open — a proposal with fewer columns. A second table would have put two ask amounts on one prospect (one on the profile's "moves & asks" panel, one on a new Proposals screen), and the way those drift is a board report that is wrong — Home read "Portfolio: 16" while the board rendered 3 for exactly this reason (BUILD-30). So it gains six columns and the product's word becomes "proposal"; the table keeps its name the way retired `donors.in_pipeline` kept its column. **`status` STAYS BESIDE `proposal_stage` and `statusForStage` IS THE ONE DERIVATION** — twenty BUILD-15/17/85/86 reads filter on `status`, so the stage is what a person sets and the status is derived from it, with no write path that sets one without the other.
- **BOTH DOORS OBEY ONE RULE, WHICH NARROWS BUILD-15.** `POST /donors/:id/opportunities` allowed several open asks on one prospect; a proposal allows **one open per fund, checked at the HOUSEHOLD** — asking a husband and a wife separately for the capital campaign is the double-ask the rule exists to stop. The rule lives in the WRITE PATH (an `INSERT … WHERE NOT EXISTS`, race-safe) because a bare `CREATE UNIQUE INDEX` would throw on any org holding two open BUILD-15 asks and the server would never boot; the partial unique index is attempted on top and **NAMES the colliding donors in the boot log** when it cannot be created. `tests/moves.test.js` and `tests/permissions-matrix.test.js` were updated with the reason beside each change.
- **PROBABILITY IS A CLOSED LIST SHE PICKS FROM (10/25/50/75/90) AND 63% IS REFUSED, NOT ROUNDED** — a rounded probability is a number the product invented about a person. The weighted total therefore counts only the proposals carrying a probability she set, and **its sentence says how many it left out**; a figure that treated a blank as 50% would be Steward guessing at a gift. Decline reasons are a closed list too, because "why do we lose asks" is the question the screen exists to answer and free text cannot be counted.
- **PORTFOLIOS RE-OPEN NOTHING (`shared/portfolioShape.js`).** BUILD-30 settled that assignment IS the portfolio IS the board; `portfolioMembership` stays the one definition and the suite proves the portfolio's count, Home's card and the board are one number. What was missing: the ORDER (open ask, then days since last contact — and **never spoken to sorts above a long silence**, not as zero days), the target and count cap **she typed** (absent until she does, never a percentage of nothing, and a cap BLOCKS NOTHING), and the ACTOR on the assignment. `PATCH /donors/:id/assign` was checking no org on the officer id, taking the owner's NAME off the payload and recording no actor — all three closed. **"Major prospect" is `orgs.major_prospect_cents`, default $1,000, and the sentence quotes it.**
- **A CULTIVATION PLAN IS A SEQUENCE OF THREADS AND IT SENDS NOTHING (`shared/planShape.js`).** Each step, when its turn comes, IS a BUILD-81 thread. `threads_one_open` is why exactly one step is OPEN and the rest PENDING, enforced by a second partial unique index rather than by hoping. **The chaining self-heals with no tick** (production has none): if the donor already has an open follow-up of their own the step waits and the next close advances it, and the sentence says "Nothing is stuck." A template may only hold a step type the Thread engine knows (asserted against its table) and may not go backwards in time. **Skipping is recorded as SKIPPED**, dismissing its thread with a reason because the BUILD-81 CHECK refuses a close without one. Editing a template does not rewrite an applied plan; deleting one archives it.
- **THE PROSPECT BRIEF'S GUARANTEE IS THE SCHEMA, NOT THE PROMPT (`shared/briefShape.js`).** **There is NO NUMERIC FIELD ANYWHERE IN IT** — the model returns prose and CITATIONS and every figure is rendered by Steward from the rows, so a model that wanted to assert "$50,000 capacity" has nowhere to put it (walked structurally, walker proven able to fail). Every sentence cites a row Steward actually handed over or is DROPPED AND COUNTED; a numeric RULE goes through `shared/thresholds.js` ("lapse after 75 days" refused, her own $12,500 over 5 gifts kept — data is not a claim); and **capacity language with no digit in it** ("good for a lead gift", "net worth suggests") is refused on WHOLE WORD RUNS, with three legitimate sentences asserted to survive. Nothing is dropped silently — the page and the PDF both say how many lines were left out. `GET /donors/:id/brief-rows` is the citation source made visible, and it makes the row gathering provable with no key: a pledge is labelled a promise, a soft credit recognition, a conversation QUOTED. **Whether a real model writes a page worth carrying is NOT drilled in the suite, on purpose** — `scripts/build99-brief-drill.js` (SELF_REFUSING) is that drill and ends with four questions nothing automated can answer.
- **THE DASHBOARD INVENTS NO GOAL (`shared/majorGiftsDash.js`).** Nothing reaches it without a one-sentence definition and the suite checks each tile's definition IS the registry's string rather than a copy. No benchmark, no "organisations like yours"; asked-versus-committed states a plain fraction, never a "close rate". The only target in this build is Part 2's, asserted from both ends. An empty org gets a sentence, not a wall of $0, with all six stage rows still explained.
- **AN OPEN ASK IS NOT A GIFT, AND THE MAPPER CAN NOW SAY SO.** Five new targets plus BUILD-36's existing `owner` surfaced as Portfolio Owner. These ARE claimed by header (unlike BUILD-98's extras) because a mis-read ask writes a row an officer can delete while a mis-read employer writes promised money — every regex anchored and requiring ASK/PROPOSAL/OPPORTUNITY/SOLICITATION, so **a bare "Amount" is never one**. **An open NPSP Opportunity is now a PROPOSAL** (Prospecting→Identified, Qualification→Cultivating, Proposal and Negotiation→Asked) instead of a refusal; **Closed Won is a gift and never a proposal**, and **Closed Lost stays refused** rather than becoming a Declined proposal, because NPSP carries no reason and Steward's Declined requires one. `importProposals` runs post-commit and touches no money — four Opportunities in, four proposals out, ZERO gifts, no lifetime giving moved, nothing on the ledger. A duplicate is skipped and counted, an unreadable stage defaults to Identified and is COUNTED, an unreadable probability is DROPPED. Proposals export from the report builder with all fields; `status` is deliberately not one of them.
- **Gotchas this build paid for:** a **backtick inside a template literal ENDS IT** (a SQL comment saying `orgPeriodBounds` in backticks gave "missing ) after argument list" pointing at the opening line); `SELECT ?,?,…` in an `INSERT … SELECT` has no type context, so every placeholder needs a cast, and a parameter used only in `IS NOT NULL` needs one too; a `DATE` column comes back from pg as a **JS Date at LOCAL midnight**, so `String(d).slice(0,10)` is "Sun Nov 15" and `toISOString()` moves it a day west of UTC — `civilDateOf` reads the local calendar parts (and a test helper made the same mistake in the other direction); `normalizeDate` returns `{value, warn}`, not a string; **a raw-byte search of a pdfkit PDF finds nothing** (Flate-compressed) and an assertion written with an `|| true` escape is vacuous — inflate the streams; and `AGENT_MODEL` was moved to the top constants block because `tdz-scan --all` rightly flagged a read five thousand lines above its declaration, legal only by call order.
- **Two defects found on routes this build did not otherwise touch:** `POST /ai/stream` answered **500** with no `ANTHROPIC_API_KEY` (`new Anthropic()` throws) where `aiGate`'s `ai_no_key` already had the honest word — now 503; and `POST /donors/:id/brief` ran its gate BEFORE the donor check, so a cross-tenant probe got 503 instead of 404 (found by tenant-matrix §3, which is what that suite is for).
- **CI DOES NOT GATE THIS BRANCH.** `.github/workflows/ci.yml` triggers on push/PR to **main** only, so pushing `build-99` runs nothing. The battery below was run locally; CI gates on Jonathan's merge.

## BUILD-98 (switch) PART 8 — TWO-STEP SIGN-IN FOR ADMINS, AND EVERYTHING IN ONE FILE (2026-09-25)
Suite `tests/build98-security.test.js` (30, in run-all; proven able to fail by letting a setup-only session through). Settings → Account → **Sign-in and your data**.
- **`totp.js` — RFC 6238 on Node's crypto, no dependency**, checked against the RFC's own test vectors. A code is accepted one step either side of now and **never twice**: `users.mfa_last_counter` is advanced atomically on every accepted code.
- **The secret is SEALED** (`shared/secretBox`, AAD `mfa:<org>:<user>`), pending until one good code proves the app has it. `STEWARD_CREDENTIAL_KEY` unset → setup answers 503; it never stores a readable secret.
- **Login**: two-step on → the password alone gets `mfa_required`; a wrong code `mfa_invalid`. **`orgs.require_admin_mfa`** (default off): an admin without two-step gets a **setup-only session** — `requireAuth` (auth.js) lets it reach `/me/mfa`, `/me/mfa/setup`, `/me/mfa/enable` and **nothing else** — and `enable` is the one door to a real session. Staff are not swept in.
- **Nobody locks themselves out**: the org rule refuses an admin who has not turned two-step on (409) and staff (403); an admin cannot turn two-step off while the org requires it.
- **Default OFF, on purpose**: requiring it for every admin tonight would put the demo login and every suite's admin login behind a code. Turning it on for an org is one checkbox, by an admin who already has it.
- **`GET /org/export/full` — every table carrying the org's id, found by asking `information_schema`**, so a table added next month is in the export the day it exists. The org's own row first. **Withheld by column name**: passwords, sealed secrets, tokens, hashes, key fingerprints, stored receipt PDFs. Admin only, **never write-gated** (a lapsed org can always leave). The suite asserts every org table is present, no other org's id or marker is anywhere in it (leaf walk, never a stringified search), and no withheld column appears.
- **Not built, and why**: the help centre and videos (content), in-app chat (a provider account), SOC 2 (an attorney and an auditor), an uptime page (a monitoring account), and **the public security page — its sentences are claims about what is and is not true, so they are Jonathan's to write.**

## BUILD-98 (switch) PART 7 — THE FILE PEOPLE STAY FOR (2026-09-25)
Suite `tests/build98-migration.test.js` (87, pure, in run-all; proven able to fail by taking "Refunded" back out of the stage vocabulary). Fixtures + answer key `tests/fixtures/build98-migration/`.
- **`shared/migrationPresets.js` — eight presets on the mapper, never second importers:** Bloomerang, Little Green Light, DonorPerfect, Neon, Kindful, Network for Good, Givebutter, Zeffy (Salesforce NPSP stays in its own module). Each is a table: mapper field → the vendor's documented column spellings, the SIGNALS only that vendor writes (**two must be present; a tie is a question, not a guess**), columns with no home named with a reason, a **checklist of which report to run**, and **what does not come across**. The import screen applies the preset where it recognises the file, keeps the generic guess for the rest, and shows the checklist.
- **One test per preset, in cents and rows**: each fixture goes through the ONE accounted builder and must match its hand-computed key — gifts, cents, the one row that is not money set aside with its dollars, the file equation, and the same person's two gifts on one record. **The key caught a fixture defect on its first run** (an unquoted `$1,000.00` split into two cells) — which is what a key is for; fixtures are read through `analyzeCsvText`, never a naive split.
- **Payment statuses are stage words now**: succeeded/completed/paid… are received; refunded/failed/pending/cancelled/voided/chargeback are set aside by name. **"Partially refunded" is deliberately NOT known** — part of that money stayed, so a human answers.
- **DonorPerfect marks pledges with a one-letter record type** the builder cannot read; rather than teach the shared type vocabulary single letters, the preset's checklist says to filter the report to gifts (record type G) and says what that leaves behind.
- **Every preset is `documented-not-walked`** and the fixtures are hand-built to documentation. The first real export of each vendor is the check; the two-hour migration walk the brief asks for is Jonathan's to run on a call.

## BUILD-100 (grants) PART 7 — THE SCREENS, AND THE LINK THAT WOULD HAVE OPENED THE APP (2026-09-25)
Parts 1–6 shipped the grant machinery with no client beyond the pipeline. Part 7 is the five screens over it. Suite `tests/build100-screens.test.js` (93, browser, in run-all) walks every one at **1440 AND 390** and compares what the screen says with what the API said, never with a string in the test; both plants below were proven to fail it.
- **Grants → Deadlines** (`GrantDeadlines.jsx`): the sentence, twelve months (empty ones shown), every open deadline with the server's timing sentence (and a report-due row's balance), the org's lead times (admin). **A grant's own deadlines** (add, move, done) and **documents** sit on GrantProfile, replacing the "File uploads coming soon" placeholder.
- **HOME SAYS IT AS A SENTENCE, NEVER AS `homeDeadlineLine`** ("3 grant deadlines in the next 14 days" is a numeral under ten on Home). `homeNote.grantDeadlineSentence` → "One grant deadline falls in the next two weeks." `/dashboard/home` returns `grantDeadlinesSoon` counted through **`shared/grantMilestones.deadlinesInWindow`**, the ONE window function the Deadlines screen and the old line also count through, so the two surfaces cannot disagree; the Deadlines screen opens on the same sentence.
- **THE DEFECT PART 7 FOUND: `/grant-documents` WAS NOT PROXIED.** A grant document is a signed bare path opened as a plain link (no auth header), so in prod every link would have returned `index.html` — the BUILD-95 photo class, third time. vercel.json gained the rewrite, and **`tests/email-links.test.js` §4b now DERIVES the bare-path list** from every unauthenticated `app.get("/seg/:param"` the server builds into a URL, so the next one fails CI instead of prod. The walk also fetches the link through the preview and asserts a PDF comes back.
- **The funder on the organisation's own record** (`FunderPanel.jsx`, only when `donor.kind==="organisation"`): type, EIN (a 409 `ein_already_on_file` is a merge, said as one), every grant, a new request, every document across grants. `GET /funders/:id/grants` now carries the `ein`.
- **Finance → Restricted** (`RestrictedView.jsx`): each figure's hover IS `RESTRICTED_METRICS`' definition; **an overspent balance renders NEGATIVE, sign first ("-$5,500")** — `fmtFull` reads "$-4,200" and is pinned that way in finance-funds, so the sign is written at the render site, with `{fmtFull(` kept inline (a wrapper hid the figure from the build97 census, which then counted one fewer number than the screen showed).
- **Import grants** in Donors' Import & tools menu (`GrantImport.jsx`): the same file parser every import uses, the server's preview (writes nothing) with its counts, set-aside rows by line, and what it writes and does NOT write, before the button.

## BUILD-100 (grants) — FUNDERS, DEADLINES, DOCUMENTS, RESTRICTED MONEY, REPORTS, IMPORT (2026-09-25)
**The BUILD-100 label was already used** by a one-off fix (`tests/build100-score-names.test.js`), the way BUILD-98's and BUILD-99's were — so this is **BUILD-100 (grants)** everywhere, brief committed at `claude/BUILD-100-grants.md`. Built in worktree `~/steward-100`, branch `build-100`, ports 5671/4213. Suites `build100-funders` (83) · `build100-deadlines` (68) · `build100-documents` (61) · `build100-restricted` (63) · `build100-reports` (101) · `build100-import` (92), all in run-all CORE.

- **THERE IS NO SECOND `grant_stage` COLUMN, AND THAT IS THE DECISION (`shared/grantShape.js`).** `grants.status` already had a vocabulary twenty places read, so the brief's six statuses are canonical (researching · loi · submitted · awarded · declined · closed) and every older spelling is an ALIAS resolved in ONE place — a legacy row still answers its canonical filter, asserted. **A GRANT IS A REQUEST TO AN INSTITUTION**: `funderProblem` refuses a person at every door, in one sentence that says why (a cheque from an individual is a gift, and counting it as a grant puts it in the wrong half of every report). Probability has no place here and restriction does: unrestricted · program-restricted · capital · time-restricted, and **time-restricted money without its release date is REFUSED** because that date is the whole restriction. Decline reasons are a closed list for BUILD-99's reason — "why do we lose grants" cannot be counted in free text.
- **AN AWARD WRITES EXACTLY ONE PLEDGE ON THE FUNDER AND NO GIFT** (`PUT /grants/:id/award`). The instalments sum to the award through BUILD-88b's ONE schedule writer, so the funder's cheque applies itself from whichever door it arrives through; a second press writes nothing new. **The board report's pipeline and awarded figures are integer cents now** — the NUMERIC migration on `grants.amount`/`received` made `0 + "5000.00"` produce `"05000.00"`, and two grants summed to `"05000.003000.00"`. Six sums were wrong (two server, four client, via ONE `client/src/api.js` boundary) and **none of them threw**; none had an assertion on it either.
- **A DEADLINE IS A THING STEWARD WATCHES, NOT A DATE ON A ROW (`shared/grantMilestones.js`).** Five kinds with the brief's lead times (LOI 30 · proposal 30 · decision 0 · report 21 · renewal 45, `orgs.grant_lead_days`, per org). A milestone inside its lead becomes a BUILD-81 THREAD on the funder, owned by the grant's officer, due on the MILESTONE's date. **`threads_one_open` is why the model has three states** — pending, waiting, raised: a donor already holding an open thread makes the milestone WAIT, the next close advances it, and the sweep re-reads both pending and waiting every pass, so **it self-heals with no tick** (production has none) and `waitingSentence` means the state does not read as a bug. Moving the date moves the thread (`original_due_date = COALESCE(original_due_date, due_date)`, BUILD-81's snooze semantics) — **`threads` has no `updated_at`, and writing one 500'd the route while the thread went on pointing at a deadline that had moved**.
- **A PARTIAL LEAD-TIMES SAVE MUST NOT RESET THE OTHER FOUR.** The first fix merged the patch over the stored values and was still wrong, because `normalizeLeadDays` fills from DEFAULTS — so a REFUSED value fell through to the default rather than leaving the org's own choice standing. `pickLeadDays` takes only keys that are PRESENT and VALID, so `{...stored, ...pickLeadDays(patch)}` can never overwrite a good stored value.
- **A GRANT'S FILES RIDE THEIR OWN SIGNED DOOR, WITH THE KIND INSIDE THE HMAC (`grantDocs.js`).** Reusing the photo signer would make the KIND the only thing separating a headshot's link from a signed funder agreement's, and that separation would live in the route rather than in the signature. **Thirty minutes, not twelve hours** — a document link is clicked once, deliberately, and a signed agreement carries bank details and a signature. Attachment-only + nosniff, **the first BYTES decide the type** (no svg, no html, a .txt that opens like markup is refused), 20 MB decoded — **and that cap and the 30mb body parser are ONE DECISION IN TWO PLACES**, named as such, because BUILD-96 moved one without the other and got a PayloadTooLargeError surfacing as a bare 500. Versions are DERIVED from upload order, never a column; `collectLiveAssetRefs` gained `grant_documents`, **without which the 90-day sweep destroys a signed agreement**, proven end to end through the real purge route with a 200-day-old asset.
- **`remaining` IS RECEIVED MINUS SPENT, AND THE DEFINITION SAYS WHY (`shared/restrictedMoney.js`).** Money a funder has promised but not paid is not in the bank and cannot be spent, so counting it would overstate the restricted balance by exactly what is still owed — and an org spending against that figure would be spending money it did not have. `outstanding` is its own line. **Overspent is said out loud, never clamped to zero**: spending more against a restricted award than the funder has paid is precisely the finding the screen exists to surface. **THE WIRE**: a payment against a restricted award posts to the GRANT's fund, in `recordGift`, before the unrestricted fallback — so restricted revenue lands restricted from every door.
- **FIVE SAVED REPORTS, AND THE TWO COMPUTED ONES READ THE SAME FUNCTIONS THE SCREENS DO.** `shared/reportBuilder.js` gained a `grants` entity (16 fields, every one compiled as a column and a group with no `?` surviving into the SQL); grants-pipeline, grants-by-funder and grants-awarded-vs-requested are builder definitions, grant-deadlines-90 and grant-restricted-balances are handlers calling Part 2's and Part 4's own functions. A second query would be a second computation that could disagree with the screen — asserted to agree on the restricted total in cents and on which deadlines are due, **date for date**.
- **THE REPORT OUTLINE'S GUARANTEE IS THE SCHEMA (`shared/grantOutline.js`), AND AN OUTCOME CLAIM IS REFUSED WHATEVER IT CITES.** No numeric field anywhere in it (walked structurally, walker proven able to fail), so every figure a reader sees is rendered by Steward from the rows. A grant report is exactly where a fluent model invents an outcome, and Steward holds none — nobody has entered attendance or results — so **there is no row that could ground one** and a gift row standing behind a sentence about a showcase is not evidence. **The first cut of that rule had no teeth and the suite showed it**: it refused an outcome only when the line cited nothing, which the cited-nothing rule already refuses, so the check changed the wording of a refusal and nothing else. Because an unconditional refusal costs a real sentence when it misfires, three phrases were deliberately left OUT — a bare "reached", "increase in", "as a result" — each of which would have refused arithmetic over the rows. **A document row says "Steward has NOT read this file"**, because Part 3 parses nothing and a model with a filename will otherwise quote a proposal nobody read. **The figures are STORED, not recomputed** (BUILD-87 Part 1): a payment next week must not change what an outline drafted today says the funder had paid.
- **A FUNDER IS AN ORGANISATION, AND AN IMPORT'S NAME MATCH MAY NOT LAND ON A PERSON (`shared/grantImport.js`).** A preset on the mapper, never a second importer (the 89d rule, fourth application). An institution's name is often a person's name, and matching "The Margaret Chen Trust" to Margaret Chen's own record would put institutional money on a human being's giving history, permanently and invisibly — so such a row is **REFUSED BY LINE** with the fix named and nothing written. **EIN beats name**, `donors.funder_ein` arriving with the partial unique index that makes that a fact rather than a hope. **AND THE ENTITY TYPE IS PART OF THE NAME**: the first name key stripped "foundation", "trust" and "fund" along with "Inc.", which made the Sunrise Foundation and the Sunrise Trust ONE funder. **An imported file is history and raises nothing** — no gift, no pledge, no deadline watched, no follow-up, each asserted at zero — and an awarded row gets no pledge, because a historical award already had its cheques. **What an "Amount" column MEANS is decided by the spelling that matched**, not by the vendor: "Amount Requested" on an awarded row demotes it to submitted and counts it, a plain "Amount" on a Closed Won opportunity IS the award. Four vendor presets (NPSP · Bloomerang · Instrumentl · Submittable), each detected from TWO of its own columns and each declaring its confidence, so a wrong spelling is one line and a suite that fails by name.
- **A DECLINE WITH NO READABLE REASON DOES NOT GET `no_reason_given`** — that key is a claim about what the funder said, and Steward can only say the file did not carry one. `other` plus the note, and still countable.
- **Gotchas this build paid for:** **pg serialises a `timestamptz` to a JS Date and `String(date)` is "Thu Sep 25 2026 …", which sorts lexically by WEEKDAY NAME** — both the document version numbering and the funder's newest-first list sorted on it, so "proposal #1" and "#2" were assigned by the day of the week (fixed by normalising to ISO in one place, proven by reverting). **A change to a `shared/` module the server dynamic-imports is invisible to a suite until the SERVER is rebooted** — a prove-able-to-fail run came back green with the defect planted. `testMode` is a FUNCTION in server.js, not a const. Requiring `assetStore.js` inside a test opens a second pg pool with no SSL config ("The server does not support SSL connections") — drive the real purge route instead. A literal control-character regex in source makes the Bash tool refuse the command (`\x00-\x1f\x7f`). `PUT /funders/:donorId` read `req.body.funderType` whether the key was present or not, so a body carrying only an EIN was refused for a bad funder type. And `tests/tenant-matrix.test.js` needed FOUR new `bResolver` entries (`msId`, `docId`, `spendId`) plus `grant_spend`/`grant_milestones`/`grant_documents` in the reset list **ordered before `grants`** — both cascade from grants, but `grant_id` is nullable, so a row without one would block the org delete.
- **What the suites found in my own work, not the product's:** a test asserting the report lead time was 30 when it is 21 (rewritten to test the better property — that a refused value leaves the stored 45 standing), and a ledger lookup reading `pay1.body.id` where the gift route answers `{gift, donor, pledge}` — inspected the rows with `KEEP=1` BEFORE touching the product, and the wire had been right all along. **A catch may not blame the data for a bug** (BUILD-84's rule) applies to a test too: a red assertion is not evidence of a product defect until the rows have been read.

## BUILD-101 — MEMBERSHIPS (2026-09-25; branch build-101, worktree ~/steward-101)
Brief `claude/BUILD-101.md`. **A member is not a donor even when the same person is both; a membership PAYMENT is a gift and nothing else.**
- **PART 1 — LEVELS AND MEMBERSHIPS.** Suite `tests/build101-memberships.test.js` (28, in run-all). `shared/membership.js` is the pure half (validateLevel, fmvSentence, civil-date `expiryFor`: 12 months from 15 March runs THROUGH 14 March, 29 Feb + 12 months ends 27 Feb, calendar year ends 31 Dec, lifetime has none). **FMV > price is refused at the route AND by a CHECK on `membership_levels`** (the BUILD-98 event-level rule); FMV is the org's number and Steward never estimates it; $0 FMV is said in a sentence ("receipts will call the whole $100 deductible"). Prices are admin-only.
- **ONE CURRENT MEMBERSHIP PER PERSON IS THE DATABASE'S RULE** — partial unique `uq_memberships_current (org_id, donor_id) WHERE status IN ('active','grace')`. `enrollMembership` CLAIMS the membership row FIRST, so the index refuses a second one before any money is written (409 `membership_current`, "Renew it rather than adding a second"); if the gift then fails, the claim is released.
- **THE PAYMENT GOES THROUGH `recordGift`** with `quidProQuoValue` = the level's FMV, so the existing receipt states the deductible split with no new renderer ($100/$25 → receipt deductible $75), and membership money and donation money are the same ledger rows. A retried payment rides `gifts.idempotency_key` and returns the same membership.
- Surfaces: `MembershipPanel` on the person's record beside giving (hidden for an org that sells no levels); **Fundraising → Members** (`MembersView`: counts by status, levels with current/lapsed counts, members sortable by expiry). A level somebody has held can be retired, never deleted (409 `level_in_use`). Cancel is never write-gated and never refunds (a refund is its own act on the gift).
- **PART 2 — RENEWALS.** Suite `tests/build101-renewals.test.js` (43, browser leg included, in run-all). **Status is DERIVED from the dates** (`MB.statusOn`: active → grace for `orgs.membership_grace_days` → lapsed); `processMembershipRenewals` (hourly, the pledge-reminder timer family; `POST /memberships/run-sweep`, a pinned `today` only under TEST_MODE) writes it down and opens **ONE renewal thread** per membership expiring inside `orgs.membership_renewal_days` — label "Renew Maya's Family membership, expires 14 March", step `membership_renewal`, note drafted on `threads.draft_note` in the org's voice (`membershipRenewalDraft`), **sends nothing**. Recorded against THAT expiry (`renewal_thread_for`), so a second sweep, or a thread she dismissed, is never reopened for the same date; `threads_one_open` means a person with a thread already open is tried again next sweep. **A date already past never opens a thread** (an imported membership is history). Deceased / do-not-contact / do-not-solicit get none.
- **`renewMembership` IS THE ONE RENEWAL**: the old row becomes `renewed` (a status, so the one-current index still holds), the new row points back (`renewed_from`) and **starts the day after the OLD expiry** while current or in grace — paying early never costs a member time — or today once lapsed; advisory-locked per person; the renewal thread closes as an OUTCOME on the payment's own timeline line. **From any door**: inside `recordGift`, a gift of EXACTLY the level price from someone whose membership is due (in window or grace) IS the renewal and takes the benefits split; a near miss is a gift (the pledge-instalment rule). A payment that already states its quid pro quo, an instalment, and a recurring charge are never read as one.
- Home's note gains ONE sentence, only when non-zero: "Six memberships expire this month." (`membershipSentence`). A lapsed member is never in LYBUNT and a lapsed donor never in lapsed members (asserted). Settings merge over the STORED values. **Found by the walk:** the profile's history compared rows by object identity, so the membership a person holds was listed again beneath itself.
- **PART 3 — LAPSED MEMBERS ARE THEIR OWN LIST.** Suite `tests/build101-lapsed.test.js` (16, in run-all). `GET /memberships/lapsed` + the Lapsed view on Members: who, last level, when it lapsed, years as a member (the terms they held), and whether they still give (**a gift that was not a membership payment** — so someone can be a lapsed member and a current donor at once, shown as both). **A lapsed member is a PERSON, once**: `LAPSED_MEMBER_SQL` = their latest membership lapsed AND they hold none now — the one predicate behind the count, the list and `?status=lapsed`, so a rejoined person is never counted. **Drift, LYBUNT and SYBUNT never read `memberships`, and the suite proves it byte for byte** (each snapshotted before and after the membership rows land, with Drift shown non-empty so the comparison compares something); the lapsed list never reads them either.
- **PART 4 — SELLING IT ONLINE.** Suite `tests/build101-online.test.js` (22, own Stripe mock on STRIPE_MOCK_PORT, in run-all). `/give/:slug?membership=<levelId>` (`MembershipPage` in Donate.jsx, the `?event=` shape) states the benefits and the deductible part BEFORE she pays; `GET /org/:slug/membership/:levelId/public` shows what a flyer would and nothing about who holds it. **`/donate` prices from the LEVEL** (the page's amount is ignored), no fee gross-up, one-time or **auto-renew = a yearly recurring subscription, 12-month levels only**. The webhook **re-reads the level org-scoped** from `metadata.membership_level_id`, or — for a renewal charge that carries no metadata — from **`recurring_subscriptions.membership_level_id`**, stamped at `checkout.session.completed`. **`attachOnlineMembership` is the one step, keyed on the GIFT under a lock**: the first charge and the checkout event for a new auto-renew membership arrive in EITHER order and produce exactly one membership (payment-first is attached by the checkout, which finds that gift). A buyer who already holds one is RENEWED from the old expiry; year two's charge extends it. **A failing membership card rides the existing dunning and card-expiry machinery unchanged**, and the membership's own dates decide its status. Members → each level has a "Copy join link".
- **PART 5 — DIRECTORY, CARD AND REPORTS.** Suite `tests/build101-reports.test.js` (24, in run-all) reconciles every report to a HAND count of its fixture in cents. Six `REPORT_HANDLERS` keys on the one CSV layer (`reportToCsv` + `sendReportCsv`, injection guard included): `members-directory`, `members-by-level`, `members-expiring` (60 days), `members-lapsed`, `members-new-renewed` (a membership counts in the month of the payment that bought it, or its start month without one), `membership-revenue`. **Membership revenue and donation revenue are TWO columns, summed in the database in cents, and never one "revenue" figure** — together they are every gift, each once (asserted). A membership payment is a gift a membership points at (`MB_GIFT_SQL`); everything else is a donation. Five of them join `STANDARD_REPORTS` (now 18; build98-reports' count moved with the reason beside it), so a saved report and the Reports CSV are one computation. **The member card** (`GET /memberships/:id/card.pdf`) is one page — a wallet-sized panel with the letterhead, name, level and expiry — on the ack-letter pdfkit pattern. Members gets Directory CSV and Print; the profile gets "Member card (PDF)".
- **PART 6 — IMPORT.** Suite `tests/build101-import.test.js` (31, browser leg included, in run-all). **Presets on the ONE mapper, never a second importer**: `shared/membershipImport.js` holds four (plain spreadsheet · NPSP Opportunity · Bloomerang · Little Green Light, the last three "documented-not-walked"), the header words for level / member-since / start / expires, and `buildMembershipRows` (every unreadable row set aside with its LINE). A bare "Level" is claimed only beside a membership DATE column. The four fields are first-class donor-mapper targets (auto-mapped when `membershipColumns` recognises the file, never a custom-field prompt), the shape detector counts them as evidence of **one row per person**, and the memberships ride the **LAST chunk** of `/donors/import-combined` so every person already exists. `importMemberships`: person by EMAIL exactly, else by name (oldest record); **level matched case-insensitively to the org's own; an unknown level is HELD by line and never created**; status from the dates; **history only — no gift, no ledger row**; a re-run adds nothing. The brief's "50-row fixture … holds the two unknown" is read as **52 rows: fifty placed, two held** (lines 17 and 40). **The file is generated from today** by one rule, because the renewal window is a fact about today. **Found by the browser leg:** the receipt treated "import extras exist" as "a column ledger exists", and a membership file (extras, no ledger) crashed it into the error boundary. Fixed at the guard, and the leg now listens for the boundary's console line, because a swallowed crash raises no page error.

## BUILD-98 (switch) PART 6 — A KEY THAT OPENS ONE ORG, READ ONLY (2026-09-24)
Suite `tests/build98-api.test.js` (27, in run-all; proven able to fail by planting a revoked key that still opens). Settings → Integrations → **API keys** (admins only).
- **A key is shown ONCE and stored as its SHA-256** (`api_keys`); the list carries a name, a prefix, who made it and when it was last used, never the key. **Read scope only** in this build. **Revoking keeps the row**, is never write-gated, and a revoked key answers the SAME 401 body as one that never existed.
- **TWO DOORS, TWO LOCKS.** `requireApiKey` guards `/api/v1/*` and nothing else; `requireAuth` never accepts a key and `requireApiKey` never accepts a staff JWT. **The org comes from the key's STORED ROW** — an `org_id` in the query or an `X-Org-Id` header changes nothing (BUILD-37 B9).
- `/api/v1/me` (the Zapier auth test) · `/api/v1/people` · `/api/v1/people/:id` · `/api/v1/gifts`. Lists are **newest first with an id**, which is exactly a Zapier POLLING trigger ("new person", "new gift" — Zapier dedupes by id), so no webhook subscriptions were needed for the first triggers. Anything else under `/api/v1`, including a write, falls through to the app's one 404. Limit capped at 100; own rate limiter keyed by the key's fingerprint.
- **A wealth screen (DonorSearch / iWave) SURVIVES AN IMPORT**: `donors.wealth_screen_source/rating/capacity/date`, all TEXT and **kept as the vendor wrote them** (a capacity is usually a range). Mapped on the CSV transaction path (`txMap.wealthRating/Capacity/Date`, `WEALTH_HDR` in importShape.js) and the workbook path (three standard fields); written for new people in import-combined's savepointed batch. **A bare "Score" or "Rating" is not claimed** — it needs a vendor name or "wealth" in front. **It never feeds Steward's own `wealth_score`.** The donor-only aggregate path (`/donors/import`) does not carry them yet.
- **Not built, and why:** QuickBooks posting (gated on Jonathan's walk), Mailchimp/Constant Contact audience sync and NCOA (each needs a real account — BUILD-91: nothing reaches the marketing page until proven on one), Zapier ACTIONS (write scopes — the read API is the trigger half), the published Zapier app itself (needs a Zapier developer account).
- **Gotcha:** a REGEX route (`app.all(/^\/api\/v1.../)`) breaks `scripts/build75-route-inventory.js`, which splits string paths. Let the final 404 handler answer instead.

## BUILD-98 (switch) PART 5 — VOLUNTEERS AND HOURS (2026-09-24)
Suite `tests/build98-volunteers.test.js` (31, browser leg included, in run-all). A Volunteering panel on the profile; "Import volunteer hours" in Donors' Import & tools menu.
- **`shared/volunteerHours.js` — HOURS ARE COUNTED IN HUNDREDTHS, summed as integers**, so ten shifts totalling fifty hours read exactly 50, never 49.99999. **A shift is more than zero and at most 24 hours** (route AND a CHECK on `volunteer_shifts`) — a 40-hour "shift" is a week typed into one row.
- **ONE PERSON, TWO ROLES.** Logging hours marks the person a Volunteer on the SAME record (BUILD-94's `person_types`); a volunteer who gives is already made a donor by `recordGift`. Never a second row. Merge moves shifts to the survivor.
- **The volunteer's own link is COPIED by staff, never sent by Steward.** `/volunteer/log?token=` is an HMAC over org + person + expiry (180 days). **The GET renders and changes nothing**; the form POSTs. A tampered or re-pointed token is the same 404. Proxied through vercel.json before the SPA catch-all.
- **Wranglr and VolunteerHub are PRESETS on a small mapper, not integrations** (the column spellings are documented-not-walked, the NPSP confidence note). An imported shift has a KEY (who, day, hours, role) with a unique index, so the same export imported twice adds nothing; every refused row is named by line. A person the file names who is not on file is created as a **Volunteer, never a donor**.
- **Hours are a column and a filter in the report builder** (`volunteer_hours`), and **"Volunteers who give"** is a standard saved report (thirteen now).
- **Found on the way, fixed:** the donor profile auto-fires an AI "next move" stream on open (since the MGO toolkit), and a failed stream threw out of an async handler — an unhandled rejection on every profile open and a spinner that never stopped. It now says so in the panel. The auto-fire itself (a model call per profile view, since the MGO toolkit) is left as it is; firing only when "Next Move" is pressed is the recommended change and is Jonathan's call.

## BUILD-98 (switch) PART 4 — THE DONOR SIDE OF A GALA (2026-09-24)
Suite `tests/build98-events.test.js` (36, browser leg included, in run-all). Fundraising → **Events**; public tickets at `/give/:orgSlug?event=<id>`.
- **`shared/eventShape.js` — A TICKET IS A GIFT THAT BOUGHT SOMETHING, AND THE RECEIPT SAYS SO.** A $150 ticket to a $60 dinner is a $150 gift (what she paid, what the org received — totals, Drift and the ledger see $150) of which $90 is deductible. Levels (`event_levels`) carry price and fair-market value; **fmv > price is refused** at the route AND by a CHECK constraint (a negative deductible is a typo, not a tax position).
- **`recordGift` gained `quidProQuoValue`/`quidProQuoDesc`** and writes `deductible_amount`/`quid_pro_quo_*` in THE one insert — so the EXISTING receipt path states the split with no second receipt renderer. Every other gift passes neither and is unchanged.
- **An unpaid sponsor is a PLEDGE (with one instalment), never money**, and closes itself when the cheque arrives through any door. Recognition lines are the org's template (`{{name}}`), read back on the guest list for the programme.
- **Online tickets ride the existing donate route**: `eventLevelId` + `quantity`, and the SERVER prices them from the level — the page's amount is ignored, tickets are one-time with no fee gross-up, capacity is checked. The webhook re-reads the level (org-scoped, never trusting metadata amounts), writes the split on the gift and the guest-list row. **The public page is `?event=` on the giving page, not a path segment** — `/give/:org/:page/:fundraiser` would have swallowed it.
- **Attendance lands on each person's timeline ONCE** ("Came to…" / "Registered for … and did not come"): both the new attendance route and the old attendee PATCH claim `event_attendees.attendance_logged_at` first, so saving the list twice writes nothing twice.
- **The old Events tab stays hidden** (off-palette, pre-pivot); this is a new, on-palette surface over the same `events`/`event_attendees` tables. Not a ticketing system: no seat maps, check-in scanning, transfers or waitlists (the brief's own line), and a ticket refund is a gift refund through the existing `charge.refunded` path.
- **Decisions (moved here when the BLOCKED files were retired):** tickets sell as a giving-page MODE (`?event=`), not a page-builder widget; the widget is the fuller version, worth building once an org actually sells tickets that way. **Fair-market value is the org's number**: Steward records it and never estimates it, and an org that leaves it at $0 gets receipts that call the whole ticket deductible (wrong for a dinner), which every level surfaces as "worth $X, so $Y deductible".

## BUILD-98 (switch) PART 3 — REPORTS PEOPLE CAN BUILD (2026-09-24)
Suite `tests/build98-reports.test.js` (36, browser leg included, in run-all). Reports → **Your reports**.
- **`shared/reportBuilder.js` — A FIELD IS A NAME FROM THE CATALOGUE, NEVER A STRING OF SQL.** Five entities (people · gifts · pledges · recurring · conversations), each field a key with SQL written by the module; every value a bound parameter; custom fields by key only (`/^[a-z][a-z0-9_]{0,59}$/`, the one place a name becomes SQL, fenced). A definition naming anything else is REFUSED, which is what makes a saved report safe to store, share and schedule. And/or groups nest **3 GROUPS deep** (conditions inside a group do not count — the first cut counted them and refused a legal 3-deep filter).
- **The compiled SQL carries its own `$n` and must contain no `?`**: db.js's `query()` rewrites every `?`, so one inside the SQL would bind a value to the wrong slot. `compile()` refuses it, and the suite compiles EVERY catalogue field as a column and a filter to prove none does.
- **THE TWELVE (`STANDARD_REPORTS`) READ THE SAME FUNCTIONS THE SCREENS DO.** LYBUNT, SYBUNT, top 50, retention and gifts-by-month call `REPORT_HANDLERS` (shaped by the same `reportToCsv` the Reports CSV uses), so a saved LYBUNT and the Reports tab's LYBUNT are one computation — asserted against a hand count. The rest are builder definitions with `{{fyStart}}`/`{{twoYearsAgo}}` resolved on the org's calendar at run time, so a saved "this year" is this year.
- **Totals are summed in the database over exactly the filtered rows**, never re-added from a capped page. Private by default; **shared** reads for the org, **only the owner edits**. CSV (the one `sendReportCsv`) and PDF.
- **Weekly email: Monday morning org-local, ONCE per report per week** — `saved_report_sends` is reserved before the send and released if it fails (the digest discipline). Staff mail to the owner, branded, no donor footer. Its ONE link is `/dashboard?report=<id>`, a GET that opens the report and changes nothing.
- **Found by the walk, and it would have shipped:** opening Reports STRAIGHT onto Your reports — exactly what the email link does — crashed the tab, because the page's parameter builder read `.year` off a default period not yet loaded. Clicking in worked, so only a first render showed it. Now a committed browser assertion, proven to fail without the fix.
- **The number census could not see a new screen file** — its scan list is explicit, so a new component was neither counted nor excluded. `tests/build97-numbers.test.js` now fails on any component or page in neither list (proven with a planted file), and the eleven pages that were in neither now carry their reasons.

## BUILD-98 (switch) PART 2 — ACKNOWLEDGMENTS AND LETTERS THAT PRINT (2026-09-24)
Suite `tests/build98-letters.test.js` (31, in run-all). Fundraising → **Acknowledgments**.
- **`shared/ackLetter.js` is the rule, three parts**: an unknown merge field is **refused at SAVE** with every bad token named (`{{frist}}` printed forty times is the failure); a field with **no value is NAMED, never printed blank** — that donor's letter is left out and the batch says why; the amount is **the gift rows', summed in integer cents**, one letter per DONOR listing every gift in the batch.
- **The backlog is the org's own N** (`orgs.ack_backlog_days`, default 7): gifts not marked thanked, older than N days, non-sample. The count carries its sentence.
- **`POST /acknowledgments/letters/pdf`** — ONE PDF, one page per donor, letterhead, date, and the address block at the **#10 double-window position** (`ACK.WINDOW`, 2" down, 7/8" in); a long letter is cut at the page, never spilled. `/letters/preview` is the same set as JSON with the skipped and why. **Labels** are Avery 5160, one per donor, and read the ADDRESS only — a template a gift cannot fill never costs somebody their envelope. **Printing changes nothing; `POST /acknowledgments/mark {giftIds, via}` is its own press** and stamps `acknowledged_by/_name/_via` + `acknowledgement_sent_at` **once** (the first stamp is kept), and closes the matching 88b drafted thank-yous so nobody is thanked twice.
- **Left out of a batch, by name**: a deceased donor (the family is thanked by hand), no postal address, a field with nothing to put in it. **A letter is signed by the org's receipt signer, otherwise by the person printing it** — never unsigned (the walk found every letter refused on an org with no signer set).
- **Only a template MARKED default stands in for "no choice"**; otherwise the built-in letter. Taking whichever saved template came first printed the wrong letter (found by the suite).
- **"Who thanked them" is the user's NAME, not `actor(req).name`** — that is the login email, an audit stamp, not a signature.
- Year-end statements were already right (BUILD's receipt path, IRS language + EIN); the suite pins that one foots to the donor's gifts in cents.

## BUILD-98 (switch) PART 1 — SOFT CREDITS, TRIBUTES, MATCHING GIFTS (2026-09-24)
**The BUILD-98 label was already used by the photos build (8feaf60), so this build's files carry `-switch`: brief `claude/BUILD-98-switch.md` (committed this time — BUILD-96's never was, and is lost), decisions `the commit messages for BUILD-98 (switch)`.** Suite `tests/build98-credit.test.js` (49, in run-all). Built in a separate worktree (`../nonprofit-erp-b98`, branch `build-98`) because another session was running BUILD-96 on main in the same tree — **two sessions in one working tree cost this build two reverts and a stash; use a worktree.**
- **THE RULE (`shared/giftCredit.js`): A GIFT IS COUNTED ONCE, ON THE PERSON WHOSE MONEY IT WAS.** A soft credit is a ROW POINTING AT A GIFT (`gift_soft_credits`, amount or percentage, ≤ the gift, never the giver themselves, UNIQUE per gift+person). Nothing that totals money reads it: `gifts.amount`, `donors.total_giving` and `fin_transactions` are untouched, so the ledger posts once and the bookkeeper export is hard credit by construction. The profile shows **Their own giving** and **With soft credit** side by side (census entries `profile.creditHard`/`creditWithSoft`); reports are hard unless `?credit=soft`, which adds a separate column and never changes a total or a rank. The existing HOUSEHOLD soft credit (BUILD-14) is a different lens and stays separate.
- **EXTRAS ARE CHECKED BEFORE THE GIFT IS WRITTEN** (`checkGiftExtras`): a refused soft credit refuses the gift, a foreign id is 404 with nothing planted. They are written in `recordGift` (`o.extras` → `writeGiftExtras`), so every door lands them the same way; `PUT /gifts/:id/extras` adds them after the fact.
- **TRIBUTE**: `gifts.tribute_type/tribute_donor_id/tribute_name`. The honouree is a record when there is one and a NAME when there is not — an import never invents a record for a memorial. A notify name/email/address writes ONE `tribute_notices` draft per gift. **Steward never sends it, and the notice module is handed no amount, so it cannot state one.**
- **MATCH**: the expected match is a PLEDGE on the EMPLOYER's record (`pledges.is_match`, `matches_gift_id` unique) with one instalment, so recordGift's existing instalment rule applies the employer's cheque from any door and closes it in cents. **A match pledge is excluded from the late-pledge thread, the late count and both pledge-reminder queries** — Steward never chases a company about its matching programme. A match already on file (same amount, on/after the gift) is linked at creation, which is what makes an imported file with both rows close correctly.
- **IMPORT**: the mapper gains `softCreditName/softCreditAmount/tributeName/tributeType/tributeNotify/matchEmployer` (anchored header regexes: "Tribute" alone is the honouree's name, its type always says "type"). Carried as NAMES and resolved AFTER the import transaction commits (`importGiftExtras`): a soft-credited person not on file is created, an employer is found or created as an organisation. The NPSP preset maps NPSP's tribute and matching fields; **there is no Bloomerang preset yet** (Part 7) — BLOCKED §1.1.
- **Merge** reassigns soft credits (primary wins a conflict), tribute notices, honouree and employer pointers, and deletes a soft credit that merging turned into self-credit.
- **Gotchas:** a variable collected inside `withTransaction` and read after it must be declared OUTSIDE it (the import 500'd on `pendingGiftCredit is not defined`); a browser/API suite run against a non-default server port needs `SINK_PORT`/`STRIPE_MOCK_PORT`/`BILLING_MOCK_PORT` matched, or email-driven suites (org-blindness) fail looking like product bugs.

## BUILD-94 PARTS 4 + 5 — BULK MAIL THAT BEHAVES, AND A CALENDAR SHE ALREADY HAS (2026-09-22)
**Part 4 — what Mailchimp did that Steward now has to do.** None of it optional, all of it before her first campaign goes out of Steward.
- **A GET NEVER CHANGES STATE, and `/unsubscribe` was breaking it** in the one place it costs a real person something: it unsubscribed ON GET, so every corporate link scanner, mail-client prefetcher and safe-links proxy was silently unsubscribing people who clicked nothing. **GET now RENDERS** — naming the organisation, because "unsubscribe from what?" is unanswerable for someone on four nonprofits' lists — **and one button POSTs.** No login. The RFC 8058 one-click POST was already correct and lands on the same line; a mail client gets a bare 200, a person gets a page.
- **`do_not_email` was a column nothing read.** Imports had written it since BUILD-77 and `donorMailDecision` never consulted it — a flag that changes nothing is worse than no flag. It is now read in **the one place that decides whether anything may be sent**, beside the new `email_unreachable` (a fact about the ADDRESS, not a preference, so it blocks **transactional mail too** — a receipt to a dead mailbox is a bounce, not a receipt).
- **Bounces and complaints mark the person.** Hard bounce → unreachable with **the date and the reason on the profile**; complaint → unsubscribed. Both write a timeline line, because "why did we stop emailing them" has to be answerable. **THE ORG COMES FROM THE VERIFIED ACCOUNT MAPPING, NEVER THE PAYLOAD** (BUILD-37 B9): the From address is looked up against sending domains *we* verified, exactly one match or nobody — a shared-domain From identifies Steward, not a tenant, and guessing marks the wrong person. The global suppression (the reputation half) happens regardless. Endpoint setup: **MANUAL-STEPS §10**, fifteen minutes, and `email.opened` is deliberately NOT subscribed.
- **NO ADDRESS, NO SEND** — a refusal, not a warning, on campaigns, scheduled campaigns and sequences alike. A warning somebody dismissed is how an org sends 4,000 unlawful emails; the fix is ninety seconds in Settings. A sequence with no address **HOLDS** (nothing consumed, nothing failed) so the day she types it the whole queue goes; a scheduled campaign goes back to **draft**, where she left it.
- **The sent list carries delivered, opened and unsubscribed — COUNTS ONLY.** Nothing per person, anywhere. The decision and its reasoning are in `steward-data-handling.md`; turning per-person opens on is a data-handling change and a line in the customer agreement, not a switch.
- **Scheduling is a real date-and-time field in the org's own timezone.** `orgTime.localToInstant` is the new seam: a `datetime-local` input carries no zone, and handing its string to a `timestamptz` made Postgres read it in the SERVER's zone — **9:00 typed in Chicago was stored as 9:00 UTC and would have gone out at four in the morning.** Two-pass conversion, verified across both DST boundaries. An explicit instant (Z or an offset) is still honoured exactly.

**Part 5 — put it on my calendar.** She uses Microsoft. No OAuth, no Azure app, no sync: Outlook and Google are **deep links to their compose screens**, plus a server-generated `.ics`. All three come from **ONE builder**, so the subject and the start time cannot disagree — the property the suite pins, because three code paths producing three slightly different appointments is exactly how this rots.
- **THE UID IS STABLE PER TASK, FOREVER** (`steward-<org>-<task>@stewardapp.dev`). An `.ics` with the same UID is an **update** to the event already in the calendar; a UID derived from the time, or a fresh one per download, silently leaves two appointments behind — which is worse than no button. Moving the step keeps the UID and moves the time.
- A step with **no time is an ALL-DAY event** — inventing 9am puts a fictional appointment in somebody's morning. `DTEND` is the next day (RFC 5545 makes it exclusive), lines are folded at 75 octets (Apple Calendar refuses otherwise), and `;`/`,` are escaped.
- The body carries the **last logged line** and a plain-text pointer back to the record. **A URL in a calendar body is fine** — the CRM's no-links rule is about the CRM's own screens, and an entry you open on a phone three days later is exactly where a way back earns its place. `NOT_SYNC_NOTE` ships inside the menu: a button reading "put it on my calendar" is otherwise read as sync, and the disappointment arrives three weeks later.

- **Gotchas these parts paid for:** **editing `tests/run-all.sh` while it is running corrupts bash's read of it** (every suite ran; the summary line died with a phantom syntax error — `bash -n` said the file was fine); and a suite that drives the sequence engine at the real wall clock **passes or fails by the hour it is run at**, so `/sequences/tracked/run` takes a pinned `now` **under TEST_MODE only** — production's tick passes no clock, and synchronising the assertion to "whatever the window says right now" would have tested nothing.

## BUILD-94 PART 3 — SEQUENCES, AND THE RULE THEY CHANGE (2026-09-22)
**THE RULE, RESTATED. Since BUILD-88c: nothing goes to a donor she did not press send on. Sequences change it to this, and NO FURTHER: _she wrote every word, she turned it on, and each send is hers._** Steward still writes nothing to a donor. Personalization comes from her data through merge fields and per-track copy, **never from a model** — there is no model on the tracked send path, and `tests/build94-sequences.test.js` asserts it on the source rather than remembering it.
- `shared/sequenceShape.js` is the pure half (triggers, stops, track rules, merge rendering, the send window, validation, the actor line, the Home line, the retroactive sentence). The engine extends the BUILD-13 sequence tables rather than forking a second one — **one place a scheduled email can come from** is the point.
- **Tracks are where the personalization lives.** Tracks are tried IN ORDER and the first match wins, so "a person is on exactly one track" is true **by construction**, not by hoping the rules are disjoint. `validateSequence` REFUSES a sequence whose last track is not "Everyone else" — without a catch-all, enrollment silently does nothing, which is the worst outcome because it looks like it worked. A track with no steps is refused for the same reason.
- **Merge fields are her data, not a model's sentence.** `{{first}} {{last}} {{name}} {{last_gift_amount}} {{last_gift_date}} {{fund}} {{sponsor_name}} {{org_name}} {{gift}}` + **every custom field on the person**. `{{sponsor_name}}` is BUILD-86's word for a giver, not a second person's name. **An unknown token is refused at SAVE time** — "Dear {{frist}}," is the failure this exists to prevent, and a preview that renders blank names the field rather than hiding it.
- **The preview renders the real email for a NAMED REAL PERSON**, defaulting to the most recent real giver. A sample proves the template parses; a real person proves the sentence reads right with THEIR gift in it.
- **Triggers, closed set:** first gift ever · first recurring gift · added as Volunteer · manually enrolled. **No "anyone in a segment" trigger** — that is a campaign and Communications already does it. **First-gift fires inside `recordGift`, AFTER the rollup**, reading `gift_count === 1` off the row the rollup just wrote: a route that asks "is this their first gift" before the rollup races itself.
- **Stops, closed set:** unsubscribed · do-not-email · deceased · removed · **a second gift** (remaining steps skipped unless the step is marked "send even after another gift", so a welcome series does not ask for a gift the week after one arrived). **A LOGGED CONVERSATION IS NOT A STOP**, and the settings copy says so — the assumption is silent and the consequence is an email the day after a real conversation.
- **Idempotent on (person, sequence, step) by the UNIQUE INDEX, not a flag.** `sequence_sends` is CLAIMED **before** the provider call; a retried job finds the row taken and advances instead of sending a second copy. A failure keeps its reason and **surfaces on the sequence line on Home** (BUILD-37 H2 — never swallowed).
- **The send window is weekday mornings in the ORG's timezone**, and **BUILD-84's rule holds: no timezone a HUMAN CONFIRMED, no sequences, and the screen says why** (the column has a default, so "has a timezone" is true for every org and means nothing). Outside the window nothing sends and nothing is consumed.
- **ENROLLMENT IS NEVER RETROACTIVE** — mechanically, because the only way in is the event itself. The turn-on screen says so **with the count that would have been enrolled had it been on all year**, so she can decide to enroll them by hand rather than find the gap months later.
- **Turning it on is audited with actor and time**, and every send's timeline line quotes it back: `Sequence: Welcome, step 2, turned on by Allie Barnett on 3 Oct`. **Turning it off leaves the enrolled where they are** and sends nothing further — losing where five people were is not recoverable.
- **Setup is Jonathan's; the last act is hers.** A super-admin can build a sequence inside her org and leave it off — and **`POST /sequences/tracked/:id/turn-on` refuses a super-admin account**, because "she turned it on" is the sentence the whole relaxed rule rests on and it has to be true.

## BUILD-94 PART 2 — PEOPLE WHO ARE NOT DONORS (2026-09-22)
Until this build every person in Steward was a donor, and Allie could not leave Mailchimp ($100+/month) because her volunteers, staff and board lived only there. `shared/personType.js` is the model; `shared/mailchimpPreset.js` reads her file.
- **Four types, and a person can be more than one:** Donor, Volunteer, Staff and board, Other. `donors.person_types` JSONB (not a join table — four fixed values, always read with the row, and every money surface needs the predicate INLINE in a WHERE clause it already has). **The migration sets every existing person to Donor**, and the predicate is **NULL-tolerant** so a legacy row reads as a donor even before a migration touches it. `normalizeTypes` DROPS an unknown key (a hostile payload cannot invent a fifth type) and **floors an empty list at `["other"]`, never `["donor"]`** — calling a Mailchimp contact a donor is how a giving total goes wrong.
- **THE ONE PREDICATE: `donorOnly(alias)` in server.js / `donorOnlySql` in the shared module.** Spliced wherever "donors" means money: Drift's engine query, every `solicitableSql` stewardship site, and the campaign "All Donors" segment. **`solicitableSql` still means CONTACT PERMISSION only** — whether someone is a giver at all is a separate fact and gets its own predicate at the call site, never folded into a helper named "solicitable".
- **A VOLUNTEER WHO GIVES BECOMES A DONOR TOO, on the SAME record — written in `recordGift`**, the ONE place every money path already rolls up through (BUILD-88a), so no giving route can forget it. Never a second row. `"other"` means "we do not know what they are", so a gift **replaces** it rather than accumulating beside `"donor"`.
- **Four new segments:** Everyone with an email · Volunteers · Staff and board · Donors. **"Everyone with an email" is the one segment that deliberately crosses every type** — it IS the Mailchimp audience. The three person segments make the count sentence read **"people"**, never the org's word for a giver. **And "All Donors" now actually filters to donors** — before this build the two sets were identical, so leaving it unfiltered would quietly send an appeal to the volunteer roster.
- **The Mailchimp preset is a preset on the mapper, never a second importer** (the BUILD-89S 89d rule). Two questions are left to the person because neither can be read off the file: **is this the unsubscribed file** (Mailchimp exports one CSV per status; import only the first and every unsubscribe it was honouring is silently lost — the file NAME preselects the answer), and **do the tags say what someone is** (offered, never applied — `"Board Game Night 2024"` contains the word board and is not a board member, so the match is on a WHOLE tag). Tags → ONE multi-select custom field named Tags; MEMBER_RATING/OPTIN_TIME/CONFIRM_TIME become custom fields rather than being thrown away; LEID/GMTOFF and the rest are ignored.
- **AN UNSUBSCRIBED MAILCHIMP CONTACT IMPORTS AS UNSUBSCRIBED. Never as reachable.** And in BOTH places: `do_not_email` on the row is what a human sees on the profile; **`email_suppressions` is what `donorMailDecision` actually consults before every marketing send**, and it is the one that matters. A flag written in only one of them is decoration.
- **Vocabulary:** the directory count reads "40 people" the moment a non-donor is on the page and "40 donors" while every row is one — the no-op path stays byte-identical (the BUILD-86 rule). **The tab label itself is a decision, recorded in `BLOCKED-build94.md` §1**, because renaming it would override the vocabulary BUILD-86 already sold an org.
- **Gotchas this part paid for:** a `//` comment inside a SQL template literal is SQL, not a comment (`42601 syntax error at or near "//"` from inside `recordGift` — put the explanation above the `await run(`, or use `--`); and a fixture that `DELETE`s an org row with `.catch(() => {})` turns a swallowed FK failure into a duplicate-key on the NEXT run — re-use the org with `ON CONFLICT DO UPDATE` instead.

## BUILD-95 — SQUARE, ONE CONNECTIONS SCREEN, AND A PICTURE OF THE CHEQUE (2026-09-22)
- **§5A — Square is a POINT OF SALE, and that is the whole difficulty.** Every other provider Steward reads is a giving platform where a row is a donation unless it says otherwise; a farm on Square is taking lesson fees, clinic fees, hay and merchandise, and a gift is the SAME SHAPE with no field to separate them. So the design is not a cleverer classifier: **Square cannot tell us, so the organisation has to** — `giving_sources.config` names which locations are giving (or a phrase their donation items carry) and **nothing imports until it is set**. Importing a $45 lesson as a charitable gift inflates a giving total, lands on a lifetime figure, moves Drift and can reach a tax receipt. **The refusal is LOUD**: silent non-import reads as "Square had no donations", a more comfortable untruth. **Amounts are MINOR UNITS** (250 = $2.50) — the 100x mistake, asserted first — and `Square-Version` is pinned. Mirrored in `publicSources` but **NOT on the allowlist** until a real dollar has run through a real account.
- **§4 — the checklist landed on the wrong screen.** "Set up online giving" names two jobs, they lived on two Settings tabs, and the button deep-linked to a THIRD (the page builder). **"Where giving comes in" is now a panel on Integrations**, beside the processor; `sources` survives as a deep-link alias. The item ticks on **EITHER** job, because an org that only wants Steward to watch has genuinely activated (BUILD-89S's premise).
- **The photo bug, twice.** A donor photo is `<img src="/person-photos/…">` — a bare same-origin path, because a browser fetches an image with no auth header and the URL carries its own signature. `/portal-assets` was proxied through Vercel; `/person-photos` was not, so every image got `index.html`, failed to decode, and fell back to initials — **identical on screen to "no photo uploaded"**. And `scripts/local-preview.js` **hand-copied** the same table, so it was broken locally too and HID the production bug. It now **DERIVES the table from vercel.json**. `tests/email-links.test.js` enumerates every bare backend path and pins proxied-and-before-the-catch-all.
- **Adjust before it sets.** Drag, zoom, circle is what is saved, cropped to 512 **in the browser** so what she positioned is what is stored rather than the server having a second opinion about where the face is.
- **A picture of the cheque.** Same asset seam, same **signed/expiring/private** door — a cheque carries a name, an amount, a bank, an account number and a signature, and is the most sensitive image this product holds. **NOT cropped square** (a square cheque is unreadable): long-edge 1600, WebP q86. `gifts.cheque_asset_id` is in `collectLiveAssetRefs` — **without it the 90-day sweep destroys evidence**.
  - **THE MONEY IS THE POINT, THE PICTURE IS THE EVIDENCE.** A photo that will not store does **not** cost her the deposit — the line commits and the failure is **reported by line number**, because she is holding the cheque at that moment and it is the only time re-taking it is free.
  - **Keyed by LINE NUMBER, never by mutating the request body.** The commit RE-PLANS server-side and writes from `plan.lines`; the gate exists precisely so the client's copy of a line is never trusted, so the photos join the same way. Hanging the asset id on `body.lines` wrote it nowhere — two cheques stored, zero attached, and `chequePhotos: 2` said it had worked.
- **READING THE CHEQUE — IT PROPOSES, AND IT CANNOT POST.** `POST /deposits/read-cheques` writes **nothing**: no gift, no donor, no image, no row, and the suite proves it by content-hashing the org's tables either side of the call rather than by reading the handler. A read fills in the paste box; the SAME plan the typed path uses then places it, so the four-state rule is the only thing that ever places money.
  - **THE MODEL TRANSCRIBES; STEWARD DOES THE ARITHMETIC.** A cheque carries its amount twice — the digits in the box and the words on the line — and a bank has a rule about them because they disagree often enough to need one. So Steward does not ask the model how confident it feels (a self-reported number is not evidence); it asks for **both amounts, transcribed independently**, and checks them against each other through `shared/money`'s one parser. **Agreement to the cent is the ONLY outcome that fills in an amount.** Every other case leaves the amount blank — which the deposit sheet already routes to `needs_you` — and states what it saw: *"The box says $250.00 and the line says $25.00. Type the amount."* **Steward does NOT apply the bank's words-win rule**: a bank is reading the cheque it is about to pay; Steward is reading a photograph of one already banked.
  - **THE MODEL READS GLYPHS AND IS GIVEN NO MONEY DECISIONS.** The schema cannot express a fund, a donor id, a confidence or a resolved amount — asserted by name, so one cannot be added quietly. **Claude Opus 5**, deliberately: this is cursive in biro and the wrong place to economise. Strict tool use (`additionalProperties:false` + every field `required`), every field nullable so a blank memo comes back blank, and `unreadable[]` names what it could not read.
  - **ONE GESTURE, BOTH OUTCOMES.** The photographs that get read are the photographs that attach — two buttons would mean somebody presses the first and skips the second, and the stack of cheques is in front of her once. A photo that stores but will not read still attaches; the evidence does not depend on the handwriting.
  - **AND THE MODEL BOUNDARY IS NOT DRILLED IN THE SUITE, ON PURPOSE.** Whether it reads a REAL cheque correctly needs a real key, a real image and real money — and a mock answering for it is the BUILD-57 mistake exactly (three builds proven against a mock that lied in seven load-bearing ways). `scripts/build95-cheque-drill.js` (SELF_REFUSING, no DB, no server) calls the real API on real photographs and prints what came back; **every settled amount it reports is one a human must read back against the cheque.** Until that runs, the arithmetic is proven and the reading is not.
- **Gotchas:** a deposit line with a blank memo and **no org default fund is `needs_you` by design** ("we do not know" is not "unrestricted") — a fixture without one gets zero placed lines; and `/portal/:slug/give-default` **answers 401 to an anonymous visitor on purpose**, so a blanket "no 4xx" browser collector must name it rather than widen.

## BUILD-95 §5B — THE GIVING-PAGE BUILDER: ONE BUILDER, TWO SURFACES (2026-09-22)
- **THE REGISTRY CAME FIRST, because a widget was declared in THREE places nothing kept in step** — the type list and validator in server.js, the render switch and full-width set in `PortalWidgets.jsx`, and the label/hint/default tables in `PortalEditor.jsx`. Adding a widget to two of the three gives a screen that renders nothing or an editor offering what the server refuses, **and no test could see it, because there was nothing for a test to compare the three against**. `shared/pageWidgets.js` is that something; `tests/page-widgets.test.js` walks each consumer back to it (including that **every registered widget has a branch in the renderer**) and is proven able to fail on each defect in turn.
- **THE SURFACE IS A FILTER, NOT A FORK.** A widget declares its surfaces; the palette offers it there and **the server REFUSES it elsewhere**, from the same list — so a hand-rolled request cannot put a donor's own giving history on a page a stranger opens from a flyer. `give` and `mygiving` are portal-only, each for a reason a giving page cannot satisfy: a give button on a giving page scrolls to the form beneath it, and My Giving needs a donor session.
- **THE FORM IS NOT IN THE REGISTRY.** A giving page whose one job is taking a gift must not be able to lose it — that is a page that silently stopped working and says nothing on screen. It is always rendered; `giving_pages.form_position` chooses only whether it **leads the page or follows the story**, two layouts that both always work.
- **Draft/published on `giving_pages` itself**, not a second table: `portal_pages` is ONE row per org (org_id is its PK) and giving pages are many, so the portal's SHAPE does not carry over, only its rule. **A draft never reaches a donor**, and **an UNBUILT page is byte-for-byte what it always was** — which is what makes this safe to ship.
- **ONE resolver (`resolveWidgetsPublic`) and ONE renderer** for both surfaces. A widget that resolved or drew differently on two surfaces would eventually show two different numbers for the same fund.
- **THE RETENTION SWEEP NOW READS EVERY PAGE OF THE ORG** — the survey's own finding. `pruneWidgetAssets` read only `portal_pages`, which is org-keyed; once giving pages carried widget photos it would have soft-deleted a photo a LIVE giving page was showing and made it permanent ninety days later.
- **THREE DEFECTS ONLY LOOKING FOUND, each while every server assertion was green.** (1) **The TDZ class, third appearance in this repo** (BUILD-84, BUILD-89): the `useMemo` that builds the page read `th` twenty lines above its declaration, so the whole page rendered its error boundary. (2) Then the page drew the record's title and story **above the hero she wrote to be the headline** — the builder arguing with the record it was built from; a built page now replaces the title, story and image. (3) Then it **opened on a bare `$0` thermometer** before that hero. A page whose first line is `$0` tells a donor nobody has given; the thermometer is a live figure that SUPPORTS an ask and is not the ask, so the built page leads and the figures follow.
- **And four more in the editor, all of it lying about what she was doing:** it called itself the Portal editor, badged **SAMPLE DONOR DATA** on a page with no donor data at all, **lost the form control the moment she had widgets** (it only rendered in the empty state), and **left the form itself out of the preview** — she was arranging around something she could not see. The form's PLACE is in the preview; the control that moves it is in the **chrome**, because a radio pair inside the phone reads as something a donor sees.
- **Gotchas this part paid for:** a browser assertion can pass for the WRONG REASON — the palette is collapsed by default and a widget's **chrome label carries its name too**, so reading the closed screen "found" Hero and Programs & funds on the page behind it; open the palette and read the palette. A `useCallback` that gains a new closed-over value needs its deps updated or it is a stale closure (`apiBase`, `formPosition`). The draft route answers **`draft`**, not `widgets` — ONE contract, because it is one editor. And **the census ratchets DOWN, NEVER UP**: five new literals were paid for by tokenising thirty-four, taking the ceiling 1172 → **1153**.
- **THE TRAP I WALKED INTO AGAIN: never touch the shared scratch stack while a battery runs against it.** A full run during editing and reboots came back 12 red in 1567s (against ~475s clean); re-run untouched it was 5, and four of those were real. **A red battery run concurrent with edits tells you nothing** — re-run it clean before reading a single failure.

## BUILD-94 FIRST RUN — THE GREETING AN ORG GETS ONCE (2026-09-22)
A new organisation's first sign-in is the one moment the product gets to say *this is yours* before it says anything else. `FirstRunWelcome` (shared.jsx) is a full-screen greeting carrying **only the org's own record**: their name, their mission in their words, their two-or-three words, and a **motif**.
- **"Already welcomed" is the DEFAULT, and being greeted is the exception.** `users.welcomed_at` is `DEFAULT NOW()` with every existing row backfilled; **`/auth/register-org` sets it NULL by name**. A NULL-means-greet column would have thrown a full-screen takeover in front of every existing user and **every test fixture that inserts a user without thinking about it — which is all of them**, blocking every browser suite.
- **`ALTER TABLE … ADD COLUMN IF NOT EXISTS … DEFAULT x` DOES NOTHING WHEN THE COLUMN ALREADY EXISTS** — including the default. A database that got the column from an earlier deploy keeps inserting NULLs, so a FRESH database would have been correct and an UPGRADED one would not. The `ALTER COLUMN … SET DEFAULT` that follows it is not belt-and-braces; it is the fix.
- **It stays inside the four colours, and it is the gold moment at scale** — the same gesture (a rise, one sheen), not a second aesthetic. No confetti: `tests/build94-welcome.test.js` pins the animation names, so a confetti burst cannot arrive without changing that line. Every movement is off under `prefers-reduced-motion` while the greeting still reads.
- **`orgs.welcome_motif` is the one piece of white-label the greeting carries**, set on the same `PATCH /orgs/:id` as mission and website. NULL draws nothing; a named motif draws what that organisation is actually about. `horse` is the first, for Justin's Place — equine-assisted services, where a horse is the programme rather than decoration. An unknown motif is stored and ignored, so naming one before it exists is harmless.
- **Drawing it: five hand-drawn attempts produced a sheep, a deer and three ponies.** The browser was the only thing that could tell me, and the honest answer was to stop drawing and **trace the reference** (`scratchpad/horse/trace.js` — Moore-neighbourhood border following + Douglas-Peucker, run over the supplied bitmap with `sharp`). The motif is now ONE traced path with its own `box`. **Provenance is recorded in the source**: if that reference came from a stock library, its licence wants checking before it ships beyond a demo org.
- **It is a HERD, and it loops.** Seven horses, smaller/fainter/slower the further back — depth done the way depth is always done. **Negative animation delays** so every horse starts part-way across and the screen is already running at first paint; positive delays leave an empty screen for the first seconds and then a bunch arriving together, which is the only three seconds most people ever see. **Linear timing**, because a horse does not ease to a halt in the middle of a field. A single motif crossing once was the earlier rule and was **deliberately replaced** — seven horses running off the right edge leave an empty screen while she is still reading.
- **The ground is a soft radial vignette, not a sweeping band.** The first version swept a translucent brass band across the whole screen and read as a green smear with a hard vertical edge down the middle. A vignette has no edge to see.

## BUILD-94 PART 1 — A FACE ON EVERY PROFILE (2026-09-22)
Allie Barnett named it first: a donor record with no face is a row, not a person. `personPhoto.js` is the pure module (sign/verify/initials/SSRF guard); the bytes ride the BUILD-51 asset seam under the new kind **`person`**.
- **A donor photo is NOT theme imagery, and does not use its door.** `/portal-assets/:id` is unauthenticated and immutable-cached because a portal banner is public by definition. A photograph of a person gets `/person-photos/<assetId>?e=<exp>&s=<hmac>` — **signed, expiring (12h), `Cache-Control: private`**. The signature covers **the org id on the STORED ROW**, never anything the caller sent (BUILD-37 B9, applied to a GET): to open org B's photo you would need org B's org id inside an HMAC keyed by `JWT_SECRET`. Expired and wrong-org answer the **same 403**, so a probe cannot tell them apart.
- **512 square WebP, original discarded.** Type checked by CONTENT (`imageBytesMatchMime` — the BUILD-86 rule), 10 MB of decoded image, SVG excluded (a script-bearing document is nobody's headshot). Unlike the theme path this does **NOT** fall back to storing the original: a 10 MB master masquerading as a thumbnail is the thing the cap exists to prevent.
- **`donors.photo_asset_id` is the first pointer in the product storing a BARE asset id** rather than a `/portal-assets/` path. It is therefore in `collectLiveAssetRefs` — **without that the 90-day purge would destroy the face on a live profile**, and `tests/asset-retention.test.js` now pins `donors` alongside the other four pointer tables.
- **ONE mark, everywhere: `PersonMark` (shared.jsx).** Photo if there is one, otherwise **initials on the org's colour** (`var(--org-accent)`), never a grey silhouette. Live on: profile header, Home Thread rows, Drift list, Communications segment preview, global search results, household members. The thread row's old brass-when-late tinted letter is gone — the row's own left edge already carries that signal, and a mark that changes colour by status is not the same mark everywhere.
- **`GET /people/photos` is the ONE seam for row surfaces** — `{donorId: signedUrl}` for the org, fetched once into `PhotoContext`, capped at 5,000. The alternative was threading a signed URL through seven payload builders, each a place for the face to silently go missing. The **profile signs its own**, so a record is never the one whose photo vanished because a list was capped.
- **An import photo URL is an outbound request a spreadsheet chose.** It takes the BUILD-84 geocoder's exact shape: the row lands `photo_fetch_status='pending'` and a **drainable queue** (`processPhotoQueue`, 5-min tick, `POST /photos/run`) does the network — 25,000 fetches inside an import transaction is how an import times out. BUILD-37 G5 enforced in `checkRemoteImageUrl`: **https only, no credentials, no non-443 port, no private/loopback/link-local/CGNAT/unique-local address, no metadata host** — *and the guard re-runs on `r.url` after redirects*, which is the hop the string check cannot see. 10s timeout. Every row leaves with a **terminal status and the reason ON THE ROW** (`photo_fetch_error`); a dead URL on row 4,000 costs that row its photo and nothing else.
- **Gotchas this part paid for:** a new root module is invisible to `deploy-shape` until it is **git-added** (the artifact is git-tracked files minus `.railwayignore` — the BUILD-79/88c class of break, caught before it shipped); a raw `#ffffff` inside a `var()` fallback string **counts against the palette-census ratchet** (use `"var(--x, " + T.white + ")"`); and an `http://169.254.169.254` fixture is refused by the **protocol** check one step before the metadata check, so it never exercises the rule it was written for.

## BUILD-90 — THE CLOSE LINK AND THE BILLING DATE (2026-09-20)
Jonathan closes in the room. The executive director puts a card in on his laptop or her phone, **nothing is charged**, and the contract and the product agree on exactly when the first charge happens. Suites, all in run-all: `close-link` (50) · `trial-billing` (43) · `one-date` (33), plus the rewritten `trial-end` (25). Decisions and the three things that need Jonathan: `BLOCKED-build90.md`.

- **THE RULE, AND IT HAS NO CLAUSES: the first charge is THIRTY DAYS AFTER SIGNING.** An earlier draft started the clock at import with a 44-day cap; Jonathan's decision on 19 September replaced it. **Signing is one timestamp** (`orgs.signed_at`, stamped once, by the close link) and `trialEnd.js` is the one definition. Nothing moves the date — not an import, not a second import, not a rescheduled onboarding meeting — and `tests/trial-billing.test.js` §1 proves it the strong way: import a real donor file through the real route, twice, and `trial_ends_at` is **byte-identical** afterwards. A date a customer can move by doing ordinary work is not a date a contract can name.
- **90a — THE CLOSE LINK IS NOW THE ONLY DOOR A CUSTOMER COMES THROUGH.** Public signup stays closed (BUILD-87 F.2). `POST /admin/close-links` (**super-admin only**) takes org name, contact email and plan and returns a Stripe Checkout URL in subscription mode with `trial_period_days: 30` and `payment_method_collection: "always"` — the card goes in, and the Checkout page states the charge date and "cancel any time before then and you pay nothing" **above the button**, not in an email afterwards. **NOTHING EXISTS UNTIL STRIPE SAYS THE CARD WENT IN**: an unopened link leaves no org, no user and no subscription, only an `close_links` row naming who it is for. The org, the first admin and the subscription are created by `checkout.session.completed`, and the admin is emailed a **seven-day** set-password link (she may sign on a Tuesday and sit down with it on Friday).
- **THE TRIAL END IS READ OFF STRIPE, NOT RECOMPUTED.** `closeLink.js` and `trialEnd.js` define the same arithmetic, but the value written to `orgs.trial_ends_at` is `subscription.trial_end` — so Stripe and Steward cannot disagree about the one date the contract names. That also fixed a live defect: `customer.subscription.updated` **flattened Stripe's `trialing` to our `active`**, so a card update during a trial silently erased the trial from Settings.
- **90b — A WEEK'S NOTICE, ONCE, AND A CANCEL BUTTON THAT NEEDS NO PHONE CALL.** Seven days before the charge (day 23 of 30) one email from Jonathan's address carries the date, the amount, **the card's last four** and a one-click cancel. `orgs.trial_reminder_sent_at` is what makes "once" true — a six-hourly tick across seven days must not send fourteen warnings — and it is stamped **only after a delivered send**, so a Resend outage retries rather than eating the only warning she gets. The emailed link **renders a confirm page on GET and cancels on POST**: an inbox scanner that prefetches links must not be able to end somebody's subscription. Settings → Billing shows the same date and the same button.
- **NO SUBSCRIPTION, NO CHARGE, NO WARNING.** The reminder also requires a real `stripe_subscription_id`: an email naming an amount, a date and a card's last four must never reach an org that has none of those. That is right on its own merits and it is also what keeps the first production tick silent — a manually-granted plan, a demo org or a legacy trial is never warned about a charge that is not coming.
- **CANCELLING IS TWO DIFFERENT PROMISES AND THE CODE MAKES BOTH.** Before the first charge → `subscriptions.cancel` outright, zero charges, ever. After a charge → `cancel_at_period_end`, and she keeps the month she paid for. The suite asserts **what Stripe was actually told**, not just what the API answered.
- **90c — ONE DATE, THREE SURFACES, AND THE STRING IS GONE.** "December 31, 2026" was pinned BY NAME in `tests/invitation-only.test.js` as three ACCURATE survivors, on the grounds that copy must not contradict code and changing the code was money math. This build did the money math: the free-through path is deleted from `trialEnd.js`, `scripts/extend-trials-free-through-2026.js` is gone, and the survivors list is **zero**. No customer had signed under that promise, so nothing is grandfathered.
- **THE PRICES ARE THE LIVE ONES AT LAST: Founding $199 / Core $249 / Team $499.** `closeLink.js`'s `CLOSE_PLANS` is the one list; `PLAN_MRR`, `PLAN_MONTHLY_COST`, the pricing page and `scripts/create-billing-products.js` are checked against it by `tests/one-date.test.js`. **BUILD-87's guard had a hole this closes**: it banned the literal `$149` from `Pricing.jsx` and the page went on rendering $149, because the price is interpolated from `price: 149` and the string never appeared in the file. The new guard checks the DATA and then the **rendered page in a browser**.
- **THE PRICE ON THE PAGE MUST BE THE PRICE IN STRIPE — and the prod smoke is what found it.** After deploy, `/health` reported `billing.ok: true` on prod: all three `STRIPE_PRICE_*` set, in live mode, **at the RETIRED amounts**. "Configured" was true and wrong, so the `plan_not_configured` guard protected nothing and a close link would have shown "$249" on Checkout while Stripe charged the retired amount. The amount is now **retrieved from Stripe and compared before a link is minted** (`plan_price_mismatch`, naming both numbers and the env var); `GET /admin/close-links` reports `ready` — what Stripe holds against what the page would quote — instead of the false comfort of `configured`. **A configured id is not a correct price**, and that is the whole lesson: this build is about the product and the contract agreeing, and an amount is half of that agreement.
- **`STRIPE_BILLING_API_BASE` — the platform-billing twin of BUILD-45's `STRIPE_API_BASE`.** The close link is the one billing path that makes an outbound Stripe call, so the battery needed a mock for it (`BILLING_MOCK_PORT`, :5604). The two Stripe clients stay deliberately independent; they now have independent mocks. The boot recipe also sets the three `STRIPE_PRICE_*` ids, because **a close link refuses to mint a session without a configured price** — correct in production, and it moved `tests/billing.test.js` from asserting the shape of a missing configuration to asserting what the route actually does.
- **Gotchas this build paid for:** `orgTz(orgId)` returns `{timezone, timezone_confirmed_at}`, and passing the whole object to an `Intl` option throws `RangeError: Invalid time zone specified` — which is how the first welcome email failed to send while everything around it passed. Use `orgTzName()`; `formatChargeDate` also degrades to the default zone rather than throwing, because a malformed zone must not cost a customer their warning. **A new root module is not in the deploy artifact until it is `git add`ed** — `deploy-shape` reads `git ls-files`, so an untracked `closeLink.js` failed it correctly. **A guard that greps source for a forbidden string must strip COMMENTS first**, or the file explaining why the string was removed fails the rule it documents.
- **Needs Jonathan — DONE, verified 2026-09-25 (`/health.billing` live+ok+checked):** the three LIVE-mode Stripe prices at the new amounts, `STRIPE_PRICE_*` set on Railway, and one real close link run on prod with his own card — confirm no charge, then cancel it.

## BUILD-89S — GIVING SOURCES: KEEP WHAT YOU TAKE GIFTS THROUGH (2026-09-20)
**NB the BUILD-89 label was already used for "Home, organised" three days earlier, so this build is tagged 89S in its commits and here.** An organisation keeps PayPal, Zeffy, Cash App or whatever it takes gifts through today; Steward reads those gifts in and never touches the money. The sentence the whole build has to make true: **"Keep PayPal. Keep Zeffy. Steward reads them. It never holds or moves a dollar."** Suites, all in run-all: `build89s-sources` (83) · `build89s-paypal` (37) · `build89s-zeffy` (38) · `build89s-stripe-givebutter` (49) · `build89s-presets` (42) · `build89s-surfaces` (50). Full battery **162 suites, 0 failed**; landing verifier **64 → 71** (it grows, never shrinks). Decisions: `BLOCKED-build89a.md` · `BLOCKED-build89c.md` · `BLOCKED-build89d.md` · `BLOCKED-build89e.md`.

- **THERE WAS NO ENCRYPTION IN THIS REPO, AND NOW THERE IS — FOR NEW SECRETS ONLY.** 89a's brief said to use "the same encryption already used for secrets in the repo" and to STOP if there was none. There was none: `gmail_connections.access_token`/`.refresh_token` and `users.mfa_secret` sit in **plain text today** (written up, NOT fixed — that is somebody's build and pretending otherwise would be worse than the gap). Jonathan's call was to build the sealer rather than stop. **`shared/secretBox.js`** — AES-256-GCM, per-envelope random salt + IV, key by HKDF-SHA256, **AAD bound to the org id** so a sealed blob copied between tenants fails to open. **THERE IS NO PLAINTEXT PATH**: `seal()` THROWS with no key configured, the connect route answers 503, and nothing is written — a missing key makes the feature unavailable, never available-and-insecure. **`giving_sources.credentials_sealed` carries a CHECK constraint, so the DATABASE refuses a readable key**, not just the route. **`STEWARD_CREDENTIAL_KEY` must be set on Railway before any org can connect a source** (MANUAL-STEPS §7); **rotating it orphans every stored credential** — there is no re-seal path yet.
- **ONE CONTRACT, ONE RUNNER, ONE GIFT PATH.** `shared/givingSources.js` holds the only row shape that may cross the line and what "monthly" means; `syncSource` writes every row through **`recordGift`**, never a second INSERT. **De-duplication is provider + the provider's own id, NAMESPACED** (`paypal:8XN…`) — which is what makes a PayPal CSV row (89d) and the PayPal API reading the same transaction ONE gift, asserted at the seam (`presetExternalId` === `externalKey`, byte-identical). **Donor match is exact email or a new donor, NEVER a name match** — a name collision lands on a new person and is REPORTED, one tap away in the duplicate review that already exists. **Fund is the source's default or nothing** (`defaultFund:false`, recordGift's donor-initiated case); a memo is not a designation. **The gift is the GROSS**, the fee sits beside it in the new `gifts.processor_fee_amount` (which is NOT `cover_fee_amount` — that is the donor choosing to add the fee). **The first read of a source is import history and never posts** (BUILD-83, via `giving_sources.backfilled_at`).
- **READ ONLY, AND PROVABLY.** Adapters never get `fetch` — they get `readOnlyHttp(provider)`, which **refuses any request that is not a GET** and records every attempt for the suite to audit. The single exception in the whole system is PayPal's OAuth token POST, named in `READ_ONLY_EXCEPTIONS`; a PayPal **payout** POST is still refused. **`sources/stripeSource.js` shares no code path with Steward's own Stripe** — no `stripeKeys`, no `server.js`, **and not the Stripe SDK** (an SDK client hands anything holding it a `.refunds.create()` that the handle could not see), asserted structurally with comments stripped, because the file explains the rule by name.
- **RECURRING IS PROVIDER-NEUTRAL, AND SAYS WHICH KIND IT IS.** `confidence='provider'` when PayPal/Stripe/Givebutter named the subscription; `'inferred'` when Steward saw three or more gifts of the same amount 27–34 days apart, which reads **"Looks like $50 monthly through PayPal"** until one tap confirms it. A missed payment (expected date + 5 days' grace) opens **ONE Thread** — `giving_recurring.missed_for` stores the date already raised, so a second sweep over the same unpaid month finds nothing to do. **A PROVIDER SAYING A PAYMENT DID NOT HAPPEN BEATS THE ABSENCE OF ONE**: a `failed` row carrying a recurring ref raises the Thread THE SAME DAY (`raiseToldFailures`), which is also the one channel a stopped Givebutter plan travels down rather than a second path to keep in step.
- **THE WINDOW DECIDES WHAT BECOMES A COMMITMENT; IT DOES NOT DECIDE WHAT KEEPS ONE.** Found by 89a's own suite: a card that soft-declined and retried eight days late lands 39 days out, fell outside the 27–34 window, and froze the commitment on an expected date already past — raising a Thread about a payment that actually arrived. Once recognised, the next gift of the same amount through the same source satisfies it whenever it lands.
- **REFUNDS ARE COUNTED AND NAMED, NOT REVERSED, ON PURPOSE.** The only refund path that exists (the Stripe webhook's inline branch) **DELETES the gift**, which on this path is actively wrong: the provider still returns the original payment as completed, so the next sync would re-create the gift it had just deleted, forever. So an already-refunded row is not written and is counted; a refund whose gift IS on file is counted and **NAMED** on the run summary. Named for its own build in `BLOCKED-build89a.md`.
- **WHAT THE BRIEF GOT WRONG, CHECKED RATHER THAN REPEATED.** PayPal's codes and limits were confirmed against developer.paypal.com (status S/P/D/V; T0002 subscription; T1107/T1100 refunds; T0400/01/03 withdrawals; 31-day windows; page_size max **500**; **"a maximum of three hours for executed transactions to appear"**, which is WHY every sync re-reads the last few days). **Zeffy's public API is READ-ONLY** — it has no create/modify/delete endpoint, contrary to the brief's "can record and delete payments" — and paging is `has_more` + **`next_cursor`**, not `starting_after`.
- **WHERE A FIELD NAME COULD NOT BE CONFIRMED, THE UNCERTAINTY WAS GIVEN A SHAPE.** Zeffy's and Givebutter's field-level references need an account, so each adapter declares a **`FIELD_MAP`** of candidate paths per contract field and **its suite proves every declared candidate is actually read**. A wrong guess then fails by name instead of arriving as a silently empty donor, and correcting it against a real payload is one line. Same pattern for 89d's statement presets, each declaring its own `confidence` (PayPal documented, Venmo reported, **Cash App unconfirmed** — sources disagree on whether it exports a CSV at all, and **no PDF parser was built**).
- **A STATEMENT FILE IS A PRESET ON THE MAPPER, NEVER A SECOND IMPORTER** — `shared/sourcePresets.js` produces `autoDetectTxMapping`'s own vocabulary, field for field, and the payment method is a **fact about the FILE** (stated) rather than a guess about a row. **A named movement that is never a gift is refused whichever way the money went** — a POSITIVE "Bank Transfer" is the org moving its own money in from its bank, not a donation — and the SIGN decides only when the type word says nothing. (My first statement of that rule was the obvious one and was wrong; the test caught it.)
- **A DEFECT IN THE ONE MONEY PARSER, found by 89d:** `normalizeMoney` read `"- $20.00"` and **REFUSED `"+ $50.00"` as unparseable**, which is exactly how Venmo signs an incoming amount — so every incoming line of a Venmo statement would have had no amount at all. Fixed in **both** places the minus is handled (the sign can ride inside the currency symbol), counted as a sign mark so `"+-5"` still refuses. Ten money-parsing suites re-run green.
- **Two byproduct fixes, both pre-existing, both proven against a stashed tree:** `tests/thread-nudge.test.js` **was failing every Saturday and Sunday** — the morning brief deliberately sends no thread section at the weekend, so a run pinned to "today" was right to send nothing two days in seven; it is anchored to the next WEEKDAY now, with the fixture dated from that same anchor (the two deliberately-pinned dates stay, because those tests are ABOUT the weekend rule). And the demo seed has been failing on every boot for some time with `there is no unique or exclusion constraint matching the ON CONFLICT specification` — confirmed on clean main, not this build's, written up in `BLOCKED-build89a.md` §4.
- **Gotchas this build paid for:** `require("./sources")` resolves to a bare DIRECTORY and `deploy-shape` rightly calls that an escape from the deploy artifact — require `./sources/index.js`. A new root module that computes a civil date pushes `date-seam` over its baseline; **use `orgTime.addDays`, and read an instant's civil date with `orgToday(org, instant)`** rather than a UTC slice, which is wrong for every org west of Greenwich. `normalizeMoney` returns `{value, warn, blank}`, not a number. **Rebuilding `client/dist` WITHOUT `VITE_API_URL` silently breaks every browser suite** (they fail as timeouts that look like product bugs) — and `vite preview` is not `scripts/local-preview.js`, which is what mirrors vercel.json's rewrites. A guard that greps source for forbidden names must strip COMMENTS first, or a file that explains its own rule by name fails it.

## FIX — THE THREAD ROW TAKES DRIFT'S SHAPE (2026-09-18)
Jonathan, looking at the two lists one under the other: *"drift looks far better, fix it."* He was right, and the difference was not colour.

- **A Drift row gives you a FACE, a whole sentence that WRAPS, one fact on the right with its label under it, and buttons big enough to mean something.** The Thread row gave a name, a clause **cut off mid-word with an ellipsis**, and then said "overdue" TWICE — once beside the step and again underneath it. The Thread row is Drift's anatomy now, in the Thread's own words: the step moved INTO the sentence ("Sat down about the spring campaign a week ago. **Next: send the proposal.**"), which is where a person says it, and the right-hand fact is the only thing a queue is really sorted by — **how late this is** (`14 days / OVERDUE`). BUILD-85's reason line is suppressed when it is the one the fact already states, which is the same rule as `supersedes`.
- **The row's height is the content's** (`min-height:64px`). The fixed 64 was what forced the sentence into one truncated line in the first place.
- **`lowerFirst`** — a step label is written as a heading ("Send the proposal") and reads mid-sentence, so only the first letter moves, and never on an acronym ("Send the LOI").
- **The band label pads 13px** to line up with the row's own content edge (the face), not the name 52px to the right of it.
- **Reviewed contract changes, each with its reason beside it:** `scripts/build89-walk.js` §4b (name at Drift's weight, the sentence must NOT be nowrap/ellipsis and must carry "Next:", the fact is stated once, the row clears 64 rather than equalling it) and `scripts/build87-f3-walk.js` (the clause CONTAINS time in words rather than ending on it; the band lines up with the row's content edge).

**AND THE CLASS THAT BIT TWICE IN ONE NIGHT: A STEP FORWARD MUST LAND ON A WEEKDAY.** `thread-nudge` §5 stepped a flat **+8 days** and `build84`'s timed-reminder leg stepped **+1 day**; both passed Sunday through Thursday and both failed on a **Friday**, when the step lands on a Saturday and the weekend rule correctly sends nothing. Neither was a product regression — proven by running both against a stashed tree — and both are fixed by advancing to the next WEEKDAY and **deriving** the expected day count from the date chosen. It is the same family as BUILD-84's "a guard that was measuring the CALENDAR, not the code": **pin a golden whose comparisons are all its own; SYNCHRONISE a suite that asks the server a question about now.**

## BUILD-89 — HOME, ORGANISED (2026-09-17)
Home read as a stack of tiles that opened by telling you what you had not done. One panel now, the work on the left and a rail on the right, and the rail answers when you press something. Walk `scripts/build89-walk.js` (86 measurements at 1440 AND 390, ALL GREEN) → `docs/build89/`. Battery 156 suites, landing verifier 64/64. Census 1,174 → **1,172** (four literals tokenised to pay for the panel's own colours).

- **THE HEADER IS WARM.** It was the morning sentence at 34px serif — "Six people are waiting on you; Chen has been waiting two months." — which is an accusation before coffee. The header is the greeting and **the day**; the sentence moved INTO the Thread's own header at reading size, where it summarises the list under it instead of passing a verdict on the person reading it. BUILD-86's guard follows it there (`.thread-note`), and the property it protects is unchanged: the sentence only on Home, the as-of line only on the board.
- **ONE PANEL, NOT EIGHT EDGES.** `.home-shell` is a white panel on the light ground with the work at `flex:1` and a 340px **Today rail** beside it, divided by ONE hairline; below 1100 it stacks and the rail goes first. **Inside the panel no card draws its own edge** — `cardWrap` is transparent on Home and a block is separated by air and a rule (`.home-block`), because the panel already drew the border. The board keeps real cards: it is a grid of numbers, not a page.
- **THE RAIL HAS TWO STATES, and never an empty one.** Today rests on three numbers (open follow-ups · due today · the org's own word for monthly givers whose card failed this week). Press a number and its **list** arrives over the same space with a way back; press a row — in the rail or in the Thread — and the **donor** arrives: lifetime giving, last gift, the next step and its reason, "Log a conversation" and "Open the record". A tab strip was considered and refused: HubSpot's own home shows three tabs of zero, and an empty tab is what makes a product look dead in a demo. A thread row is **still a real `<a href="/donors/:id">`** (BUILD-45 D-1), so cmd-click still opens the record in a new tab; a plain click opens the rail, and the row it came from is marked.
- **THE CREAM BARS ARE GONE.** OVERDUE / TODAY / COMING UP were filled bars the width of the card, chopping one list into three blocks. They are quiet 11px labels on the same white, with no rule under them.
- **THE DEMO FILE — `scripts/build89-demo-seed.js`, 1,000 donors.** Deterministic (seeded PRNG), idempotent (stable emails, and the import dedupes on email), every record tagged `demo-file`. Individuals, **churches, foundations, businesses and households**; every stage and every giving tier occupied; ~4,300 gifts over three years with funds, payment methods and gift types spread; monthly givers, lapsed, first-time, major; a deceased record, a do-not-contact record, a do-not-solicit record; ten pledges, five grants across the pipeline, and **twenty-five conversations whose next steps land across overdue/today/coming-up**. Runs in about a second through the real API. **Every name is unique by construction** — fifty firsts against fifty surnames collides long before a thousand records, and three rows reading "Halcyon Charitable Trust" is the fastest way to make a demo look fake.
- **Three defects this build's own looking found:** a `const` read twenty lines before its declaration took the whole screen to its error boundary (**the BUILD-84 TDZ class again** — `onPanel` sat below `sHdrPad`, which read it); the rail showed **"Lifetime giving $0"** on every donor because it read `total_giving` off an **adapted** donor, where the field is `total` (`adaptDonor`, api.js); and the seed logged ten conversations instead of twenty-five because it invented touch keys (`email_sent`, `note`) instead of using `shared/threadShape.js`'s `TOUCH_TYPES`.
- **BUILD-88d's walk was folded into this one** rather than left measuring a screen that no longer exists, and **BUILD-87 F.3's header and card geometry are superseded** with the reason written beside them — what F.3 proved that still stands is still checked there.
- **Gotcha:** a JSX comment may not sit between an element's attributes. And macOS reaped the scratch Postgres cluster out of `/tmp` mid-battery (26 suites failed at once on `could not open file "global/pg_filenode.map"`); the cluster now lives at **`~/steward-test-pg`**, and `tests/README.md`'s recipe should follow it there.

## BUILD-88d — HOME PROPORTIONS (2026-09-17)
Layout only: no query, no logic, no new number, one commit. Walk `scripts/build88d-walk.js` (74 measurements at 1440 AND 390, ALL GREEN) → `docs/build88d/home-1440.png`, `home-390.png`. **The token census did not rise: 1,174 hex literals against a 1,174 ceiling** — the one new token (`T.ground`) was paid for by deleting a dead `T.gold700 || "#8a6d1f"` fallback.

- **THE HEADLINE.** 34px DM Serif at a **28ch** measure, **clamped to two lines** (a long morning used to push the first card under the fold), 32px of air below it, and a **14px warm-grey greeting** above. The org name keeps its place on that line and loses its brand accent — on one 14px line the accent was a third colour competing with the headline under it, and the org's logo beside it already says whose system this is.
- **TWO COLUMNS FROM 1100px.** `.home-grid`: cards at 2fr, the **Today rail** at 1fr, 16px between. The rail is FIRST in the DOM and grid places it in column 2, so the single-column fallback below 1100 puts it above the cards with no second rule and no duplicated markup. `minmax(0,Nfr)`, not `Nfr` — a long donor name in a flex child otherwise refuses to shrink and the grid overflows.
- **THE TODAY RAIL** is three numbers this page already carried buried in a card header ("12 open · 3 overdue"), which is where a number goes to be skipped: open follow-ups · due today · the org's own word for monthly givers whose card failed this week. 40px serif over a 13px label, each tile a link to its own list — a jump to the card when the card is on this page, the tab that owns the list when it is not, **never a dead tile**.
- **THE GROUND LIGHTENS** to `T.ground` `#f7f5f0`. Cards stay white on the **`#e8e4db`** hairline (`T.bg2` — the Thread and Drift cards used to override it to `bg3`, and to brass when something was overdue; overdue has the band, the row's brass left border and the count to say so, and the card edge is not a third voice), 12px radius, 24px padding, 16px gap, **no shadow**.
- **ONE ACTION PER ROW.** The row is **64px** (9px of air, a 44px touch target, 9px of air; the height is fixed at ≥1100 so half a pixel of line box cannot make one row in a queue 65), the name **15px medium**, the clause **14px warm grey**, the action on the right edge. **Dismiss moved into a "…" menu** (`ThreadDismissMenu`'s trigger) — it was a second bordered button beside the emerald verb, so every row offered two things at equal weight and the eye had to choose before it had read the name.
- **Section headers** are 18px serif with the brass underline and 16px below. **The sidebar is 240px**, its items 14px with 8px of vertical padding, and MORE is collapsed for somebody who has never opened it.
- **Two things the walk's own captures found, not its assertions:** the middle region of a thread row wrapped to two lines when the next-step label was long, which quietly made that row 68px instead of 64 (it is one line with an ellipsis now); and at 390px a card header ran its title into its link with no gap ("20 thank-yous ready.Teach Steward your voice") — headers wrap on a phone.
- **BUILD-87 F.3's geometry is SUPERSEDED by this pass**, and its walk was updated in the same commit rather than left to rot: seven numbers moved (headline size and measure, column gap, card padding). Everything else F.3 proved still holds and is still checked there — one column of prose, one emerald action per row, one-line empty states, the hairline, no shadow, no surnames.

## BUILD-88c — APPEALS THAT COME FROM HER (2026-09-17)
**SCHEMA INIT ORDER IS PART OF THE COMMIT.** BUILD-88b's `pledge_installments` create was written beside the rest of 88b's schema work, ~180 lines BEFORE `pledges` is created. On an existing database that is invisible; on a FRESH one the FK to `pledges(id)` does not resolve, `initDb` throws "relation pledges does not exist", the server never finishes booting, and **CI's `test` job fails at "Boot the API server" — which gates BOTH deploy jobs.** Main was red from the 88b merge until it was found, so 88b and 88c sat undeployed. Two rules out of it: a new table goes AFTER the tables it references, and **`git push` no longer runs the battery (the pre-push hook is lint only), so CI must be READ after every push to main** — `gh run list --branch main --limit 3`.

Built in the `build-88c` worktree, parallel with 88b. Two parts, two commits. **An appeal she presses send on is hers to send; nothing goes to a donor she did not press send on.**

- **C.1 — HER OWN DOMAIN, VERIFIED.** One seam decides who an email is from: `orgSendingIdentity(orgId)`. Unverified, mail leaves from Steward's domain with the ORG's name in the display slot and a **Reply-To that reaches a human** — it reached NOBODY before this part, because the Resend SDK maps `payload.replyTo` → wire `reply_to` and silently IGNORES a passed `reply_to`, so three call sites (the founder's onboarding drip among them) were sending donor mail with no Reply-To at all. Verified, everything a donor's inbox shows — From, Reply-To, List-Unsubscribe mailto — is the org's own. **A domain belongs to ONE org, enforced by a global unique index at the database**, not an if-statement. Three routes and no fourth: read the state, claim, check. Nobody is ever blocked from sending while unverified and every screen says which of the two is in force (`sendingDomainPayload().sentence`, written once, read by Settings and by the composer's preview).

- **C.2 — NEVER A BLANK BOX.** Communications opened on an empty rich-text editor and a blinking cursor; that is the moment a fundraiser closes the tab. It opens on **six real emails** now (`shared/emailTemplates.js`, pure): Appeal, Thank-you, Year-end, Event invitation, Sponsor update, Newsletter — in the org's name, its vocabulary (BUILD-86), its band colour and its logo. The sponsor update is offered ONLY to an org whose own word for a monthly giver is a sponsor; everyone else sees five. **The blanks are only facts Steward cannot know** (the evening's date, the month's news) and each one names what goes in it. The composer is editor-left, **live phone-width preview right, rendered by the SAME renderer the send uses with the FIRST RECIPIENT's own first name in it**; merge fields are chips, and the chip list is now the renderer's own list (`{{last_name}}` was offered and has never been replaced — every email that used it went out with the braces showing). The segment reads as people: "3 donors, including Margaret Chen and Bob Harmon" — nobody notices 17 is too many, everybody notices a name that should not be there. **"Send me a test"** goes to the caller and is refused for anyone else (a "test" to a donor is a send); it writes no recipient row and no interaction. **A campaign send writes exactly ONE email interaction per recipient** (`metadata.via = "campaign"`), so the timeline and Drift see what she sent. ONE emerald action ("Send to 3"); schedule is a link, and a chosen segment chip is a STATE (cream + emerald hairline), not a second action.

- **THE WALK** (`scripts/build88c-walk.js`, 18/18): Communications opens on the six in her org's name, Appeal arrives written, the preview reads "Hello Margaret" because Margaret is first on the list, the segment says "3 donors, including Margaret Chen and Bob Harmon", and "Send me a test" puts one email in her own inbox — `[Test]` in the subject, her org's name in the From, a Reply-To that reaches her, no recipient row and no interaction on anybody's record. The captured email is then READ AT 390px: no sideways scroll, nothing off the right edge, no body type under 14px, no merge braces. **The last step of the brief's walk is Jonathan's** — this stack's Resend key is a dummy and the mail lands in the local sink, so a real send to jonathan@stewardapp.dev and a real phone is the one thing the walk cannot do for him. (A bare email document lays out at 980px: the harness inserts the `width=device-width` viewport a phone's mail client supplies, or every measurement is a fiction.)

- **THE DEFECT C.2's OWN TEST FOUND, and it is the worst one in the product: AN EMPTY SEGMENT SENT TO EVERYBODY.** `resolveCampaignRecipients` filtered `byStage`/`byTier`/`manual` only `if (list.length)` — so a campaign that named no stages, no tiers or no people fell THROUGH to every donor with an email address. She deselects everyone, presses send, and the whole list gets it. An empty explicit segment is **zero people**, in the preview and in the send (`tests/build88c-composer.test.js` §2). Also found: `t("donor", 2)` returns null — the vocabulary key is `giver` — which had the segment sentence reading "3 null, including Margaret Chen".

## BUILD-86 PARTS B + C — HER WORDS, ONE PALETTE, AND FOUR DASHBOARDS (2026-09-16)
Suites `tests/vocabulary.test.js` (49) · `tests/palette-census.test.js` (13) · `tests/dashboards.test.js` (52), all in run-all + CLIENT_SUITES. Fixture `docs/build86/notes.txt`. Decisions `BLOCKED-build86.md`.
- **PART B — HER WORDS.** `shared/vocabulary.js`: nine fixed keys on `orgs.vocabulary_json`. **The defaults ARE today's strings** (the no-op path is byte-identical, which is what makes it safe), **only the DIFFERENCE is stored** (so a later default change still reaches an org that chose nothing), **the plural is STORED not computed** (somebody's word is "clergy"), and it **NEVER reaches a receipt, a year-end statement or the portal** — asserted, because a §170 acknowledgment is a legal document. `orgPeriodBounds` AND `orgReportYear` both read `fiscal_year_start_month` (the suite caught the second still on the hardcoded July: a January-fiscal org would have got right bounds and a WRONG YEAR LABEL on one report). The first run **ASKS, it does not wall** — a modal on Home would block every existing org's next login. Settings → Your words, forever after. Demo seeded with Heart of Africa's words.
- **C.1 — ONE ACTION COLOUR.** `#10b981` (83) and `#1a6b4a` (135) swept from the app; `T.green`/`greenMid`/`greenDk` ALL point at emerald `#0d5c3a`, repainting 358 call sites through a 3-line change. **brand-allowlist derives what is legal from that token object, which forced the sweep and the collapse into ONE commit** — the right forcing function. Contrast improves both ways. **Overdue is BRASS, not red**; red is only a destructive confirm. **SAGE IS DELETED** — 107 literals → cream at reduced opacity (`sage400`/`sage600`), because the rule's warm grey scores ~2.0:1 on ink and the contrast guard would rightly refuse it; cream adds no colour at all. Sage survives only on the landing + donor giving dashboard, which carry their own audited palettes.
- **THE CENSUS RATCHETS, and that is the same rule with a date on it.** Zero-hex-outside-tokens is 1,404 → **1,217** across 49 files; CLAUDE.md already called the full migration a non-overnight pass. `tests/palette-census.test.js` holds the FINISHED parts at ZERO (no second green, no bright library red, overdue brass) and makes the rest CEILINGS THAT MAY ONLY FALL, printing a note when the gap opens. `rgb()` was raised ONCE, deliberately, because cream-at-opacity IS an rgba.
- **C.2 — THE NOTE (`shared/homeNote.js`).** Part A's sentence read like a log line ("Chen is at day 7."). Lead with the PERSON when one thing is late, the COUNT when several, still naming who waited longest. **Time in words, never a day count.** Numbers under ten spelled. No colons, no em dashes (a semicolon is allowed). **EACH STEP SHAPE WRITES ITS OWN SENTENCE** — a shared tail produced "is expecting a call about the gala two weeks ago and hasn't heard back", a tense clash you only hear by reading it. **`docs/build86/notes.txt` is twenty rendered notes in a row** and caught "Eight people are waiting on you; **1** has been waiting" on its first render — no assertion would have. **HOME IS FOUR THINGS**: the note, the Thread, Drift, the failing monthly gifts. "Needs your attention" and `commandCenterSection` (dead since BUILD-83, still holding a scroll to a deleted element) are gone. **BUILD-45 D-1's anchor/sibling finding MOVED to the thread rows rather than dying with the queue.**
- **C.3 — FOUR DASHBOARDS (`shared/dashboards.js`).** Board · Fundraising · People · Recurring, each ONE question. **NOTHING appears without a one-sentence definition**, and the registry test walks it: a metric added without one cannot reach a screen. The definition is ONE string from the registry to the hover and to the PDF footnote. Each dashboard is ONE parallel batch of reads (the BUILD-54 §1 pattern), never a query per metric. **PDF equals the screen IN CENTS** and prints every definition. **0.6 ANSWERED**: "stewardship debt" → **Gifts not yet thanked**, counted only from the org's **first import** (an imported file is history — using the earlier of org-creation and first-import counted a pile of history as thank-yous owed); **first-touch delay REMOVED** (it measured the import date, not the donor). **REMOVED**: Board management (its render was still keyed on tab id `board`, which C.3 reused, so BOTH drew on one screen), the platform-fee banner, My portfolio. Pipeline funnel is **Team-only** — a one-ED shop has no funnel.
- **Gotchas this build paid for:** `pg` hands a DATE back as a **JS Date**, so `String(row.d).slice(0,10)` yields `"Tue Aug 12"`, compares against a TEXT ISO column as garbage, silently matches nothing and **reads as good news** — format with `TO_CHAR` in SQL. A magnitude heuristic on money ("over a thousand, treat as money") put a bare `500` under `$5,000`; **a value's kind is DECLARED, never inferred**. `Math.round()` on a dollar figure trips `money-cents` and rightly so. A new parameterized route needs a tenant probe **or a reasoned `PARAM_EXEMPT` entry**. And three separate guards had to be taught that **a comment is not a screen**.

## BUILD-86 PART A — HOME, AND THE BOARD MEETING (2026-09-16)
**Home is hers at 7:40 in the morning. Dashboard is the board meeting.** Findings + the four adjustments to the brief: `audit/BUILD-86-FINDINGS.md`; suite `tests/build86.test.js` (52, in run-all + CLIENT_SUITES); walk `scripts/build86-capture.js` (18, ALL GREEN) → `docs/build86/`. **Part B (vocabulary) has NOT started — it is gated on the Heart of Africa meeting, per the brief.**
- **TWO SURFACES, ONE REGISTRY.** `surface: "home"|"board"` is a property on `HOME_SECTIONS` (`client/src/lib/homeLayout.js`), which is the whole reason this is a MOVE and not a rebuild: the sections, the ordering machinery and the per-user saved layout (BUILD-34) already existed. ONE layout array holds both; the surface is a filter at render. `<Dashboard surface="home"|"board">` — the same component, differing only by prop, because a second component is two places to keep a section. **Home:** setup · **thread** (unhideable) · drift · **recurring**. **Board:** **hero** (unhideable) · retentionPipeline · monthly · myPortfolio · impact. **The `dashboard` tab id KEEPS its route and its "Home" label** so every deep link, `navigateTo("dashboard")` and the morning email work unchanged; `board` is a new id beside it.
- **THE SENTENCE — `client/src/lib/morningSentence.js`** (pure, JSX-free, clock passed in). Assembled from the three sources that already exist and are already capped: Thread, Drift, failing monthly gifts. **Three rules:** (1) **NEVER A TEMPLATE WITH HOLES** — a source with nothing contributes no clause; "0 people to thank" is the product filling a screen with its own scaffolding. (2) **A NAME BEATS A COUNT** — one thing is named ("Harmon is at day 24"), several are counted with the most urgent still named; **surnames**, the way a fundraiser says it aloud, but an ORGANISATION keeps its whole name (never "Foundation"). (3) **NOTHING WAITING IS AN ANSWER** — "Nothing is waiting on you this morning." is allowed to be the whole screen. Comma-separated clauses, no "and" (the brief's own rhythm); **small numbers are SPELLED** ("Three conversations overdue") because a sentence read aloud does not open with a numeral, while a DAY COUNT stays a numeral (a reading, not a count of things). Asserted on the FAMILY of all eight source combinations, never one string.
- **FOUR ADJUSTMENTS TO THE BRIEF, each to keep "it is only a move" true.** (1) **"since her last login" is NOT SUPPORTED** — no last-login stamp exists on this path, so it would have been new state; it is also the wrong thing to want (a fundraiser back from a fortnight would meet fourteen days of failures on her calmest screen). **Fixed 7-day window**, `RECURRING_WINDOW_DAYS`. (2) **"Home renders no numeric-only element" would fail against BUILD-85's own Thread card**: the open/overdue count and the "and N more" line STAY (each labels the named rows directly beneath it); the **30-day continuation rate MOVES** to the board (a performance measure over a period, and the only one of the three she cannot act on). The test encodes the brief's real sentence — **no row on Home is a number without a name attached**. (3) **Part B is scoped to the enumerated surfaces**, not to 0.3's count: "donor" appears **2,513** times in client/src and **~134** are rendered text; the rest are identifiers that must not change. (4) **Vocabulary must NEVER reach a receipt, a year-end statement or the donor portal** — a §170 acknowledgment is a legal document.
- **`/recurring/health` now returns `atRisk[]`** — the same subscriptions `atRiskCount` already counted, with the donor's NAME, amount and how long it has been failing, capped at 6. Not a new metric: a count that finally says who. It is what lets the failing gifts be a row group of people rather than a figure inside a card of board metrics.
- **Found by the build's own walk, fixed in the product:** (1) **"day 0" reached the screen** — a thread planned this morning against a date already past is genuinely overdue and genuinely zero days old; the sentence now says how LATE it is instead, and the row says "planned today". (2) **TWO NUMBERS FOR ONE FACT** — the sentence read "24 days overdue" directly above a row reading "Overdue 23 days", because it derived lateness from the browser clock while the row used the org's civil calendar. `overdueDays` is computed ONCE, server-side, and shipped on the row; the sentence only reads it. (3) **`moveToTop` sent a board section above the hero** — "top" means the top of the section's OWN surface now, rail intact.
- **Reviewed contract changes:** `tests/home-layout.test.js` (the canonical list is Home-then-board and **two** sections are unhideable, one per surface; the move-to-top rail is surface-scoped), `tests/empty-states.test.js` (walks the new tab; the retention and at-risk probes FOLLOW the sections that moved — Drift's stays on Home), `tests/presentation-wiring.test.js` (the goal-hero figures are asserted on the board, plus the new rule that Home carries no goal percentage; **`goTab` not `nav`** — on mobile the board is in the More drawer).

## BUILD-88b — NOTHING TO LOG (2026-09-16)
Built in the `build-88b` worktree on top of 88a. **Ten cheques: 39.4 seconds and 79 interactions before, 6.7 seconds and 7 after** (`scripts/build88b-deposit-timing.js`, both runs driven in a real browser on the same ten lines, both landing the same $4,973.83). Battery: **154 suites, 0 failed**; landing verifier 64; walk `scripts/build88b-walk.js` (21, ALL GREEN) on a ten-line slip typed out of the v3 fixture. Suites: `build88b-deposit` (70) · `build88b-pledges` (43) · `build88b-thankyous` (37), all in run-all CORE.

- **B.1 — THE DEPOSIT SHEET** (`shared/depositSheet.js`, pure; Fundraising → **Deposits**). Paste the slip's lines; **nothing is placed by guess**. Four states in the four colours: **placed** (a person on file and a fund the memo NAMED), **placed_new_donor** (nobody answers to this name — a fact Steward checked), **needs_you** (an ambiguous name, an unmatched memo, an amount NEAR an instalment, an unreadable amount), **not_a_gift** (refund, transfer, grant draw, store deposit, programme fee, rent, interest, subtotal — on a known person a PAYMENT on the record, out of every giving total). **A GUESSED DESIGNATION IS AN AUDIT FINDING**: an unmatched memo carries the fund list and never General; a blank memo takes `orgs.default_fund_id` ONLY if somebody chose one. Fund aliases are the org's own (`fin_funds.aliases` — "Xenia", "Xenia UMC"). The gate is on the SERVER, not the button: `/deposits/plan` reads and writes nothing, `/deposits/commit` re-evaluates the whole plan and refuses with the arithmetic named, and an UNSTATED slip total is not a passed check. The deposit is an `imports` row with `shape='deposit'`, **reversible as a whole for 24 hours** (`POST /imports/:id/reverse` — gifts, ledger rows, timeline entries, drafts and the people it created with no other history; totals RECOMPUTED, never decremented). Every gift goes through 88a's `recordGift`. **Nothing is sent.**
- **B.2 — PLEDGES THAT KEEP THEMSELVES.** `pledge_installments` (created in B.1 because the deposit matches against them). An explicit schedule must SUM TO THE PLEDGE or it is refused with both figures; a stated cadence generates one with the remainder on the first. **A matching payment applies by itself from every door**, because the match lives inside `recordGift`; WITHIN TEN PER CENT IS DELIBERATELY NOT MATCHED there — a background path has nobody to ask, and the deposit sheet, which does, asks. A fully paid pledge closes itself and REPLACES the last payment's draft with the better thing to say. **Thirty days past due opens EXACTLY ONE thread** (`pledge_reminder`) with the note already written in her voice on `threads.draft_note`; the `threads_one_open` index makes a repeat structural. Deceased / do-not-contact / do-not-solicit get none. **A SHELL pledge (88a A.7) never goes late** — it is unfinished, not overdue. The morning sentence gains "Two pledge instalments are late."
- **B.3 — THANK-YOUS, DRAFTED** (`shared/draftNote.js`). Every gift through the one path earns exactly one draft (`thank_you_drafts`, unique per gift). **Four exclusions, each a case where a letter would be WRONG**: a pledge payment under $100, anonymous, do-not-contact/deceased, a sample donor. **Her voice from three samples she pastes in Settings**; until then ONE plain sentence naming donor, amount and fund. Steward lifts her GREETING and SIGN-OFF verbatim and nothing else — copying habits is defensible, copying sentences into a letter she did not write is not. The queue is Home's fifth section; Copy, Mark sent, Skip, and **"Mark all as sent" only after every draft has been OPENED**. Mark sent logs a conversation IN HER NAME (the Thread cycle runs, and A.5's weekly count sees it). Receipts untouched. **Steward never sends it.**
- **THREE DEFECTS THE PARTS' OWN WORK FOUND.** `POST /donors/:id/pledges` refused "1,000.00" because the guard ran `Number()` before the money seam. The thank-you queue wrote the actor's EMAIL as the logged-by name. And the walk caught the Deposits view being remounted by its parent's reload, which took the "it foots" confirmation off the screen the instant the deposit landed.
- Deferred on purpose: QuickBooks read-only pull, bank feeds, voice logging (BUILD-89).

## BUILD-88a — ONE SYSTEM, ONE MAPPER (2026-09-16)
Seven parts, seven commits, one battery at the end: **tests/run-all.sh 151 suites, 0 failed**; landing verifier 64 guards; walk `scripts/build88a-walk.js` (18, ALL GREEN). Suites, all in run-all CORE: `build88a-mapper` (67) · `build88a-one-gift` (53) · `build88a-one-task` (37) · `build88a-giving` (23) · `build88a-profile` (20, browser) · `build88a-week` (37) · `build88a-finance` (23).

- **A.7 — THE MAPPER, CORRECTED.** `/donors/import-combined` hardcoded NULL for a gift's `fund_id` and had no `payment_method` column in its INSERT at all, so **every imported gift in every org has neither** — which is why a real org's receipt read "Fund → new custom field" and "Payment Method → type". The write is fixed first, then the vocabulary: the CSV mapper now speaks the SAME standard vocabulary the workbook mapper has had since BUILD-82 (Fund/Designation → Fund; Payment Method → its own field, never the gift type; Gift Type → type; Legacy ID/Gift ID/Ref/Transaction ID → the external gift id; Donor Type → `donors.donor_type`). The workbook path stops burying the fund in a notes string ("Fund: X") and stops using the payment method as a gift type. **A fund named in the file IS a fund**: matched case-insensitively to the org's own, the rest created UNRESTRICTED before the gifts are written (a restriction is a board decision, not a column), and `fundNameFromCell` refuses a money-shaped cell so a shifted row cannot put "500.00" on the chart of accounts forever. With no Gift Type column the **BUILD-80 notes vocabulary** decides the kind. **AN ID THAT REPEATS IS NOT ALWAYS A DUPLICATE** — 28 pairs in the 2,500-row file share a legacy number and are plainly different gifts; an id identifies a gift only together with its date and amount, so a true repeat still dedupes and a collision is imported, surrenders the id (`external_id` NULL) and is counted. **A HOUSEHOLD IS TWO PEOPLE**: a household form that NAMES someone joins only that person (it used to fold into any same-surname person behind that email), and the CSV path declares `identityResolved` so the server's blunt email fold cannot undo it on the next run either. **A pledge payment implies a pledge** (shell pledges, linked). **Existing data is NOT back-filled by guessing** — runs before `FUND_METHOD_FIX_AT` carry one line on the Imports page saying to re-import.
- **A.1 — ONE GIFT, ONE PATH (`recordGift`).** Five places wrote a gift row and disagreed about what a gift is; one of them (the event attendee) used `ON CONFLICT DO NOTHING` with no conflict TARGET and minted a new gift on every save. Three rules: a gift row always carries a fund and a payment method; the timeline entry LINKS to the gift (`interactions.gift_id`) and holds **no copy of the amount**; the ledger posts under the BUILD-83 rule (`orgs.ledger_posting_enabled`, default true). **The amount-in-the-text is the Renee Castillo defect** — the profile drew one $5,000 gift twice, once from the gift row and once from the sentence beside it. Existing rows are backfilled where exactly one candidate matches; nothing is deleted and no note is rewritten. **"Gift received" in Log a conversation was `interactionType: "other"` and wrote NO GIFT AT ALL**; it is a gift now, with an optional amount and fund/method inline. `scripts/build88a-dedupe-gifts.js` clears real duplicates (**dry run by default**, never touches a row carrying a source key, recomputes rather than decrements). **TWO CASES FOR THE DEFAULT FUND**, found by the battery: a staff-typed gift takes the org's unrestricted fund (a picker was in front of them); a donor-initiated online gift that designated nothing stays undesignated. A REFUSED fund id never becomes a different fund.
- **A.2 — ONE TASK, EVERY SCREEN.** Threads and tasks stay two tables (a thread carries an opening interaction, a close kind and a one-open-per-donor constraint a task row has nowhere to put) and are read through **ONE composer**, ranked by the one ranking, each row carrying `kind`. Only a task attached to a DONOR joins. The profile shows every open item with a count; Home shows them under BUILD-85's cap of twelve with "and N more"; the morning email puts **Due today ABOVE overdue**. **No label begins "Follow up:"** — the label is the step (`stepFromNote`, or the type default), enforced server-side.
- **A.3 — FINANCE, EDITABLE AND FED.** A budget gains a **fund** (`budgets.fund_id`, nullable = the whole account) and its actual is measured against that fund's money; `basis=fiscal` reads the org's July 1 boundary through the one seam instead of `${year}-01-01` string arithmetic; `DELETE /finance/budgets/:id` is what makes the fund and the year editable and not just the amount. **FINANCE FEEDS FUNDRAISING**: with no goal set, the Fundraising card reads the year's contributions budget, says so, and moves when an admin edits it; an explicit goal still wins. **Finance is behind the Team flag** (`CORE_HIDDEN_TABS` in App.jsx) — Cowork's recommendation, **Jonathan's to overturn by emptying that set**; not a locked preview, because an empty ledger under a padlock is an advertisement.
- **A.4 — THE PROFILE, TIDIED** (layout and copy only). ONE emerald primary in the header; **first name everywhere** (`firstNameOf`, incl. the top bar); **the send panel is gone from the profile** — Steward prepares, she sends, and "Draft Email" copies to the clipboard; the Move Stage strip and Enroll in sequence render ONLY with the Team flag; **the wealth score is hidden** until `WEALTH_SCORE_DEFINITION` and `WEALTH_SCORE_SOURCE` carry real strings (a number an officer uses to decide how much to ask for, that nothing on the screen defines); the voice guard reaches the rendered timeline (zero em dashes, zero build-tagged strings).
- **A.5 — THE WEEK IN REVIEW IS THE ACTIVITY REPORT.** `composeActivityReport` takes a WINDOW, not a period name, which is what makes it auditable: **the seven single-day windows of a week sum to the week, in integer cents**, and the suite takes it apart that way. Five figures — conversations logged, gifts received (count and dollars), thank-yous marked sent, follow-ups closed by outcome, follow-ups dismissed — per user and org-wide, in the email AND on the People dashboard's "This week", from one counter with one definitions table. **A boolean cannot answer "this week"**: `gifts.acknowledgement_sent_at` is stamped now, and a gift acknowledged before that belongs to NO week, which the definition says out loud.
- **A.6 — GIVING, NOT REVENUE.** No dashboard label, definition, rail entry or board PDF says "revenue". The board says **"Giving this year"** with the definition that names what is not in it. Optional, off by default: one typed **"Other income this year"** on its own line directly under giving, **never summed into it** — half of that sum would come from gifts Steward holds and half from a number nobody here can check. Absent when off, not a $0 row.
- **A DEFECT THE WALK FOUND, of this build's own class**: the conversation form's fund picker named "Gala Reserve" (first unrestricted fund in a NAME-sorted list) while the write used "General Operating" (`ensureOrgLedger`'s oldest). Which fund is the default is the SERVER's to say — `/finance/funds` marks it with `isOrgDefault` from the same function the write uses.
- **DONE, in BUILD-90 (2026-09-20).** The billing date was left as "December 31, 2026" on three surfaces because the code still granted free access through that date. BUILD-90 did the money math — **thirty days from SIGNING**, not from import commit as this line originally proposed (Jonathan's 19 September decision: a date a customer can move by re-importing is not a date a contract can name). See the BUILD-90 section above.

## BUILD-87 PARTS 1-4 — WHAT HUBSPOT TAUGHT, AND NOTHING MORE (2026-09-16)
Four things a small office needs, each in the smallest honest form. Built in two PARALLEL WORKTREES (1+2+4, and 3) under a user-issued speed override and merged in order; suites `tests/imports-history.test.js` (32) · `tests/import-sentence.test.js` (52) · `tests/bookkeeper-export.test.js` (58) · `tests/inbound-email.test.js` (59), all in run-all CORE. Decisions `BLOCKED-build87.md`. **Deliberately NOT built: Mailchimp/Constant Contact sync, any inbox or calendar OAuth, import undo.**
- **PART 1 — NAMED IMPORTS AND A HISTORY THAT RECONCILES.** New `imports` table (**no prior shape existed** — BUILD-88 Part 1 has not landed, so this creates it and reserves `shape='deposit'` so deposits land here rather than in a second table). `POST /imports` · `GET /imports` · `GET /imports/:id`. The name defaults to the filename with the extension stripped, is editable on the review step and is **uniqued per org** ("steward-leads (2)"). **THE SUMMARY IS STORED, NOT RECOMPUTED** — a donor created after the import does not move a figure on its receipt, which is the entire point of keeping the object; the BUILD-83 read-back is computed on the CLIENT, so the importer POSTs the one it is rendering. **The BUILD-72 invariant now asserts against the STORED row, in cents, and a disagreement is a FINDING carried on the row, the list and the receipt — never a silent repair.** Evidence that edits itself to look consistent is worth nothing. Settings gains a read-only **Imports** page; there is no undo in this build and the page SAYS SO rather than leaving the absence to be discovered.
- **PART 2 — THE MOMENT AFTER IMPORT (`shared/importSentence.js`, pure, JSX-free, clock-free).** The receipt opened on a table; it opens on ONE sentence built from the decisions the user made in the mapper — exclusion flag, gift type, date convention, duplicates review — read through BUILD-86's `t()`. Same three rules as the morning sentence, because they are the same rules: **never a template with holes**, **her words**, and **never claim a balance you cannot back** ("all of it accounted for" only when the equation balances in integer cents). **A FOLD IS NOT A SET-ASIDE** — only exclusions and routed gift types ride "set aside as you asked"; saying it about a date fold is a lie about where the money went. Order is sentence → three large numbers → balance line → table, with ONE primary action, **Open Home** (and without a navigator it stays "Done" rather than a button that lies). The sentence is built once and stored on the Part 1 run, so a reopened receipt says what it said that morning. Asserted on the family: each of the four kinds alone, then **all sixteen subsets** checked for holes, dangling joins and unterminated sentences.
- **PART 4 — THE BOOKKEEPER'S EXPORT.** A report key on the BUILD-79 file layer (`reportBookkeeper` + a `case` in `reportToCsv` + the one `sendReportCsv`) — **no second export path, no new route**. Eleven fixed columns and nothing else: a bookkeeper's file is not a CRM dump. Totals by fund is the same data a second way, on screen and as a trailing section of the same file; a gift with no fund is its own "(no fund)" line, never folded into whichever fund sorts first. **SOFT CREDITS AND MATCHED GIFTS CANNOT APPEAR** — they live in `donor_relationships` and this query reads `gifts`; the one leak path (a human typing "soft credit" into a gift type) is refused by name, and **the DAF grant itself is money that arrived and stays**. **THE FILE HAS TO FOOT, IN CENTS, BEFORE A BYTE IS WRITTEN**: `bookkeeper.js` compares the rows, the database's own sum and the fund totals, and a mismatch is a **409 that never reaches `reportToCsv`** — nothing is repaired, because a bookkeeper's file that does not foot is worse than no file, since it will be trusted. **The database sum is asked for EXACTLY, not pre-rounded to the file's two decimals** — rounding it there would make the two sides agree by construction, and a number that cannot disagree is not a check. `gifts.amount` is `NUMERIC(12,2)`, so on the live schema the two sums cannot currently part company; the rule is therefore a pure module proved on a SYNTHETIC tree carrying each defect in turn (the `date-seam` §8 pattern), because a guard that can only be observed silent is not measuring anything.
- **PART 3 — EMAIL LOGGING BY BCC, AND NO PROVIDER CHOSEN.** `log+<org_slug>@<inbound domain>`, BCC it and the mail lands on the donor's record. **THE WHOLE SURFACE IS OFF BY DEFAULT** (`INBOUND_EMAIL_ENABLED`, the `requireFlag` convention — disabled means 404, not "403 coming soon"), proven byte-identical against a SECOND server booted without the flag rather than against a source string. **THE TENANT WALL, asserted as a FAMILY of eight shapes: the org is the plus-address and NOTHING else, and the sender must be a user of that org.** Both refusals are counted, never guessed; org B's rows are content-hashed before and after the whole family and must be byte-identical. A shared secret on the webhook is what stops anyone who has seen a BCC line from writing into a CRM, and **the flag on with no secret set answers 503 on purpose**. One match logs, no match or several HOLD in an Unmatched list, and **an inbound email NEVER creates a donor**. The matcher's first cut kept one donor per address; its own test caught that **a couple sharing an email** would have been filed on whichever row the query returned first. Ids travel in the BODY on the three Settings routes, so no new parameterized route and no `PARAM_EXEMPT` excuse. **NO SUBPROCESSOR IS CHOSEN AND NO DNS IS TOUCHED** — who receives donor correspondence is a new third party and a DNS change on a domain already carrying two live mail configurations, which is a decision about what leaves the system; the webhook takes a normalized payload any provider adapts to, and `BLOCKED-build87.md` carries the candidates, the root-MX/send-MX/**third-subdomain** constraint and the five steps to switch it on.
- **Findings surfaced, not fixed here:** `/donors/import-combined` hardcodes `NULL` for a gift's `fund_id` and `payment_method`, so **an imported gift arrives with no fund and no payment method — two columns the bookkeeper's export shows**. `tests/reports.test.js` (not in run-all) cannot log in as `admin@willow.test` on the shared scratch database, identically against an untouched checkout: a fixture collision, not a regression.
- **Gotchas this build paid for:** agent worktrees live at `.claude/worktrees/agent-*` and are whole checkouts of this repo — `tests/legal-entity.test.js` walks from the repo root and red-lit on its own reflection until `.claude` was skipped (`no-emoji` and `deploy-shape` scope themselves with `git ls-files` and were fine). `.gitignore`'s `node_modules/` has a trailing slash, so a worktree's node_modules SYMLINK is untracked-but-not-ignored and a `git add -A` would commit an absolute path. `tests/tenant-matrix.test.js`'s reset list must gain every new table or the suite stops being re-runnable after any crashed run.

## BUILD-87 PART F — THE THREE THINGS PRODUCTION WAS SHOWING (2026-09-16)
Part F is three independent fixes seen on the live site on 15–16 September, one commit each, ahead of the rest of the build.
- **F.1 — ONE MODAL SHELL.** Guard `tests/modal-shell.test.js` (26, in run-all + CLIENT_SUITES); walk `scripts/build87-f1-walk.js` (four dialogs measured at 1440 AND 390, ALL GREEN). **`Modal` in `shared.jsx` is now the only dialog shell in the authenticated app** — twenty-eight ad hoc ones are gone. It portals to `document.body`, backdrops `position:fixed; inset:0`, caps the dialog at `90vh` with its own body scrolling, takes an optional STICKY FOOTER so a long form's primary action cannot be pushed out of reach, ref-counts the body-scroll lock (a dialog opened from a dialog must not unlock the page early), closes on Escape and returns focus to the opener.
- **THE CAUSE WAS ALREADY WRITTEN DOWN TWICE AND HAD NOWHERE TO LIVE.** `.fade-in`/`.slide-in`/`.slide-up`/`.modal-anim`/`.gold-moment` all animated a TRANSFORM with **`animation-fill-mode: both`**, so the final keyframe's `translateY(0)` was retained forever — and an element with any transform other than `none` is the CONTAINING BLOCK for every `position:fixed` descendant. A "fixed" backdrop inside one is fixed to a div that may be four thousand pixels tall, which is exactly what clipped the Edit-campaign dialog below "Start date" under a half-height backdrop. BUILD-22 found this; `RecurringGiving` and `MetricBreakdownPanel` each portalled their own way out and the other twenty-eight shells did not. **Fixed at BOTH ends**: every dialog portals, AND the fill-mode is `backwards` (which holds the from-keyframe before the animation and reverts afterwards — every one of these keyframes ends on the identity transform, so it is visually identical and structurally inert).
- **What the walk found that no source assertion could.** (1) **`onClose` is an inline arrow at nearly every call site**, so keeping it in the effect's dependency list re-ran the whole open/close cycle on every render of the parent — each re-run's cleanup restored focus and each new run re-read `document.activeElement`. (2) Then, with that fixed, focus STILL landed on `<body>`: **React applies a child's `autoFocus` during COMMIT, which is before `useEffect` runs**, so an effect that reads `document.activeElement` on mount reads the dialog's own first field and "returns" focus to a node about to be unmounted. The opener is captured **during render** now. Both were invisible to the markup and visible the moment something measured where focus actually landed.
- **The guard's line is the SCRIM, and it is proven able to fail.** A dialog is a full-viewport fixed layer that centres a box on top of a page you can still see; a side drawer, a full-screen takeover, a check-in kiosk, a toast and an invisible click-catcher are not dialogs, and calling them modals to make a number look better would be the guard lying. The distinguishing property is that a dialog's backdrop is **translucent** (`rgba()` or a hex WITH an alpha channel) — an opaque fill is a screen. §4 runs the detector over a synthetic tree containing the exact defect and over each shape it must not flag, including the same opaque loader re-tinted, so the scrim test is shown to be doing the work. **Three named exclusions, with reasons**: `shared.jsx` (it is the shell), `pages/Landing.jsx` (the EAGER entry chunk — must never import shared.jsx, same rule ProductMark carries) and `pages/Donate.jsx` (public white-label on `publicTheme.js`, not the app tokens). Both public pages are top-level routes with no transformed ancestor, so neither can hit the trap.
- **F.3 — HOME, LAID OUT.** Layout only; no query, no logic, no new number. Walk `scripts/build87-f3-walk.js` (67 assertions at 1440 AND 390, ALL GREEN). **The header is a greeting and a sentence, in that order of SIZE** — the org name at 16px bold used to sit above the note, so the biggest thing on her morning screen was the name of the place she already works; it and the greeting are now one 12.5px line and the note is a 40px DM Serif headline at a **24ch measure**, in **one 1100px centred column** (`.dash-col`, Home only — the board is a grid of numbers, not a page of prose). **The ProductMark pills are off Home**: a pill introduces a product to somebody who has not met it, which is the landing page's job; the names are plain serif with the brass underline `PageTitle` already uses. **A thread row is a name, one clause and one emerald action** — "Meeting · 2026-09-09 · She asked for the import report · Admin User" became "She asked for the import report a week ago." (`threadClause`, reusing BUILD-86 C.2's `agoPhrase`), with the touch type, the exact date and the people on **hover** (`.attn-meta`, opacity not display so the row never changes height, `:focus-within` for a keyboard, and always-on under `(hover:none),(pointer:coarse)` because a phone cannot ask). `rank.why` stays — BUILD-85's rule that a row always answers "why this one first" — but is no longer emerald: **on this screen emerald means "this is the button", and exactly one thing per row may mean that.** **Empty states are ONE LINE with the working behind a "why"** (`OneLineEmpty`); the detail is **unmounted, not hidden**, because text that is present but invisible is how an empty state lies to a test. **Cards: 32px horizontal padding, 24px gap, hairline, no shadow** (vertical stays tighter than 32 on rows — a 32px gap above every name turns a twelve-row queue into a scroll).
- **F.3.5 — THE RAIL IS FIVE ITEMS AND A "More".** BUILD-20 Part 3's three labeled groups put eleven items on the rail at equal weight. `PRIMARY_NAV` = Home · Dashboards · Donors · Fundraising · Reports (Settings still pinned at the bottom); `MORE_NAV` = Pipeline · Grants · Communications · Tasks · Workflows · Finance · Portal, inside a disclosure shut by default and remembered per browser. **It opens ITSELF when the surface you are on lives inside it** — walked through the top-bar search onto Grants, because a rail that cannot admit where you are standing is the one way this split could have made the product worse. **A portal-tier org gets its portal tab on the RAIL, never folded away** — its entire product is that surface. **MOBILE IS UNCHANGED**: the bottom bar + More drawer is already this shape and four slots is a different constraint.
- **F.3.7 — AND THE SEED HAD TO REACH THE ORG THAT ALREADY EXISTS.** BUILD-86 C.3 changed the demo admin's literal to a real name and stopped there, so a fresh scratch DB got it and **production's demo org — created long before, and therefore hitting `ON CONFLICT (id) DO NOTHING` on every boot since — kept saying "Admin User" on every row.** That is what was on the screen on 16 September. The upsert now corrects **`name` and only `name`** (the password, the email and the role are somebody's login), seeded as **Mike Henderson**. A colleague renders as a **first name** (`firstNameOf`, shared.jsx), and one name when the logger and the owner are the same person — "Mike · Mike" is the software talking to itself.
- **Found by LOOKING at the walk's own 390px capture, not by an assertion:** the thread row's three regions all drew **on top of each other** with "Dismiss" off the right edge, and every text assertion above it was green. The row stacks on a phone now, and the walk gained the check that would have caught it — **no two regions of a row may overlap, and every action button must be inside its card** — plus the band header's 3px transparent left border, without which "OVERDUE" started three pixels left of every name it labels.
- **Reviewed contract changes:** `tests/presentation-wiring.test.js` (the pill is asserted ABSENT from Home and the two products asserted still NAMED), `tests/empty-states.test.js` (the BUILD-76 "the zero shows its work" probe now clicks "why" first — same teeth, one click further), `tests/locked-features.test.js` (the three NAV_GROUPS assertions follow the split, and gained the two properties that matter more: no id in both lists, and **every id in `TABS` reachable from the rail or from More**), `tests/build86.test.js` (Dashboards-under-Home reads the rail's order instead of two call sites), `scripts/build81-capture.js`.
- **Gotchas this part paid for:** a `</div>` placed before `{layoutError&&…}` lands INSIDE a pre-existing `{(<>…</>)}` that wraps the gold moments, the sections, the layout error and the set-goal modal — babel says `Expected corresponding JSX closing tag for <>` and points at the close, not the cause. `getComputedStyle` resolves `24ch` to px, and `innerText` applies `text-transform` (the rail's group label comes back "MORE"). A search result committing on **`onMouseDown`** ignores a synthetic `.click()`. A desktop window narrowed to 390px still reports a mouse, so `(hover:none)` needs Playwright's `hasTouch`/`isMobile` to be tested at all. And the run-all boot needs **`DONOR_ACCOUNTS_ENABLED=1 NETWORK_SIGNUP_ENABLED=1`** or thirteen suites red-light on a `/network/signup` 404 — an environment gap wearing a product failure's clothes, exactly as `tests/README.md` warns.

## BUILD-85 — THE FOLLOW-UP ENGINE (2026-09-15)
BUILD-81 built a careful RECORD of commitments and half an engine. This is the other half. Findings `audit/BUILD-85-FINDINGS.md`; decisions `BLOCKED-build85.md`; suite `tests/build85.test.js` (62, in run-all + CLIENT_SUITES); walk `scripts/build85-capture.js` (18, ALL GREEN) → `docs/build85/`.
- **IT IS ONE PERSON'S LIST.** `composeThreadNudge` took no user and `runThreadNudgesForOrg` sent the IDENTICAL org-wide list to every user; threads carried `owner_id` and nothing read it. (The irony: the older Tasks reminder already had the per-officer scoping the flagship system lacked.) Both composers take a user now, `scope=mine` is the default, and **the gate is the SERVER's** — a non-admin asking for `scope=all` is DOWNGRADED, not refused (the BUILD-31 pipeline precedent). **Unowned threads ride the ADMIN's own list** as a backstop and nobody else's; `stat.unowned` is reported so the condition can be fixed rather than tolerated. The Home toggle follows the BUILD-32 rule (admin + multiOfficer only).
- **A QUEUE, NOT A WALL — `shared/threadRank.js`.** Pure module. **(1) Every point is named** — the score is a sum of bounded, individually labelled signals, so a row can always say why it is there in the user's own words. **(2) MONEY IS RELATIVE TO THE ORG, NEVER ABSOLUTE** — every money signal is scored against the org's own p90 of lifetime giving; absolute-dollar ranking is how a CRM starts telling a food pantry its work is small. **(3) The score NEVER reaches the screen** — it orders the list and stops; the UI shows the order and the reason. Signals: recurring_risk 34 · overdue min(d,21)×3 · ask_open 26 + ask_size ≤14 (relative) · thank_decay min(d,14)×2 · first_gift 22 · major_donor 18 · due_today 8 · stale 10. **Bands are FACTS** (overdue/today/ahead off the due date) — deliberately no "high priority" band, which would need an invented threshold. `QUEUE_CAP=12`, `EMAIL_CAP=10`, **and the remainder is STATED**. Two display mechanics: `supersedes` (a decay reason replaces the generic overdue one it is derived from) and `lead` (a signal whose value is EXPIRING takes the headline regardless of points — a major donor's late thank-you must not lead with "top tenth").
- **ONE MORNING EMAIL — `runMorningBriefForOrg`.** `processDailyTaskReminders` and `processThreadNudges` shared the same [6,12) window and sent SEPARATELY. Now both ticks land in one sender which **reserves BOTH `digest_sends` ledgers** (`thread_nudge` + `daily_tasks`), so whichever arrives first sends and the other finds the reservations taken — two timers, one email, neither idempotency ledger rewritten. Both prefs still mean something (opted out of one → that section drops; both → no email and nothing reserved). **The weekend rule moved to the THREAD SECTION**, not the email: a Saturday list of open threads is an intrusion, a task the user dated Saturday is their own commitment. Admins also get a **roll-up** — counts per officer, never everyone's rows.
- **YOU CAN LOOK FORWARD.** `POST /donors/:id/threads` + `POST /threads/plan` (a selection, ≤200). **This does NOT reopen the tasks battle** — that rule was "logging must not require a second step", never "you may not plan". A planned thread is the same row as any other; `lastTouch.kind==="none"` (a case composeThreads always handled) renders as "Planned". One-open-per-donor holds: the single route **409s naming the commitment already there**, the bulk route **skips and reports**, and the partial unique index is the arbiter under a race.
- **THE NUMBER THE CLAIM RESTS ON.** `GET /threads/health` + snapshots `threads_open` / `thread_days_to_close` / `thread_continuation_rate`. **Continuation** = of the threads closed as an outcome, how many had their closing conversation open the next one (the join IS the chain: `b.opening_interaction_id = a.closing_interaction_id`). A rising open count with a falling continuation rate is a list being CLEARED, not relationships being kept. Thin data is said not smoothed (<5 closes → null, never snapshotted).
- **Found by its own tests, fixed in the product:** (1) **`major_donor` fired on EVERY donor at a young org** — `>=` p90 over a uniform donor base means p90 IS everyone's value; a signal that fires on everything is noise wearing a signal's clothes. Now strictly greater: no spread, no claim. (2) **The thank-you decay sentence could never reach a screen** (overdue scores 3/day off the same days that decay scores 2/day) — hence `supersedes`. (3) **A planned "Send thank-you note" missed the decay entirely** because `nextStepTypeForLabel` derives the type from the FIRST verb (`send`); the signal reads the LABEL now, not only the type — found by the walk. (4) The morning report could not tell "clear morning" from "opted out and missing three overdue threads"; it composes first and applies the preference second. (5) **Em dashes reached an email** (two rank reasons + the "and N more" line) — caught by thread-nudge's voice guard.
- **Gotchas this build paid for:** a new route needs `scripts/build75-route-inventory.js` re-run in the SAME commit or tenant-matrix red-lights (it needs `DATABASE_URL`+`JWT_SECRET`+`RESEND_API_KEY`+`STRIPE_SECRET_KEY` to boot); a new `scripts/*.js` fails script-guards until classified; **logging a gift ALREADY opens a thread**, so a walk that seeds gifts and then plans will silently 409 against its own fixtures (the walk now checks every write — a silently-ignored 409 is how a walk lies to itself).
- **Reviewed contract changes:** `tests/thread-nudge.test.js` subject (`"3 threads open · …"` → `"3 waiting on you · …"` — the count is threads AND tasks now; the escalation, which is the part that works, is unchanged) and its skip reason (owner-scoping means a staff member who owns nothing is `empty`, not `opted_out`). `tests/notifications.test.js` needed no edit once the task row said "Due today" rather than "Today" — preserving an existing contract over a one-word preference.

## RECURRING RECOVERY: THE PRE-FAILURE HALF (2026-09-11)
Everything in the recovery engine began at `invoice.payment_failed` — after the gift was already lost and the donor had already had an apology. Three additions close both ends. Suite `tests/recurring-recovery.test.js` (29, in run-all); decisions + the two dashboard steps in `BLOCKED-card-recovery.md`.
- **THE CARD THAT IS GOING TO DIE, BEFORE IT DIES.** `refreshCardsOnFile` + `notifyExpiringCards` + `processCardExpiry` (server.js). New `recurring_subscriptions` columns: `card_payment_method_id`/`card_brand`/`card_last4`/`card_exp_month`/`card_exp_year`/`card_checked_at`/`card_expiry_notified_for`. **IT IS A POLL, NOT A WEBHOOK, AND THAT IS NOT A SHORTCUT: Stripe's `customer.source.expiring` fires ONLY for legacy Card/Source objects and explicitly does NOT occur for PaymentMethod integrations** — which is what Steward uses (setup-mode Checkout → `setupIntent.payment_method`). Verified in Stripe's own event reference. Same shape as BUILD-84's geocoding queue: budgeted background sweep (`CARD_RECHECK_DAYS`=7, `CARD_CHECK_BUDGET`=200/tick, 6-hourly), answer stored on the row, nothing at read time. ONE Stripe call per subscription gets both (`expand: ["default_payment_method","customer.invoice_settings.default_payment_method"]` — a subscription with no default of its own inherits the customer's, and reading only the first leaves those rows blank forever). A failed READ stamps `card_checked_at` but NEVER blanks the stored card — a network blip is not a fact about the card. Window = **this month or next**; **one notice per card per expiry, stamped with the EXPIRY PERIOD (`YYYY-MM`), not a send date**, so a re-read cannot re-notify and a genuinely new expiry is eligible again by construction. Mail kind `card_expiring` = transactional; rides the org's existing `recurring_dunning_enabled` toggle; stamped only after a REAL delivery (the W-4 rule).
- **THE NETWORK FIXED IT ITSELF.** `payment_method.automatically_updated` (Stripe's Card Account Updater) is handled: store the new details and **CLEAR `card_expiry_notified_for`** — clearing is the point, the card has a new expiry and the donor should hear about that one. **Without this handler the expiry sweep emails donors whose card was never going to fail**, which is worse than sending nothing. `card_payment_method_id` exists solely so the event can find its subscription. **The live endpoint does NOT yet subscribe it** — `stripeEvents.js` declares it, `webhook-manifest` pins manifest==handler, and `/health.webhookSubscriptions` reports it MISSING until someone adds it in the Stripe dashboard (BUILD-62 class, made visible; see BLOCKED-card-recovery.md).
- **THE AUTOMATION HANDS OVER TO A HUMAN.** `openSustainerLapseThread`. The cadence is four emails over fourteen days; when it ran out `next_dunning_at` went NULL and the subscription was left to Stripe with **nobody told**. Now exhausting it opens a **THREAD** (BUILD-81's spine — not a task), owned by the donor's officer, **due TODAY** (it has already been failing a fortnight), labelled with the money and the cadence (`"Call about their $40 monthly gift — the card failed and our emails did not reach them"`). TWO callers, and the second is not redundant: **involuntary** `customer.subscription.deleted` also opens one, because an org with `recurring_dunning_enabled` off never runs a cadence to exhaust. `ON CONFLICT (org_id,donor_id) WHERE closed_at IS NULL DO NOTHING` makes both safe — they can never stack. A **voluntary** cancellation gets nothing (the BUILD-57 churn split is respected), and the person-surface gate is copied from `openGiftThread` verbatim (sample/deceased/DNC/non-person never handed over). Note: the opt-in `failed_recurring_recovery` WORKFLOW recipe still makes a *task* at the FIRST failure — different moment, different mechanism, no collision.
- **Staff see preventable money apart from lost money.** `/recurring/health` and `/recurring/movement` both return `expiringCount`/`mrrExpiring`; the Recurring tab's MRR line reads "N active sustainers · N at risk · N cards expiring" in its own colour. Deliberately NOT folded into at-risk — at-risk is money already broken, expiring is money one email still saves, and merging them buries the actionable half.

## BUILD-84 (2026-09-10) — WHAT A COLUMN IS, WHAT A DONOR IS, WHERE COORDINATES COME FROM, AND A TASK WITH A TIME
Found in one hour importing the REAL 444-row `steward-leads.csv` into a live org and opening the Map. Four customer-facing defects no fixture resembled. Findings `audit/BUILD-84-FINDINGS.md`; decisions `BLOCKED-build84.md`; suite `tests/build84.test.js` (151); walk `scripts/build84-capture.js` (41, ALL GREEN) → `docs/build84/`.
- **THE HEADER IS A SEQUENCE OF TOKENS, NOT A STRING (`shared/importShape.js`)** — `normalizeHeader` / `headerTokens` / `MEASUREMENT_QUALIFIERS` / `MONEY_WORDS` / `headerMatchesLabel` live ONCE and every caller reads them (the CSV mapper's private copies are deleted; the workbook's second normaliser is gone). **`\b` DOES NOT FIRE AT AN UNDERSCORE** — `_` is a word character — which is why `\byear\b` never saw `fiscal_year` and `\bzip\b` never saw `zipcode`. Normalise to tokens FIRST; then every `\b` means what it says.
- **P0-1 — being NUMERIC is not evidence of being MONEY.** `scanAmountShapedColumns` used to take every column whose cells parsed as money, sort by cell count, and let column order break the tie silently — so a drive-time column in minutes became the file's $12,840 while `revenue`/`contributions`/`deficit`/`contrib_lost_yoy` sat unread. Now a column qualifies on POSITIVE evidence only (currency marks in ≥20% of values, OR a money word in the header) and is disqualified by any measurement qualifier. **EVERY qualifying column is returned with its OWN subtotal and its own reason**; `sum` is the strongest SINGLE column, never a cross-column collapse. The dollar equation anchors only when there is no ambiguity — the mapped amount column, or the one and only qualifier — otherwise `inFile` is null and the receipt says so in a sentence. **`amountColumnEvidence(header, values)` is the one place that decides.**
- **P0-2 — AN ORGANIZATION IS A DONOR.** `resolveDonorIdentity({name, organization, email})` is the ONE nameability test, called from the CSV donor path, the CSV wide path, the CSV transaction builder and the workbook builder. Nameable = a person name **or** an email **or** an organization. When a row carries both, **the organization IS the donor and the person is the CONTACT on it** (`donors.contact_name`) — never folded into the donor's name. `donors.kind` is the donor type and now takes three explicit values (`person`|`organisation`|`anonymous`; NULL = a legacy row, read as a person). Set-aside vocabulary is `NAMEABILITY_REASON` = **"no name, email, or organization"**, one string, rendered by the pre-write line, the receipt and the downloadable file. On the real file this was 245 of 444 rows silently set aside — every one an organization, and the largest gift among them.
- **P0-3 — A STAGE ASSIGNMENT STATES THE INPUT IT USED.** `stageAssignmentBasis(mapped)` declares the basis as a FIELD LIST (`STAGE_BASIS_FIELDS`) and DERIVES the sentence; nothing is hand-written, so a basis that cannot be read back off the mapping cannot be claimed. No amount and no date → one stage, no distribution, and "No giving data in this file, so everyone starts in the same stage." **This closed two BUILD-83 leftovers**: `POST /donors/import` AND `POST /gifts/import-history` were still writing `stage` (the second gated on `stage='prospect'`, so fixing the first alone would have silently stopped re-inference forever). Both write `suggested_stage`; the guard is `stage IS NULL` — revise a suggestion, never a placement.
- **P0-4 — GEOCODE ONCE AT WRITE TIME, NEVER AT RENDER (`geocode.js`).** The Map used to call the PUBLIC Nominatim instance from the browser, once per donor, 1.2s apart, on every render, storing nothing — minutes of crawl at 444 donors, unreachable at 25,000, against terms requiring caller-side caching and forbidding systematic queries, and sending donor home addresses to a third party on every page view. Now: donor columns `latitude`/`longitude`/`geocoded_at`/`geocode_status`/`geocode_provider`/`geocode_key`; triggered by WRITES only (both import routes, `PUT /donors/:id`); server-side batched background job on the existing 5-min tick with a logged round-trip budget; **a record whose `geocode_key` is unchanged is never looked up twice, and the queue de-duplicates by address before spending a request** (444 donors = 408 lookups = ONE batched Geocodio call, measured). The map reads stored coordinates and its only network call is `GET /geocode/status`. **It always renders and says what it lacks** in the receipt's vocabulary ("444 mapped · 116 no address on file · 12 could not be located · 30 still processing"); nothing placed is a SENTENCE, never an empty grey box with a spinner. Provider seam: `GEOCODIO_API_KEY` → Geocodio, `GEOCODE_NOMINATIM_BASE` → a SELF-HOSTED instance, neither → **"unconfigured"** (job does not run, no address leaves the server, the map says so). **The public Nominatim instance is refused BY HOSTNAME in code.** `audit/data-handling.md` names what is sent (address fields only) and what is retained. **PROD PROVIDER IS JONATHAN'S CALL — `BLOCKED-build84.md`; until then prod has no pins.**
- **CENSUS — A MATCH RESPECTS THE BOUNDARIES OF THE UNIT BEING MATCHED (`shared/textMatch.js`).** Fourth appearance of the class (BUILD-82 `"Unnamed: 31"` → 23,867 donors discarded; mapper FIX `contact_confidence`→name; FIX-3 `600` inside `imp_6e5600ab`; BUILD-84's scanner). `tokenizeText`/`containsTokenRun`/`eitherContainsTokenRun` for text; `findLeaf`/`numericLeafEquals`/`textLeafContains` for payloads. **279 call sites enumerated and each given a verdict in the findings.** Fixed: donor-name containment in the thank-you queue and in `matchDonorForGift` ("Ann Lee" is inside "Joann Leewood"), `campaignMatchScore` ("Gala" scored 0.90 against "Galaxy Fund"), `normalizeStage` ("Alaska" read as *solicit*), `NEGATOR_PHRASES` ("Casino Mailing List" refused), the year-column `\b` regexes, and **all 16 `JSON.stringify(payload).includes(…)` guards in the suites** (they walk the payload through `tests/helpers.js`'s `leaks()`/`textMatch()`, the CJS door onto the one module). **RULE: never `JSON.stringify` a payload and then search the string** — `tests/build84.test.js` §4 walks the whole repo and fails the build if one reappears. A hit that stays a substring match is fine when the haystack genuinely has no boundaries (search boxes, free-text note markers, `email.includes("@")`) — that reason is written down once, next to the class.
- **FEATURE — A TASK WITH A TIME ON IT EMAILS AT THAT TIME.** Prerequisite established first: **the due field held NO time** (`threads.due_date TEXT`, every default `+N days`). `threads.due_time TEXT` (`HH:MM`) rides BESIDE it, nullable — a civil date is a day on a calendar in every timezone (orgTime's type discipline), so converting the column would have been the larger and wrong change. **Nothing was migrated, by construction.** **PRECEDENCE, stated once in `shared/threadShape.js` and read by BOTH surfaces** (`digestShouldSkip`/`stepReminderDue`): a timed task sends its own email and is out of the digest ON ITS DUE DATE ONLY; a date-only task stays in the digest and sends nothing; a timed task left open REJOINS the digest next morning as overdue. **The weekend rule INVERTS** — a time is a commitment to a moment, so `processStepReminders` has NO weekday gate (that absence is the rule), and Settings says so next to the toggle. 90-minute delivery window (a 2:00 reminder at 5:00 has lost the point). Button = the donor's **log-one-line screen prefilled with the task**, a plain GET that changes nothing. **`orgs.timezone_confirmed_at`** is the gate: `orgs.timezone` has always been NOT NULL with a default, so "has a timezone" meant nothing; without a HUMAN's choice the time field is not offered and the route refuses it (`timezone_unset`). Onboarding now asks, prefilled from the browser. Off switch `users.notify_step_reminder`, per-user, default on, in the SAME notifications list as the nudge. Recipient = the thread's owner, else creator, else the org — a time is one person's commitment. Idempotent via `digest_sends` `step_reminder`/`step:<threadId>:<day>`.
- **FIX (2026-09-10, same session) — AN ERROR HANDLER MAY NOT BLAME THE DATA FOR A BUG (`client/src/lib/domainError.js`).** The TDZ defect below is a NAMED CLASS now. **THE RULE: a catch around domain logic RE-THROWS anything that is not a domain error, and NEVER emits user-facing copy for one it did not expect.** An error handler that turns a bug into a data-quality message is worse than no handler, because it sends the user to fix their file — the same family as the rest of BUILD-84, **a screen stating something it cannot back**. TWO medicines, because a re-throw is not always right: **render path / pure computation → `rethrowProgrammerError(e)` as the catch's first line** (every tab is inside an `ErrorBoundary`, so a bug becomes an honest crash screen) — applied to `payload`, `bothPayload`, `mapperPlan`, `dateConvEvidence` and the workbook build, two of which were WORSE than the one that bit (a swallowed `mapperPlan` takes `cfUndecided` to 0 and would let an import run with columns nobody decided; a swallowed `dateConvEvidence` removes the mixed-convention block); **async event handlers → `errorMessage(e, fallback)`**, because React error boundaries do NOT catch an async callback's throw and re-throwing there gives an unhandled rejection and a stuck spinner — a domain error is quoted, a bug gets a sentence naming itself as ours. **141 catch blocks across 28 client files.** Typed mappers (`billingErrorMessage`, `PlanPicker`) are exempt from the rewrite and do the check themselves. Guard: `tests/build84.test.js` §4b **brace-matches** every catch in `client/src` (a ten-line window reported false hits — the same ignore-the-boundaries mistake this build censused) and fails the build if one puts words on a screen without routing the error first; proven able to fire. **Named, NOT fixed:** ~30 donor-profile catches that swallow into an EMPTY READ STATE (`.catch(()=>setMoves([]))`) — same family, but the honest fix is a per-panel "couldn't load" state and re-throwing would crash the profile on a wifi blink.
- **FIX (2026-09-10) — three review items.** (1) **The Geocodio cost figure was wrong and it is the one you'd quote to an ED**: the billable unit is a DISTINCT ADDRESS, only a new or changed one, and 2,500/day are free — 444 donors → 408 distinct → **$0.00**; 25,000 distinct → $22.50 in a day or $0.00 over ten; a steady-state org spends nothing. **Provider DECIDED: Geocodio**; `audit/data-handling.md` names it. (2) **The receipt caps the currency list at the largest THREE** with "and N more" behind them — display only, every column still scanned and still on `reconciliation.dollars.currencyColumns`. (3) **The timezone gate LINKS to the fix** — `navigateTo("settings",{section,focus})` carries a `focus` that names one card; the Time Zone card scrolls itself into view and rings. Refusing an action and then leaving the user to hunt for the fix is half a fix.
- **FIX (2026-09-10) — CI RED ON THE PUSH: a guard that was measuring the CALENDAR, not the code.** `import-messy-v2`'s "17 future pledge installments" became 16 on the 10th, because fixture row 1985 is dated **September 10, 2026** — future through the 9th, same-day on the 10th. Nothing in the push touched pledges; that guard was going to fail that day regardless. **THE RULE THAT SEPARATES THE TWO MEDICINES: pin a golden whose comparisons are all its own; SYNCHRONISE a suite that asks the SERVER a question about now.** `import-messy-v2` is pure (no `NOW()`/`CURRENT_DATE`/`INTERVAL` anywhere) so it is pinned to its fixture's `anchorDate` from key.json; `import-messy` and `import-messy-cf` ask the server clock-relative questions, so pinning one half desynchronised them (15 vs the key's 13) — they get the BUILD-83 fix, UTC → `civilToday()`. **And the live defect underneath it:** `buildTransactionRows`'s `today` defaulted to `new Date().toISOString()` (UTC) and the real caller passed none, so the import judged "future-dated" on UTC's calendar IN THE BROWSER — between 8pm Eastern and midnight a gift dated TOMORROW imported as an ordinary gift and a pledge installment due tomorrow posted as cash instead of routing to the schedule. Now `localCivilToday()` is the default and `Donors.jsx`'s `orgCivilToday(timezone)` (Intl) passes the ORG's civil today; `DonorImport` takes the org for it.
- **Gotchas this build paid for:** (1) **A `const` referenced before its declaration inside a `useMemo`, swallowed by that memo's `catch`** — the new `stageBasis` sat between `payload` and `stagePreview`, so `payload` read it in its TDZ and the screen said "No rows ready — map at least one column to name or email". Every unit test passed; only the browser could show it. The walk now fails on any `[import]` console error, not just an uncaught `pageerror`. (2) **A new root-level module must be `git add`ed before `deploy-shape` will pass** — the artifact is git-tracked-minus-ignored, so an untracked `geocode.js` is a route to `ERR_MODULE_NOT_FOUND` in prod (that suite is exactly the BUILD-79 class working). (3) **`orgTz`'s 30s cache served a deleted org's state to the next suite run** — it now rides `SESSION_CACHE_TTL_MS=0`, the flag that already means "this is a test boot, do not cache identity". (4) A new `scripts/*.js` fails `script-guards` until classified. (5) A new route needs `scripts/build75-route-inventory.js` re-run in the same commit or `tenant-matrix` red-lights.

## THE THREAD (BUILD-81, 2026-09-06) — the prospective spine; Drift is the deepener
- **The thesis moved prospective**: you log a conversation, Steward hands you the next step, and it stays with you until the thread closes. **VOICE RULE (post-build FIX, asserted): Steward HOLDS things, it doesn't nag — "keeps asking" and "until you've done it" are banned from every rendered surface (landing gates + presentation-wiring + thread-nudge assert zero), and Jonathan-voice copy never stacks three sentence fragments.** The Thread and Drift are NAMED PRODUCTS rendered by the ONE `client/src/components/ProductMark.jsx` pill (dependency-free — the landing is the eager entry chunk, so it must never pull shared.jsx) on the landing hero panel / how-it-works head / landing Drift head and Home's two section headings. **THE RULE THIS BUILD ADDED: never fight the tasks battle — fight the remembering battle.** Nothing may ask the user to create a task; logging a conversation IS creating the follow-up. A thread = a donor + an open next step (last touch, next step + due, days open, owner). ONE open thread per donor (`threads_one_open` partial unique — the DB decides races, never check-then-insert).
- **The write path is `POST /donors/:id/conversations`**: one line + the next-step decision in the SAME request ({type, due, label} — or {skipped:true}, recorded on the interaction; a missing decision is a 400). Logging on a donor with an open thread CLOSES it as an outcome (closing_interaction_id) and the same answer decides whether the next opens. `shared/threadShape.js` is the ONE defaults table both sides read.
- **THE NOTE OUTRANKS THE TOUCH TYPE (FIX 2026-09-09).** A touch type says what KIND of contact happened; the note says what was actually asked for or promised, and when they disagree the note wins. `stepFromNote` matches the shapes people write (asked for / asked about / said I'd / promised to / wants / needs / following up with) and proposes **"Send the import report"** where a Meeting used to propose a thank-you note. Nothing matching falls through to the touch default. Every suggestion carries **`source` {from:"note"|"touch", why, matched}** and the screen SHOWS which rule it used (with a one-click "use the Meeting default instead") — a wrong guess must be visible before it can be corrected. The step **label is free text**: prefilled, editable inline from the row in one click, sanitised through the ONE `sanitizeStepLabel` seam, stored in the existing `next_step_label` column; the type is derived from the label's own verb. Drift-done reads its line through the same precedence, and the drift row shows + edits that step before saving (it used to be derived server-side, unseen).
- **The defaults table (FIX 2026-09-09 — thank-you is a GIFT default and belongs nowhere else):** gift → Send thank-you note +2 · meeting/visit → **Follow up on \<subject\>** +5 (the subject completes from the note via `subjectFromNote`; no subject → the bare "Follow up", never a placeholder) · call reached → Follow up +5 · call no answer → Try again +2 (kept on its own merit; not one of the spec's six rows) · email sent → Follow up if no reply +4 · **ask or proposal made** → Check in on the ask +14 · **note with no touch → NO automatic step**, the flow asks for one. The BUILD-81 meeting/visit **follow-on chain is RETIRED** (it walked a meeting from its thank-you to the real follow-up; the meeting row now IS the follow-up) — the mechanism still reads on both sides for threads that already carry one, but no default plants one. Guards: `tests/thread-next-step.test.js` (56 — the extractor's matches AND non-matches, precedence both ways, and every touch type through the real route checked for step AND due date) + `tests/thread-step-inline.test.js` (14, browser — the proposal is an INPUT, one click focuses it, the DB holds the edited text, in the log flow and from the drift row).
- **No silent close is a DATABASE guarantee**: the `threads_close_honest` CHECK (db.js) refuses a close that is neither outcome-with-interaction nor dismissal-with-reason (fixed list: no_longer_prospect · handled_outside · revisit). Revisit = SNOOZE on the open thread (`snoozed_until`; off the list/stat/email until the date, resurfaces by construction, days-open keeps counting). Proven red by raw UPDATE in tests/threads.test.js §4.
- **Threads are NEVER inferred from imported data** (a Last Contact column is history, not an open loop — asserted through the real import). The only non-human opener: a LIVE gift (manual route + webhook one-time; never recurring renewals, sample/deceased/DNC/non-person donors) opens a Thank +2 thread via `openGiftThread` when none is open. Drift-done with a line opens a thread (BUILD-76's byproduct logging, the widget itself unchanged).
- **The nudge is EMAIL, one per user per weekday morning** (`processThreadNudges`, the existing 5-min tick; org-local [6,12) window; weekday on the org's civil date, `orgs.thread_nudge_weekends` opt-in; `digest_sends` 'thread_nudge' idempotency; `users.notify_thread_nudge` default-on). Lists every open due-or-overdue thread org-wide, OLDEST first; **the SUBJECT is the escalation** ("3 threads open · Name, day 24"); rows say "day N", never a date to subtract; NO email when nothing is due and an empty morning reserves nothing. **A GET must never change state** (mail clients prefetch): links go to `/donors/:id?conversation=1` (opens the log flow after a page load; Done/Snooze are POSTs there) — proven in tests/thread-nudge.test.js §2. CAN-SPAM footer = legal_name · receipt_address; a missing address is said out loud with a link, never a pretending footer. Ops: `POST /nudges/run {today?,dryRun?,force?}` (weekday rule applies to the pinned date; the clock window doesn't).
- **Home order: The Thread (heading literal, stat "N open · M overdue · oldest K days" — a COUNT, never dollars) → Drift → the rest.** Needs Your Attention folds INSIDE the Thread card (de-duped: a thank item never doubles an open thread); the recurring line leads with "N cards stopped this month." when failed cards exist; the checklist item is "Log your first conversation" (ticks on the first threads row — the old automation item ticked on a fresh org that had done nothing). Empty state verbatim: "No conversations logged yet. Log your first call from a donor's record and the next step will come back to you." Donor record: thread card above giving history; "Log a conversation" is the gold primary on the directory AND the record (LogConversation.jsx; + Add stepped down — brand-allowlist pins both).
- **The landing page says the same sentence** (BUILD-81 §4.4 order): the question H1 ("Who did you mean to call back?") + the five-knot thread visual (brass knot breathes opacity/transform-only; full-opacity static under reduced motion) · how-it-works beats (DOM renders of the real UI; invented names collision-checked against every fixture/seed) · when-a-card-stops (the reader's arithmetic, no number computed) · Drift (the dot field moved DOWN as evidence, FEP "full-year 2025" caption byte-intact) · the record (the one raster: the Donor Map over the SAMPLE fixture, OSM attribution on-page per ODbL) · your-data (four true sentences) · closing. **CTA semantics rule: navigation is a real `<a href>`, `<button>` is for on-page actions** (`.lp a { color: inherit }` outranks class selectors — scope CTA classes as `.lp .lp-btn-*` or ship ink-on-ink text, found by the compositing contrast sweep). Gates: `scripts/landing-prod-verify.js` **grew 29→40 and must never shrink** (CLS === 0.0000 at 1440 AND 390, em-dash ban, H1, knots, placeholder-must-render-flagged); tests/landing-field.test.js (43) is the local mirror; the retired year-panel/verticals assertions are listed with reasons in audit/BUILD-81-FINDINGS.md.
- **Language (asserted)**: "recovery" is a feature noun, "recovered" a banned outcome (reserved-recovered scans landing+app+email incl. nudge subjects); no sector statistics (FEP is the one sourced exception); Steward reports counts, never congratulates; NO em dashes in Jonathan-voice copy (landing/email/empty states — the landing gate greps the rendered text); nudge subjects are facts, no exclamation marks.
- Suites: threads (56) · thread-nudge (24) in run-all; walk `scripts/build81-capture.js` → docs/build81/. Known seams: audit/BUILD-81-FINDINGS.md §worry (thank-queue action doesn't close the thread — BUILD-82 candidate; org-wide nudge at Team scale). BLOCKED-build81.md: the © entity fill + Cowork artifact update are Jonathan's.

## DRIFT (BUILD-76, 2026-09-03) — the thing the product is named for, now real
- **`drift.js` (repo root) is THE definition**: a donor is drifting when meaningfully past their OWN expected next gift (threshold 1.25× cadence, +30d floor) and not past the lapse boundary (2.5× cadence or 24 months, whichever first). Seasonal givers (3+ years clustered in a month/quarter holding ≥80% of events) are month-aware — drift measured from the window closing + 30d grace, never interval math. Confidence: high = 3+ events AND (seasonal OR MAD/median ≤ 0.25 with cadence ≤ 450d); 2 gifts or unclear cadence = medium (behind `includeMedium`, labelled, NEVER shown as high); 1 gift = not eligible. Value at risk = trailing-24-month giving. Every threshold env-overridable (`DRIFT_<NAME>`) — that seam IS the one-computation proof. Pure module: `today` is a parameter, zero clock reads, in the date audit's FILES.
- **`computeDriftForDonors(orgId,{donorIds})` (server.js) is the ONE integration point** — the home list (`GET /drift`, cap 11, ranked by value at risk), the headline dollars, the funnel row, and the `drift` badge field on `/donors`, `/donors/summaries`, `/donors/:id`, `/pipeline` all read it. **Computed on READ, never stored** — a gift landing (webhook, manual, refund reversal) is reflected on the next read by construction; do NOT add a cache without write-path invalidation. Exclusions (each family-asserted): deceased · do_not_contact · subscriptions in status active/past_due/recovering/recovered/paused (failed cards are the failed-payment path's problem) · open pledges · single-gift donors.
- **Part 4 loop**: `POST /drift/:donorId/done {note}` — one inline line, skippable; BOTH outcomes insert an `interactions` row (`metadata.via='drift_done'`, `skipped` bool) so the record reads "you called her" and the list stops resurfacing (HANDLED_SNOOZE_DAYS=30 on meaningful contact; the badge stays — money is still at risk). Advisory-locked per (donor, org-day, actor) against double-taps. `log_capture_rate` (lines ÷ completions, 30d) snapshots via `snapshotMetricsForOrg`.
- **Reasons are sentences a fundraiser says out loud** ("$2,000 every March since 2019. Nothing for 14 months.") — pinned by tests/drift.test.js §9 (no ratios/day-counts/underscores). Drift language is money AT RISK, never recovered; the forward-looking noun "re-engagement" is deliberately allowed (asserted in reserved-recovered).
- **Suites/rigs**: `tests/drift.test.js` (72, run-all — the brief's fixture table through the REAL import path, exclusion family, threshold-child both-move proof, webhook/refund, cap, the loop); `scripts/build76-drift-drill.js` (SELF_REFUSING, real Stripe test mode + `stripe listen` on :5621 — recipe in docs/drift/README.md, 21/21); the walk in docs/drift/. workflows: `quiet_past_pattern` (trigger `donor_drifting`, sweep reads the SAME computation, high-conf only, dedup per donor+last_gift_date, live-transition guard via `driftStartDate`) + `pledge_due_soon` (leadDays before open pledges) + tuned `major_gift_alert` (`suggestedThreshold` = p95 of trailing year, ≥20 gifts) — 7 recipes total, none of the three may email a donor (C.2, pinned in workflows-e2e §B76).
- **Officer visibility (Part 5, tenant-matrix §8)**: donor DATA is org-shared (the turnover thesis); portfolio VIEWS (pipeline board, my-stats family) are officer-scoped server-side; the day view's ?scope=all stays open to staff; drift is org-wide and a colleague may clear a drift item (actor stamp records who). NEVER silo notes per officer.
- **KNOWN tension (BUILD-77 candidate)**: the fixed-365 stage pill (`Lapsed`) and the drift badge can honestly disagree on one record (both true, separate vocabularies — LAPSE_DAYS machinery deliberately untouched). Part 6 (custom fields grown up, audit/BUILD-76-SPEC.md D.1) SLIPPED to BUILD-77 — the schema migration deserves its own build, not the tail of this one.

## BUILD-59 — PORTAL VISUAL PASS: the banner image system (2026-08-17)
The donor-portal banner is now a considered image SYSTEM in ONE shared renderer (`client/src/components/PortalBanner.jsx`) + a scale defined once. Full report + §worry + 3-worst-surfaces: `audit/BUILD-59-FINDINGS.md`; verify-first red `audit/build59-verify-first-red.txt` (pre-fix scrim fails AA on all 3 demo banners). **SCOPE (honest): this pass is the HEADER BANNER + the shared `S` styles — the signed-in dashboard, page-builder widgets, impact feed, fund cards, receipts are NOT restyled yet (a second pass; the scale + PortalBanner are the vehicle).**
- **Focal point** — `portal_settings.header_focal_x/y` (normalized 0..1, center default) → `portalThemePayload.headerFocal` → `object-position`. Set by CLICKING the editor crop preview (`PortalBannerPreview`, one control, no handles/zoom). Fixes "out of crop" (installation photo's students are right-of-center; focal keeps them framed). Header-only for now (widgets stay center-crop — §worry-3).
- **Preview == render, PROVEN** — the crop is `object-fit:cover` into a FIXED ratio `PORTAL_HEADER_RATIO="1200/300"` (cover crops by RATIO not pixel size → identical at every breakpoint); the editor preview reuses the SAME ratio + the SAME `bannerImgStyle` as the live banner. Pinned by `tests/portal-visual.test.js` (browser, 390/1440/2560: CLS 0.0000, object-position honors focal, ratio-invariant, srcset ladder, eager hero, no h-scroll).
- **Responsive/CLS** — `/portal-assets/:id?w=` sharp-resizes to a width whitelist `PORTAL_ASSET_WIDTHS=[400,800,1280,1920,2560]` (NEVER upscales, WebP, immutable-cached per content-addressed id) → real `srcset`+`sizes`. Container `aspect-ratio` reserves space (CLS 0). Hero eager+fetchpriority, below-fold lazy. **While the hero loads, the container shows a SOLID BAND in the org's primary color** — never a spinner/grey/generated art (standing rule).
- **Scrim (AA over photos)** — `lib/portalScrim.js` (the ONE model shared by render + test): bottom-anchored gradient behind TEXT only, `SCRIM_STOPS` tuned so white plaque text clears WCAG AA at every text pixel over the LIGHTEST image (church 5.38:1, was 2.59). `tests/portal-contrast.test.js` reads real pixels with sharp; also pins brass/sage <4.5 as body (accent-only, never text).
- **Type + spacing scale** — `lib/portalScale.js` (defined once, JSX-free): 8-step modular type (serif display-only), 4/8 spacing, injected as `--pt-fs-*`/`--pt-sp-*`; Portal.jsx `S` object + header snapped. GOTCHA: **`resolveAssetUrl` gained `VITE_ASSET_ORIGIN`** (local-capture override — the `vite build` preview has no `/portal-assets` proxy; set it for captures, UNSET in prod). Capture: `scripts/build59-capture.js` (GUARDED_WRITERS) → `docs/build59/{before,after}/`. Suites `portal-contrast` + `portal-visual` in run-all. Images committed `tests/fixtures/portal-images/`.

## BUILD-57 Part 1 — THE STAFF RECURRING-GIVING SURFACE (2026-08-16)
Recurring gifts are no longer invisible to staff. Suite: `tests/recurring-surface.test.js` (83, in run-all); NB `BUILD-53-staff-recurring.md` never existed anywhere (see `BLOCKED-build57.md`) — Part 1 was built from BUILD-57's own embedded decision table.
- **The action rule (LOCKED, pre-answered):** anything that can MOVE MONEY — create a subscription, change amount, change frequency, update the card — is an **INVITATION** (`recurring_proposals`): staff propose, the donor completes from an emailed tokenized link (`/recurring/proposal?token=` — CSPRNG hash-at-rest, **14-day expiry, exactly one resend** which supersedes the old token; a second identical proposal supersedes the first). Pause / resume / cancel / fund designation are **staff-direct** (`POST /recurring/subs/:subId/pause|resume|cancel`, `PUT …/fund`). **Cancel is deliberately NOT checkWriteAccess-gated** (DELETE-convention reasoning: a donor asking to stop is never blocked and cancel can't take money); pause/resume/fund/proposals are gated writes. Staff never touch card data — card update always goes through the Stripe setup-Checkout.
- **Every staff-side change fires an UNSUPPRESSIBLE donor email** — `sendRecurringDonorEmail` (server.js) checks NO flag: not `recurring_dunning_enabled`, not `email_suppressions`, not prefs (transactional money mail, receipts rule; no unsubscribe footer). The suite tests that it CANNOT be suppressed (kill-switch off + suppression-listed donor still delivered), not that it fires.
- **Proposal completion paths**: amount/frequency → server-rendered org-branded confirm page → Stripe-FIRST reprice (R-1 shape, advisory-locked) → completed + change-logged actor `donor`; create → Stripe subscription Checkout (metadata carries `proposal_id` + `fund_id`; `checkout.session.completed` completes the proposal and stamps the BUILD-56 fund designation); card_update → setup-Checkout (setup-intent metadata `proposal_id`; completed in the setup webhook branch). Public routes `/recurring/proposal` + `/confirm` are donateLimiter'd; vercel.json proxies both (before the SPA catch-all).
- **`recurring_change_log`** (append-only, db.js) is the movement ledger behind the MRR waterfall: kinds `created·amount_up·amount_down·paused·resumed·canceled_voluntary·canceled_involuntary·recovered·fund_changed`, written at every mutation site (webhooks, portal routes, staff routes, proposal confirm). **The churn SPLIT is decided at write time**: `subscription.deleted` while `past_due/recovering` = involuntary (card failure), from active/paused = voluntary; portal/staff cancels log voluntary directly and the deleted-webhook skips rows already `canceled` (no double-count). `subscription.updated` logs an external amount change only when old≠new (our own paths sync `rs.amount` first, so no double-log).
- **Routes (all requireAuth, org-scoped, in the org-blindness battery):** `GET /recurring/roster` (every sub + donor + fund name + `total_given` = SUM over gifts linked via new **`gifts.recurring_subscription_id`** — stamped in `payment_intent.succeeded` whenever the PI's invoice resolves a subscription; pre-57 gifts stay NULL, never guessed — + `current_period_end` synced from `subscription.updated`; at-risk first; displayStatus precedence canceled > past_due > paused > pending > active); `GET /recurring/movement` (MRR = Σ monthly-equivalent over active/recovered/past_due/recovering; month-to-date waterfall; **12-month retention** = subs whose 12-month mark passed, alive-at-mark ÷ cohort, null when cohort 0; benchmark cited ONLY as `{71, "M+R Benchmarks 2026"}`); `GET /recurring/exceptions` (counts + ≤8-row lists: failed cards, cadence-exhausted, pending proposals, 14-day anniversary window).
- **Client:** `client/src/components/RecurringGiving.jsx` — `RecurringView` under **Fundraising → "Recurring Giving"** subtab (movement summary → at-risk queue → invitations → filterable/sortable roster; per-row ONE "Actions ▾" menu; modals portal to body — the BUILD-22 fade-in containing-block lesson) and `DashboardRecurring` under **Home's new Today | Recurring `SectionTabs`** (exceptions only — counts + "Open Recurring Giving" button; NEVER a second roster). Deep link: `navigateTo("fundraising",{frSection:"recurring"})` → `fundraisingIntent` → Fundraising `initialSection` (opts key `frSection`, distinct from Settings' `section`).
- Capture: `scripts/build57-capture.js` (GUARDED_WRITERS; DB-seeds sub states — no API mints a failing card) → `docs/build57/part1/`.

## BUILD-58 — SILENT FAILURES & THE BOUNDARY AUDIT (2026-08-16→17)
The three BUILD-57 walk wounds closed as INSTANCE + CLASS, the import findings triaged, every external boundary drilled. Verify-first red: `audit/build58-verify-first-red.txt` (57 asserts); full report + §worry: `audit/BUILD-58-FINDINGS.md`.
- **W-3 — chart of accounts + loud ledger.** `ensureOrgLedger(orgId,{heal})` (server.js) is the ONE ledger provisioner AND the ONE stamp-target resolver: advisory-locked, self-heals a chartless org on the spot and says so LOUDLY (CRITICAL log + Sentry + **`/health.ledger.chartSelfHeals`**). All 3 org-creation paths (register/register-org/**network-signup** — the hole) provision at birth; all 6 stamp sites resolve through it — **the `'4010'` probe now lives in exactly ONE place** (pinned). Prod checked read-only: only 5 throwaway test orgs were chartless, no real org, no repair. `tests/ledger-provisioning.test.js` (25).
- **W-4 — transactional-vs-marketing mail + the lying log.** `DONOR_MAIL_POLICY` (server.js) classifies every donor-facing kind transactional|marketing; **`donorMailDecision` is the ONLY caller of `getSuppressionReason`** (pinned by source scan). Transactional (dunning, recovery thank-you, receipts, year-end, recurring changes/proposals) NEVER consults the marketing suppression list; marketing does. Transactional still honors DELIVERABILITY suppressions (`bounced`/`complained`) — just not the opt-out. New `donors.deceased` (blocks ALL mail) / `do_not_contact` (blocks marketing) — OR'd on merge, mapped on import, badged on the profile. **Log honesty:** `dunning_sent` only after real delivery (failure→retry, nothing logged; refusal→`dunning_skipped`); sequence interaction+advance only after delivery; workflow `actions_taken` carries `sent:true/false`; proposal note says FAILED when it failed. W-5 (doubled org name in proposal subject) fixed. `tests/mail-suppression.test.js` (31). **Attorney-line flagged in `BLOCKED-build58.md`.**
- **W-2 — no dead-end first login.** App.jsx initial load is `allSettled` (portal_tier 403s are expected, never "Failed to connect"); `PORTAL_TIER_TABS` shell (Donors · Donor Portal · Settings) lands on the portal hub; network-application status = a quiet banner. **The matrix** `tests/first-login-matrix.test.js` (91) is a DATA TABLE — every tier × approval × onboarding asserted non-dead-end; a plan literal in the tier authority without a row FAILS. **White-label sweep:** the 3 public give payloads + the transactional email family render `portal_settings.display_name` via `donorFacingOrgName()`, never the staff "(Demo)" name. Live: `docs/build58/w2-portal-first-login.png`.
- **Part 2 — import never discards input silently.** `classifyColumns` (importShape.js): every column is mapped / deliberately-ignored / unrecognized, reported BY NAME on the result screen (single-sheet + Import-both). Fixes: deceased/DNC first-class; `isEmailHdr` accepts "Donor Email" (+Contact/Primary/Billing) so Import-both links by EMAIL not name; the Recommended menu entry opens the magical DonorImport (**legacy `CombinedImport` DELETED**); `externalId` rides every Import-both gift (new pure `buildGiftItemsFromLedger`); `decodeSpreadsheetBytes` (UTF-8→windows-1252 fallback) kills mojibake; negative/refund + unparsable rows counted with reasons. normalizeDate/Money/Email moved to importShape.js (normalizeMoney parses `(1,000)` negatives). `tests/import-columns.test.js` (48); live `docs/build58/p2-import-result.png`.
- **Part 3 — the boundary audit.** `scripts/build58-stripe-drill.js` (SELF_REFUSING) drills every Stripe boundary vs REAL test mode (:5621 + `stripe listen`, 21/21). **W-1 fixed:** the network-approval gate + auto-delist sweep ask Stripe for `charges_enabled` LIVE (`stripeChargesEnabled()`, fail-safe on unreachable) — not our link-created `stripe_connected` flag. **DISPUTES were unhandled everywhere** (headline finding): `charge.dispute.created` now flags the gift (`gifts.disputed_at`/`dispute_status`) + a LOUD high-priority staff task with the respond-by deadline (money only HELD, not reversed); closed/won keeps it; closed/lost reverses like a full refund. **The property:** `tests/fixtures/external/` holds ONLY recorded real payloads with a `_provenance` stamp — `external-fixture-provenance.test.js` rejects a hand-authored one; `stripe-disputes.test.js` (16) is driven by the RECORDED real dispute payload. Every boundary + the three questions: `docs/build58/boundaries/DIFFERENCES.md`. Never-drilled named as such: `BLOCKED-resend-webhook-drill.md`, `BLOCKED-storage-failure-drill.md` (+ the standing `BLOCKED-stripe-live-drill.md`).
- **Coda:** `BUILD-54-donor-experience.md` (like `BUILD-53-staff-recurring.md`) **does not exist** — a handoff spec name that was never a committed file; the real work is in `audit/BUILD-54-FINDINGS.md` + this file. All other referenced BLOCKED/audit/script files resolve.
- **Test-fixture note:** since W-3, every org is born with a chart of accounts, so suites that `DELETE FROM orgs` must clear `fin_transactions`/`budgets`/`accounts`/`fin_funds` first (patched: notifications, email-polish, import-*, smart-moves, name-normalize, reserved-recovered, network-gate, notify-delivery, import-assign). A new org-creating suite needs the same cleanup order.

### BUILD-57 §2a — the REAL-Stripe drill rewired the webhook layer (2026-08-16)
Three builds of recurring plumbing had been proven only against a mock that lied in SEVEN load-bearing ways — full list `docs/build57/stripe-drill/DIFFERENCES.md`, all fixed + pinned in `recurring-surface` §6. The standing knowledge: **(1)** real subscription PIs carry NO receipt_email/metadata — donor resolution rides invoice→subscription (old API) or `pi.customer`→unique-non-canceled-sub (2025+ API, where `pi.invoice` doesn't exist); **(2)** event payloads ride the ENDPOINT's API version (server-side retrieves ride the pinned lib) — the `invoiceSubscriptionId`/`invoiceSubMetadata`/`invoiceLineInterval` normalizers in server.js read both generations (`invoice.parent.subscription_details.*` on new payloads; `current_period_end` lives on subscription ITEMS); **(3)** repricing uses `price_data.product` (an id) via `ensureRecurringGiftProduct()` — one durable tagged product per connected account, because Checkout's auto-product is INACTIVE + IMMUTABLE and `product_data` is Checkout-only; **(4)** stripe-node 22 does NOT auto-detect `{stripeAccount}` in params position — retrieves are always 3-arg; **(5)** on recovery, `customer.subscription.updated` arrives BEFORE `invoice.payment_succeeded`, so the safety-net branch owns the full recovered bookkeeping (changelog + thank-you). The LIVE-key confirmation is Jonathan's ten-minute `BLOCKED-stripe-live-drill.md`; **no real nonprofit gets approved until it runs.** Part 3's walk record (`docs/build57/walk/WALK.md`) carries 7 ranked findings — W-3 (real-signup orgs have NO chart of accounts → every ledger stamp no-ops), W-2 (portal-tier first login is a dead end), W-4 (dunning email honors the marketing suppression list and logs `dunning_sent` anyway) are the pilot-blocking three.

## BUILD-56 — ASSET RETENTION & UNDO (2026-08-16)
Destruction of an org's uploaded branding is impossible-by-default. Suite: `tests/asset-retention.test.js` (56, in run-all — committed FAILING RED first, red output in `audit/build56-verify-first-red.txt`); full report + §worry: `audit/BUILD-56-FINDINGS.md`.
- **Prune = SOFT DELETE.** A refcount-zero `portal_assets` row gets `deleted_at` stamped; bytes stay in BOTH stores (DB row and S3 object) for **`ASSET_RETENTION_DAYS = 90`** (one named constant, assetStore.js — decided, don't re-litigate). Public URLs 404 exactly as before (`getThemeAsset` filters deleted); re-uploading identical bytes RESURRECTS the id. `dbFallbackRows` excludes soft-deleted rows (retention ≠ failed S3 put).
- **ONE destruction seam.** `destroyAsset()` inside assetStore.js's marked `── DESTRUCTION SEAM` block is the only code anywhere that removes bytes. The suite's battery scans all product source + scripts: any `DELETE FROM portal_assets`/`s3Delete(` outside the seam FAILS, and every prune/put/history call site is count-classified (script-guards-style total classification) — a new call site fails until classified. Proven by plant-and-fail.
- **Pointer history** — `asset_pointer_history` (kept indefinitely): every mutation of a row pointing at an asset (portal_settings logo/header, impact photos, campaign hero, portal_pages draft/published/starter/revert — 11 sites) appends entity·from→to·actor. Legacy in-row base64 being replaced is RESCUED into the store first (lands in the window instead of vanishing). Page history stores extracted asset-path lists, not widget JSONB.
- **Restore** — `scripts/restore-asset.js` (GUARDED_WRITERS, writerDbUrl): `list <orgId>` (restorable assets + history), `restore <pa_id> --repoint` (un-delete + re-point from history; portal-page widgets are bytes-only + editor guidance). Proven by byte-equality + pointer-live-again in the suite. `/health.themeAssets.softDeleted` = restorable count.
- **Purge** — `purgeExpiredAssets` (6h tick + `POST /assets/run-purge` requireAdmin, caller's org): destroys only past 90 days, logs every destruction in `asset_purge_log`, and a referenced-but-old object is SELF-HEALED live (never purged; a soft-deleted row a live pointer references was 404ing that pointer — restoring it is the fix). 89d survives / 91d purges / cross-org untouched, all tested. S3-delete failure keeps the row for retry.
- **Root-cause fix found by this build: asset ids are now KIND-salted** (`assetIdFor(orgId, kind, contentType, buffer)`). Pre-BUILD-56 ids let byte-identical uploads share one row across kinds, so a per-kind prune could kill the other kind's live pointer. Legacy shared rows are covered by a global live-reference guard in `pruneUnreferencedAssets` (`collectLiveAssetRefs` — also the purge guard; battery pins it reads all four pointer tables).
- **`DELETE /campaigns/:id` now prunes + history-logs its hero** (used to leave it live-but-unreachable forever). **Org deletion still doesn't touch asset tables** — documented interaction in FINDINGS, fold into the cascade in the org-deletion build.
- **Tigris bucket versioning** = MANUAL-STEPS.md §6 (belt-and-braces, NOT a substitute — Jonathan does it in the console/CLI). Pre-BUILD-56 pruned objects are unrecoverable (versioning wasn't on).
- **`recurring_subscriptions.fund_id`** (BUILD-55 §worry-3 follow-up, BUILD-53 prerequisite): stamped validated-org-owned at `checkout.session.completed`, carried onto every RENEWAL by the renewal-attribution block (ambiguity key now campaign|page|fund) — renewal gift + ledger stamp route to the designated fund (attribution-completeness 75). **Demo-org fund "re-stamp" resolved as a finding, no data changed**: prod has exactly ONE webhook-era gift ($1 smoke test, org_creo) — see FINDINGS before assuming that ledger is wrong.

## BUILD-49 — DONOR FRONT DOOR: /giving landing + gated entry points (2026-08-13)
A donor can reach their giving account without anyone sending them a link. Suite: `tests/donor-front-door.test.js` (44, in `run-all.sh`); capture `scripts/build49-capture.js` (26 asserts, DSF2, 390+1440) → `docs/build49-front-door/`.
- **/giving is a real landing page when signed out** (`GivingLanding` in GivingDashboard.jsx): Steward-neutral hero ("All of your giving. One quiet place."), value trio (all-orgs-together / recurring control / tax time), and the org-blindness promise stated plainly in its own ink band. AuthCard is beside the hero — **password primary, the emailed sign-in link the offered alternate** — with mode state LIFTED into the landing (hero CTAs set it). Signed-in visitors skip straight to the dashboard (unchanged `me ? <Home/>` precedence). from=<slug> courtesy theming kept. NB a same-path hash change on an already-open /giving deliberately does NOT re-derive auth mode — entry links are fresh navigations.
- **Account sign-in link (new machinery, portal-magic-link discipline)**: `donor_account_signin_links` (db.js — CSPRNG, hash-at-rest, 15-min, single-use, superseded on re-request) + `POST /account/request-link` (identical response known/unknown; an UNVERIFIED account gets its verification email re-sent, never a sign-in bypass) + `POST /account/link-verify` (atomic consume → session). Client: `/giving/signin` route → TokenLanding kind `signin`. A verified alias signs in to its account (UNION lookup).
- **Entry points, ALL gated on ONE predicate — `givingAccountEntry(org)`** (server.js: DONOR_ACCOUNTS_ENABLED && portal enabled && network_listed; unlisted orgs' donors never see any of it): **(a)** receipt + **(b)** year-end cover emails get one quiet footer line via `givingAccountEmailFooterHtml` — link `/giving#signup&from=<slug>&email=<enc>` (email verified-in-context → fragment prefill; **PII rides the FRAGMENT only, never a query string**); the year-end **PDF** gets a footer line stamped into the frozen snapshot at issue time (`snapshot.givingAccountUrl` = `/giving#from=<slug>` — deliberately NO email in a document that may be printed/forwarded; already-issued receipts never change); **(c)** the post-donation thank-you screen (Donate.jsx) offers the account when `org.givingAccount` (now on all three public donate payloads) — no email prefill (donor email isn't known client-side there); **(d)** org portal nudge unchanged; **(e)** Settings › Donor Portal gains `PortalWebsiteSnippet` (Settings.jsx) — copy-paste text-link + button HTML with live preview + the org's portal URL, shown only while enabled+listed.
- **SEO**: `client/giving.html` is a second Vite HTML entry (rollupOptions.input) with real title/meta-description/canonical/OG in served bytes (scrapers don't run JS); vercel.json rewrites `/giving` → `/giving.html` BEFORE the SPA catch-all; same SPA bundle either way. SPA navigations set document.title client-side.

## BUILD-47 — FIND YOUR NONPROFITS: directory + follows + /giving design pass (2026-08-12)
Donor-side org discovery on the BUILD-46 network. **Prime directives (LOCKED): adding an org must never, by itself, reveal or imply giving history — history appears ONLY via the verified-email link machinery; and the directory reveals only that a LISTED org is on the network, never anything about any donor.** Findings + worry paragraph: `audit/BUILD-47-FINDINGS.md`.
- **Directory** — `GET /network/directory?q=&page=` (requireDonorAccount + own limiter 120/15min, x-test seam): **listed orgs only** = `portal_settings.enabled AND network_listed` (pending applications are disabled+unlisted, the delist sweep clears the flag — the three invisible states fail the predicate by construction). Search by name / city / state / exact-9-digit EIN; LIKE wildcards escaped; results carry ONLY listing-card fields (name, location, logo, colors, description) + the caller's own linked/followed flags. **Never add donor counts, supporter numbers, or activity signals to a directory row.** Card fields `portal_settings.directory_description/city/state` are org-editable in Settings › Donor Portal (visible only while listed). Relevance ranking deliberately deferred (~needed at 500–1,000 listed orgs — FINDINGS).
- **Add flow** — `POST /account/orgs/add {orgSlug}` (30/15min): ONE code path, three outcomes. Always: upsert `donor_org_follows` → clear `unlinked_at` on a previously-hidden link (explicit re-add = donor intent, the one sanctioned relink outside `/links/:id/relink`) → run the existing idempotent link job → return `{ok:true}`. Outcomes render from the dashboard refetch: verified-email match = full history; no match = **followed** card; alias-verify later converts follow→link automatically (the link job already runs there; display precedence — link beats follow — completes it). The suite pins outcomes 1 and 2 to **byte-identical response bodies** (no oracle for "a record exists under another email").
- **Follows** — `donor_org_follows` (account-scoped, UNIQUE(account,org), CASCADE) is DASHBOARD-SIDE state under THE WALL: **no org-side route may read it** (rule in db.js beside the donor_account* rule; org-blindness battery covers follows). `/account/dashboard` gains `followed:[]` (identity + description + Give path `/give/:slug`, **zero history figures** — and the summary strip is hidden until the first LINKED org, no $0s pretending) + follows' **org-wide-only** impact updates merged into the feed (targeted updates never match a follow — no attribution to borrow). `/account/me` gains `follows` (with `converted`). `DELETE /account/follows/:id` = unfollow (audited `unfollowed`, zero org-side effect). A follow never resurfaces an org the donor hid (any-link-row exclusion in the followed query).
- **Design pass** (`GivingDashboard.jsx`, local `G` tokens — all values from the existing T set, brand-allowlist green): full-bleed ink header band (serif cream wordmark + brass rule), ink summary strip with typographic hierarchy (This-year hero/brass eyebrow; Lifetime + Organizations behind pine hairlines; stacks ≤640px via the `GivingStyles` style block), org cards with org-accent left edge + serif names, followed cards with FOLLOWING eyebrow + honest connect copy (one tap → Account tab, alias input focused with org-name context), composed empty state (directory search inline under "Find the organizations you give to"; auto-link explanation secondary), zero-results honesty ("Not on Steward yet" + recipient-less `mailto:?` — donor-authored word of mouth, no org contact collected), persistent "+ Add organizations" on Home, styled trust line.
- **Verified**: `tests/network-directory.test.js` **59** (scoping incl. hostile direct-API queries + row-key allowlist, three outcomes byte-identical, conversion on alias verify, unfollow zero-org-effect capture, hidden-org non-resurfacing + explicit re-add relink, listing-card edit round-trip, search+add rate-limit bursts) and `tests/org-blindness.test.js` extended to **48** (world-2 now includes directory searches + a follow of org B pre-alias + conversion; `dof_`/`donor_org_follows` in the marker sweep) — both in `run-all.sh` + CI. Capture: `scripts/build47-capture.js` (**22** DOM asserts, DSF2, 390+1440) → `docs/build47-directory/` (before/after).

## BUILD-46 (network, Aug 12) — GLOBAL DONOR ACCOUNTS & THE GIVING NETWORK (2026-08-12; FLAGS OFF IN PROD)
**Deliberately creates cross-tenant identity — THE WALL is the safety invariant: a donor may see across orgs; an org may NEVER see across orgs.** Full verdicts + worry paragraph: `audit/BUILD-46-network-FINDINGS.md` (unique name — the BUILD-46 label was reused; one build = one uniquely-named findings file is now a rule). Data-handling: network section of `audit/portal-data-handling.md`.
- **FEATURE FLAGS — everything donor/signup-visible is OFF in prod**: `DONOR_ACCOUNTS_ENABLED=1` (all `/account/*`, account-stamped sessions, the portal nudge, the `/giving` page) and `NETWORK_SIGNUP_ENABLED=1` (`POST /network/signup`, `/join`). Unset = routes 404 byte-identically to unknown routes and prod behavior is BUILD-45 exactly (proven by a flag-off child-server test leg). CI sets both ON (`ci.yml` env + run-all.sh boot recipe). `/network/config` is the client's non-secret flag probe. DO NOT flip flags in prod without: the consumer-brand decision (`BLOCKED-consumer-brand.md`), the legal pass (`BLOCKED-legal-network.md`), and the live-Stripe recurring drill (still outstanding, flagged bold in FINDINGS).
- **Accounts (§1)**: `donor_accounts` GLOBAL (no org_id; email unique case-folded), bcryptjs cost 12 (argon2 rejected: native dep). Full BUILD-37 §1 checklist enforced+tested: CSPRNG single-use hash-at-rest ≤60min tokens, supersede-on-re-request, byte-identical failures (NO enumeration incl. unverified-login and alias-conflict), sessions revoked on password AND email change, email-change confirms at the OLD address then the NEW address must independently verify before anything links. **Every account-lifecycle email (verify/reset/alias/email-change AND portal magic links) rides the queued `notification_failures` path** (sentinel org_id `donor-network`, raw resend of stored html, surfaced on /health) — never fire-and-forget. MFA: `BLOCKED-donor-mfa.md` (schema stubs exist). Sessions: `portal_sessions.donor_account_id`; org_id now NULLable (account-wide sessions); both auth paths mint the same session (a magic link for a verified account email opens portal + dashboard).
- **Linking (§1.2)**: `donor_account_links` — EXACT match on VERIFIED emails ONLY (never name/fuzzy — wrong-link = P0). Triggers: verify, alias-verify, reset (reset-by-email doubles as verification + the §1.3 password-setter for magic-link-era users), webhook donor-resolve, org-approval (`linkOrgJoinsNetwork`), lazy idempotent pass on dashboard reads. Unlink donor-initiated/audited/never-auto-relinked; verified alias emails globally unique (partial unique). Account deletion: links+PII gone, org records byte-identical, audit trail keeps actions sans email.
- **Dashboard (§2)**: `/account/{me,dashboard,recurring,tax-summary}` — read-time aggregation only, NO stored rollups; display filter = linked AND portal-enabled AND `network_listed` (new portal_settings column: ON via network approval, OFF for existing orgs until the Settings › Donor Portal toggle). Client: `pages/GivingDashboard.jsx` at `/giving` (consumer brand "Steward — Your Giving" — placeholder, `BLOCKED-consumer-brand.md`), org drill-down `/giving/orgs/:orgSlug` = the UNFORKED `<Portal/>` under a back bar (`GivingOrgShell`); vercel.json gained `/account-api` + `/network-api` proxies (cookie stays first-party). Portal.jsx is still the brand-allowlist EXCLUDE; GivingDashboard uses publicTheme tokens.
- **THE WALL (§2.4/S-13) — `tests/org-blindness.test.js`**: ten org-staff routes captured byte-identical before/after the donor has an account+links+dashboard use, plus a marker sweep (no org-B string/id/amount/fund or account artifact in any org-A body), pipeline counts untouched, drill-down indistinguishable from magic-link in the org's audit. **RULE: any new org-side route that mentions donor identity gets added to this battery in the same commit, and no org-side handler may read the donor_account* tables.**
- **Network gate (§3)**: plan `portal` = its own tier (`orgPlanTier` returns 'portal' BEFORE the trialing shortcut; soft bands). CRM route families 403 `portal_tier` via ONE `app.use` gate (giving-summary report + donors/gifts allowed). `POST /network/signup` (flagged) mints an org that is invisible (portal 404) AND un-giftable (`/donate` checks `network_applications.status==='approved'` for portal-tier orgs) until: LIVE EIN check vs `ein_registry` (IRS Pub 78; `scripts/load-irs-ein-registry.js`, monthly, empty-registry fails SAFE) + Stripe onboarding + HUMAN approval in the AdminDashboard "Network Review" queue (approve refused otherwise — even refusals are logged decisions). EIN dupes → dispute queue, can't touch the holder (S-15). 6h auto-delist sweep (+ `POST /admin/network/run-gate-sweep`): listing off, gifts blocked, portal stays up, admin alerted.
- **Suites (all in run-all + CI, 171 asserts)**: donor-accounts 49 (incl. S-11 bursts, queued-email outage/retry, flag-off child server) · donor-linking 25 (S-12) · org-blindness 41 (S-13) · network-gate 34 (S-14/S-15) · donor-dashboard 22 (view==ledger equalities, listing toggle, wrapped-portal parity).
- **Demo**: `scripts/seed-build46-network-demo.js` (LOCAL-ONLY, refuses non-scratch DB) + `scripts/build46-capture.js` (8/8) → `docs/build46-network-demo/` (dashboard-home, recurring, tax-summary, org-drilldown + ORG-SIDE-PROOF.txt). Demo email alex.demo@n46.test across Harbor Music School + Open Door Pantry.

## BUILD-45 (Aug 10) — DONOR PORTAL (white-label) + §1 money-path prerequisites (2026-08-10/11)
**The third reuse of the BUILD-45 label** (the 2026-08-08 dashboard findings moved to `audit/BUILD-45-dashboard-FINDINGS.md`). This build **deliberately reverses the 2026-07-12 "no donor-facing portal" decision** while keeping its substance: no donor passwords, no tiers/badges/leaderboards, no streak claims, no cancel dark patterns. Full verdicts + worry paragraph: `audit/BUILD-45-FINDINGS.md`; data-surface inventory for the attorney/app-sec review: `audit/portal-data-handling.md`; verify-first notes: `audit/BUILD-45-NOTES.md`.
- **§1 prerequisites (BUILD-44 F-3/F-4/F-5 — FIXED, DB-enforced):** (1) `gifts.idempotency_key` + partial unique `uq_gifts_idem` — every non-webhook gift create takes a client-generated key (both gift forms mint one per open via `crypto.randomUUID()`); a replay returns the original gift `duplicate:true` with ZERO side effects; 50× parallel → exactly one row. (2) **(donor, amount, date) is NEVER a gift dedup key**: imports insert same-day/same-amount twins and report them (`duplicateCandidates`); the ONE dedup key is an explicit **external/transaction-ID column** (`gifts.external_id` + `uq_gifts_external`, cross-run idempotent; auto-detected in the import mappers); import-history HOLDS no-ID collisions with existing gifts for human review (`heldForReview` + an "import anyway" confirm), never silent. (3) **Pledge partial payments**: `gifts.pledge_id` links payments; paid = derived Σ; a partial leaves the pledge OPEN with an honest balance; every "pledged" figure (fundraising, campaign progress, solicitations) reads **remaining = amount − paid**; delete/edit/refund recompute via `recalcPledgePayment` (the ONE reconciler). State-diff A9b + attribution + concurrency2 manifests updated = the reviewed money-contract changes. Suite: `tests/gift-idempotency.test.js` (39).
- **Portal auth (§2)**: magic link ONLY — 256-bit CSPRNG, 15-min, single-use (atomic `UPDATE…RETURNING`), invalidated on re-request, **hash-at-rest** (`portal_magic_links`/`portal_sessions` store SHA-256 only); no enumeration (identical response, async lookup+send so timing is flat); per-IP + per-target-email + per-mutation rate limits (burst-proven via an `x-test-*` seam honored only under `DISABLE_RATE_LIMIT=1`); sessions are a **separate HttpOnly Secure SameSite=Lax cookie + separate table** — the differential sweep proves portal↔staff credentials cannot cross in either direction. **Tenancy is path-based** `/portal/:orgSlug`, reached same-origin in prod via the vercel.json **`/portal-api/*` proxy** (cookie stays first-party); custom CNAMEs → `BLOCKED-custom-domains.md`. Every link-request/session/mutation writes `portal_audit_log` (P-7). The portal is **opt-in per org** (`portal_settings.enabled` default false); disabling it kills live sessions.
- **Dashboard (§3)**: every figure is a live SUM over the SAME `gifts` rows the CRM reads (portal == DB == donor summaries, tested); YTD/per-year bars (tap → gift list)/lifetime/first/largest; receipts stream the EXISTING stored `pdf_data` session-scoped (S-9); pledges show F-5 balances; households render in a separate labeled section (combined figure only, P-6 — one email may match multiple donor records, all render; same email in another org = fully independent session); thin-data honesty — no streaks/percentages, empty sections hidden.
- **Recurring self-service (§4)**: mutations are **Stripe-FIRST** (Stripe failure = mutation fails — never claim a schedule changed while Stripe keeps charging) and serialized per sub via advisory lock (R-7 races tested). Amount = server-repriced integer minor units, floor `portal_settings.min_recurring_cents`, `proration_behavior:none`; pause = `pause_collection` void (+ optional resumes_at; dunning excludes paused; auto-resume flips status via `invoice.payment_succeeded`); cancel = `cancel_at_period_end`, one confirm, optional reason; card update = the EXISTING signed setup-Checkout URL. Every mutation: audit row + donor confirmation email on the org letterhead + CRM timeline mirror. **`STRIPE_API_BASE`** (env, test-only — the RESEND_BASE_URL pattern) points the donation Stripe client at the portal suite's local mock; it's in the run-all/CI boot env now.
- **White-label (§5)**: `portal_settings` theme (display name, logo/header image — mime+size validated, colors through the ONE `normalizeAccent` contrast guard which deepens + tells the admin, footer/contact/EIN, min recurring); CSS vars on the portal page; "Powered by Steward" **off by default**; designed default theme. `pages/Portal.jsx` is a documented brand-allowlist EXCLUDE (white-label = the org's palette, not Steward's). Admin UI: **Settings › Donor Portal** (PortalManager + ImpactUpdatesManager).
- **Impact + drift (§6)**: `impact_updates` (title/body/≤4 photos/fund-campaign targets validated org-owned/org-wide flag); matching is DETERMINISTIC over existing gift attribution (trailing 24 months; targeted first, org-wide fallback; no classifier). **Drift wire**: cancel/pause → officer email via `notifyUserOnce` (ED fallback, deduped per event) + a high-priority due-today task + a priority-88 day-view bucket (from `portal_audit_log`, last 7 days); the **dunning/recovery email now links into the portal** when enabled; sign-ins/impact views land as low-priority timeline notes (never alerts).
- **Verified**: `tests/portal.test.js` **67** (magic-link lifecycle, wiring equalities, all money paths against the Stripe mock, races, differential sweeps portal×staff both directions, bursts, XSS-as-data, contrast guard, disable-kills-sessions) + gift-idempotency 39 — both in `run-all.sh` (72 suites) + CI (`STRIPE_API_BASE` added). Demo: `scripts/seed-build45-portal-demo.js` (API-driven dressing safe for prod; local-only sub/drift seeding) + `scripts/build45-portal-capture.js` → `docs/build45-portal-demo/` (7 DSF3 shots incl. the day-view drift alert). **Prod follow-ups (human/deploy-gated)**: run the seed script against prod after Railway deploys; one REAL test subscription must be paused/re-priced/canceled through the live portal before pilot donors get links; book the external app-sec review (its scope now includes this public surface).

## BUILD-46 (Aug 8) — two demo bugs + Phase 2 brand sweep (2026-08-08, pre-Fairhope)
Two demo-visible bug fixes, a verify-only gate, and the Phase 2 loading/brand sweep. Shipped in stages (Stage A = the two bugs + gate, pushed green 67/67; Stage B = brand).
- **Bug 1 — follow-up task badge flagged FUTURE due dates as overdue.** Root cause (diagnosed, not assumed): the donor-profile follow-up badge (`Donors.jsx`) computed overdue as `daysDiff(due) < 0`, where `daysDiff = floor((now − due)/day)` — *elapsed-since* semantics, so a future due date is negative → flagged overdue (a task 6 days out read "Overdue — was Aug 14"); the raw ms diff also crossed UTC midnight. `daysUntil`-based math elsewhere ("412 days left") was always correct. Fix: new JSX-free **`client/src/lib/taskDue.js`** — overdue ONLY when the due date is strictly before today, compared as CALENDAR dates in the local (org) timezone. Future → warm-grey `T.ink3` "Due Aug 14"; today → brass `T.gold500` "Due today"; past → terracotta "Overdue · was due Aug 14". Pinned by **`tests/task-due.test.js`** (18): a task created now with a future due date can never render overdue; boundaries at exactly today and yesterday.
- **Bug 2 — solicitations win rate used the wrong denominator.** `reportSolicitations` computed won/(won+**open**); a win rate counts DECIDED asks only = **won/(won+lost)** (open asks aren't losses). Added a symmetric `lostByOfficer` window query (marking lost stamps `closed_at=NOW()`, like won); `byOfficer` now carries `lostAsks`/`lostAskAmount`/`decidedAsks`; `winRate` is null when nothing is decided (client shows "—"/"No decided asks yet", never 0%). Open count was already surfaced separately and stays labeled "Open". `Reports.jsx`: "Close rate"→"Win rate", added a Lost column + definition caption. Pinned by **`tests/solicitations-winrate.test.js`** (2 won/1 lost/4 open → 66.7%, 0-decided → null); `report-truth` win-rate assertion corrected (1 won/0 lost/2 open → 100%). **Enumeration deliverable `audit/BUILD-46-rate-denominators.md`** — every other computed rate/percentage checked; win rate was the sole denominator bug; the analogous recovery rate already uses recovered/(recovered+lost).
- **Item 3 (verify-only, GATE) — campaign Edit loads the correct record.** Verified NO wrong-record load: each card's Edit closes over its own campaign object, the modal remounts per open and inits from it, and `save()` PUTs to that same `campaign.id` (no shared/indexed/stale ref). Reproduced the exact 5-campaign screenshot structure on a live local server+DB and diffed all 6 Edit-form fields per campaign against stored values — all match (Spring Studio shows 15000/project, NOT the umbrella's 180000/annual). The screenshot was the FY2026 umbrella's modal (fixed overlay) layered over the Spring Studio card. `audit/BUILD-46-campaign-edit-verification.md`.
- **Item 4 — Phase 2 brand sweep** (full per-surface enumeration in `audit/BUILD-46-brand-sweep.md`). Cause of the "old green + S mark" loading screen: NOT index.html (clean) but the App shell's "Loading your workspace…" splash (`App.jsx`), whose S-badge + spinner used `T.green` `#10b981` (retired AI-green) → **Emerald `#0d5c3a` badge + Cream serif S (matching the OG) + Emerald spinner**. Also fixed: **OG image** (`og-image.svg`/`.png` + linkedin-cover — S-badge `#1a6b4a`→Emerald, subhead `#a3b8a8`→Sage `#8fa896`, PNG regenerated via headless Chrome), **index.html** pre-hydration body bg `#030712`→Ink, **auth bucket** old-green `#1a6b4a`→Emerald `#0d5c3a` (Login/Invite/Forgot/Reset/Signup), **ErrorBoundary** Reload button `T.greenMid`→`T.greenDk`. Confirmed-clean: favicon.svg/.ico/pngs, apple-touch, android-chrome, site.webmanifest, Suspense `RouteFallback`, `RootErrorFallback`, 404 (redirect, none), logout (no screen), Invitation.jsx (`#e0a893` = legit semantic error on dark). Flagged not-tonight: `publicTheme.greenDk #1a6b4a` (feeds Donate/ManageFundraiser), Landing `greenMd`, public-theme neutral ink greys. Guards: eslint src clean, brand-glyph 66 / brand-allowlist 27 / palette 26 / no-emoji green. Screenshots `docs/build46-brand-2026-08-08/`.
- **Audit follow-up (not tonight):** `audit/BUILD-46-bundle-hash-followup.md` — prod bundle hash changed on a backend-only push with unchanged client source; the deploy-verification signal needs a reproducible-build check.

## BUILD-45 (Aug 8) — two live-review dashboard defects + demo cleanup (2026-08-08, pre-Fairhope)
Distinct from the 2026-08-07 BUILD-45 below (same number reused for a different brief). Two demo-visible UI defects Jonathan found on prod, plus demo-data lint. Findings/diagnosis: `audit/BUILD-45-dashboard-FINDINGS.md` (renamed when the number was reused a THIRD time for the 2026-08-10 donor-portal build, whose findings own `audit/BUILD-45-FINDINGS.md`); the one blocked item: `BLOCKED-build-45.md`.
- **D-1 — "Needs your attention" rows are now real donor LINKS.** Each row's left region (avatar + name + task text) is a genuine `<a href="/donors/:id">` (`Dashboard.jsx`), with the action button a SIBLING of the anchor (never nested → keyboard/new-tab safe; the button also `stopPropagation`s). Hover affordance (`shared.jsx` GlobalStyles `a.attn-row-main:hover` → cream-alt `#e8e4db` wash + donor-name underline; brass `#c9a84c` focus-visible ring; ≥44px tap targets on both main + action). Orphaned rows (no resolvable donor) render the main as a `<span>`, never a dead link (+ a dev-only console orphan count). **The whole left region goes to the donor profile regardless of the action button's own behavior** (one unambiguous target). — **`/donors/:id` was NOT a route** (the SPA opened profiles via in-app `selectDonorId` state; the catch-all redirected unknown paths to `/`). Since the brief's committed test asserts `href === /donors/:id` AND cmd-click must work, a real URL was required: added `<Route path="/donors/:donorId">` in `main.jsx` → `RequireOnboarded><App/>`, and `App.jsx` reads the `:donorId` on mount, opens that profile, and `replaceState`s to `/dashboard` (same pattern as `?stripe_connected`/`?subscribed`). Verified: a fresh load / cmd-click on `/donors/smpl_d1` opens the profile, not the landing page.
- **D-2 — Prospect Pipeline `$0` tiles.** *Diagnosis first (no assumption):* the demo org had **ZERO opportunity records** — the tiles (`OPEN ASKS / WEIGHTED FORECAST / CLOSED THIS FY`) were arithmetically correct, not a broken rollup (confirmed org-wide via `/reports/solicitations` byOfficer all-zero + `/pipeline` every card `openOppCount 0`). No new finding; the rollup code is fine. **Fix A** (`Pipeline.jsx`): an empty tile renders `—` in warm grey (`T.ink3`) + `No asks logged yet` instead of a misleading `$0`; when all three are empty, one explainer line `No asks recorded — the board tracks people, asks track money.` (no invented route). Non-zero behavior unchanged. **Fix B** (`scripts/seed-build45-asks.js`, idempotent, real API, reversible): seeded credible asks into **prod `org_creo`** — open asks on the 4 Solicit prospects (each ≤ 2× that donor's largest prior gift), 2 closed-won this FY, 1 closed-lost. Tiles now read **OPEN $85,000 · WEIGHTED $59,500 · CLOSED THIS FY $72,500** (win rate was displayed as 33.3% here — that display was the win-rate denominator bug fixed 2026-08-08; the same 2-won/1-lost fixture now correctly reads 66.7%, see the Solicitations definition above).
- **D-3 — demo junk.** `Jonathan Atkindaddy` (a typo'd test donor, $15,001/3 gifts, Steward) soft-deleted via `DELETE /donors/:id` + its `Follow up: Jonathan Atkindaddy` task deleted (backup: `audit/build45-backup/`). The other two "empty Jonathan" chips are the **Officer Portfolios legend USERS** (`user_jonathan` = Jonathan's own login, `user_0a9d3327`), not donors — no remove-user route exists (same wall as `BLOCKED-demo-org-officers.md`), so that item is documented in `BLOCKED-build-45.md`, not force-deleted.
- **Tests:** D-1 DOM assertions added to `tests/presentation-wiring.test.js` (per row: main is `<a href="/donors/:id">` == API donor id; action button not a descendant of any `<a>`; action click leaves `location.pathname` unchanged — at 390 AND 1440). Fix A source-guard + zero-opportunity forecast assertion in `tests/pipeline.test.js`, and an em-dash render check in `presentation-wiring`. `#e8e4db` added to the `brand-allowlist` EXTRAS. NB the sample fixture uses GLOBAL `smpl_dN` donor ids — only ONE org can hold sample data at a time; do not load sample data into a second org in the same scratch DB (it silently PK-collides).

## BUILD-45 — fixed BUILD-44 F-1 + F-2 (2026-08-07)
The two BUILD-44 findings worth fixing before Sunday. Product code changed (unlike BUILD-44); the encoded FINDINGS tests flipped to the corrected contract.
- **F-1 (HIGH) — read_only orgs could still perform Team-layer writes.** `checkWriteAccess` added to the five routes that had `requirePlan("team")` but no write gate: `PATCH /donors/:id/stage`, `/donors/:id/assign`, `/donors/bulk-stage`, `/donors/bulk-assign`, `POST /donors/:id/score`. Placed AFTER `requirePlan` so a Core caller still gets 403 `plan_required` and a lapsed/trial-expired Team org now gets 402 (the documented order, matching `PUT /portfolio/officers/:userId/color`). `tests/permissions-matrix.test.js` 94/94 (the three `roAdmin:"open"` rows → 402; +2 rows for the two previously-uncovered routes). `/auth/invite` staying write-ungated is a deliberate product call, not part of this.
- **F-2 (MEDIUM) — a failed notification send was lost forever.** Root cause: `sendGiftAlertEmail` swallowed every provider error and always returned `true`, and `notifyUserOnce` reserved the `notification_sends` dedup row BEFORE sending — so an outage lost the alert AND reserved it to silence (a re-trigger deduped to nothing). Fix, three parts: (1) `sendGiftAlertEmail` returns real success/failure (no `RESEND_API_KEY` = "nothing to deliver" = success, so envs without email don't queue retries); (2) on a real failure `notifyUserOnce` RELEASES the reservation and durably queues the send (recipient+subject+body) in a new **`notification_failures`** table (db.js); (3) **`retryFailedNotifications()`** re-sends on the existing 5-min tick (+ `POST /admin/notifications/retry` ops/test hook, `{force}` to bypass backoff), deletes on success — re-reserving the dedup row so a later same-event trigger still dedups — and after `MAX_NOTIFY_ATTEMPTS=5` leaves a permanent record. **`/health.notifications.failedPending`** surfaces the count (cached via `refreshNotifyFailedCount`, so the health path stays synchronous — this is the SURFACING F-2 was missing). The send failure still never fails the triggering action. `tests/notify-delivery.test.js` 27/27 (outage → released + queued + surfaced; retry-while-down → attempts grow, nothing delivered; retry-after-recovery → the once-lost alert ARRIVES, queue clears, dedup restored).
- **Test-env consequence (not a product change):** internal notifications now report real delivery, so a suite that counts `notification_sends` deltas needs a live capture sink on :5602 or the sends legitimately fail+queue. Added `startMailSink()` to `tests/state-diff.lib.js`; both state-diff suites start one (A-series 68, B-series 101 stay green). Full `run-all.sh` green.

## BUILD-44 — overnight wiring sweep, TESTS ONLY (2026-08-07; committed locally, NOT pushed — morning review)
**Hard rule honored: zero product code/schema changes.** Every bug found is DOCUMENTED in **`audit/BUILD-44-FINDINGS.md`** (severity-ranked, with repros + the honest verdict paragraph) and encoded as *current behavior* in a committed suite with a `FINDINGS` comment — so each finding is reproducible on demand and will announce itself (a failing assert forcing a reviewed manifest edit) the moment someone fixes it. Six new suites, all in `run-all.sh` (64 total):

- **Part 1 — `state-diff2.test.js` + `state-diff2.manifests.js` (101, org_wap2)**: the B-series extends BUILD-43 to grant lifecycle (create/advance/award-stamps-ledger-once/close-keeps-booking, un-award reverses byte-for-byte; NB **`PUT /grants/:id` requires the full body — a status-only PUT 400s**; closing schedules a "+6mo next cycle" task), all five workflow recipes + dedup-refire = the empty manifest, task lifecycle (self-assign silent), goal create/edit/delete + **child roll-up never double-counts** (`{d:0}` = "must NOT move" semantics added to the asserter), household member add/remove (combined = Σ hard credit — the soft-credit surface), designations, restricted-fund routing, planned giving, **branding = the all-zero manifest**, bulk reassign, recurring cancel, year-end statement supersede. Shared machinery extracted to **`tests/state-diff.lib.js`** (both suites use ONE snapshotter — now also ledgerGrantLinked / subsCanceled / designations / plannedGifts / tags(::jsonb cast — the column is TEXT) / restrictedTotal / goalAmount).
- **Part 2 — `presentation-wiring.test.js` (22)**: rendered DOM text == API value at 390px AND 1440px (hero %, Cash on Hand, thermometers, grant amounts, donor lifetime/last gift, directory count, WiR) — the matcher mirrors `money.js` BOTH formats (`$585,400` and `$585.4k`); `/donors/summaries` returns RAW column names.
- **Part 3 — `notify-delivery.test.js` (18)**: every trigger enqueues EXACTLY one message w/ right recipient+payload against a real sink; the failing-sink leg **confirmed F-2**: a provider failure = the alert is lost forever (no retry, and the dedup row is reserved BEFORE the send, so re-triggers dedup to silence).
- **Part 4 — `permissions-matrix.test.js` (86)**: role × route × plan × subscription as a DATA table + cross-org 404s + the data-hostage export rule. **Found F-1 (HIGH): five Team-layer write routes have `requirePlan("team")` but NO `checkWriteAccess`** (`/donors/:id/stage`, `:id/assign`, `bulk-stage`, `bulk-assign`, `:id/score`) — a lapsed/read_only org can keep mutating portfolios/stages/scores. Also `/auth/invite` is write-ungated (decide-then-encode). Per-donor assign is admin-only (BUILD-31 model — matrix corrected).
- **Part 5 — `concurrency2.test.js` (14)**: parallel same-gift edits → donor total == gift == LEDGER STAMP every time (the BUILD-43 sync holds under contention); parallel same-file imports → each donor/gift exactly once; parallel reassign coherent + portfolio counts reconcile to the donor table; **F-3: double-submitted manual gift = TWO gifts** (no idempotency key; consistent but doubled; the pledge still fulfills exactly once).
- **Part 6 — `empty-states.test.js` (20)**: brand-new zero-donor org, every screen at both widths — **clean**: no NaN/Invalid Date/undefined/Infinity, zero page errors, and the retention card does NOT fabricate a rate. Browser-suite conventions for run-all portability: SKIP cleanly without Playwright or a localhost-API dist; the app must be served from **:4173** (the API's CORS allowlist) — reuse a running preview else self-serve; seed auth from the REAL `/auth/login` payload (hand-built user objects bounce to /login); `/_vercel/*` 404s (not HTML).
- Other findings recorded (not fixed): **F-4** import collapses same-(donor,amount,date) gift twins silently; **F-5** a pledge payment fulfills the WHOLE pledge regardless of amount (single-payment model); **F-6** no recurring pause state; **F-7** simulate-path notification keys differ from webhook keys; **F-8** WiR previews the COMPLETED week (demo surprise); **F-9** missing reversal routes consolidated.

## BUILD-43 — the WIRING test: full-org state-diff harness (2026-08-06)
The question "is it all actually wired together?" now has a permanent, ~15-second answer. `tests/state-diff.test.js` + `tests/state-diff.manifests.js` (both in `run-all.sh`, **68 asserts**).

### The property
`snapshotOrgState()` captures every number the product shows — fundraising rollup/goals/period/this-week, all seven reports (giving summary, LYBUNT, SYBUNT, retention, top donors, annual, solicitations incl. per-officer), per-donor lifetime/count/stage/owner (keyed by EMAIL, stable across runs), households, officer portfolios, pipeline counts + forecast, finance (cash, calendar AND fiscal period revenue, fund balances, gift-history total), grants, tasks, recurring health, Week-in-Review totals, and the DB queue/append-only counters (ledger rows, receipts active/voided, workflow runs, notification/digest sends, recovery events, pledges, interactions, moves). One canonical action runs; the full diff must equal a committed manifest EXACTLY — an unexpected delta anywhere = double-counting; a declared delta that didn't occur = dead wire. Then **reversal symmetry**: reverse the action through the product's own path and the state must return to baseline byte-for-byte minus DECLARED append-only exclusions (each one a comment-justified decision). **The manifests are the spec: a manifest edit is a money-flow contract change, reviewed like a schema migration — never loosened to green a build.**

### Fixture
Deterministic seeded-LCG org at WAP scale — **1,530 donors / 5,738 gifts** (`org_wap`, Team+receipts on, chart of accounts seeded — NB the gift→ledger stamp NO-OPS without the '4010' account; the fixture must call `/onboarding/complete`). Donors 0..99 carry a 2026-05-15 last gift (steward band = the exact LYBUNT cohort); everyone else lapsed; baseline current-FY, week, and WiR figures are all ZERO so every delta stands alone. Builds via the real chunked import in ~1s. Digest periods are PRE-RESERVED at build so the 5-min tick can't land rows mid-run; dunning disabled for the same reason (the hourly tick).

### Ten actions, and what building the manifests found (all fixed or encoded)
Actions: manual gift · import-with-history · online gift (signed webhook) · recurring created + failed card · full + partial refund · gift edits (amount/date/campaign, each reversed) · officer reassign · stage move + ask · pledge + payment · donor delete (forward-only — **no restore-from-trash route exists**).
- **FIXED (product): `PUT /gifts/:id` never synced the gift's LEDGER STAMP** — editing a stamped gift's amount/date left `fin_transactions` at the old figures, silently desyncing Cash on Hand from the gift record with no mismatch queue. The route now updates the linked stamp (amount/date/fund) — pinned by A6a/A6b (the FISCAL finance lens exists precisely to pin the DATE sync; `/finance/summary` defaults to CALENDAR where a within-year move is invisible).
- **FIXED (product): clearing attribution (`campaignId:""`) left the synced legacy NAME column** — the read side matches `campaign_id OR campaign=name`, so a "cleared" gift kept counting toward the thermometer forever. Clear now nulls the name too (unless a free-text name is explicitly sent). `gift-attribution.test.js` was UPDATED (33→36): it had been implicitly pinning the bug (Annual stayed $6,000 after a clear).
- **Encoded facts** (each now enforced): the import DEDUPES gifts with identical (donor, amount, date) — two same-day same-amount gifts collapse to one on import; a pledge payment **fulfills the whole pledge regardless of amount** (single-payment model, no partial tracking — pledged→raised converts once, and deleting the payment gift reopens it); `/digests/preview` composes the most recently COMPLETED week, so same-week actions never appear in WiR (its totals are FROZEN in every manifest); soft-deleting a donor drops reports/finance/donor totals while the campaign thermometer KEEPS their attributed gifts (BUILD-33 nuance — a fundraising delta on A10 FAILS the run); trash+purge is a byte-perfect inverse for HISTORICAL imports (0 residual — Option A means no ledger stamps to orphan); the online-gift webhook creates its own thank task AND the workflow's (2 tasks per online gift); `notification_sends` dedup collapses owner+ED to one row when they're the same person.
- Harness craft notes: target scratch objects by an UNAMBIGUOUS key (a notes tag), never amount — an amount-only lookup collided with a fixture gift; `checkout.session.completed` resolves the donor by `session.customer_email`, not metadata; `{d:0}` in a manifest means "must NOT move" (absence is the pass).
- `DISCOVER=1` prints raw diffs instead of asserting — the manifest-authoring tool, never CI. Suite SKIPs cleanly without the scratch stack conventions (localhost guard in helpers).

## BUILD-41 — hero simplification + donor surfaces on mobile (2026-08-06; committed, NOT pushed — stacked on BUILD-40 awaiting review)
Evidence: `scripts/build41-capture.js` (**18/18** live at a true 390px viewport against the local stack) → DSF2 screenshots `docs/build41-2026-08-06/`; hero re-measure in `audit/mobile-perf.md`.

- **Part 1 — the hero PHOTOGRAPH is retired.** The landing hero is a **solid ink field** (`#0f1a12`): the choir image, its srcset, the scrim, the `aspect-ratio` container, the index.html route-scoped preload, and the `hero-choir-*.webp` assets are ALL deleted (`ASSETS.md` records the retirement) — the photo muddied the type and was the LCP problem; cream serif + brass rule carries itself. The subhead is ONE clause: "Steward tells you who to call today, and what to say." (trailing failed-cards clause dropped; that story lives in the calculator + moment 2). Trust strip unchanged. **`landing-hero-verify.js` was REWRITTEN to pin the solid design** (24 → 22 asserts: NO `<img>`/background-image/scrim in the hero, ink background, computed cream-on-ink contrast, one-clause subhead, floated-card rules unchanged) — a reintroduced hero image fails the script until deliberately updated. 390px: total page bytes 359,683 → **319,572**; there is no hero asset for first paint to wait on.
- **Part 2 — donor Directory at <768px is ROWS, not a crushed table.** The old mobile override (`2fr 68px 68px 44px`) predated the checkbox column — the checkbox landed in the wide `2fr` track and donor NAMES got a 68px cell ("M…", "Ju…", emails "mw…"). Under 768px the grid rows + header row are `display:none` and a parallel **`.dir-row-mobile`** renders per donor (same map returns `[desktopRow, mobileRow]`): **full 17px name that WRAPS (`overflowWrap:anywhere`), never truncates**, inline stage chip after the name, muted 14px meta line (lifetime · last gift · date), score badge right-centered, ≥64px tap row. **Checkboxes exist only in explicit Select mode** — a mobile-only `Select`/`Done` toggle (`.dir-select-toggle`) next to Export CSV; in Select mode tapping a row toggles selection (bulk bar unchanged), Done clears. Desktop is untouched.
- **Part 3 — donor profile at 390px.** (1) **The clipped Giving History card is fixed**: the stacked mobile grid kept the left column's own `overflowY:auto` height-cap, slicing the chart card mid-render with the dark rail starting through it. The body is now the ONE scroller; both columns `overflow:visible; height:auto` — **with `min-width:0;max-width:100%`, which is load-bearing**: without it a grid item's auto min size is its content's min-content (the 537px tab row) and the whole column blows out sideways (found live; the capture script now asserts no horizontal overflow). (2) **Action row**: Request Gift is the full-width primary (class `dph-primary`); Impact Summary + Edit collapse into a **"⋯" overflow menu** (`dph-more`/`dph-more-menu`, mobile-only — desktop keeps inline buttons via `dph-desktop-act`). (3) **Delete left the top row entirely on ALL widths** — it renders at the bottom of the Overview record (quiet terracotta outline, behind the existing `deleteDonor` confirm); a destructive action at thumb height beside Edit was a mis-tap risk. (4) Tab row (`.dp-tabs`) keeps internal `overflow-x:auto` with a **right-edge mask-image fade** as the scroll affordance (mask stops use ink `#0f1a12` — masks are alpha-only and `#000` trips the brand allowlist; the §9 gradient ban is about bar FILLS, a transparency mask is not one). (5) Back is a compact `←` (word span hidden on mobile) beside the donor name instead of a full-width bar.
- **Demo-org officer cleanup needs a prod super-admin** (`NEEDS-JONATHAN.md` §8): the legend's "Jonathan 0·$0" / "Jonathan Atkinson 0·$0" are real org_creo users — one is Jonathan's OWN login (xjca2006@gmail.com) — and **the product has NO remove-user route** (all `app.delete` routes enumerated; Settings › Team invites but can't remove). Manual Supabase deletion caused the documented dangling-FK incident. The file has the 2-minute safe path (Supabase delete + `POST /admin/data-integrity/fix`) and specs the proper `DELETE /users/:id` as its own reviewed change.
- Guards green after: build41-capture 18/18 · landing suite (funnel 41 / hero 22 / motion 8 / crispness 34 / image 18 / reveal 7) · locked-features 58 · clickability 55 · pipeline-gating 20 · brand-glyph 66 · brand-allowlist 27 · palette/no-emoji/onboarding-brand/upgrade-checkout · full `run-all.sh`.
- Noted, not fixed (out of scope): the sample-data event renders "Invalid Date" on the profile's Events card (visible in the 390px walk) — a seed/display bug worth its own small FIX.

## BUILD-40 — mobile overhaul at a TRUE 390px (2026-08-06; committed, NOT pushed — awaiting review)
Walked/verified at a real 390×844 Playwright viewport — **never verify mobile by resizing a window** (Chrome's minimum is 500px; a resize silently shows desktop layout). Evidence: `audit/mobile-perf.md` + before/after per-section screenshots and `metrics.json` in `docs/build40-2026-08-06/` via committed `scripts/build40-mobile-capture.js`.

- **P0-1 (the build): scroll reveals are now FAIL-OPEN, and OFF at phone width.** The BUILD-29 `.lp-reveal` was fail-closed (base `opacity:0`, visibility dependent on a one-shot IntersectionObserver callback) — a momentum flick/anchor jump/back-nav scroll restoration moved sections through the viewport between callbacks and stranded them blank forever (8 sections measured at opacity 0 in the live audit; 4 reproduced locally). Now: the hidden state is scoped to **`html.reveal-ready`** (armed by JS only after recovery exists) AND to **`@media (min-width:768px)`** — a phone never hides content behind an animation, nor does broken/blocked JS; reduced-motion honored; every observer callback runs a **recovery sweep** (reveal anything whose top < viewport bottom regardless of isIntersecting) plus a `requestIdleCallback` pass; rootMargin −10%. **Content visibility must never depend on an animation succeeding — do not regress this to a bare `.lp-reveal{opacity:0}`.** Guarded by `tests/landing-reveal.test.js` (7 — failed 3/7 against the old code; hard scroll jumps at 390px AND 1440px must leave zero opacity-hidden text, reveals must be off at phone width, and the calculator slider must be draggable by real pointer at 390px). It's in `run-all.sh` and SKIPs cleanly (exit 0) when Playwright/`client/dist` are absent.
- **P0-2 — hero asset**: new `hero-choir-640.webp` (37.6KB) + widened `srcset`/preload `imagesrcset` (index.html, still route-scoped to `/`), `aspect-ratio: 2560/1417` on `.lp-hero-photo`. NB the audit's "2560 to phones" was an iframe artifact (`sizes=100vw` reads the outer desktop window); real phones chose 1280 — the 640 variant covers DPR-1/2. Local FCP 104→96ms; the prod 3.3s FCP is bundle-parse/font-bound (prerender = separate decision, see `BLOCKED-mobile-height.md`).
- **P1 — 390px height 14,988 → 11,568px (−23%)**, all under `@media (max-width:768px)`: section padding 116→48px; hero height from content not 82vh (headline + both CTAs clear a ~700px usable fold); **verticals = horizontal snap carousel** (flex + scroll-snap, scrolls inside its own container); CTA pairs **full-width/equal/52px/primary-first** via `.lp-cta-row`; 43% statement left-aligned 27px/1.35 (`.lp-problem`/`.lp-statement` — long centered serif ≠ 390px); **product shot drops the desktop browser chrome** (`.lp-frame-bar` hidden — traffic lights under "Not a mockup" self-undermine on a phone); how-it-works illustrations hidden at phone width (numbered text carries it); queue card deduped to 4 rows (+ item-count chip hidden so the header never contradicts); founder letter 17px/1.7 (`.lp-founder-letter`); mobile nav keeps **Pricing** reachable, "Log in" moves to footer, gold CTA compacts. **The <9,000px target needs editorial cuts — deliberately BLOCKED, not guessed**: `BLOCKED-mobile-height.md` has the candidate cuts with measured savings (2 moments on mobile ~700px, letter behind a disclosure ~900px, …).
- **P2 — touch/type**: slider 30px thumb + 34px hit area (padding + background-clip; content-box); 16px body-copy floor on mobile; ≥44px tap boxes on nav/footer links; footer pads `env(safe-area-inset-bottom)` (the `viewport-fit=cover` meta was deliberately NOT added — shared app shell, own pass). Contrast on ink recorded: brass 7.8:1, sage 7.0:1, deep-sage `#6b8f7a` **4.96:1 — the thinnest AA margin on the page, don't darken it**.
- **All guards green after**: landing-reveal 7/7 · funnel 41/41 · hero 24/24 (measured AA over the recomposed 390px hero) · motion 8/8 · crispness 34/34 · image 18/18 · brand-glyph/no-emoji/palette/brand-allowlist · `npm run build` clean.

## Invitation pivot + live-audit credibility fixes (2026-08-06)
Steward's public funnel is INVITATION-ONLY while the five founding partners are chosen — self-serve signup is de-linked (not deleted), and three credibility issues found in a live Chrome audit of stewardapp.dev are fixed.

### The invitation funnel (one form, two surfaces)
- **`client/src/pages/Invitation.jsx`** owns the ONE "Request an invitation" form: `<InvitationSection/>` (full-width ink section — eyebrow "Founding partners — five organizations", serif headline, brass rule, 560px column, labeled fields incl. the donor-band select + optional hardest-part textarea, gold/ink submit, "I read every one of these myself. — Jonathan") rendered (a) on the landing in place of the old founding-partner mailto ask (headline "Be one of the first five.", keeps the letter-precedes-ask order) and (b) as the standalone **`/invitation`** route (headline "Steward tells you who to call today, and what to say."). Success state replaces the form IN PLACE ("Thank you — that's with me." + the honest "if it isn't the right moment, I'll tell you that honestly too" — saying no is what makes the scarcity real). **No CAPTCHA (trust cost too high on a credibility page), no countdown, and never the word "waitlist"** — a hidden `website` honeypot + a 3s minimum-fill-time check stand in.
- **`POST /invitation-request`** (public, `invitationLimiter` 10/15min) → `invitation_requests` table (db.js; human-read, never rendered into the app) + fire-and-forget notify email to `FOUNDER_EMAIL` (reply_to = the requester). **Both bot signals return the SAME `{received:true}` as a real submission** — they just store nothing (never tip a bot off). Fields trimmed + length-capped (hardest-part 2000), oversized input capped not rejected. Guarded by `tests/invitation.test.js` (18, in `run-all.sh`).
- **Every self-serve CTA became "Request an invitation" → `/invitation`:** landing nav/hero/close (was "Start free" → /signup ×3), the trial microcopy ("30-day trial · no credit card") is gone, the login page's "Sign up free" link, and the pricing page's unauthed nav + plan buttons + footer note. **The `/signup` route itself stays live but UNLINKED** — Jonathan sends it directly to accepted partners. **Authed pricing behavior is untouched** (Current plan / startCheckout / trial banner — `upgrade-checkout.test.js` still green).
- **Pricing stays PUBLISHED, reframed future-tense** (hiding prices reads as Blackbaud-shaped opacity — the exact thing Steward positions against): a framed chip above the plan cards says Steward is invitation-only, these are the prices when it opens in January, and founding partners lock in below them. The landing's invitation section carries the same quiet signal ("Plans from $149/month … See pricing").

### Live-audit credibility fixes (the P1s)
- **43% stat now attributed to its PRIMARY source**: "43.3% is the full-year 2025 donor retention rate published by the Fundraising Effectiveness Project (AFP Foundation for Philanthropy)" — was mis-attributed to Bloomerang (a competitor, republishing FEP's number). Never cite a competitor as the authority.
- **"Keep 100% of every gift" overclaim removed everywhere** (Stripe's ~2.9%+30¢ still applies, and Zeffy is genuinely 0% total — the overclaim was both riskier AND weaker than the truth). The truth is the wedge: **"No platform fee. No donor tip. Gifts settle in your own Stripe account."** (hero trust line, pricing gold line).
- **Calculator re-sourced**: `CHURN_RATE = 0.29` from **M+R Benchmarks 2026** (2025 data: monthly sustainer retention 71% at twelve months; ~1 in 10 monthly gifts fails inside two months) — replacing the unsourced "widely-cited 20–30%" (24% midpoint) payments-literature hand-me-down. Assumption + source stated inline on the card.
- **Hero subhead leads with the promise, not fees**: "Steward tells you who to call today, and what to say — and stops you losing the donors you already earned to failed cards and silence." (Fees demoted to the trust line.) Also fixed: the money strip still quoted the LEGACY $99/$249/$499 plans → now $149/$299.
- **Guards updated in lock-step**: `landing-funnel-verify.js` (41 — CTA → /invitation, no Start-free/free-trial/waitlist strings, FEP-not-Bloomerang, no keep-100%, calculator 0.29 + M+R cited, form + honesty line present), `brand-glyph.test.js` §7 (login link is now "Request an invitation", forest green). Verified locally: funnel 41/41 · hero 24/24 · motion 8/8 · crispness 34/34 · image 18/18 · **full `run-all.sh` 57 suites green**; live browser drive + DSF3 screenshots `docs/invitation-2026-08-06/` via committed `scripts/invitation-capture.js` (form submit → real API → row + in-place success state).
- **Audit items deliberately NOT done this pass** (flagged, not forgotten): the ~3.3s client-render FCP / hero-paint lag on cold loads (srcset + preload already exist; server-rendering the hero text is a separate perf pass), and the broken smooth-scroll / reveal-on-jump behavior. Mobile rendering remains UNVERIFIED (the audit's window-resize didn't take) — highest-value remaining check, needs a real device.

## BUILD-36 Part A — officer notifications: hear about donors & tasks without logging in (2026-08-05)
An officer must hear about their portfolio gifts, task assignments, and due tasks by **email** — deduped, toggleable, idempotent, and ON for new orgs. Internal staff mail throughout (branded header via `brandEmailHeaderHtml`, org name `displayNameCase`'d, canonical links via `publicAppUrl`, **NO donor unsubscribe footer** — the same rule as `sendGiftAlertEmail`/digests).

### The notification matrix (who gets emailed for what)
| Event | Recipe / path | Recipients | Pref toggle | Dedup key |
|---|---|---|---|---|
| A gift lands | `instant_gift_thanks` (`notify_gift`) | ED (org admins) &/or assigned officer per `config.notify` ∈ ed\|owner\|both | `notify_portfolio_gifts` | `gift:<giftId>` |
| Major gift (≥ threshold) | `major_gift_alert` (`notify_owner` → assigned task) | the donor's owner (ED fallback) | `notify_task_assignments` | `gift:<giftId>` |
| A task is assigned to you by someone else / a workflow | `POST`/`PUT /tasks`, workflow `create_task`/`notify_owner` | the assignee (never a self-assign) | `notify_task_assignments` | `taskassign:<taskId>:<userId>` (manual) or `gift:<giftId>` (gift-fired) |
| Daily due/overdue tasks | `processDailyTaskReminders` (5-min tick, morning window) | each user with tasks due today + overdue | `notify_daily_tasks` | `digest_sends` `daily_tasks` / `day:YYYY-MM-DD` |

### The mechanisms (server.js)
- **A1 — gift-notify default ON for NEW orgs.** `provisionNewOrgWorkflows(orgId)` (called ONLY at `/auth/register-org` + `/auth/register`) runs `ensureWorkflows` then enables `instant_gift_thanks` with `notify:both`. **Existing orgs are never re-created, so their toggles are untouched** — `ensureWorkflows` still inserts every recipe disabled; only the register path flips it on. Hearing about a gift is the product working, not a setting to discover.
- **A2 — task-assignment email.** `notifyTaskAssignment(task,{org,actorUserId,eventKey})` emails the assignee (title · donor · due · "Open Steward" link) when `assigned_to !== actor` (no self-assign email). `POST /tasks` fires it when the assignee ≠ creator; `PUT /tasks/:id` now accepts `assignedTo` and fires ONLY on a genuine reassignment to a NEW person ≠ the actor. Workflow `create_task`/`notify_owner` fire it with `actorUserId=null` (a workflow is "someone else").
- **A3 — daily reminder.** `processDailyTaskReminders(now)` on the existing 5-min tick (NOT a second scheduler), gated to a morning window `[6,12)` local, reserves `digest_sends` (`daily_tasks`, `day:<date>`) so it goes **once per user per day**. **Sends only when non-empty** (no due/overdue tasks → no email, nothing reserved). Subject: `"N tasks need you today — <Org>"`. Ops/test hook: `POST /digests/run-daily` (requireAdmin, `{today?,dryRun?}`).
- **A4 — one email per person per event + per-user toggles.** `notification_sends (org_id, event_key, recipient_user_id)` UNIQUE (channel is metadata, deliberately NOT in the key) is the cross-recipe dedup: `notifyUserOnce(...)` reserves the row BEFORE sending, so **gift-notify and the major-gift owner alert can never both email one person for the same gift** (both use `event_key=gift:<giftId>`). A pref opt-out reserves NOTHING (a different, opted-in notification for the same event can still win). Toggles live on `users.notify_portfolio_gifts` / `notify_task_assignments` / `notify_daily_tasks` (BOOLEAN DEFAULT true; NULL treated as ON by `userWantsEmail`), read/written via `GET /me` (`notifications`) + `PUT /me/notification-prefs`, surfaced in **Settings › Account → "Email notifications"** (three checkboxes, default on).
### Part B — walkthrough fixes (B1 invite page, B2 bulk assign-owner, B3 greeting)
- **B1** — invite page rebuilt on the public auth convention + brand guard extended to the auth bucket (see the `InvitePage.jsx` bullet under "Project structure").
- **B2 — bulk "Assign owner ▾" in the Directory.** The bulk bar's owner control (admin-only + `requirePlan('team')`, matching BUILD-31 pipeline role scoping — cross-officer ownership is the oversight Team sells, so **staff never see it**) now lists **active officers AND pending invitees** (from `/portfolio/officers` `invites`, id `invite:<id>`). `PATCH /donors/bulk-assign` accepts `assignedTo="invite:<id>"` → validates the invite is in-org/pending/unexpired → **HELD** (`pending_assignee_invite_id`/`pending_assignee_name`, `assigned_to=NULL`, not on a board) until `/auth/invite/accept` resolves it to the new user + their board — the exact pending-invitee rules as import owner-routing. A real user assignment IS portfolio+board membership (BUILD-30); toast "N donors assigned to <name>" (+"(held until they accept)" for a pending target). Counts stay consistent by construction (the shared `portfolioMembership`). Guarded by `tests/import-assign.test.js` §5 (**73**: active→board, pending→held→accept-resolves, staff→403, bogus invite→400) + `tests/locked-features.test.js` (admin+Team gating pinned).
- **B3** — greeting windows → `client/src/lib/greeting.js` (see the Dashboard.jsx design-system note).
- **Verified**: `tests/notifications.test.js` — **31/31**, REAL captured email bytes (local Resend sink), in `run-all.sh` (**54 suites green**). Covers: new-org default-on + existing-org-untouched; owner-assigned gift → officer emailed once, branded, no footer; both-recipes-one-gift → exactly one officer email; each toggle honored; task-assign by-other / self-assign-silent / reassignment-once; daily reminder non-empty-only + once-per-day + opt-out; org isolation. DSF3 renders: `docs/build36-2026-08-05/` (officer-gift, task-assignment, daily-reminder emails) via `scripts/build36-notify-capture.js`. Greeting windows (B3) → `client/src/lib/greeting.js` + `tests/greeting.test.js`.

## Demo-seed boot time bomb — FIXED (2026-08-05, found live)
`seedData()`'s metric-snapshot seed used **fixed row ids (`msseed_debt_0…20`) with day-shifting `snapshot_date`s** under `ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE`. On the FIRST boot after a date rollover, the insert found no conflict-target match (new date) and fell through to the id PRIMARY KEY → 23505 → `Database init failed` → **`process.exit(1)` → crash-loop until manual intervention**. Prod survived only when the day's snapshot row already existed at deploy time (regular demo-org traffic writes it); the scratch stack reproduced it deterministically at local midnight. Two-layer fix (db.js):
- **Date-stable seed ids** (`msseed_debt_${date}`): an id collision now implies a conflict-target match — idempotent by construction, every day.
- **Seed failure is no longer fatal**: `getDb()` wraps `seedData()` in try/catch (CRITICAL log, server boots). Schema init failure stays fatal — the schema is required to serve; org_creo's demo sugar is not. Do NOT re-tie seed success to boot success.

## BUILD-35 — "Set up Steward" activation checklist + email polish (2026-08-04)

### Part 1 — the activation checklist (post-onboarding → activated org)
A persistent, dismissible **"Set up Steward"** card on Home for new orgs. **Every item's done-state is COMPUTED live from real org data — never stored per-step** — so an item checks itself off however the underlying thing became true (wizard, Settings, a teammate). The checklist doubles as the hand-onboarding script for design partners.
- **`GET /org/setup-status`** (requireAuth): six items in value order — `donors` (>5 real donors; sample + trashed never count), `stripe` (`stripe_account_id`), `address` (`receipt_address`), `givingPage` (≥1 `status='active'` page — archived doesn't count), `workflow` (≥1 enabled recipe), `team` (≥2 users OR a live pending invite) — plus `doneCount/totalCount/complete/cardState/tier`. The **`team` item exists only on Team tier** (plan-graceful: HIDDEN on Core, not shown-and-locked). An established org reads `complete` and never sees the card.
- **Dismissal is the ONLY stored state** — `orgs.setup_card_state` (NULL = show · `'collapsed'` = the "Finish setup · 4/6" chip · `'hidden'` = never again), **per org, admins share it**, via `PUT /org/setup-card` (requireAuth + requireAdmin; deliberately not checkWriteAccess — a display preference). Staff see the card but only admins get the dismiss/hide controls.
- **Client** (`SETUP_ITEM_META` + `SetupChecklist`, Dashboard.jsx): each row = label + one-line why + an **exact deep link** — donors → the Donors tab with the one-file magical import ALREADY OPEN (new `openImport` intent threaded App→Donors), stripe/givingPage → Settings › Giving, address → Settings › Tax Receipts, workflow → Workflows tab, team → Settings › Team. Progress bar is a **solid gold fill** (no gradients). It's a normal BUILD-34 layout section (`setup`, 2nd in `HOME_SECTIONS`, hideable; ships to stale saved configs via the merge rule).
- **Completion**: one `GoldMoment` (`moment="setup_complete"`, the existing once-per-org pattern), then the card is gone forever. **The celebrate decision is captured ONCE at fetch time (`setupCelebrate` state)** — GoldMoment stamps its once-ever localStorage flag on mount, so a render gate that re-read the flag would kill the banner on the next re-render (it did, in the live drive; don't regress this). Gated on a `steward_setup_seen_{orgId}` flag so an org that was already activated before the card existed is never congratulated.
- **Verified**: `tests/setup-checklist.test.js` **36** (every item flips from the real underlying change incl. sample/trashed/archived/disabled negatives, plan grace, established-org complete, card-state admin-only/org-wide/validated/org-scoped, client-source deep-link guard) — in `run-all.sh`. Live drive + DSF3: `scripts/build35-capture.js` (**10/10**: fresh org 1/6 → workflow-row deep link lands on Workflows → real changes flip to 5/6 → dismiss chip persists across reload → completion GoldMoment → gone forever) → `docs/build35-2026-08-04/`.

### Part 2 — email polish (found reading real inboxes)
- **`displayNameCase(raw)`** (server.js, next to `normalizeName`) — the conservative HALF of the BUILD-26 rule: re-case ONLY wholly-lower/upper strings, preserve internal caps, **no "Last, First" flip**. Applied where org/user names enter outbound email: `brandEmailHeaderHtml`, digest subjects (`Week in Review — {org}`, `Your Monthly Report — {org}`) + headings (`Monthly Report — {officer}`), invite subject/body, receipt + fundraiser-live subjects. "Monthly Report — jon" can't ship again; "CREO Arts"/"McKinney" stay verbatim.
- **All-zero digests never shame or spam.** An all-zero officer month (`0 asks · 0 moves · 0 gifts`) renders a **nudge computed from their real data** — `countDonorsDueForTouch` (assigned donors with no interaction in 30d): "No moves logged this month — N prospects in your portfolio are due for a touch → open your pipeline". A fully-empty Week-in-Review gets the same treatment org-/officer-scoped. **Genuinely nothing actionable → the send is SUPPRESSED but the period is still RESERVED** (`digest_sends` row, `meta.suppressed:true`) so the 5-min tick never retries — idempotency discipline unchanged. Normal periods render exactly as before.
- **Verified**: `tests/email-polish.test.js` **30** — REAL captured email bytes via a local Resend sink (lowercase org/user → title-cased subject/heading/branded header; all-zero month → nudge with the real count, no zero row; nothing-actionable → no send + reserved-suppressed row; normal month/week unchanged; second run sends nothing; no digest link on a deployment host; + the live-test finding coverage below) — in `run-all.sh`. digests 38 / reports-cadence 32 / workflows-e2e 65 still green.

### Live-test findings fixed (2026-08-05 — a prod end-to-end run reading the real inbox)
A full prod live test (throwaway org, alias-only donor emails, every email read from the actual Gmail inbox) passed all receipt/automation mechanics and caught five template gaps, all fixed:
- **Receipt cover email** now carries the branded org header (`brandEmailHeaderHtml`), title-cases the org name in the BODY (the BUILD-35 sweep had fixed only its subject), and uses on-palette `#8fa896` instead of Tailwind `#6b7280`. It stays deliberately unsubscribe-free (transactional; suppression still respected upstream).
- **Year-end statement email subject** says "Your year-end giving statement from …", no longer "donation receipt".
- **Workflow email subjects AND bodies** (`thankyou`/`reengage` templates, the `notify_gift` internal alert) + the **`{{org_name}}` token** in dunning/campaign/sequence/pledge-reminder contexts + the AI milestone/at-risk draft context all run through `displayNameCase` — raw signup casing can no longer render anywhere in outbound mail.
- Covered by `email-polish.test.js` (receipt cover branded/title-cased both places, year-end subject, welcome subject+body+signature, CAN-SPAM footer intact).
- NB when testing idempotency via `POST /workflows/simulate`: pass the REAL event's `dedupKey` (e.g. `gift:g_…`) — omitting it deliberately mints a fresh key (it simulates a NEW event), which is not a dedup failure.

## Canonical email base URL — publicUrl.js (FIX, 2026-08-04)
**Found live: the password-reset email linked to `client-five-tau-13.vercel.app` — a real user correctly smells phishing.** The leak was the `process.env.FRONTEND_URL || "https://client-five-tau-13.vercel.app"` pattern copy-pasted across ~10 link sites (reset, invite, giving-page/peer-fundraiser share URLs, Stripe redirect/return URLs, gmail callback), plus the unsubscribe + card-update links riding the raw `railway.app` API host.
- **`publicUrl.js` is the ONE resolver** (pure, `stripeKeys.js` convention): `publicAppUrl()` / `resolvePublicAppUrl(env)`. Env source stays **`FRONTEND_URL`** (the pre-existing var — no second var invented), with `CORS_ORIGIN`'s first origin as the local-dev fallback (the scratch capture stack), and the code-level fallback is the canonical **`https://www.stewardapp.dev`**. A value pointing at a **deployment host (`*.vercel.app`, `*.railway.app`) is REJECTED** — even a misconfigured env can never leak one into a link. `http→https` upgrade except explicit localhost; trailing slash stripped. **server.js never reads `FRONTEND_URL` itself** — every link derives from `publicAppUrl()`.
- **Unsubscribe + card-update links now carry the canonical domain too**: root `vercel.json` gained proxy rewrites (`/unsubscribe`, `/recurring/update-card` → the Railway backend, declared BEFORE the SPA catch-all), so those backend routes are reachable on stewardapp.dev and `buildUnsubscribeUrl`/`buildCardUpdateUrl` use `publicAppUrl()`. `BACKEND_URL` survives ONLY for the invisible open-tracking pixel (not a link a donor sees).
- **Boot check is loud-but-not-fatal (deliberate):** on listen, an unset `FRONTEND_URL` logs a WARNING and a rejected deployment-host value logs CRITICAL — but the process boots, because the fallback IS canonical and crashing the API (donations, webhooks) over an env var would be worse than the warning. **`/health` exposes `publicUrl: {url, fromEnv}`** — the one-glance post-deploy check that prod links carry stewardapp.dev. Railway should still set `FRONTEND_URL=https://www.stewardapp.dev` explicitly (turns the boot warning green).
- **Guarded by `tests/email-links.test.js` (35, in `run-all.sh`)**: every resolver branch; server.js reads no FRONTEND_URL/VERCEL_URL, has no request-derived host (`req.headers.host` etc.) and no `localhost`; vercel.app only on the CORS-allowlist line; both backend link builders on `publicAppUrl()`; the vercel.json proxies exist and precede the SPA catch-all. Verified with REAL captured email bytes (local Resend sink, no env set): reset + invite emails carry only `https://www.stewardapp.dev` links.

## BUILD-34 — customizable Home: per-user section layout (2026-08-04)
**Home renders from a per-user ordered section config, and edit mode is reorder + show/hide of WHOLE sections only — deliberately NOT a widget grid** (no resizing, no columns, no free-form placement; a section-level stack keeps Home designable and calm — the moment individual widgets float free, the default design and every future section addition stop being ownable).

### The config model (ONE source of truth)
- `client/src/lib/homeLayout.js` (JSX-free, Node-testable like `money.js`) owns the **canonical section list + default order**: `hero` (Fundraising goal banner), `setup` (BUILD-35 activation checklist — renders nothing for activated orgs), `goalCards` (per-goal breakdown grid, split out of the old hero IIFE), `commandCenter` (Today-at-a-glance stat row), `myPortfolio`, `retention` (Donor retention card incl. the Signals chips), `work` (the queue/briefing + funnel/grant/recurring two-column grid), `impact` (ImpactLine). **A future Home section = append it to `HOME_SECTIONS` there** (+ its JSX in Dashboard.jsx's `sections` map).
- **Merge rule (the stale-config guarantee)**: `mergeLayout(saved)` keeps the user's saved order for ids that still exist, drops retired/unknown ids, and **APPENDS any canonical id the saved config doesn't know — visible, in canonical order** — so a new section ships for every user and is never silently hidden by an old saved config. Guarded by `tests/home-layout.test.js`.
- **Safe rails**: the `hero` is movable but **never hideable** (Home can never be blanked) — enforced three times: at render (merge forces it visible), at write (`PUT /me/home-layout` normalizes it visible), and in the UI (no Hide button; an "Always shown" pill). Everything else hideable.

### Persistence — per USER, server-side
`users.home_layout` (TEXT JSON, NULL = canonical default) + `GET/PUT/DELETE /me/home-layout` (server validates shape only; the canonical list lives client-side). Per-user on purpose: follows the user across devices (never localStorage), and org admins don't control other users' layouts. **Reset saves NULL (DELETE), not a frozen copy of today's default** — future default-order changes then apply automatically. Saving an order that equals the default also clears to NULL. Plan-gating is orthogonal: a section a Core user can't see simply isn't in their rendered list (its id may sit unused in a saved config; the merge tolerates it) — hiding ≠ gating.

### Edit mode UX (Steward restraint)
Quiet **"Edit"** text button by the greeting (no floating pencil). In edit mode: content dims + goes inert (`pointerEvents:none`), each section gets a floating **handle pill (⠿ + label), a "↑ Top" button (FIX 2026-08-04), and a Hide button** — absolutely positioned chrome, so entering/leaving edit mode causes **zero layout shift**. **"↑ Top"** one-clicks a section to the top of the stack, respecting the hero rail: while the hero is the first VISIBLE section, top = directly under the hero; hero moved down → genuinely first (pure `moveToTop(layout,id)` in `homeLayout.js`; a no-op returns the SAME array reference, which is how the UI hides the button on the hero and on whatever already sits at the effective top). Keyboard path free (it's a button); a visually-hidden `role="status"` aria-live region announces the landing position; persists via the same Done save. Drag is native HTML5 (same machinery as the pipeline board) with a midpoint rule (slot before/after the hovered section by cursor half — no reorder thrash); the only motion is a 150ms lift (shadow + 2px translate) on the dragged section, **off under `prefers-reduced-motion`** (module-level `REDUCED_MOTION` matchMedia). **Keyboard path (the pipeline accessibility bar): handles are focusable, ArrowUp/ArrowDown move the section (aria-label announces "position X of N"), Enter saves.** Hidden sections collect in a **"Hidden" tray** at the bottom of edit mode (recoverable, never lost). **Done saves optimistically** (exit immediately, rollback + error toast if the PUT fails); **Esc cancels**; "Reset to default" restores the canonical order. The shared My-donors/Whole-org scope toggle isn't a section — it renders above the **first visible scoped section** (`commandCenter`/`retention`/`work`), wherever the user put it, and hides during edit mode. Sections with no data (e.g. `goalCards` with <2 goals, a silent `impact`) render nothing and aren't offered in edit mode — only explicit hides reach the tray.

- **Verified**: `tests/home-layout.test.js` **36** (round-trip, the "second device" via a second login, per-user + per-org isolation, 400s on malformed/oversized configs, hero-never-stored-hidden, dedupe, DELETE-resets, the full merge rule incl. new-section-appears-for-stale-config, and the moveToTop hero-rail cases: under-hero when hero first / genuinely-first when hero moved down / same-reference no-ops / hidden-row-above-hero) — in `run-all.sh` (50 suites green). Live drive + DSF3: `scripts/build34-capture.js` (**16/16**: edit affordance → hide → tray → KEYBOARD reorder → Done → reload shows the server-persisted order with the hidden section gone → Reset clears to NULL → Move-to-top by mouse AND keyboard with the aria-live announcement, hero/top-slot buttons correctly absent, order persisted across reload) → `docs/build34-2026-08-04/` (home-default, edit-mode-handles, edit-hidden-tray, edit-reordered, home-reordered-persisted, edit-move-to-top, home-move-to-top-persisted).

## Attribution completeness (FIX, 2026-08-04) — every money path attributes, reverses, and reconciles
Closes every remaining path money takes into (or out of) Steward: manual, edit, import, online, recurring, pledge, refund, donor-covered fees, grants — plus the Home hero chips' clickability. Suite: `tests/attribution-completeness.test.js` (**70**, in `run-all.sh`); DSF3 screenshots `docs/attribution-fix-2026-08-04/` via `scripts/attribution-chips-capture.js` (local stack — build the client with `VITE_API_URL=http://localhost:5601`, `vite preview` on :4173, server booted with `CORS_ORIGIN=http://localhost:4173`).

### What campaign "raised" MEANS now (LOCKED — documented in fundraisingCampaignRows)
**`raised` = `giftRaised` + `grantAwarded`.** All thermometer/goal surfaces (fundraisingCampaignRows, `/campaigns/:id/progress`, roll-ups, Home hero, giving-page/peer-fundraiser progress) share it:
- **`giftRaised`** — Σ attributed gift PAYMENTS RECEIVED, **net of any donor-covered fee portion** (`amount − cover_fee_amount`). Goal progress counts what the donor intended for the mission; the CHARGED total stays in Reports (money in), Finance (money moved), receipts (the legal acknowledgment), and donor totals — deliberate, don't "reconcile" them to one number.
- **`grantAwarded`** — Σ attributed grants' amounts once AWARDED. `grants.campaign_id` (optional, org-scoped 404 on foreign) + **`grants.awarded_at`** is the attribution fact: stamped on the transition INTO `awarded` (the same moment as the existing award→ledger income stamp), kept through `active`/`closed` (a won grant's status moving on never drops the thermometer), cleared on a move BACK to a pursuing/rejected status (un-award reverses). An award **never creates a gift row** — if the foundation's check is also logged as a gift on their donor record, attribute only ONE of the two (helper text on the grant campaign selector says exactly this).
- **`pledged`** — Σ attributed OPEN pledges (`pledges.campaign_id`, set at pledge time via the pledge form's campaign selector; org-scoped). A SEPARATE figure ("$54,000 raised · $20,000 pledged" — `committedText` in Fundraising.jsx, `rolledPledged` on umbrellas), **NEVER summed into raised**: a payment against a campaign-attributed pledge INHERITS the pledge's campaign (explicit campaignId on the gift wins), converting pledged → raised exactly once as money arrives. The solicitations report carries `openPledges {count,total}` beside the ask forecast.

### Giving pages → campaigns (one goal concept)
`giving_pages.campaign_id` (optional; org-scoped 400 on foreign — a page from org A can never attribute to org B's campaign). The Settings page editor has a "Gifts through this page count toward" selector. **`POST /donate` stamps the page's configured campaign into the charge metadata** (`effectiveCampaignId` — the page's own campaign WINS over a client-sent campaignId), so webhook → `gifts.campaign_id` → thermometer moves with no human touch. **One goal concept:** a linked page **tracks the campaign** — Settings list, Fundraising Pages tab, and the public Donate page all show the CAMPAIGN's live raised/goal (reads expose `campaign_name`/`campaign_goal`/`campaign_raised`); only an unlinked page keeps its own `goal_amount`.

### Recurring renewals attribute (not just the first charge)
`recurring_subscriptions.campaign_id`/`giving_page_id`/`cover_fee_amount` are stamped at `checkout.session.completed` (mode=subscription) from the session metadata. A RENEWAL's invoice-generated PI carries no checkout metadata, so the `payment_intent.succeeded` handler resolves attribution from the subscription row: precise via `stripe.invoices.retrieve(pi.invoice)` when Stripe is reachable, else the donor's single attributed non-canceled subscription — **ambiguity (2+ subs with different attributions) attributes NOTHING** (never mis-assign, same rule as imports).

### Refunds/voids reverse attribution everywhere (`charge.refunded` handler)
Every surface is a live SUM over gift rows, so reversing the row reverses them all at once. **Idempotent BY CONSTRUCTION** — remaining = `(ch.amount − ch.amount_refunded)/100`, so a redelivered event converges. **Full refund**: auto-VOIDS an active receipt (`void_reason='Gift refunded via Stripe'` — a refund is a fact about the money, the acknowledgment no longer describes a real gift; the voided record survives with `gift_id` NULLed), reopens a fulfilled pledge, deletes the single ledger stamp + the gift in one transaction, `recalcDonorSummary`, logs an interaction note. **Partial refund**: shrinks the gift + its ledger stamp to what the org kept (cover_fee capped at the new amount); an issued receipt is deliberately NOT auto-edited — the existing `receipt_mismatch` queue surfaces it for a human. The manual void path (`DELETE /gifts/:id`, BUILD-33) already reversed everything and is re-asserted here.

### Donor-covers-fees: which number counts (LOCKED)
`gifts.cover_fee_amount` (and the mirror on recurring_subscriptions) = charged − intended, read back from Steward's own checkout metadata (`cover_fees`/`base_amount_cents` — server-derived, never client-trusted). **Campaign/page goal progress counts the gift amount (donor intent, net); Reports/Finance/receipts/donor totals keep the grossed-up charged total** (money in / money moved / legal record). Both are correct answers to different questions — documented so it can't drift.

### Home hero chips are drillable (count-matches-destination)
The four dark-hero chips route through the shared `interactive()` (dark variant — hover, cursor, gold focus ring, Enter/Space): **Pace** → Fundraising Overview; **This FY** → Reports › Giving Summary current FY (fiscal); **This week** → Giving Summary CUSTOM range pre-filled with the chip's exact Monday week (`thisWeek.start/end` now on `/fundraising/overview`); **Re-engaged** → a `MetricBreakdownPanel` drill-down of the donors behind the number (`/impact` now ships `reengagedDonors`, Σ rows === the chip's amount/count). **Reports is now intent-carrying** (`navigateTo("reports",{report,preset|from/to,yearMode})` → `reportsIntent` → `initialReport`/`initialParams`, remounts via navNonce like the other intent tabs). "Time Left" has no destination and stays visibly static (no dead click). Guarded by `tests/clickability.test.js` (source) + the live destination-count agreement in the attribution suite Part 6.

## Finance entity-routing (FIX, 2026-08-04) — manual money-in wires to grants and donors, no free-text money
Observed live: $60,000 "Money in" free-typed as "Mellon Foundation" while the Grants board showed Mellon with a $60k open ask — the ledger gained money, the grant stayed "in the works," open-asks stayed wrong, and marking the grant Awarded later would have booked the same $60k AGAIN (the award auto-stamp, BUILD-09). Same class as the Designation bug: free text where an entity link belongs. Suite: `tests/finance-entity-routing.test.js` (**46**, in `run-all.sh`); DSF3 screenshots `docs/finance-entity-routing-2026-08-04/` via `scripts/finance-entity-routing-capture.js` (local stack, same recipe as the attribution capture).

### The ONE rule (LOCKED)
**Money from a person, foundation, or grant enters through the gift/grant paths — which stamp the ledger exactly once. Finance's manual money-in is for genuinely non-donor revenue** (interest, merch, reimbursements). The manual form routes a recognized name to the right flow; it never silently accepts a donor's money as an anonymous ledger row. Free text remains valid for true vendors (the hardware store).

### Award stamp is now idempotent BY CONSTRUCTION + reversible
- **`fin_transactions.grant_id`** (db.js) + partial-unique **`uq_fin_txns_grant (grant_id) WHERE grant_id IS NOT NULL`** — the grant twin of `uq_fin_txns_gift`. `stampGrantAward()` (server.js) is the ONE award→ledger stamp: `source='grant'` (badged "Grant · Award" in the unified ledger — a `grant_id`-carrying row badges as the award booking regardless of source), `ON CONFLICT DO NOTHING`, so re-award/redundant-PUT/adopted-row can never double-insert. The pre-existing gap where **POST /grants created directly IN 'awarded' never stamped** is closed (same helper).
- **Un-award reverses the ledger** (same discipline as a voided gift removing its stamp): moving an awarded grant back to a pursuing/rejected status deletes the auto stamp and **UNLINKS an adopted manual row** (`grant_id=NULL`, row survives — treasurer-entered data is never deleted by a status move).

### The routing prompts (client, `TransactionModal` in Finance.jsx)
- **Vendor/Donor is entity-aware**: 220ms-debounced type-ahead against `GET /donors?search=&limit=` + `GET /grants?search=&limit=` (org-scoped server queries), grouped "Open grant asks" / "Donors"; picking a donor sets the real `donor_id` FK on the manual row (route already `orgOwns`-guards it). Matching is the pure JSX-free **`client/src/lib/financeMatch.js`** (`namesMatch` strips legal noise — "The Mellon Fdn Inc" matches "Mellon Foundation"; `findOpenGrantMatch` only over `OPEN_GRANT_STATUSES` = GRANT_ACTIONABLE; **ambiguity → no match, never mis-assign** — same rule as import owner-matching). Free-typed names are re-checked at save time.
- **Money-in naming an open-ask foundation** → prompt ("Mellon Foundation has a $60,000 open ask (Community Arts Access). Is this that grant?") → **Yes** runs the EXISTING award flow (`PUT /grants/:id status:'awarded'`, amount = the money that actually arrived) — the award stamp IS the ledger entry, **no manual row is inserted**, the board moves, open-asks clears, `awarded_at` is stamped. A routed award also patches the shared `data.grants` (Finance now takes `setData`) so the Grants board reads Awarded in-session. **No** logs the manual row as typed.
- **Money-in naming a known donor (no open grant)** → prompt to log it as a **gift** instead (`POST /donors/:id/gifts` — lifetime/receipts/attribution/ledger, the whole chain, once). Declining keeps the manual row WITH the `donor_id` link (ledger-only income from a known donor is the deliberate exception). Expenses never prompt.

### Award-side guard (the other direction)
`GET /grants/:id/manual-match` (read-only, org-scoped, 404 foreign) finds recent (180d) **manual, unlinked** money-in matching the funder name (bidirectional substring on vendor/description) or the exact grant amount. Every client award path (kanban drop, profile status change, edit-save — `resolveAwardAdoption()` in Grants.jsx) checks it before the PUT and offers: **link the existing row** → `PUT … adoptTxnId` makes that manual row the award's single booking (`grant_id` set, `source` stays `'manual'`, no new insert, audit-logged) — or book separately. `adoptTxnId` is validated up front (foreign/gift-sourced/already-linked → 404 with NO state change; on a non-award PUT → 400) — never a silent double-book.

### Consistency (asserted)
The 46-test suite drives the Mellon scenario end to end: manual-log-then-award-with-adopt → Cash on Hand exactly $60k (not $120k), grant awarded + `awarded_at`, open-asks cleared; award/un-award/re-award always nets exactly one ledger row; the DB unique holds even against a raw duplicate insert; gift path books once; org isolation both directions. No scenario books the same inbound dollars twice across manual + award + gift.

## BUILD-33 Parts 2–4 — Grants facelift · Donors action consolidation · whole-product brand sweep + HARD token allowlist (2026-08-04)

### The action-color conventions (LOCKED, applied product-wide)
**Primary action = `gold500` fill with INK text** (never white-on-gold). **Secondary = forest-green outline/text.** **Destructive = quiet terracotta outline — never a bright red fill.** Dark panels are reserved for the Home hero, profile rails, and deliberate showcase moments — never list rows, tables, or admin chrome. Errors/overdue ride the new terracotta ramp (`terra700` text on `terra100` wash, `terra200` borders); warnings/urgency ride gold (`gold700` banner, `gold100` text). The **App.jsx billing banners** moved off Tailwind red-900/amber-950 onto these families (read-only = deep terracotta, past-due/canceled/trial-urgent = deep gold).

### The token allowlist guard — `tests/brand-allowlist.test.js` (the enforcement)
**Every color literal in active client source must be a T-token value (shared.jsx), a publicTheme value, or an entry in the guard's explicit, documented EXTRAS list — anything else FAILS.** It is wired into BOTH `tests/run-all.sh` AND the client **build** (`client/package.json` `build` runs it before `eslint src && vite build`, so Vercel deploys fail on drift; `npm run brand-guard` runs it alone). Proven live: a planted `#ff00aa` failed the build with file:line, removed → green. It also hard-bans the Tailwind red/amber/blue/purple/pink/mint families outright (they can't even be smuggled into EXTRAS), asserts the BUILD-33 surface guards (Grants honest-overdue + no colored borders, the Donors Import-&-tools menu with every import path reachable, Communications conventions + no giant-letter thumbnails + cream sequence rows), and asserts SC/TIER_COLOR reference T tokens. **Excluded, documented:** `pages/AdminDashboard.jsx` (super-admin ops tool, own `A` palette) and the deprecated hidden components (Events/Board/Volunteers/Programs/AnnualFund — the pivot backlog; AnnualFund/Programs aren't even imported). **This closes the old "~1300-literal backlog" note for ACTIVE surfaces at the VALUE level**: every literal in scanned files is now an on-palette value (tokenizing remaining same-value literals into `T.*` references is optional polish, not a brand risk — the guard pins values).
- **T gained documented ramp stops (BUILD-33):** `sage400 #8fa896` / `sage600 #6b8f7a` (text on dark panels — these were ~90 raw literals), `green650 #2d4a35` (hairlines on dark), the **terracotta ramp** `terra700 #8a3a24` / `terra200 #eac6b8` / `terra100 #f6e3dd`, `gold700 #8a6d1f`, `gold50 #fdfaf2`. **Legacy off-palette tokens `T.red`/`T.amber`/`T.blue`/`T.greenPale` are DELETED** (usages swept). **`SC` and `TIER_COLOR` (shared.jsx) are now on-palette** — the blue/purple/amber status + wealth-tier pills (Grants pills included) are closed everywhere they render.
- Also swept: Donors.jsx (~110 literals: every red/amber/blue/purple incl. the **four emerald→blue gradient import CTAs → solid gold**, planned-giving purple → green/gold with **Restricted = gold** per the Finance convention, activity/event/tier color maps → five-color sets), Settings, WelcomePage, DonorMap, ShareBlocks (slate embed block → pine), LoginPage/Signup/Forgot/Reset/Donate/ManageFundraiser error chrome → terracotta, TouchpointTimeline direction badges (blue "Sent" → gold), VoiceMemoModal. `PRESET_ACCENTS` (Settings branding swatches) are customer-choice data — allowlisted, not chrome.

### Grants (Part 2) — on brand, structurally consistent with Fundraising
Kanban columns are quiet `T.bg2` containers with **typographic headers** (label + $total + count — the Pipeline-board treatment; the dark header blocks + colored left bars are gone); column/card accents are LOCKED to the palette (`KANBAN_COLS` references T only). List stat cards lost their colored top borders (active filter = gold wash + gold border; the clickability statusFilter contract is unchanged). A **summary strip** (In the works / Received / Next deadline, typographic — no boxes) sits above the board/list, matching the Fundraising structure. **Honest overdue (the rule):** `GRANT_ACTIONABLE = {prospecting, loi, applied, submitted, draft, pending}` — a deadline only carries urgency while the grant is still being pursued; awarded/active/closed grants NEVER show "Overdue"/countdowns (`deadlineMeta()` in Grants.jsx is the one implementation; the profile's Days-to-Deadline shows "Passed" instead). The sample seed was checked and is fine — open grants have future deadlines; the noise was purely the display rule. `statusToCol` also maps legacy `submitted→applied`, `draft→loi`. FindGrants lost its purple/blue AI gradient button (gold primary) and navy results panel (pine `green950→green800`, gold eyebrow, legible `inkInverse` text — was dark-on-dark). Kanban/List toggle + drag-and-drop unchanged.

### Donors action row (Part 3) — primary + one menu
**+ Add** (now gold primary) and **✦ Call List** stay; **Import / Giving History / Import + History / Merge duplicates collapsed into ONE "↑ Import & tools" dropdown** — "Import + History" carries a gold **Recommended** badge (the magical one-file path), the others are labeled by their specific case ("Import donors only — a contact list with no gift rows", "Add giving history — attach a gift export to donors already here", "Merge duplicates"). All four modals stay reachable (guarded by brand-allowlist §Donors). Standing rule: 4+ sibling action buttons → one primary + a labeled menu.

### Communications (Part 4 known offenders) — confirmed fixed
Primary buttons (Use Template / + New Sequence / + New Campaign / Save) = gold/ink; Delete/Remove/Unenroll = quiet terracotta outline; **sequence rows are cream cards with ink text** (the near-black panels are gone); **template thumbnails are serif type-samples on a gold-tinted card** (serif template name + 34px gold rule + subject sample — no grey giant-letter blocks); campaign table header is cream (`bg2`), not a dark band; status badges/segment chips/open-rate colors on the five-color set; AI-suggest chrome moved from purple to the gold "Suggested" family.

## BUILD-33 Part 1 — report truth: every report proven against hand-computed values (2026-08-04)
`tests/report-truth.test.js` (**84**, in `run-all.sh`) seeds a small golden fixture (12 donors, ~30 gifts across 4 fiscal years, every donor's pattern documented in the file's header comment) and asserts every report against **expected values computed by hand from the patterns — literals in the test, never derived from app code**. The suite found and fixed three real cross-surface bugs: **(1) `DELETE /gifts/:id` orphaned the gift's `fin_transactions` stamp** — the ledger kept income from a gift that no longer existed anywhere (violates "every gift stamps the ledger exactly once"; the stamp is now deleted in the same transaction); **(2) `/fundraising/overview` period/prior/week totals counted soft-deleted (trashed) donors' gifts** while Reports exclude them — Fundraising and Reports could show different period totals (now the same `JOIN donors … deleted_at IS NULL` predicate as Reports; the recent-gifts list is filtered too); **(3) `/finance/summary` `giftHistoryTotal`** (the "your giving history lives in Reports" figure) included trashed donors' gifts — it now matches what Reports actually shows. NB the campaign-thermometer `raised` (fundraisingCampaignRows / campaign progress) deliberately still counts a trashed donor's attributed gifts — a campaign genuinely received the money; the *period totals* are the cross-surface "same number" invariant, thermometers measure money toward a goal.

### Report definitions (LOCKED — the meaning can't drift silently)
- **Giving Summary** — gifts in the period (org-scoped, trashed donors excluded, `is_sample` included). `total`/`giftCount`/`uniqueDonors`; `avgGift` = total/count rounded to cents; **`medianGift` = `PERCENTILE_CONT(0.5)` — for an EVEN gift count the mean of the two middle values** (e.g. 8 gifts 20…1000 → (75+180)/2 = 127.5); **new donor = first-ever gift (any fund/campaign, unfiltered) falls inside the period** — basis-dependent (a donor can be new under calendar and returning under fiscal); online = `stripe_payment_id IS NOT NULL`; monthly = `GROUP BY LEFT(date,7)`, only months with activity.
- **LYBUNT** — gave in the prior year (same basis), no gift in the selected year. **SYBUNT** — any gift ever before the selected year, none in it (so SYBUNT ⊇ LYBUNT; the difference is donors whose giving skipped last year). Fiscal year N = Jul 1 (N-1) → Jun 30 N; membership legitimately differs between bases.
- **Retention** (report rows = last 3 COMPLETED years) — **retention % for year Y = (donors who gave in BOTH Y-1 and Y) ÷ (donors who gave in Y-1)**; dollar retention = retained donors' Y dollars ÷ ALL Y-1 dollars (can exceed 100%); **first-year retention = same formula restricted to donors whose FIRST-EVER gift was in Y-1**. Empty prior year → null, never a fake 0%/100%. The Annual report's retention figure is the same formula for its single year.
- **3-Year Comparison** — per-donor y0/y1/y2 sums (selected year and the two before); `changePct` = (y0−y1)/y1 on the two most recent years, **null when y1=0 and y0>0** (new money has no denominator); org growth = same formula on org totals; rows ranked by 3-year total.
- **Annual** — period totals + growth vs prior year + new/returning + retention + by-fund/by-campaign (each breakdown sums back to the total; campaigns honor the legacy `campaign_id` OR name dual attribution).
- **Top Donors** — period scope = `SUM(gifts)` ranked; lifetime scope = `donors.total_giving` column (imported history often has no gift rows); `view=household` re-keys the SAME gift rows by `COALESCE(household_id, donor_id)` — Σ household rows === Σ individual rows, soft credit can never inflate hard totals (BUILD-14 invariant, re-asserted here).
- **Solicitations forecast** — open = Σ open `opportunities.target_amount`; **weighted = Σ ask × STAGE_WEIGHT[donor's current stage]** with the documented weights `prospect .1 / qualify .2 / cultivate .4 / solicit .7 / steward .9 / lapsed .05`; officer win rate = **won ÷ (won + lost)** over the window — DECIDED asks only; open asks are NOT losses and never dilute the rate (FIX 2026-08-08, was the buggy won÷(won+open)). null → "—"/"No decided asks yet" when nothing is decided. `byOfficer` also carries `lostAsks`/`decidedAsks`; pinned by `tests/solicitations-winrate.test.js`.

## BUILD-32 — gift→campaign attribution · re-engaged giving · hero depth · single-value pickers (2026-08-04)
A walkthrough-driven pass. Four parts.

### Part 1 (CRITICAL) — gifts attribute to campaigns via `campaign_id`, not a free-text string
The headline bug: a manually-logged gift could NEVER move a campaign thermometer. "Designation" on the gift form was **free text that only landed in the interaction note** — there was no campaign reference on any manual gift path, so `raised` (a live `SUM(gifts)` matching `campaign_id OR campaign=name`) never saw it. Fixed end-to-end:
- **`POST /donors/:id/gifts` now accepts `campaignId`** (and `campaign_id` alias), validates it **org-scoped** (foreign → 404), writes `gifts.campaign_id`, and copies the campaign NAME into the legacy `campaign` text column so name-based reports stay consistent. It also accepts `fund_id` as an alias for `fundId` (the Add-Gift form was silently dropping its fund on the old spelling mismatch). `PUT /gifts/:id` gained the same: set / change / clear (`campaignId:""` → NULL) attribution.
- **Both manual gift forms carry a real Campaign selector** (`client/src/components/Donors.jsx`): `LogTouchpointModal`'s Gift branch AND `DonorProfile`'s Add-Gift form. Both source **goal'd campaigns** from `GET /fundraising/campaigns` (the ones with thermometers — not pure email blasts) and send `campaignId`. The Stripe webhook already set `campaign_id` from PI metadata; imports carry the free-text `campaign` NAME which the read side matches — every gift-entry path can now attribute.
- **The three overlapping fields are clarified with one-line helper text** — **Designation** (what the donor said it's for, free text) · **Campaign** (which goal it counts toward — moves that thermometer, `campaign_id`) · **Finance Fund** (which ledger fund it posts to, `fund_id`). **Smart fuzzy-match**: typing a designation that matches a campaign name shows a one-tap **"Did you mean the campaign X? Attribute →"** suggestion — pure matcher in `client/src/lib/campaignMatch.js` (`bestCampaignMatch`, JSX-free, Node-testable; exact/substring/token/typo, ambiguous → no suggestion, never silently discards a typed campaign name).
- **Backfill (report, don't guess):** `scripts/backfill-campaign-attribution.js` — dry-run by default, `--apply` promotes gifts whose free-text `campaign` **exactly** (normalized) equals one campaign name to a real `campaign_id`. Idempotent (only `campaign_id IS NULL`), ambiguous (name shared by >1 campaign) SKIPPED, recoverable JSON written to `docs/` first. Exact-name only — the fuzzy matcher is a live human-confirmed UI affordance, never used for silent bulk backfill.

### Part 2 — "Re-engaged giving" is counted SEPARATELY from "recovered", never merged
Two precisely-labelled numbers on `GET /impact` (the honest "what Steward has done for you" surface):
- **Recovered (automated):** `recoveredAmount` — dollars the **failed-card recovery workflow** attributably won back (`payment_recovery_events type='payment_recovered'`). Unchanged. "Recovered" stays a RESERVED word (BUILD-26 B3) — only this.
- **Re-engaged (surfaced):** `reengagedAmount` / `reengagedDonorCount` — gifts from donors who were **lapsed and gave again** = a gift after a **>365-day gap** (the SAME `LAPSE_DAYS`/`inferStage`/win-back-goal definition; every such return gift counted, distinct donors counted). Real and measurable, NOT an estimate, and **deliberately never merged into "recovered"** (merging would overclaim). Surfaced with recovered — as two distinct clauses/rows — in the Settings value-summary line, the Settings Billing impact card, and Home's `ImpactLine` (all keep the honest empty state).

### Part 3 — Home hero: more depth, ~20% shorter (`Dashboard.jsx`)
Reduced hero height (padding `22px 26px`→`16px 22px`, big % `58`→`44`, tighter margins/bar) and added **two live figures** to the right-hand stack (both branches): **This week** (amount + gift count, from a new `thisWeek:{raised,giftCount}` on `GET /fundraising/overview` computed via `weekBounds(0)` — a true Monday week) and **Re-engaged/Recovered** (Part 2, from `/impact`). Dropped the static **"Active Goals"** count (never changed week to week). Kept the roll-up headline, percent, **solid gold bar**, pace, and the FY comparison. No new decoration — the density is information (guard `brand-glyph.test.js §9` "no `linear-gradient(90deg`" still green; hero container `135deg` depth is the kept exception).

### Part 4 — Hide single-value pickers (standing UI rule)
**"My portfolio / All portfolios" and the officer filter show only when 2+ officers actually have assigned donors.** New server signal **`multiOfficer`** (# distinct officers with ≥1 assigned pipeline-stage donor ≥ 2) on `GET /pipeline` AND `GET /dashboard/home`. `Pipeline.jsx` gates the toggle + officer filter on `canViewAll && multiOfficer` (admin-gated per BUILD-31 AND multi-officer); Home's "My donors / Whole org" scope toggle gates on `homeData.multiOfficer`. **Standing rule: hide single-value pickers** — a picker whose options all resolve to the same view is clutter. (Reports shows officers as report COLUMNS, not a picker — nothing to hide there.)

### Verify (committed)
- `tests/gift-attribution.test.js` **34** — every entry path sets `campaign_id`; raised/percent recompute live from attributed gifts; foreign campaign → 404 (no row planted); unattributed gift still hits org totals; PUT set/change/clear; import (name-match) + webhook (PI metadata) paths roll up; the pure fuzzy matcher; org isolation.
- `tests/impact.test.js` **25** — re-engaged computed separately from recovered, both present not merged, first-time gifts excluded, honest empty state, org isolation.
- `tests/home.test.js` **41** — hero `thisWeek` raised+count; `multiOfficer` true (2 officers) / false (single).
- `tests/pipeline.test.js` **43** — `multiOfficer` true on the 2-officer TEAM board, false on single-officer CORE.
- Full `bash tests/run-all.sh`: **44 suites green**. `eslint src && vite build` clean. Screenshots not captured this pass (driving the connected browser needs an interactive browser-selection step unavailable in an autonomous run) — behavior is covered by the committed suites against the local stack.

## BUILD-31 — Settings IA, billing UX, pipeline role scoping, de-templating (2026-08-03)
A walkthrough-driven pass. Five parts:
- **Billing — the Stripe Customer Portal is the CANONICAL billing destination; NEVER rebuild it.** It handles PCI, proration, payment methods, invoices, and plan switching. The Settings › Account "Change plan" + "Manage billing" buttons were **two buttons to the same portal sharing one loading flag** — so both stuck on "Opening…". Fixed: **collapsed to ONE "Manage billing →"** (the portal surfaces plan-change itself), the explanatory line sits **above** it, and `openBillingPortal` opens the portal in a **new tab** (`window.open`) and **always resets loading in `finally`** — pop-up-blocked → a fallback "Open billing portal →" link; error → "Try again". **The no-active-subscription case is surfaced in-app, not as a blank portal:** `/billing/status` now returns **`hasSubscription`** (`!!stripe_subscription_id`); an org on a paid plan via a **manual/super-admin grant** (no Stripe subscription) sees "You're on {Plan} via a manual grant — no active subscription to manage" + a "Choose a plan →" link, instead of the Manage-billing button opening an empty portal.
- **Settings IA:** (1) **value-first landing** — above the tabs, a compact honest "what Steward has done for you" line (recovered $ + "kept you 100% of every dollar · 0 platform fees"; forward-looking when there's nothing yet), so the first thing seen is value, not a near-empty Organization card. (2) The **top-bar avatar/name chip is a real `<button>` → Settings › Account** (keyboard-accessible) — it read as a button and every user tried it. (3) The **Account panel is on-brand** — plain white/cream section, ink label, sign-out as a **quiet terracotta outline** (destructive-but-not-alarming, AA on white), Terms/Privacy as ordinary links — replacing the near-black `#1a0a0a` box with alarm-red `#f87171` text that read as an error state. (4) **Tab consolidation: merged Branding INTO Organization** (9→8 tabs; the Organization tab renders the org card + `BrandingManager`). Tax Receipts and Your Data were **kept separate** (compliance + export stay findable on their own) — the user chose the lighter consolidation.
- **A setting must show its payoff or be removed.** Custom Fields and Impact Metrics were "what is this for?" — both **kept** (they have real payoffs) and each manager now leads with **purpose + a concrete example + where it shows up**: custom fields → each donor's profile, an optional Directory column, and CSV export (e.g. "Board Connection", "Alma Mater"); impact metrics → milestone thank-you emails + each donor's Impact Summary PDF (e.g. "$100 = 40 meals served"). Standing rule: a setting that can't show an obvious payoff in one screen gets cut from the UI (data model kept), not shipped as clutter.
- **Pipeline role scoping (extends BUILD-30):** cross-officer visibility — **"All portfolios" and the officer filter — is ADMIN-only** (the oversight Team sells). An individual officer defaults to **My portfolio** with the toggle hidden. **Server-enforced, not just hidden:** `GET /pipeline` sets `canViewAll = (role==='admin')`, and for a non-admin **downgrades `scope=all` → `mine` and clears any foreign `assignedTo`** (a non-admin can't peek at another officer's portfolio via the query param). The client hides the toggle + officer filter when `!canViewAll`. The BUILD-30 import model is unchanged and re-confirmed: only ASSIGNED donors are on a board; unassigned stay in the Directory; no third "on the board" concept. Guarded by `tests/pipeline.test.js` §13 (admin canViewAll+sees-all; non-admin canViewAll false + scope/assignedTo downgraded server-side).
- **De-templated the three AI-template tells (Part 5):** (1) **No gradient fills on progress bars/thermometers/charts anywhere** — the gold→terracotta fade on the Home goal bar (the single most AI-looking element), the Fundraising thermometers, and an AnnualFund chart bar are now **solid gold/green**; **bar LENGTH carries the meaning.** The landing's product-shot goal bars were made solid too (they depict the real product). **Enforced by `tests/brand-glyph.test.js` §9 — no `linear-gradient(90deg` in any `client/src/components` file.** The gold-moment celebration sheen (a `linear-gradient(100deg` moving highlight, not a bar fill) is the ONE documented exception and is asserted still-present. Dark hero-card *backgrounds* (`135deg` container depth) are kept — the spec keeps the hero. (2) The **Home stat row is de-templated** — no per-stat boxes / colored left borders / shadows; the four stats read as **typography** (accent on the NUMBER) separated by whitespace, still clickable + keyboard-accessible via `interactive()`. (3) The **My Portfolio panel** dropped its colored left-accent box for a neutral hairline. **Principle: containers are for genuinely bounded objects; grouping is done with space + typography, not borders. Restraint over decoration.**

## assignment = portfolio = pipeline membership — ONE definition (BUILD-30, 2026-08-03) — READ FIRST
**This SUPERSEDES the `in_pipeline` mechanism in the 2026-07-21 section below.** Home read "Portfolio: 16 donors" while the Pipeline board rendered 3 — because Home counted `assigned_to` and the board counted a *separate* `donors.in_pipeline` flag, and the two drifted (assignment set the flag on only some paths). BUILD-30 collapses them into one state.
- **The single model: a donor assigned to an officer IS in that officer's portfolio AND on their pipeline board.** Assignment is the one and only membership state — **there is NO separate "on the board" flag.** Assigning puts a donor on the board immediately; unassigning removes them (back to the Directory only). Unassigned (e.g. bulk-imported) donors are in the Directory only and never appear on any board — the "board is not the whole donor list" guarantee is preserved by *unassigned ≠ member*, not by a flag.
- **`in_pipeline` is RETIRED / dormant.** Nothing reads or writes it. The physical column is kept (not dropped) to avoid a destructive live-prod migration; it holds frozen historical values nobody reads. **Do NOT reintroduce a separate board-membership flag.** A large *assigned* portfolio (e.g. 1,490) is legitimate and shows in full — handled by the per-column cap + search/filters, never by hiding people.
- **ONE shared server helper — `portfolioMembership({orgId, userId, scope, assignedTo})` (server.js).** Returns the membership WHERE-fragment: assigned (org-scoped) **and** `stage = ANY(ALL_PIPELINE_STAGES)`. It feeds **Home's Portfolio card, Home's Pipeline card, the Pipeline board, AND the officer-portfolios legend count/giving** — so all four are one number by construction. The `stage ∈ 6` guard means a donor in a non-pipeline stage is excluded from **all** surfaces identically (the one way they could ever differ). `scope`: `mine` = `assigned_to = me`; `all` = `assigned_to IS NOT NULL`; `assignedTo=<id>` = one officer.
- **`assign` / `bulk-assign` / `pipeline/add` / `pipeline/remove` no longer touch `in_pipeline`** — add-to-pipeline = assign to me (`COALESCE`), remove = unassign. Imports (`/donors/import`, `/donors/import-combined`) stopped writing `in_pipeline` (dropped from the INSERTs); import→assignment→portfolio→board is automatic (pending invitees resolve to a populated board on accept). The `idx_donors_pipeline` partial index is now `WHERE assigned_to IS NOT NULL AND deleted_at IS NULL`.
- **STANDING RULE (this class has now recurred twice — Finance $0 vs Reports $697k, then this): every stat card must land on a view that shows EXACTLY its number.** When you add or change a stat/count card, its click destination must render precisely that count. Home's Portfolio/Pipeline cards deep-link to the board on the SAME scope (threaded via `onNavigate("pipeline",{scope})` → `Pipeline` `initialScope`); the **Tasks** card is scope-aware and `/tasks` now accepts `?scope=mine` with the Tasks tab defaulting to "Mine" + a Mine/All toggle (threaded via `initialScope`) so "Tasks: N" lands on N; Need-to-Do uses the same `visibleQueue` it scrolls to. Don't ship a card whose number leads to a different number.
- **Drag-and-drop on the board (Team, BUILD-30 Part 3, `Pipeline.jsx`):** drag a card between stage columns → optimistic move + a one-field note prompt pre-filled `from → to` (Enter saves; **never an empty move** — BUILD-15's required description + BUILD-17 reports stay whole), rollback + a clear error toast on server reject. The keyboard/button **"Move →"** path stays as the accessible equivalent. Writes stay `requirePlan('team')` + `checkWriteAccess`; the locked Core preview can't drag; concurrency handled by the existing server move guarantees (BUILD-27).
- Guarded by **`tests/portfolio-pipeline-consistency.test.js` (28)** — Home Portfolio == Home Pipeline == board == the shared definition (count + value); assign/unassign updates all four; 0-assigned → 0 everywhere + empty board; unassigned never on any board; non-pipeline-stage excluded uniformly; click-through; org-scoped — plus updated `pipeline`/`moves`/`import-assign`/`home`/`tasks`/`consistency-e2e` suites. Full `run-all.sh`: 43 suites green. Audit: `docs/build30-2026-08-03/AUDIT.md`.

## Post-import polish — imported-gifts-vs-ledger · name normalization · reserved "recovered" (BUILD-26, 2026-07-28)
Three treasurer-/first-impression-visible fixes after an import.

### Imported gifts vs the ledger — Option A, with a NO-CONTRADICTION rule (B1)
The decision (LOCKED): **imported HISTORICAL giving is records being loaded, not money moving through Steward, so it deliberately never stamps `fin_transactions`** — it lives in Reports/Donors. Only a **current-period** imported gift stamps the ledger (so Finance's this-period revenue reflects real current activity, and `consistency-e2e`'s "import → one ledger row, surfaces agree" model still holds). This is why Finance Cash-on-Hand can legitimately be far less than the Reports giving total.
- **The HARD RULE: no screen may imply "$0 raised" when a giving history exists.** `GET /finance/summary` now returns `giftHistoryTotal` / `giftHistoryCount` (Σ all gifts) + `ledgerGiftTotal` (gift-sourced ledger income) + `unledgeredGiving` (the gap) + `hasUnledgeredGiving`. When true, the **Finance Overview renders an explainer + Reports cross-link** ("Your giving history lives in Reports · {$X} of imported giving isn't in this ledger · the ledger tracks money moving through Steward — connect Stripe or log a transaction · View giving in Reports →"). So a treasurer can reconcile Finance vs Reports instead of distrusting both.
- **Consistency assertion (committed):** `tests/finance-reports-consistency.test.js` (18) — a large historical import → Reports shows it, Finance ledger gift income ≈ $0 but `hasUnledgeredGiving` is flagged with the right total/count, and the invariant "giving history without ledger money is ALWAYS explained, never bare $0" holds; a current-period gift DOES reach the ledger and is NOT mislabeled as unledgered.

### Imported-name normalization (B2)
Pure `normalizeName(raw)` — ONE definition mirrored in `server.js` (applied at both import inserts, `/donors/import` + `/donors/import-combined`, so it's enforced regardless of client) and `client/src/lib/importShape.js` (the editable import preview); kept in lock-step by a parity sweep. Rules: collapse whitespace + trim; flip a single **"Last, First" → "First Last"** (but NOT a corporate "Acme, Inc." — a `_CORP_SUFFIX` guard); re-case **only** a wholly-upper or wholly-lower string (`ELEANOR FITZGERALD` → `Eleanor Fitzgerald`) while **preserving any human-cased name verbatim** (`McKinney`, `O'Brien`, `van der Berg`) because internal mixed case means a person already cased it; Roman-numeral suffixes (`III`) stay upper. Applies to person AND org donor names; the value stays fully editable after import (a manual `PUT /donors/:id` is never re-normalized). Guarded by `tests/name-normalize.test.js` (28 — lib edge cases + server-import parity + editability).

### "Recovered" is a RESERVED word (B3)
"Recovered" (and "recovery … won back") attaches ONLY to dollars the **failed-card recovery workflow attributably won back** (`payment_recovery_events` / `impact.recoveredAmount`). It must never label ordinary incoming giving. Fixed the Home momentum line (`Dashboard.jsx` — "$X **recovered** from N donors this week" → "$X **came in** from N donors this week") and the `AnnualFund` AI-prompt label ("Recovered lapsed donors" → "Re-engaged lapsed donors"). The auto-goal **"Win back $X in lapsed giving"** is fine (an opportunity, not a claim) and its progress already counts **only genuine re-engaged (>365-day-gap) gifts, not all incoming giving** (server `/goals/active` `lapsed_recovery` math — verified). Guarded by `tests/reserved-recovered.test.js` (7 — a source grep-guard forbidding the overclaim phrasings, allowing the legitimate recovery-workflow/`recovery rate` uses, + a live assertion the win-back goal excludes an ordinary repeat gift).
- **Verified**: all three suites wired into `tests/run-all.sh` (**39 suites green**). Screenshots (Finance explainer, directory normalized names, Home momentum line) not captured this pass — driving the connected browser needs an interactive browser-selection step unavailable in an autonomous run; behavior is covered by the three committed suites against the local stack.

## Concurrency & multi-user battle test — races fixed with DB-level guarantees (BUILD-27, 2026-07-28)
`tests/concurrency.test.js` seeds 3 orgs (A/B/C) + 3 users in org A and hits every write path with **real parallel requests** (`Promise.all`), each scenario run N=8× (races are probabilistic). It found and fixed two genuine races; the rest were already safe. **All fixes are DB-level, never app-level checks.**
- **Scenario 2 (top stakes) — parallel Stripe webhook redelivery double-recorded an online gift.** The webhook's dedup was a **check-then-insert** on `stripe_payment_id` (SELECT-nothing → INSERT); under a parallel redelivery both handlers passed the check and inserted, and because each minted a *different* `gift_id` the `uq_fin_txns_gift` ledger guard couldn't catch the twin → doubled gift + ledger + donor total. **Fix (DB-enforced):** partial unique index **`uq_gifts_stripe_pi (org_id, stripe_payment_id) WHERE stripe_payment_id IS NOT NULL`** (db.js) — safe by construction, two real gifts never share a pi.id — and the webhook now `INSERT … ON CONFLICT DO NOTHING RETURNING id`, doing the money side-effects (donor bump, ledger, tasks) **only if a row was reserved**. Verified: 5 parallel identical webhooks → exactly one gift/ledger row, total charged once.
- **Scenarios 2 & 3 — donor create/dedup-by-email raced** (webhook resolve-or-create AND the bulk-import email dedup are check-then-insert). A hard `UNIQUE(email)` is the WRONG primitive here — donor emails are legitimately non-unique in this product (the duplicate-**merge** tool exists for exactly that, and prod already has dupes, so a unique index would fail to build). **Fix (right primitive):** a Postgres **session-level advisory lock** — `withAdvisoryLock(key, fn)` in db.js (dedicated pooled client, acquire+release same session). The webhook wraps resolve-or-create in `withAdvisoryLock('donor:'+org+':'+email)` (serializes only same-email concurrent creates); both bulk-import routes wrap the email-preload→donor-insert critical section in `withAdvisoryLock('import:'+org)` (two parallel imports for one org serialize their dedup; different orgs still import fully in parallel) — no schema constraint, no dupe-forbidding, no boot-failure risk on already-duplicated data.
- **Already safe, re-proven under parallel load:** (1) same-donor two-officer edits — owner (assign) and notes (PUT) write **disjoint columns** so neither is lost; stage is contended → coherent (append-only `moves` log records every accepted move truthfully); (4) pipeline contention → one coherent final stage, no orphan moves; (5) workflow re-fire (`UNIQUE(workflow_id,dedup_key)`) + digest reservation (`UNIQUE(org,type,period,recipient)`) hold under parallel — zero double-sends; (6) cross-org isolation holds under 3-org simultaneous writes (cross-org attempts 404, totals reflect only own writes); (7) 40-way mixed burst → no rejects/5xx/hangs, totals still reconcile (no deadlock, no corruption).
- **Verified**: `tests/concurrency.test.js` — **23/23**, stable across repeated runs, wired into `tests/run-all.sh` (**40 suites green**). The read-only `scripts/consistency-audit.js` run afterward reports **clean (0 ERROR · 0 WARN)**. Needs the server booted with `STRIPE_WEBHOOK_SECRET=whsec_localtest` (webhook signing).

## Team onboarding invites officers · import routes donors to portfolios (FIX, 2026-07-28)
Sets up a real staffed dev office in one pass: onboarding can invite the other gift officers, and import routes each donor to the officer who works them (instead of dumping everyone into one unassigned pile). **Team-only; Core stays solo/unassigned and graceful.** Pairs with the pipeline-portfolio model above (assignment = what fills a portfolio).

### Part 1 — Onboarding "Invite your team" step `[Team]`
- `WelcomePage.jsx` is now a **keyed flow** (`STEP_META` + a `flow` array computed from `isTeam`), not a fixed 5-number ladder: `basics → [invite] → import → goal → metric → launch`. A Team org gets the **Invite your team** step (add gift officers by email, "+ Add another officer", send); Core skips it entirely (`flow` omits `invite`). Tier is probed on mount via `GET /portfolio/officers` (`tier==='team'`; a fresh trial reads Team). Skippable ("invite later from Settings › Team"); each officer is invited as **staff** and gets a portfolio on accept.
- **Reuses the existing Settings › Team invite path** — `POST /auth/invite {email, role}` (requireAdmin, seat-limited: Team = 10 users, counts active users + pending invites) — NOT a second invite mechanism. A `seat_limit` 403 surfaces inline. The step-key refactor kept every `onboarding-brand.test.js` grep-guard (tokenized, gold CTA, serif wordmark, no AI gradient/blue/red).

### Part 2 — Import assigns donors to officers `[Team]`
- **Owner-column detection + mapping (pure, in `client/src/lib/importShape.js`):** `detectOwnerColumn(headers)` (matches "Assigned Officer" / "Owner" / "Solicitor" / "Portfolio" / "Gift Officer" / …, anchored so it never grabs email/employer), `matchOwnersToUsers(values, users)` maps each distinct owner value to an org user by **email → name** (exact-normalized incl. "Last, First" flip, then a UNIQUE fuzzy hit via token-subset or Levenshtein≤2; **ambiguity → none, never mis-assign**), and `applyOwnerAssignment(donors, resolved)` stamps `assignedTo`/`assignedToName` (strips the raw `owner`; unresolved → unassigned).
- **Client UI (`DonorImport`, Team only):** an **officer-routing panel** in the mapping step (and the "Import both" step) — when an owner column is found it shows each value → a teammate `<select>` (prefilled from the auto-match, with a "matched by email/name · ×N" badge), an **Invite** action for an unmatched officer (those donors stay unassigned until they accept — never silently mis-assigned), and a "Leave unassigned" option. **No owner column →** bulk options: *Assign all to me* / *Assign all to <officer>* / *Leave unassigned* (split later from the Directory). `owner` is a mappable field (`CSV_FIELDS`/`txMap`) so it flows through aggregate/transaction/wide/both; `assignPayloadDonors` applies the confirmed routing before the chunked submit. Core (`isTeam=false`) never sees the panel.
- **Server (`/donors/import` + `/donors/import-combined`):** accept per-donor `assignedTo`/`assignedToName`; `buildAssigneeResolver(donors, orgId, isTeam)` validates each id belongs to **this org** (unknown/foreign → null, never cross-org) and — **only for Team tier** (`orgPlanTier==='team'`) — sets `assigned_to`/`assigned_to_name` + **`in_pipeline=TRUE`** so assigned donors populate the right officer's portfolio + pipeline. **Core imports ignore assignment** (land unassigned, `in_pipeline=false`) regardless of payload. Reuses the just-shipped batched/idempotent import; assignment is just another mapped field.
- **Verified**: `tests/import-assign.test.js` **40/40** — pure lib (owner detection incl. no-false-positive, email/name/"Last, First"/fuzzy match, ambiguous→none, applyOwnerAssignment strip+stamp) + server contract (Team import → donors routed to officers' portfolios + on board; unknown/foreign officer id → unassigned; Core import ignores assignment; aggregate `/donors/import` honors it; org isolation) + team-invite coverage (admin invite/link, staff→403, existing-email→409, accept creates user, **10-seat limit → 403 seat_limit**). Added to `tests/run-all.sh` (**34 suites green**). DSF3 screenshots: `docs/team-onboarding-import-2026-07-28/` (invite step, import owner-mapping, two officers' portfolios from one import).

### Part 3 — PENDING invitees are matchable + assignable on import (FIX, 2026-07-28)
The joint between Part 1 (invite) and Part 2 (import) was broken: onboarding invites officers, but invites are **pending** until accepted, so the importer's `matchOwnersToUsers` (which only knew active `users`) found "no match" for every officer — including the exact address `jonathan@creo.org`. Fixed so donors route to people you just invited, held until they accept.
- **Officer mapping now matches active users AND pending invitees.** `GET /portfolio/officers` returns an `invites: [{id, email, name, pending_count}]` array (pending = `accepted_at IS NULL AND expires_at > NOW()`); `name` is derived from the email local-part (`inviteeDisplayName`, server.js: `jonathan.atkinson@x` → "Jonathan Atkinson") so email/first-name/full-name spellings all collapse onto one person. `DonorImport` merges them into `orgUsers` with a synthetic id **`"invite:<id>"`** and a `pending:true` flag (labeled "…(invited — pending)" in every officer `<select>`). Exact-email in the file now auto-matches the pending invite — never "no match" when an invite exists.
- **Assign-to-pending, hold until accepted (donor columns, the smaller change).** `donors.pending_assignee_invite_id` + `pending_assignee_name` (db.js, indexed). `buildAssigneeResolver` recognizes an `"invite:<id>"` assignee: it validates the invite is in **this org**, pending, unexpired (unknown/expired/foreign → unassigned, never mis-route), and returns `{pendingInviteId, pendingName}` instead of a real `assigned_to`. Both import INSERTs carry the two columns; a pending donor has `assigned_to=NULL` + `in_pipeline=FALSE` (NOT on anyone's board yet) but shows in the Directory as "**{name} · pending**" (gold), clearly held not lost. **On `/auth/invite/accept`** the new user's row is created, then one `UPDATE donors SET assigned_to=<newUser>, in_pipeline=TRUE, pending_*=NULL WHERE org_id=? AND pending_assignee_invite_id=?` populates their portfolio — they log in to their prospects (the new-officer magic moment). Independent per invite (Benjamin stays pending until *he* accepts).
- **Variant spellings collapse (overridable).** `groupOwnerMatches(matches)` (pure, importShape.js) groups the per-value auto-matches onto the resolved person — the mapping panel shows one row "**{name} — N donors · from K spellings** ({the spellings})" with a single `<select>` that re-points the whole group (`setGroupOwner`), email preferred as the headline matchType. Genuinely unknown values (matchType `none`) stay as individual rows keeping **Invite / Leave unassigned**; blank/`Unassigned` → unassigned, no prompt.
- **Invite from the mapping screen works without re-importing.** `POST /auth/invite` now returns `{id, email, name}`; on success `DonorImport` adds the new pending invitee to `orgUsers` and sets that owner value's mapping to `"invite:<id>"` immediately (then refreshes `/portfolio/officers`).
- **Verified**: `tests/import-assign.test.js` extended to **65/65** (+25: pending matched by exact/uppercase email + full-name + first-name variants; unknown stays none; `groupOwnerMatches` collapses 4 spellings→1 person / email headline / unknown separate / no double-list; server: `/portfolio/officers` lists pending invites with derived names; import holds donors pending (assigned_to null, not on board, pending set); unknown invite id → unassigned/no-pending; **accept → donors assigned to the new user + on board + pending cleared, populated portfolio**; second invitee independent; cross-org invite id → unassigned; re-invite-after-expiry still claims by email, no orphan). `tests/run-all.sh` **35 suites green**. Screenshots not captured this pass (no connected browser in the session) — full pending→accept flow verified by the suite against the local stack.

## Honest impact / ROI number — "what Steward has done for you" (FIX, 2026-07-28)
A tasteful, retention-and-demo ROI stat. **NON-NEGOTIABLE: only ATTRIBUTABLE amounts — never present total giving as "Steward raised."** A fabricated/inflated ROI would betray the whole honest-design brand. Counts exactly two real figures + one clearly-labeled estimate.
- **`GET /impact`** (requireAuth, org-scoped) returns:
  - `recoveredAmount`/`recoveredCount` — **the hero, a HARD number**: dollars the failed-card recovery workflow actually won back, computed ONLY from `payment_recovery_events WHERE type='payment_recovered'` summing the **tracked per-event `detail->>'amount'`** (events with no tracked amount are EXCLUDED, never fabricated). Reconciles with the recovery log; ties directly to the recovery workflow's tracked recoveries (see "Recurring gift recovery"). Sums ALL recovered events (not `COUNT(DISTINCT subscription)` like the recovery-RATE math) — a sub recovered across multiple failure cycles is genuinely-recovered money each time.
  - `platformFeesPaid: 0` — **factual by construction** (own-Stripe, 0% platform fee → org kept 100% of every gift); `onlineGivingProcessed` = `SUM(gifts.amount) WHERE stripe_payment_id IS NOT NULL` (the fee-estimate base).
  - `estimatedFeesElsewhere` + `feeAssumptionPct` (3) — **OPTIONAL, secondary, ALWAYS carries its assumption inline**: `onlineGivingProcessed × 3%`, a labeled counterfactual ("what a typical platform would've skimmed"), NEVER a claim about Steward.
  - `watchingRecurringCount` (active/recovering/past_due subs) for the honest **empty state**; `plan`/`planMonthlyCost` (`PLAN_MONTHLY_COST` in server.js, mirrors Pricing.jsx) for the ROI comparison.
- **The safety-net recovery path now records the amount too** (`customer.subscription.updated` handler): it logs `payment_recovered` with `amount: rs.amount` (the sub's tracked amount — no invoice there), so the recovered figure stays complete regardless of which webhook resolves the failure.
- **Display (tasteful, not a vanity banner):** `ImpactLine` (module-level in `Dashboard.jsx`) — one quiet line at the foot of Home ("Steward has recovered **$X** in lapsing gifts and kept you 100% of every dollar"), click→provenance breakdown (what's counted + the estimate's assumption). **Account/Billing** (`Settings.jsx`, gold-left-accent line in the Billing card) — the retention moment: "Recovered $X · your plan is $149/mo" + the same expandable breakdown. Both degrade to the forward-looking watching line, then to the factual 0%-fees line; render nothing on a truly empty org. On-palette (green = recovered/positive, gold = brand accent, `◈` monochrome glyph — no emoji).
- **Verified**: `tests/impact.test.js` **18/18** (recovered = tracked recoveries ONLY not total/online giving; amount-less recovery event excluded; canceled/lost never counted; `platformFeesPaid` factually 0; online-only fee base + estimate = base×shown-assumption; honest empty state = $0 + real watching count; plan cost; org isolation both directions). In `tests/run-all.sh` (**35 suites green**). Screenshots not captured this pass (no connected browser in the session) — the endpoint + client build were verified against a seeded local stack (recovered $2,340 / online $18,400 / est $552).

## The pipeline is a PORTFOLIO, not the donor list (FIX, 2026-07-21) — the `in_pipeline` mechanism here is SUPERSEDED by BUILD-30 above (membership is now ASSIGNMENT, not a flag); the *portfolio-not-the-donor-list* principle still holds
The board shows the prospects an officer is **actively working** (~100–150), NOT the whole database. Importing 1,490 donors used to dump them all onto the board (413 in Cultivate, infinite scroll) because the board query was "every donor whose `stage` is a pipeline stage" (i.e. everyone) AND both import + a boot-time db.js backfill auto-assigned every donor to the org admin. Fixed:
- **`donors.in_pipeline BOOLEAN DEFAULT false` is the board-membership marker** (db.js). The board (`GET /pipeline`) reads `WHERE in_pipeline = TRUE` only — never "every donor with a stage". Every donor still carries a **stage LABEL** for the Directory/reports (`inferStage` unchanged); the label is a segment, board membership is the deliberate act.
- **Import populates the Directory, NOT the board.** `/donors/import` + `/donors/import-combined` now insert `assigned_to=NULL` (was: the importer) and leave `in_pipeline=false`, so imported donors appear in the Directory with their inferred stage and never flood the board. The **legacy db.js backfill that auto-assigned every unassigned donor to the first admin was removed** (it was undoing the unassigned import on every boot).
- **Deliberate ways onto the board:** `POST /pipeline/add {ids}` (single or bulk; Team + `checkWriteAccess`; sets `in_pipeline=true` and self-assigns unowned donors so they land on the caller's own board; org-scoped, foreign id → 404) and **assigning** an officer (`PATCH /donors/:id/assign`, `/donors/bulk-assign` now also set `in_pipeline=true`). `POST /pipeline/remove {ids}` takes a donor off the board (`in_pipeline=false`, unassigns) without deleting it. UI: Directory bulk bar "**+ Add to pipeline**" (gold, Team) + a per-profile "**+ Add to pipeline**" button on the moves panel.
- **Default board = "My portfolio"** (`GET /pipeline?scope=mine`, the default): the caller's assigned prospects + on-board prospects nobody owns yet. `scope=all` = every portfolio; `assignedTo=<officerId>` overrides scope to one officer's portfolio. So the whole-shop forecast view is `?scope=all`.
- **Navigable at 150:** the board takes `search` (name), `minGiving` (value band), `designation`, `sort` (`value`|`last_gift`|`stage_age`), returns true per-stage `counts` + a per-column `cap` (200, server-sorted-then-sliced), and the client renders **30 cards/column with "Show more"** so it never renders hundreds at once. Empty state guides you to the Directory to add prospects ("your pipeline is empty — and that's the point").
- Guarded by `tests/pipeline.test.js` (35: board excludes imported/in_pipeline=false donors; import doesn't flood; add/assign put a donor on the board; remove takes it off without deleting; scope mine/all; search/value-band/designation/officer filters; sort value/last-gift; per-column counts; Core-graceful locked preview; Team/read_only/empty-ids gating; org isolation) + `tests/moves.test.js` (updated: seeded prospects set `in_pipeline`, cross-officer forecast reads use `?scope=all`). DSF3 screenshots: `docs/pipeline-portfolio-2026-07-21/` (directory-with-stage-labels, pipeline-empty-curated, directory-bulk-selected, pipeline-after-adding).

## Home hero (typed/roll-up) · Funds crash · gift double-stamp (BUILD-21, 2026-07-19)
Three fixes: the Home hero gains BUILD-16's goal model, and two correctness bugs (a Funds black screen + a doubled Finance ledger stamp) are fixed with committed tests. Same discipline: org-scoping preserved, committed tests + DSF3 screenshots (`docs/build21-2026-07-19/`).

### Part 1 — Home hero uses the BUILD-16 typed/roll-up goal model (supersedes the single-goal hero)
The Home hero (`Dashboard.jsx`) showed a single `fundraising_goals` goal ("Raise $25,000…"). It now **leads with the BUILD-16 typed/roll-up model**, reading the SAME source the Fundraising Overview uses — **`GET /fundraising/overview`** (`{rollup, goals, period}`). **No second goal model, no second pace definition** (`computeFundraisingPace`/`fundraisingGoalsPortfolio` reused verbatim server-side).
- **Roll-up leads:** big number = Σ raised across **active top-level goals** vs Σ goal ("$47,200 of $115,000 · 41% · 2 active campaigns"), on the existing premium dark `.dash-goal-banner`, with **pace + this-period momentum** chips (real `period.raised`/`delta`) on the right. Roll-up = Σ children's live raised — derived, never stored; top-level only (a child's raised is inside its parent's roll-up → no double-count), same invariant as BUILD-16.
- **Typed breakdown below** (rendered when ≥2 **leaf** goals): a responsive grid of the leaf campaigns (the actual money-movers, which carry the categories) — category pill **Annual=gold, Capital=green, Project=terracotta** (T tokens, no raw hex), name, raised-of-goal, own mini thermometer, own pace. An overarching goal is summarized in the roll-up header (not repeated as a card); a leaf card shows "· N rolled up" only if it's itself overarching. Each card is `interactive()` → `onNavigate("fundraising")`.
- **Graceful degradation:** 0 goal'd campaigns → the **existing single-goal banner** (today's behavior, `/goals/active` — pencil/Set-a-goal/pace unchanged, no regression); exactly 1 → that goal leads, no empty roll-up; many → roll-up header + breakdown. The admin **pencil** on the primary → edit in Fundraising (campaigns are edited there). Pace states are faithful to `computeFundraisingPace` (met/on_track/behind/null — no invented "ahead").
- Guarded by `tests/home.test.js` (extended to **38/38**, +13: roll-up = Σ top-level with no double-count, typed categories preserved, overarching-vs-leaf, invariant Σ-top-level-rolledRaised === rollup.totalRaised, pace per goal, 0/1/many degradation on the hero's `/fundraising/overview` source).

### Part 2 — Funds black-screen fix + app-level error boundary (crash insurance)
- **Root cause (Part 2a):** the Funds subtab (`Finance.jsx`) crashed on a **`ReferenceError: fundBalances is not defined`** — it read a variable that never existed (the real per-fund map is `_fbMap`). Fixed: `_fbMap[f.id]`. A latent second hazard — **`fmt(null)` threw** (`null.toLocaleString()`) — was also hardened: `fmt`/`fmtFull` moved to **`client/src/lib/money.js`** (JSX-free so the Node suite can import them), null-safe (`null/undefined/NaN/junk → $0`), sign-first negatives (`-$4.2k`); re-exported from `shared.jsx` so all `import { fmt, fmtFull } from "./shared"` are unchanged. `getFundSparkline` + the `Sparkline` component drop non-finite points instead of emitting `NaN` SVG coords.
- **Error boundary (Part 2b — the real insurance):** a reusable **`ErrorBoundary`** (`shared.jsx`) catches a render throw, reports to **Sentry** (already live), and shows a graceful **reload / go-Home** fallback instead of a black screen. Wired at THREE levels: **app-level** (`App` export wraps `AppShell`), **per major surface/tab** (`App.jsx` content region, `resetKey={tab}` so switching tabs auto-recovers), and the **router root** (`main.jsx` via `Sentry.ErrorBoundary` with an inline fallback — deliberately NOT importing `shared.jsx` there, which would pull that whole module into the lean eager entry chunk and regress the BUILD-07 route-split). Verified live: the boundary caught the real Funds `ReferenceError` and rendered the fallback (sidebar/top bar stayed usable) before the fix landed.
- **Cache-busting:** the service worker (`client/public/sw.js`) is already **network-first** + Vite content-hashes assets (so a stale bundle isn't the mechanism), but `CACHE_NAME` was bumped **v2→v3** to force a one-time purge of any poisoned precache on each client's next load.
- Guarded by `tests/finance-funds.test.js` (**22/22**: a source-guard for the exact `fundBalances[`-vs-`_fbMap[` regression — a render-time ReferenceError can't be caught by the API suite; the money null-safety matrix via dynamic-import of `money.js`; and the server never emitting a non-finite fund balance across negative/zero/empty funds).

### Part 3 — a logged gift double-stamped the Finance ledger
- **Root cause:** `LogTouchpointModal` (`Donors.jsx`) logged a gift via `POST /donors/:id/gifts` (which auto-stamps `fin_transactions` `source='gift'`) **AND** separately called `POST /finance/transactions` (`source='manual'`, no fund) — two ledger rows per gift, inflating Cash on Hand. Violated the BUILD-09 "every path stamps `fin_transactions` exactly once" invariant.
- **Fix:** removed the redundant client call; the gift route now accepts+validates an optional `fundId` (org-scoped), stores it on the gift, and stamps the ledger **once** with it. **`fin_transactions.gift_id`** (db.js) + a **partial-unique index** `uq_fin_txns_gift (gift_id) WHERE gift_id IS NOT NULL` make the invariant **DB-enforced**: every gift-stamp path (donor-profile, both bulk imports, Stripe webhook `source='online'`, event-attendee gift) sets `gift_id` and uses `ON CONFLICT (gift_id) WHERE gift_id IS NOT NULL DO NOTHING`, so no path can double-insert for one gift (same idempotency discipline as receipts/workflows). Manual `/finance/transactions` entries set `gift_id` NULL and are unaffected.
- **Data cleanup:** `scripts/dedupe-finance-gift-stamps.js` — idempotent, **dry-run by default**, exports matched rows to `docs/` before deleting, removes each legacy `source='manual'` "Gift from …" twin of a gift-sourced row via the audited admin DELETE API (keeps the gift row), then reports the corrected Cash on Hand. A lone real manual entry is never touched.
- Guarded by `tests/finance-gift-stamp.test.js` (**17/17**: every entry point → exactly one ledger row; the `ON CONFLICT (gift_id)` idempotency mechanism; the chosen fund carried onto both gift and its single stamp; `findManualDupes()` flags a legacy twin but spares a lone manual row; Cash on Hand reconciles; org isolation).

## Donor-profile `fmt` crash + `no-undef` build guard (HOTFIX, 2026-07-19)
Same class as BUILD-21's Funds `ReferenceError: fundBalances is not defined` — an undefined reference reaching the browser. The donor profile crashed with **"Can't find variable: fmt"** (caught by the BUILD-21 `ErrorBoundary`, so no black screen, but the profile — and logging a gift — was unusable).
- **Root cause:** BUILD-21 Part 2 moved `fmt`/`fmtFull` into JSX-free `client/src/lib/money.js` and had `shared.jsx` surface them with a bare **`export { fmt, fmtFull } from "../lib/money"`**. A `export … from` re-export does **NOT** create a local binding in the re-exporting module — but `shared.jsx` itself *calls* `fmt()` (`GivingHistoryChart`, rendered on the donor-profile Overview) and `fmtFull()` (`buildContext`). Those internal calls hit an undefined `fmt`/`fmtFull`. (`daysDiff`/`daysUntil` were unaffected — they're declared locally with `export const`.)
- **Fix:** `shared.jsx` now does `import { fmt, fmtFull } from "../lib/money"; export { fmt, fmtFull };` — binds them in local scope AND re-exports, so every `import { fmt, fmtFull } from "./shared"` across the app is unchanged. **Client-wide sweep confirmed no other file uses a `money.js` helper without importing it** (every consumer imports from `./shared`); this was the only breakage.
- **The real fix — a build-time guard (client/`eslint.config.js`):** ESLint 9 flat config scoped to `src/**/*.{js,jsx}`, browser+es2021 globals, **`no-undef: "error"`** (the guard — an undefined/misnamed reference now fails the build) and `no-unused-vars: "warn"` (surfaces dead imports without blocking). `eslint-plugin-react-hooks` is registered ONLY so the codebase's existing `// eslint-disable-next-line react-hooks/exhaustive-deps` directives resolve (an unknown rule in a disable directive is itself an error); its hooks rules are left at defaults, not enforced. Wired into the deploy path: **`build` script is now `eslint src && vite build`** (client/package.json), and Vercel's build command runs the client `build`, so a `no-undef` error blocks the deploy. `lint` script added for local runs. Vite/esbuild never caught this class — ESLint does. **Verified:** clean tree → 0 errors (294 no-unused-vars warnings, non-blocking); a deliberately planted undefined ref → `no-undef` error + non-zero exit (build fails); removed → clean again.
- **`react-hooks/rules-of-hooks` is now ENFORCED as an error, same deploy gate (FIX, 2026-08-03).** Supersedes the "hooks rules left at defaults" note above. A **conditional hook** — one called after an early return, inside an `if`/loop, or a `&&` short-circuit — throws **"Rendered more hooks than during the previous render"** in production. It shipped once: BUILD-30's drag-and-drop `displayColumns` useMemo sat AFTER Pipeline.jsx's loading/locked early returns, and a team officer's board crashed (Sentry, Safari) on the loading→loaded render transition. **The rule (`Rendered more hooks…`) is exactly this class.** Now `react-hooks/rules-of-hooks: "error"` (fails `eslint src` → fails the build/deploy) + `react-hooks/exhaustive-deps: "warn"` (noisy but surfaces real stale-closure bugs; non-blocking, existing disable directives still resolve). Enabling it also caught a second latent violation in `AdminDashboard.jsx` (useCallback/useEffect after a super-admin early return) — fixed. **THE RULE: every `useState`/`useEffect`/`useMemo`/`useCallback`/`useRef`/custom hook must run unconditionally at the top of a component, ABOVE every early return** (loading guard, `LockedFeature`/plan-gated return, empty-state return); put the condition INSIDE the hook (`useEffect(() => { if (!x) return; … })`), never around it. **Verified:** whole client `eslint src` → 0 errors; planted conditional hook → `rules-of-hooks` error + exit 1 (build fails); removed → clean. Regression note lives in `tests/pipeline.test.js` (a server suite can't catch a client render crash — the ESLint gate is the guard).

## Smart pipeline moves · in-view drill-downs (BUILD-22, 2026-07-19)
Two parts. Same discipline: org-scoping + `checkWriteAccess`; committed tests + DSF3 screenshots (`docs/build22-2026-07-19/`).

### Part 1 — Lapsed is automatic; every other move is a suggestion
**Jonathan's rule: the officer owns stage.** The software SUGGESTS every judgment move and never auto-advances one — the ONE exception is **Lapsed**, a fact about giving recency (not a judgment), which is set automatically. Everything, including the auto-lapse, stays editable by the officer.
- **Single lapse definition:** `LAPSE_DAYS = 365` (server.js) — the SAME 365-day boundary as `inferStage` and the pipeline "Lapsed" column. Do NOT invent a second lapse rule.
- **Auto-lapse** (`autoLapseOrg(orgId)`, swept by `processSmartMoves()` on the existing 5-min cadence — NOT a second scheduler — for EVERY onboarded org, not gated on a workflow recipe): moves a donor to `lapsed` when past the window, with **guards**: only donors with **prior giving** (`gift_count>0` — a no-gift prospect is a prospect); never one being **actively solicited** (`stage='solicit'`) or with an **open ask** (`opportunities status='open'`); and never one an **officer deliberately placed forward since their last gift** (a human move — `officer_id IS NOT NULL`, `to_stage<>'lapsed'`, `created_at::date > last_gift_date::date` — so **officer override always wins**). Capped 200/tick.
- **Auto un-lapse** (`autoUnlapseOnGift(orgId, donorId, preStage)`): a lapsed donor who gives again auto-moves to **Steward** ("they just gave"). Wired into the manual gift route (`POST /donors/:id/gifts`, captures pre-gift stage) AND the Stripe webhook (was un-lapsing to `qualify` silently → now `steward` + logged). Editable.
- **Every auto-move is logged, never silent:** `recordAutoMove()` writes a `moves` row (officer_id null, officer_name `"Steward (automatic)"`, description `"Auto: lapsed — no gift in N months"` / `"Auto: re-engaged — new gift"`) PLUS a `stage_change` interaction so it's transparent in the donor timeline.
- **Suggestions** (`computeMoveSuggestions(donor)`, read-only, `GET /donors/:id/move-suggestions`): signal-based, **surfaced but NEVER auto-applied** — first gift while `prospect` → suggest Qualify; gift ≤90d while `solicit` → suggest Steward; `qualify`/`cultivate` quiet 180–365d (not yet lapsed) → advisory "reach out" (toStage null). Surfaced on the donor profile's dark rail ("Suggested Move" above Move Stage): **Accept** applies via `POST /pipeline/:id/move` (Team; logged, reason as description) — the whole Suggested-Move/Move-Stage rail is Team-gated for Core (donor-profile Core/Team split FIX, 2026-07-19), so the Accept path is Team-only in practice; **Dismiss** ignores (per-session). Team officers set any stage manually via the Move Stage buttons.
- **Ops/test hook:** `POST /pipeline/run-auto-lapse` (requireAuth + requireAdmin) runs the sweep for the caller's org now (drives the exact scheduled path; same bar as `/sequences/process`).
- Guarded by `tests/smart-moves.test.js` (**31/31**: auto-lapse fires only for prior-donors past 365 with all four guards respected + 365-day boundary 364-vs-366; idempotent second sweep; auto un-lapse on gift → steward, logged; every auto-move writes a move + `stage_change` interaction with `Auto:` description + null officer; suggestions surfaced but reading never changes stage/writes a move; officer override not re-lapsed; org isolation both directions incl. foreign-donor suggestions 404).

### Part 2 — Home drill-downs open in view, not below the fold
**Root cause:** Dashboard's root was `<div className="dash-root dash-bleed fade-in">`. `.fade-in` (`animation:fadeIn … both`) retains `transform:translateY(0)` in its final keyframe, making `dash-root` the **containing block for every `position:fixed` descendant** — so `MetricBreakdownPanel`'s `inset:0` centered within the *tall* dashboard and dropped the card at the vertical middle of the whole page (below the fold). Two fixes: (1) **`MetricBreakdownPanel` now portals to `document.body`** (`createPortal`) — escaping any transformed ancestor — and gained **Esc-to-close + focus management** (focus the panel on open, return focus to the trigger on close; `role="dialog"`/`aria-modal`; z-index 400 above the top bar); (2) **`fade-in` removed from `dash-root`** so the set-goal modal (a `position:fixed` child not portalled) and any future fixed child also center correctly. This is the ONE consistent drill-down pattern for all Home stat/portfolio/signal drill-downs (portfolio stats, stewardship-debt, retention all route through it). The inline first-touch signal still expands in place (already in view). Verified live: a portfolio stat opens a centered modal in view; Esc closes it.

## Exceeded-goal display + CREO typed roll-up (FIX, 2026-07-19)
Two things: a display bug where a **beaten goal capped at a misleading flat "100%"** (CREO's Home hero read "100% of goal reached — $75,501 of $25,000"), and CREO never being set up on the BUILD-16/21 typed roll-up.
- **Exceeded-goal display rule (LOCKED):** a goal past its target reads as a WIN, never a capped 100%. `computeFundraisingPace` now returns **`rawPercent`** (uncapped, e.g. 302) and **`over`** (dollars past goal) alongside the existing **`percent`** (still capped at 100 — it's the thermometer BAR WIDTH; a bar can't be more than full). `fundraisingGoalsPortfolio` adds `rolledRawPercent`/`rolledOver` per goal + `rawPercent`/`over` on the `rollup`; `/goals/active` adds `rawPercent`/`over`. **Client rule:** the big headline number shows `rawPercent`; the sub-line shows `goalHeadSub(rawPct,over)` = `"Goal met · $X over"` when `rawPct>100`, else `"of goal reached"`. The bar keeps using capped `percent`. Applied to the Home hero (`Dashboard.jsx`, both the roll-up hero AND the single-goal fallback banner) and every Fundraising thermometer (`Thermometer`/`RollupThermometer`/`GoalThermometerDark`/leaf cards). Guarded by `tests/goals.test.js` (Gala fixture $5,500 of $5,000 → `percent 100`, `rawPercent 110`, `over 500`; under-goal `over 0`; rollup carries `rawPercent`+`over`).
- **CREO demo goals ARE the typed roll-up** (`scripts/seed-creo-goals.js`, idempotent, real API, prod opt-in like `seed-fundraising-demo.js`): an overarching **FY2026 Comprehensive Campaign** ($180k) rolling up three typed children — **Annual Fund 2026** (annual, $60k, seeded PAST goal to $68.5k so the exceeded "$8,500 over" display is live on a real card), **Studio Expansion Capital Campaign** (capital, $120k → $54k), **Youth Arts Access Fund** (project, $18k → $13.5k). Roll-up reads $136k of $180k (76%). Gifts are real gifts on real demo donors (recalc totals + stamp the ledger once → consistency audit still reconciles), attributed by campaign name so each thermometer is a live SUM. The stale "$25,000 this quarter" `fundraising_goals` row is **superseded, not deleted** — the Home hero prefers the roll-up whenever `hasCampaignGoals` (≥1 active top-level goal'd campaign), so the old single-goal banner never renders on Home once the typed structure exists (there is no DELETE /goals route). Capture: `docs/creo-goals-2026-07-19/` (`scripts/creo-goals-capture.js`, DSF3) — hero roll-up + Annual Fund "Goal met · $8,500 over".

## Multi-goal display consistency across all three surfaces (FIX, 2026-07-19)
The typed/roll-up goal **model** was correct; its **display** disagreed across the three surfaces it renders on. The **Fundraising → Overview** tab was already right (umbrella shows its roll-up + a "ROLLS UP N GOALS" breakdown, standalone beside it) and is the **reference**. The other two were fixed to match it — **an umbrella/parent goal now rolls up and groups its children beneath it on EVERY surface**:
- **Root cause (Campaigns sub-tab):** `CampaignsView` (`Fundraising.jsx`) read the **flat** `/fundraising/campaigns` rows, so the umbrella rendered its OWN direct gifts (**$0 · Behind pace**) while its children funded it, and the children showed as flat peer cards. **Fix:** it now reads the **same enriched `overview.goals` portfolio** Home/Overview use (one source, `fundraisingGoalsPortfolio`) and renders **top-level goals only** — an umbrella card shows its roll-up `Thermometer` (raised = Σ children, pace off that total) with each child nested + still editable beneath it; a standalone stays its own card.
- **Root cause (Home hero):** the breakdown grid rendered the **leaf** campaigns (4 flat cards) while the header counted **top-level** goals (2) — count ≠ cards. **Fix:** it renders `activeTop` (top-level goals) so **card count == header count**; the umbrella card nests its children (like Overview's "Rolls up N goals"), a standalone stays top-level. Header wording changed "campaigns" → "goals" for top-level semantics.
- **Umbrella is its own kind, NOT a child category (UI-only, no model change):** an overarching goal shows an **"Overarching"** badge (neutral `T.ink2`/`T.bg2`) instead of a category chip, so an umbrella typed `annual` no longer reads as a duplicate of its child "Annual Fund 2026". Shared `CategoryBadge` helper in `Fundraising.jsx`; matching inline treatment on the Home hero.
- **Consistency is by construction:** all three surfaces read one `/fundraising/overview` payload (Campaigns switched off the flat endpoint). Guarded by `tests/goals.test.js` — the umbrella's `rolledRaised`/`rolledPercent`/`rolledPaceState` are **identical** across `/fundraising/overview` + `/fundraising/goals` (never "behind" while children fund it), the flat `/fundraising/campaigns` row is shown to expose the umbrella at its $0 direct gifts (the bug source, now unused), and **top-level active count == `rollup.activeGoalCount`** with children provably not top-level. Capture: `docs/goal-consistency-2026-07-19/`.

## Cross-surface consistency — audit + guardrail (BUILD-23, 2026-07-19)
The answer to "are we sure it actually works?" The gift double-log (BUILD-21) and the Stripe-webhook double-record (found + fixed here) both slipped through per-build tests because **no test followed one object across ALL the surfaces that read it and asserted they agree**. BUILD-23 closes that class for good with a backward audit + a forward guardrail.

### The canonical consistency invariants (the single source of truth)
Anything that stamps/derives money or an entity must keep these true. Both tools below check exactly this list:
- **One gift → one of everything:** exactly one gift row, one `type='gift'` interaction, and one `fin_transactions` (`source` ∈ gift/online/import/event) per gift. No `gift_id` appears on >1 ledger row (the `uq_fin_txns_gift` guard); no legacy manual "Gift from …" twin.
- **Totals reconcile across surfaces:** donor `total_giving` == Σ(their gifts); Finance Cash on Hand == Σ(ledger income−expense); **Σ(fund balances) == Cash on Hand**; each fund balance == Σ(its transactions); a goal's raised == Σ(attributed gifts); roll-up == Σ(children, top-level only — no double-count); household soft-credit never changes hard-credit org totals (BUILD-14). **Home hero / Reports giving-summary / Fundraising / Finance report the SAME period totals** (Finance may legitimately exceed the gift total by *non-gift* income — grants/manual — which must be explainable, not a silent gap).
- **No orphans:** no `fin_transactions`/gift/receipt/move/opportunity points at a deleted or cross-org row (ties to §1 `orgOwns`). NB `fin_transactions` is deliberately left on donor purge, so a ledger row referencing a purged donor is a tolerated remnant, not a defect.
- **Idempotency ledgers intact:** `fin_transactions.gift_id`, `workflow_runs(workflow_id,dedup_key)`, `digest_sends(org,type,period,recipient)`, receipt numbering — re-firing an event plants ZERO new rows.

### Live bug fixed here — Stripe webhook double-record
`payment_intent.succeeded` had **no idempotency guard**: Stripe redelivers/retries webhook events routinely, and the handler inserted a fresh gift + ledger row on every call — so one online donation could be recorded 2+ times (doubling the gift, the ledger stamp, and donor `total_giving`/`gift_count`). Fixed with a `stripe_payment_id` dedup guard at the top of the handler (mirrors the `recoveryEventAlreadyProcessed(event.id)` pattern): a repeat `pi.id` no-ops with `200 {duplicate:true}`. Verified: same webhook ×2 → 1 gift, 1 ledger row, correct total. Guarded forever by `consistency-e2e.test.js`.

### Part 1 — the backward audit (`scripts/consistency-audit.js`)
Read-only, org-scoped, API-based (same pattern as `dedupe-finance-gift-stamps.js`): logs in as an admin, fetches every surface (`/org/export` + finance/fundraising/reports/home/pipeline), reconciles the invariants above, and grades findings **ERROR / WARN / INFO / OK**. **Run it against prod CREO before a pilot goes live** (`node scripts/consistency-audit.js`, defaults to prod + demo login; `--strict` exits 1 on any ERROR; writes `docs/build23-<date>/CONSISTENCY_REPORT.md`). First run on CREO found 1 ERROR (2 legacy manual gift-twins double-logging $60k — pre-BUILD-21 remnants) + a $50k fund-reconcile gap (same root cause); **fixed** via `dedupe-finance-gift-stamps.js --apply` (Cash on Hand $136,339 → $76,339; Σ fund balances now == Cash exactly). The 2 remaining WARNs are hand-authored demo-seed artifacts (documented in the report), not code defects.

### Part 2 — the forward guardrail (`tests/consistency-e2e.test.js`)
Real server + Postgres, **62/62**. Runs the full core journey on a FRESH org and asserts after each step: a gift via **every entry point** (donor-profile / import / online-webhook) → exactly one gift row + one interaction + one ledger row, with Finance/Reports/Fundraising/Home all AGREEing; idempotency (webhook re-fire / digest re-run / workflow re-fire → zero new rows); pipeline move + auto-lapse + un-lapse; workflow-fires-once; empty-org + negative-fund render (the Funds black-screen class); org isolation. **This is a required gate** — it's in the standard run.

### Part 3 — wired into the routine
`bash tests/run-all.sh` (= `npm test`) runs all 26 self-contained suites (incl. `consistency-e2e` and `billing`) and fails if any fail — the standard gate every future build must keep green. Boot the server with `STRIPE_WEBHOOK_SECRET=whsec_localtest` so the online path is drivable (see `tests/README.md`). Also fixed two stale/latent suite issues the run exposed: `finance-reintegration` fixture omitted `fin_audit_log` from cleanup (FK-blocked re-runs); `digests` monthly-preview assertion still expected a 403 after BUILD-20 Part 4 made team-gated reads visible-but-locked (`200 + locked`). Report: `docs/build23-2026-07-19/CONSISTENCY_REPORT.md`.

## Platform billing cutover — Core $149 / Team $299 subscriptions (BUILD-24, 2026-07-19)
Wired the commercial loop so Steward can actually charge orgs for their subscription. **This is PLATFORM billing (Steward's OWN Stripe charging the org) — a SEPARATE integration from donation processing (each org's own CONNECTED Stripe, which routes donations). Never conflate them.** Same money-safety discipline as BUILD-23: idempotent webhooks, test-mode-first, donation flow provably untouched.

### Platform vs donation — the hard separation
- **Donations**: connected-account events on **`/stripe/webhook`** (`STRIPE_WEBHOOK_SECRET`), record gifts, idempotent on `stripe_payment_id`/`event.id`. **Unchanged by BUILD-24** — `consistency-e2e.test.js` (62/62) proves it. Runs on the `stripe` client (**`STRIPE_SECRET_KEY` only** — the LIVE key).
- **Platform subscription**: **`/billing/webhook`** (`STRIPE_BILLING_WEBHOOK_SECRET`, falls back to `STRIPE_WEBHOOK_SECRET`), sets `orgs.plan`/`subscription_status`. Different endpoint, different secret, different Stripe account (platform vs connect). The billing handler **ignores any non-subscription event type** (incl. a donation `payment_intent`) WITHOUT reserving an idempotency row — belt-and-braces.
- **Separate Stripe SECRET keys, too (FIX, 2026-07-20)**: platform billing runs on its own `billingStripe` client keyed by **`STRIPE_BILLING_SECRET_KEY`, falling back to `STRIPE_SECRET_KEY`** when unset; donation `stripe` uses **`STRIPE_SECRET_KEY` only**. So Jonathan can set `STRIPE_BILLING_SECRET_KEY=sk_test_…` and exercise the whole subscription loop (test prices + test billing webhook + test card) while live donations stay on the untouched live key — the two clients are independent, **never cross-wired**. Key resolution lives in the pure `stripeKeys.js` (`donationStripeKey`/`billingStripeKey`), asserted directly by `tests/billing.test.js`. `scripts/create-billing-products.js` prefers the same billing key so it provisions prices against whichever mode the server's billing client runs in. Everything platform-billing (`create-checkout`, `create-portal`, `ensureStripeCustomer`, the register-org platform customer, `/billing/webhook`) uses `billingStripe`; everything donation-side (Connect onboarding, donation payment links, `/stripe/webhook`, the recurring card-update setup session, `/finance/stripe-summary`) uses `stripe`.
- **Billing customer is per Stripe MODE (FIX, 2026-07-20)**: a Stripe customer created in one mode does NOT exist under the other mode's key — reusing a stored live `cus_…` with a test billing key throws `resource_missing` ("a similar object exists in live mode, but a test mode key was used") and 500'd Team checkout. Fix: **the platform customer is stored per mode**. `stripe_customer_id` holds the **LIVE** customer (existing prod values are live); new **`orgs.stripe_customer_id_test`** holds the test one. `billingStripeMode()` (in `stripeKeys.js`) maps the active billing key → mode (`sk_test_`/`rk_test_` = test, else live); `billingCustomerColumn()` (server.js) picks the column. `ensureStripeCustomer` reads/writes ONLY the current mode's column and **self-heals**: if the stored id is cross-mode or deleted (`customers.retrieve` → `resource_missing`), it mints a fresh customer in the current mode without touching the other mode's column. The register-org inline creation writes the mode column too; `resolveBillingOrgId`'s webhook fallback matches EITHER column. So switching `STRIPE_BILLING_SECRET_KEY` test↔live is safe both ways (no manual DB surgery — the pre-pilot org gets a fresh test customer on its next checkout while its live customer link is preserved). Guarded by `tests/billing.test.js` (`billingStripeMode` mapping; the two mode columns coexist without clobbering).

### Plan enum + tier mapping (non-destructive)
- `core`/`team`/`founding` are now first-class `orgs.plan` values; legacy `seed`/`growth`/`impact` stay recognized (no destructive migration). `orgPlanTier(org)`: **team** = `{team, growth, impact}` OR any live trial; **core** = `{core, seed, founding}` OR lapsed/canceled. `founding` (the private $99 price) maps to **core** tier.
- A completed **Team** checkout → `plan='team'` → `orgPlanTier='team'` → `requirePlan('team')` passes and the `LockedFeature` previews (pipeline, major-gifts) **unlock live**. **Core** → core tier → those re-lock.
- `/billing/status` now returns authoritative **`planTier`**; the client (App.jsx) prefers it, falling back to its local mirror.

### Prices + checkout
- Env: `STRIPE_PRICE_CORE`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_FOUNDING`. Provision (test mode first) with **`scripts/create-billing-products.js`** (idempotent; also mints a `steward_founding_34off` coupon as an alternative founding lever; refuses a live key without `--live`).
- `POST /billing/create-checkout` maps `core`/`team` (+ legacy) → price ids. Validation ordered **before any Stripe API call** (so it's testable without keys): unknown plan → 400; **`founding` → 403 `founding_forbidden` unless caller `isSuperAdmin`** (off-menu private close); price env unset → **400 `plan_not_configured`** (never a 500).
- Client: `PlanPicker` + reactivation/upgrade CTAs render `CHECKOUT_PLANS` (Core/Team) from `pages/Pricing.jsx`. Founding is never in the public UI.

### Subscription lifecycle webhook (idempotent)
- **`billing_webhook_events(event_id PK, type, org_id, processed_at)`** (db.js) is the idempotency ledger. `billingEventAlreadyProcessed(event.id)` does `INSERT … ON CONFLICT (event_id) DO NOTHING RETURNING` BEFORE any org mutation → a redelivered/retried event is a strict no-op (`{received, duplicate:true}`). Same discipline as `workflow_runs`/donation guard.
- Handles: `checkout.session.completed` (plan from metadata → active), `invoice.payment_succeeded` (active + period end + clear grace), `invoice.payment_failed` (past_due + 7d grace), `customer.subscription.updated` (sync; **`active`/`trialing` → re-set plan from the LIVE price** (see below); `canceled`/`unpaid` → **downgrade `plan='core'` so Team re-locks** + 3d grace), `customer.subscription.deleted` (downgrade `plan='core'` + canceled + 3d grace). Org resolved via `metadata.orgId` → `stripe_customer_id`/`stripe_customer_id_test` fallback.
- **Plan changes go through the Stripe Customer Portal (configured for Core↔Team switching), NOT a fresh Checkout.** Checkout is for a NEW subscription; switching an existing one is a subscription UPDATE (Stripe handles proration). The **Account → Billing card** (Settings.jsx) shows the current plan + a green **"Change plan →"** button for any active subscriber (plan ∈ core/team/growth/impact/founding) that opens `create-portal`, alongside "Manage billing →" (also the portal) + a caption ("Switch Core ↔ Team, update payment, or cancel — prorated in Stripe's secure portal"); trial/seed still see "Upgrade plan →" → `/pricing` (checkout). A portal switch fires `customer.subscription.updated` → the webhook flips the tier → `LockedFeature` panels re-lock/unlock automatically.
- **A portal plan switch changes the subscription's PRICE but leaves `metadata.plan` stale** (it was stamped at checkout). So the `subscription.updated` handler derives the plan from the **live price**, not metadata: `planFromSubscription(sub)` reads `sub.items.data[0].price.id` → `planForPriceId()` (reverse of create-checkout's `STRIPE_PRICE_*` map), **falling back to `metadata.plan`** only when the price isn't recognized (checkout, where metadata is reliable). Both live in the pure, unit-testable `billingPlans.js` (mirrors `stripeKeys.js`). **STRIPE CONFIG REQUIRED (human, one-time, test then live):** Stripe → Settings → Billing → Customer portal → enable "Customers can switch plans" with Core + Team as the switchable set (+ cancel). Until that's configured, the portal opens but won't offer the plan switch.

### Bands kept SOFT for launch (§5)
- Core/Team `PLAN_LIMITS` carry the pricing-page band numbers (5,000 / 25,000 donors · 3 / 10 users) for **display only**. `SOFT_BAND_PLANS = {core, team, founding}` makes `checkPlanLimit` **never hard-block** a paid Core/Team org at the band. Legacy seed/growth/impact keep their existing hard enforcement (no behavior change). **When bands are eventually enforced they MUST count ACTIVE donors (gave within ~3 years), not every record** — or the pricing page's "we count active donors, not your graveyard" claim becomes false. A full band cutover (active-donor counting + hard enforcement) is a separate, deliberate task — NOT done here.

### Existing subscribers
- `scripts/migrate-plans-core-team.js` (export-first, dry-run default, super-admin API): `seed→core`, `growth/impact→team`, **only for `active` orgs** (change-plan forces status=active, so it never reactivates a lapsed org; a lapsed legacy org resolves to the right tier anyway). Pre-cutover this is likely just test/own orgs.

### Go-live (HUMAN steps — NOT done autonomously; no Stripe keys in this env)
1. Run `create-billing-products.js` with a **test** key → paste `STRIPE_PRICE_*` into env → redeploy. Add a `/billing/webhook` endpoint in Stripe subscribed to the 5 subscription events, set `STRIPE_BILLING_WEBHOOK_SECRET`.
2. Full **test-mode** verification: Core checkout → core tier; Team checkout → team tier + features unlock live; cancel → reverts + re-locks; redeliver each event via Stripe CLI → one state change. Founding $99 path applies + stays off-menu. Donation flow still records once.
3. Only then create **live** products (`--live`), set live keys, do one real refunded end-to-end charge before onboarding a paying org.

- **Verified (code, test mode)**: `tests/billing.test.js` **29/29** (checkout→core/team tier; `planTier` live via API; sub.updated/deleted → downgrade + Team re-lock + grace; invoice failed/succeeded; **event-id idempotency** = redelivered event no-ops with one dedup row; org-scoping; donation `payment_intent` ignored + not reserved; create-checkout plan validation + founding super-admin gating + `plan_not_configured` not 500). Full `bash tests/run-all.sh` **26/26 suites green** (donation path via consistency-e2e untouched). Actual Stripe product creation + real test-card checkout are the credentialed human steps above.

### The upgrade path — CTAs → pricing page → checkout → webhook (FIX, 2026-07-20)
BUILD-24 wired the billing BACKEND but the UI never called it: every "See plans / Unlock with Team / Upgrade" CTA routed to Workspace **Settings**, and the `/pricing` page's plan buttons said "Go to your workspace" and just navigated there — so **no button reached Stripe** (which is why the earlier test-mode checkout couldn't fire). The single flow now:
1. **CTAs → the in-app `/pricing` page.** One helper, **`goToPricing()` in `shared.jsx`** (`window.location.href="/pricing"` — full nav, deliberate: `/pricing` is a route outside the AppShell tab router, matching the codebase's other billing redirects). Every `LockedFeature` `onCta` uses it: **Pipeline.jsx**, **Reports.jsx** (Solicitations/monthly), and **Donors.jsx** `lockMajor` (major-gift rail) — all previously `onNavigate("settings")`. App.jsx's **trial banner** "Choose a plan / Upgrade now" also uses it (was `openPortal` → the empty Customer Portal, a genuine dead-ish end for a no-subscription org).
2. **Pricing page plan button → real Stripe Checkout.** `pages/Pricing.jsx` `startCheckout(planId)` POSTs `/billing/create-checkout {plan}` and `window.location = r.url`. Plan-aware CTAs: not-authed → "Start free trial" (`/signup`); authed on that plan (**active** sub only — a canceled/read_only org can still re-checkout to reactivate) → **"Current plan"** (disabled); else **"Choose Core" / "Upgrade to Team"** → checkout. Loading + honest error states (`plan_not_configured`/`No Stripe price` → clean "not switched on yet" copy; `requireAdmin` 403 → "ask your admin"), never a dead button. **Founding stays off-menu** (not in `PUBLIC_PLANS`).
3. **Return handling.** `create-checkout` `success_url=/dashboard?subscribed=true`, `cancel_url=/pricing` (backend, unchanged). App.jsx reads `?subscribed=true`, shows a "Payment received — finishing up…" toast, and **refetches `/billing/status`** (immediately + at 4s/10s) so the new tier and the now-unlocked `LockedFeature` panels appear once the **billing webhook** flips the plan (the webhook is the source of truth, not the redirect). The **PlanPicker** modal (banner "Reactivate") is unchanged — it already POSTs create-checkout directly; it's the quick in-app reactivation launcher, a sibling of the fuller `/pricing` page (both hit the same route).
- **Verified**: `tests/upgrade-checkout.test.js` **29/29** (source-wiring guard: `goToPricing`→/pricing; all three LockedFeature CTAs use it + old Settings CTA gone; pricing `startCheckout` POSTs create-checkout with the plan id + redirects to `r.url`; current-plan/loading/error states; founding not surfaced; trial banner→pricing not Portal; `?subscribed` refetch + backend success/cancel URLs). Live checkout+webhook lifecycle stays covered by `billing.test.js`. The end-to-end test-mode `4242…` charge → webhook → Team unlock is now reachable from the UI (was the path the earlier test couldn't reach); actual Stripe product/price creation + the real card run remain the credentialed human steps above.

### Billing errors are TYPED — never a raw 500 for a misconfiguration (FIX, 2026-07-29)
A live-test upgrade showed "Internal server error" because the billing key was in **test** mode while the `STRIPE_PRICE_*` ids were **live** (a Stripe mode mismatch). Config alignment is Jonathan's job (see "Not code" in the FIX brief), but the app must never surface a raw 500 for it. Now, on the two platform-billing paths (`create-checkout` / `create-portal`):
- **The Stripe call is wrapped** and a thrown `resource_missing`/invalid-request is classified by the pure **`billingConfigError(err)`** (`stripeKeys.js`): the cross-mode symptom ("a similar object exists in live mode, but a test mode key was used") → **`mode_mismatch`**; a configured-but-unresolvable price id → **`price_missing`**; a missing customer (self-healed by `ensureStripeCustomer`) / anything else → null (bubbles as before). `handleBillingConfigError()` turns these into a typed 400 — **`plan_mode_mismatch`** (with a LOUD server log naming which mode the key is in vs the price: "billing key is TEST but STRIPE_PRICE_TEAM is a LIVE price") or **`plan_not_configured`** — never a 500. An **unset** price still short-circuits to `plan_not_configured` before any Stripe call (BUILD-24, unchanged). `create-portal` also returns **`portal_not_configured`** when the Stripe Customer Portal isn't set up for the current mode (must be configured in the SAME mode as the key + prices).
- **UI never shows a raw 500 or Stripe internals.** `billingErrorMessage(err)` (`client/src/api.js`) prefers the server's clean admin-facing copy for the typed codes and falls back to a safe message for anything else (incl. "Internal server error"). Wired into all four call sites: `Pricing.jsx` `startCheckout`, `PlanPicker.jsx`, App.jsx `openPortal`, Settings.jsx `openBillingPortal`.
- **Self-diagnosing (this class bit twice).** On boot, `scheduleBillingModeCheck()` → `checkBillingPriceModes()` retrieves every configured price with the billing key; a `resource_missing` means it lives in the other mode → a LOUD `[billing] MODE MISMATCH …` warning. The result is cached (no Stripe call on the hot path) and exposed as `/health`'s `billing:{mode,ok,checked}` boolean and via **`GET /admin/billing-diagnostic`** (super-admin; runs a fresh check with per-price detail).
- **Verified**: `tests/billing-config-error.test.js` **25/25** (pure classifier: cross-mode→mode_mismatch incl. `.raw`-nested + reverse phrasing, plain missing price→price_missing, missing customer/unrelated→null; `otherBillingMode`/`billingStripeMode` mapping; + source-wiring guard that both routes wrap the Stripe call, return the typed codes, and the boot/health/admin-diagnostic checks are wired). In `tests/run-all.sh`. Live mode-mismatch behavior against real Stripe stays the credentialed human step.

## Tasks (BUILD-13 Part 1 — resurrected 2026-07-18)
The daily-driver follow-up surface. The hidden `Tasks.jsx` was a deprecated **local-state stub** (mutated `data.tasks` in memory, never hit the API); BUILD-13 rewrote it into a real API-driven tab and un-hid it.
- **Table `tasks`** (pre-existing, extended): id, org_id, title, due (TEXT ISO or ""), priority (high/medium/low), type (default 'donor', kept for back-compat, not surfaced), done (INTEGER 0/1), donor_id (nullable), created_at; **added BUILD-13**: `assigned_to` (owner user id), `assigned_to_name`, `updated_at`, and index `idx_tasks_org_donor(org_id, donor_id)`.
- **Model**: title + optional due date + optional linked donor + status (open/done) + owner (defaults to the creator; may target a teammate, validated to the org). Hard delete (no soft-delete) — matches the pre-existing model.
- **Routes** (all org-scoped): `GET /tasks` (LEFT JOINs donors for `donor_name`, so the linked donor renders without a second fetch), `GET /donors/:id/tasks` (a donor's own tasks, `orgOwns` donor guard → 404), `POST /tasks` / `PUT /tasks/:id` (`checkWriteAccess`), `POST /tasks/:id/complete` (the one-click toggle, body `{done}`, `checkWriteAccess`), `DELETE /tasks/:id` (ungated per the DELETE convention).
- **§1 resurfacing security note (important):** §1 judged `POST /tasks`'s `donorId` a "benign opaque self-reference." Once Tasks became first-class and **renders the linked donor's name**, that no longer holds — a foreign `donorId` would leak a donor name/link across orgs. So `donorId` is now run through the `orgOwns("donors", …)` guard on **both** POST and PUT (foreign id → 404, no row planted); a foreign `assignedTo` → 404. Covered by `tests/tasks.test.js` and the task-IDOR case added to `tests/tenant-isolation.test.js`.
- **Frontend** (`Tasks.jsx`): three time buckets — **Overdue** (terracotta), **Due today** (gold), **Upcoming** (green), plus a **No date** group and a collapsed Completed `<details>`. One-click complete (optimistic), create-task form (title/due/priority + donor `<select>` from `data.donors`). Every donor-linked row deep-links to the donor profile via `onNavigate("donors",{selectDonorId})` using the keyboard-accessible `interactive()` treatment. Local state is synced back into `data.tasks` via `setData` so the **sidebar badge stays live** — the badge (`tasksDue` in App.jsx) counts open tasks that are **overdue or due today** (was: high-priority count). `isReadOnly` gates create/complete with the standard tooltip.
- **Donor profile surface** (Donors.jsx `DonorProfile`): the pre-existing "Follow-up Tasks" section on the Overview tab now has a **"+ Add task"** button (opens `FollowUpTaskModal`, threaded via the new `onAddTask` prop) alongside the open-task count + list. `apiFetch` bodies must be `JSON.stringify`'d (options pass straight to `fetch`) — the new Tasks.jsx follows that.
- **Verified**: `tests/tasks.test.js` — **31/31** (create/list/bucket classification, one-click complete/reopen, per-donor read, foreign-donor + foreign-assignee IDOR 404 with no side effect, org isolation both directions, `checkWriteAccess` 402 with reads still 200 and DELETE ungated). DSF3 screenshots: docs/build13-tasks-2026-07-18/ (tasks-buckets, donor-profile-tasks).

## Org branding (BUILD-13 Part 2 — tasteful white-label, 2026-07-18)
An org sets its **logo + ONE accent color**; Steward's cream/green/gold design system stays the container and the accent lands only on **accent moments** — never a full re-skin. Scope: app UI + emails + receipts (custom subdomain/domain is a deferred next tier; giving-page branding not yet applied — noted for later).
- **`orgs` columns** (BUILD-13): `logo_data` (base64 data-URI, ≤~350KB), `brand_accent` (hex), `brand_accent_fg` (derived readable foreground for text-on-accent). All nullable → unset = visually identical to pre-BUILD-13 (accent falls back to Steward gold `#c9a84c`, receipt/email header to Steward green `#1a6b4a`).
- **`branding.js`** (server + tests) — the accent is **normalized to an accessible range on save** so the UI can never render illegibly. `normalizeAccent(hex)` returns `{accent, fg, adjusted}` or `null` (malformed hex → route 400s): it **darkens a too-light color along its own hue** until (a) white OR ink text meets WCAG AA (≥4.5) on it — returned as `fg` — AND (b) the accent meets ≥3:1 on cream (`#f0ede6`). `adjusted:true` when it moved the color (UI shows "deepened slightly for legibility"). Also exports `contrast(a,b)` / `accentPasses(hex)`. Auto-adjust, not reject — black passes both, so the loop always terminates on a legible color.
- **Route**: `PUT /orgs/branding` (requireAuth + **requireAdmin** + **checkWriteAccess** — org identity is an admin write; a read_only org gets 402). Body `{logoData, brandAccent, removeLogo}`; validates logo mime (png/jpeg/gif/webp/svg) + size, normalizes accent, `brandAccent:""` reverts to Steward default. Returns the stored row + `adjusted`. Branding is read via the existing `GET /org` (adaptData maps `logo`/`brandAccent`/`brandAccentFg`).
- **`--org-accent` token layer**: App.jsx sets `--org-accent`/`--org-accent-fg` CSS vars on `.app-root` from the stored (already-normalized) values, layered OVER the BUILD-12 `T` palette — it does NOT replace it. Applied to: the **sidebar active bar + active nav icon** (was gold), and the **Dashboard greeting** (org logo + name in the accent + "Good {time}, {name}" — the onboarding payoff, "this is OUR system", the moment they finish setup). Terracotta stays LOCKED (a treasurer needs red to mean red) — the accent never touches attention/negative surfaces.
- **Emails**: `brandEmailHeaderHtml(orgId)` (async, next to `unsubscribeEmailFooterHtml`) renders a slim logo+name band on the accent above the body. Injected into the **campaign send** (once per send, hoisted out of the recipient loop) and the **recovery/dunning email** (also Part 3 recipe #1's send). Falls back to a Steward-green band when no accent.
- **Receipts**: `renderReceiptPdf` header band + logo now come from `snapshot.orgAccent`/`orgAccentFg`/`orgLogo` (frozen into the receipt snapshot at issue time, so later branding changes never alter an already-issued receipt). The amount stays green (money = green semantics).
- **Settings › Branding** (`BrandingManager` in Settings.jsx, new `SETTINGS_TABS` section between Organization and Team): logo upload, accent color picker + hex + preset swatches, and a **live preview** card mirroring the branded email/receipt header + a primary button. `isReadOnly`/admin-gated.
- **Verified**: `tests/branding.test.js` — **29/29** (contrast math + normalization incl. bright-yellow/pale-sky/white all constrained to legible, requireAdmin 403 / read_only 402 / no-token 401, set+read org-scoped, bad-accent 400, too-light constrained-not-rejected 200+adjusted, logo mime reject, remove/revert, two-way org isolation). DSF3 screenshots: docs/build13-branding-2026-07-18/ (app-shell-branded, settings-branding, branded-receipt, branded-email).

## Workflows engine (BUILD-13 Part 3 — retention recipes, builder-ready, 2026-07-18)
Automations stored as **data** (trigger → conditions → actions) so a future visual builder is a UI over the same schema, not a rewrite. v1 exposes only five pre-built recipes with on/off toggles + light config + a run log (the fifth, `instant_gift_thanks`, was added in BUILD-16 Part 3 — see below). **The visual canvas is a deliberately deferred stage on this schema — do NOT build it without new direction.**
- **Tables**: `workflows` (id, org_id, recipe_key, name, trigger, `conditions`/`actions`/`config` JSONB, enabled, timestamps; UNIQUE(org_id, recipe_key)) + `workflow_runs` (append-only log; id, org_id, workflow_id, recipe_key, trigger, dedup_key, entity_type/id, donor_id, `actions_taken` JSONB; **UNIQUE(workflow_id, dedup_key)** = the idempotency guarantee).
- **Recipes** (`WORKFLOW_RECIPES` in server.js, provisioned lazily per org by `ensureWorkflows`, **disabled by default** — nothing auto-runs until a human toggles it): (1) **failed_recurring_recovery** `recurring_failed` → send branded recovery email + create task; (2) **new_donor_welcome** `gift_received` [is_first_gift] → branded thank-you + welcome-call task; (3) **lapsing_reengage** `donor_lapsed` → add `lapsing` tag + re-engagement task (+ optional email via config `sendEmail`); (4) **major_gift_alert** `gift_received` [amount ≥ config `threshold`, default $1000] → alert the donor's relationship owner (task assigned to `donors.assigned_to`) + stewardship task; (5) **instant_gift_thanks** (BUILD-16 Part 3) `gift_received` [amount ≥ config `threshold`, default $0 = every gift] → the real-time "someone just gave, thank them now" signal: a `notify_gift` action that alerts the ED (org admins) and/or the donor's assigned officer (config `notify` ∈ `ed`|`owner`|`both`, default both) BOTH in-app (a high-priority thank task assigned to the officer, else the ED) AND by a branded internal email (`sendGiftAlertEmail` — branded header, NO donor unsubscribe footer, it's staff mail). Idempotent per gift (dedup `gift:{giftId}`, so one notice per gift no matter how many handlers fire). Distinct from `major_gift_alert` (which only fires over a big threshold and only pings the owner). The un-thanked gift also surfaces in Home "Need to Do" (the existing `/dashboard/today` thank bucket) so the loop closes even if the email is missed.
- **Engine** (`fireWorkflows(orgId, trigger, ctx)`): loads enabled workflows for the trigger, evaluates conditions (with config overrides — threshold/lapseDays), then for each: **reserves the run row first** (`INSERT … ON CONFLICT (workflow_id, dedup_key) DO NOTHING RETURNING id` — empty on conflict = strict no-op), executes actions (each wrapped so one failure doesn't abort the rest), writes `actions_taken`. Returns `{ran}` so a caller can coordinate. **Idempotency is non-negotiable** — a double-send is a trust disaster; the dedup key is the trigger's natural cycle id (`gift:{giftId}`, `failed:{sub}:{first_failed_at}`, `lapsed:{donor}:{last_gift_date}`).
- **Actions**: `create_task` (templated title, priority, dueDays, linked donor), `notify_owner` (task assigned to the donor's owner), `add_tag` (dedup into `donors.tags`), `send_email` (`recovery` reuses `sendDunningEmail`; `thankyou`/`reengage` use `sendWorkflowEmail` = branded header + CAN-SPAM footer + suppression check; no-ops without `RESEND_API_KEY`, run still logged).
- **Trigger wiring**: `gift_received` fires from BOTH the Stripe `payment_intent.succeeded` webhook AND the manual `POST /donors/:id/gifts` route (first-gift = pre-insert gift_count 0 / post-insert count 1), fire-and-forget so it never 500s the webhook. `recurring_failed` fires from the `invoice.payment_failed` webhook **only on a new failure cycle** (not each Stripe retry). `donor_lapsed` has no webhook — `processWorkflowSweeps()` runs on the existing **5-min tick** (reused, not a second scheduler), only for orgs with the recipe enabled, capped 200 donors/tick, deduped per donor+last_gift_date.
- **Recipe #1 ↔ dunning coordination (no double-send)**: the always-on dunning engine already owns the 0/3/7/14-day recovery cadence. When recipe #1 is ON and its `send_email:recovery` action fires the day-0 email, the webhook advances the subscription to `dunning_step=1` / next_dunning_at = first_failed+3d so `processDunning` does NOT also send day-0. Recipe OFF → dunning behaves exactly as before.
- **Routes**: `GET /workflows` (provisions + lists w/ run counts + descriptions), `GET /workflows/:id/runs` (log, org-scoped via `orgOwns`), `PUT /workflows/:id` (toggle/config — requireAdmin + checkWriteAccess), `POST /workflows/simulate` (requireAdmin — fire one trigger deterministically for tests/ops, `orgOwns` on donorId). Reads never gated.
- **UI** (`Workflows.jsx`, tab between Tasks and Reports; sidebar icon ⚡): recipe cards with toggle, trigger→action chips (gold trigger / green actions), light config (major-gift threshold, lapse window + optional email), and an expandable **run log** whose rows deep-link to the donor (`interactive()`). Calm, not a canvas. `isReadOnly`/admin-gated.
- **Landing "recovered" claim = HONEST (no gating needed)**: the failed-payment recovery *mechanism* (dunning auto-send + card-update Checkout + recovery-rate tracking) is **live** (pre-BUILD-13), and recipe #1 formalizes it as a toggleable, run-logged workflow. So Landing's "noticed, and recovered" and the candor section's "failed-payment recovery" remain truthful. Do not fake or over-claim beyond this.
- **Verified**: `tests/workflows.test.js` — **29/29** (provisioning + disabled-by-default, requireAdmin 403 / read_only 402 / reads 200, each recipe fires with correct actions, idempotency = same event twice → 0 ran / 1 run / 1 action set, condition gates: first-gift-only + major threshold incl. config override, notify_owner assignment, run log written, two-way org isolation incl. `simulate` foreign-donor 404). DSF3 screenshots: docs/build13-workflows-2026-07-18/ (workflows-tab, recipe1-recovery-email).

### Workflows fire on NEW LIVE events, NEVER on imports/backfills (BUILD-25 Part A, 2026-07-28)
The highest-stakes guarantee: these five recipes email donors **in the org's name**, so a workflow firing on a data load would blast thousands of donors during a first onboarding. The rule — enforced, not lucky:
- **No import path calls `fireWorkflows`.** `gift_received` fires only from the Stripe `payment_intent.succeeded` webhook and the manual `POST /donors/:id/gifts`; `recurring_failed` only from `invoice.payment_failed`. `/donors/import`, `/donors/import-combined`, `/gifts/import-history` (and re-imports/backfills/migrations) never fire anything — importing 4 donors + a $25k historical gift with **all 5 recipes ON** produces **zero** `workflow_runs` and **zero** emails.
- **The lapse sweep is the one non-webhook fire path, and it's guarded (P0 fix).** `processWorkflowSweeps` now fires `donor_lapsed` **only when the lapse crossed the window WHILE the donor was live in Steward** — SQL guard `created_at::date <= (last_gift_date::date + INTERVAL 'lapseDays days')`. A donor imported already-past the boundary (last gift years before their own `created_at`) is **history, not a live event** → never fires. A donor imported while still active who *later* crosses the window DOES fire (genuine live transition). The guard is precise, not a blanket off.
- **`processWorkflowSweeps(onlyOrgId?)`** is now per-org callable; **`POST /workflows/run-sweeps`** (requireAuth + requireAdmin) drives it for the caller's org NOW (ops/test hook, same bar as `/pipeline/run-auto-lapse`) so the guarantee is verifiable without waiting on the 5-min tick.
- **`notify_owner` (major-gift alert) degrades gracefully for an owner-less donor** — it now falls back to the ED (first org admin) instead of leaving an orphaned unassigned task; the run summary records `assignedFallback:true` so the log tells the truth. A major-gift alert is never silently dropped.
- **Per-recipe genuine-trigger + trust guarantees proven end to end** against real routes + a mock Resend sink: donor mail (thank-you, recovery) carries branding + the CAN-SPAM postal footer + unsubscribe; internal alerts (`instant_gift_thanks`, stewardship) carry branding but **no** unsubscribe footer; **no double-send under a PARALLEL re-fire** (5 simultaneous identical `simulate` calls → exactly 1 run/email/task — the `UNIQUE(workflow_id,dedup_key)` holds under a real race, not just sequentially); toggle-off is silent; recovery↔dunning coordinate (recipe day-0 send advances `dunning_step` past 0); provider failure records the run and never double-sends on retry; org isolation both ways.
- **Verified**: `tests/workflows-e2e.test.js` — **65/65**, wired into `tests/run-all.sh` (**36 suites**). Requires the server booted with `RESEND_BASE_URL=http://localhost:5602` (mail sink) + `STRIPE_WEBHOOK_SECRET=whsec_localtest` — see the updated boot recipe in `run-all.sh`/`tests/README.md`. Artifacts (real captured bytes): `docs/build25-workflows-e2e-2026-07-28/` (branded donor thank-you + recovery emails, internal alert with no footer, populated run log) via `scripts/build25-workflows-capture.js`.

## Constituent model — households / designations / portfolios (BUILD-14, 2026-07-18)
The data foundation a real development shop needs. Built backend-first with committed tests; the **hard-vs-soft-credit invariant is the correctness crux**.

### Hard credit NEVER moves (the invariant)
`donors.total_giving` stays each donor's own gift sum, and the org hard total is `SUM(all gifts)` regardless of how it's grouped. **Households and soft credit are DERIVED read-time views over the same gift rows — there is NO stored soft-credit counter anywhere.** A household is purely a GROUP BY key: combined giving = `SUM(members' hard credit)`, a member's soft credit = `SUM(other members' gifts)` = `combined − own hard`. Because grouping is just re-keying the same rows, `SUM` over households === `SUM` over individuals === org total — provably no double-count. **Do not "denormalize" a household or soft-credit total onto a column; the whole design depends on it staying derived.** `tests/households.test.js` asserts org hard totals are byte-identical individual-vs-household across DB gift sum, DB `total_giving` sum, Reports giving-summary, Reports top-donors, Fundraising overview, and Finance summary.

### Households `[Core]`
- **`households`** — id, org_id, name, `primary_donor_id`, `joint_acknowledgment` (bool), timestamps. **`donors.household_id`** (nullable FK, **ON DELETE SET NULL** — deleting a household unlinks members, never cascades into donor/gift data). A donor is in ≤1 household; primary is `primary_donor_id`, everyone else is a member ("secondary").
- **Routes** (org-scoped): `GET /households` (list + member_count + combined_giving), `GET /households/:id` (`householdView` — members with per-member hard/soft credit + primary flag, combined giving, merged giving_history), `POST /households` (`checkWriteAccess`; ≥2 members, default name "The {last name} Household", validates all members via org-scoped membership check — foreign donor 404, donor already in another household 400), `PUT /households/:id` (rename / re-primary / add-remove members), `DELETE /households/:id` (ungated per DELETE convention; unlinks then deletes). Plus `GET /donors/:id/soft-credit` → `{hardCredit, softCredit, householdCombined, householdId}`.
- **Reports household view**: `GET /reports/top-donors?view=household` groups the same gift rows by `COALESCE(household_id, donor_id)` (solo donors are their own group), returning one row per household with `isHousehold`/`memberCount`. `parseReportParams` gained `p.view`.

### Designations / planned-giving tagging `[Core]`
- **`donor_designations`** — id, org_id, donor_id (FK CASCADE), kind, UNIQUE(donor_id, kind). Kept OUT of the free-form `donors.tags` JSONB precisely because planned giving must be a **queryable, reportable segment**, not a stringly-typed tag. `DESIGNATION_KINDS` (server) = `estate`, `planned_confirmed`, `planned_prospect` (labels in `DESIGNATION_OPTS`, Donors.jsx).
- **Routes**: `GET/POST /donors/:id/designations` (`checkWriteAccess` on POST; unknown kind 400; idempotent via `ON CONFLICT DO NOTHING`; `orgOwns` donor guard → 404), `DELETE /donors/:id/designations/:kind` (ungated). **Filter**: `GET /donors?designation=<kind>` (added to `buildDonorListFilter` as an EXISTS subquery — works in both legacy-array and paginated shapes, and in the CSV export).

### Officer portfolios + color `[Team]`
- **`users.portfolio_color`** (nullable hex). `GET /portfolio/officers` (ungated read) → `{tier, single_user, officers:[{id,name,portfolio_color,portfolio_count,portfolio_giving}]}` — `single_user` (≤1 officer) drives the **single-user grace** (no color UI at all). `PUT /portfolio/officers/:userId/color` — `requireAdmin` + **`requirePlan("team")`** + `checkWriteAccess` (that order: Core admin → 403 plan_required; team read_only org → 402), hex-validated, org-scoped.
- **Portfolio filter** reuses the existing `assignedTo` param (NB: earlier docs called it `owner`; the real param is `assignedTo`). Directory color-codes each owner avatar from the officer color map + shows an "Officer Portfolios" legend bar (color assignment on Team, lock hint on Core).

### Plan tiers / `requirePlan` guard
Steward's up-market split (Core / Team) is enforced by a thin `requirePlan(tier)` middleware + `orgPlanTier(org)`: **team-capable = `growth`/`impact` plans OR any live trial; `seed`/lapsed = core.** This is a DERIVED tier over the existing plan/subscription — real Core($149)/Team price wiring is a separate, deliberate billing task, NOT rebuilt here. Only the officer-color write route is `requirePlan("team")`-gated today; households + designations are `[Core]` (ship to everyone). Every write is `checkWriteAccess`-gated; every client-supplied donor/member id runs through org-scoped ownership checks (extended in `tests/tenant-isolation.test.js`).

- **Verified**: `tests/households.test.js` **45** (hard-invariant across 6 surfaces, combined/soft credit, primary, giving history, PUT add/remove/re-primary, validation, checkWriteAccess, DELETE-unlinks-no-cascade, foreign-member IDOR), `tests/designations.test.js` **21** (CRUD, idempotent, unknown-kind 400, filter, IDOR, checkWriteAccess), `tests/portfolios.test.js` **19** (filter-by-officer, color persist, Core→403 / Team→200, staff→403, read_only→402, single-user grace, org isolation), +5 cases in `tests/tenant-isolation.test.js`. reports 32 / donors-pagination 31 still green (no regression). DSF3 screenshots: `docs/build14-2026-07-18/` (directory-portfolios, planned-giving-filter, household-profile) via `scripts/build14-capture.js`.

## Moves management & prospect pipeline (BUILD-15, 2026-07-18)
The major-gifts spine — the biggest up-market differentiator. A managed pipeline built on the **existing** `donors.stage` field (no second stage column is forked), with logged moves, ask-vs-gift tracking, an officer-colored board, and officer-activity capture that feeds BUILD-17's reports. **Depends on BUILD-14** (officer assignment/color, designations, `requirePlan`). `[Team]`-gated: the whole pipeline is a staffed-office capability, so a Core org sees a graceful upgrade state, not a broken tab. Single-officer Team orgs still work.

### Stage model — reuses `donors.stage`, does NOT fork a second field
The pipeline reuses the canonical 6-stage set (`prospect qualify cultivate solicit steward lapsed`). `PIPELINE_STAGES` (server) = the 5 forward major-gifts stages (prospect→steward, mapping to Identification→Qualification→Cultivation→Solicitation→Stewardship); `lapsed` is a trailing re-engagement column, not a forward stage. **Per-org custom stage editing is a deliberately deferred stage on this same field** (like the Workflows visual canvas) — the enum is used app-wide (donor validation, Kanban, Reports), so it stays fixed; do NOT build per-org stage config without new direction.

### Moves — every managed stage change is a logged move (description REQUIRED)
- **`moves` table**: id, org_id, donor_id, officer_id, officer_name, from_stage, to_stage, `description` (NOT NULL), created_at. Indexes on (org_id, donor_id, created_at DESC), (org_id, officer_id, created_at DESC), (org_id, created_at DESC).
- A `moves` table (not interactions.metadata JSONB) precisely because officer-activity reporting needs to aggregate per-officer cleanly — a stringly-typed tag can't. But the board's move endpoint ALSO logs a `stage_change` interaction alongside so the donor's activity timeline stays consistent. `recordMove()` helper writes the row; the route validates.
- **`POST /pipeline/:donorId/move`** (`requirePlan('team')` + `checkWriteAccess`): body `{toStage, description}`. Validates toStage ∈ enum, **description required** (400 if blank), same-stage rejected (400). Updates `donors.stage`, records the move (officer = current user), logs the timeline interaction. The legacy `PATCH /donors/:id/stage` (used by the Donors Kanban drag) is untouched — a Core-available quick-label change that does not create `moves` rows; the `moves` table is the Team managed-pipeline system of record.
- **`GET /donors/:id/moves`** — full move history for a constituent (read; org-scoped, foreign → 404).

### Opportunities — ask vs. gift (officer accountability)
- **`opportunities` table**: id, org_id, donor_id, name, `target_amount` (the ASK), status (`open`|`won`|`lost`), `gift_id` (nullable — the real gift when won), `gift_amount` (actual closed amount), officer_id/name, expected_close, created_at, closed_at. Indexes on (org_id, donor_id), (org_id, status).
- **`GET/POST /donors/:id/opportunities`** (POST `requirePlan('team')` + `checkWriteAccess`; positive target required; officer defaults to the donor's `assigned_to`, else the creator). **`PUT /opportunities/:id`** edits or closes: `status:'won'` with `giftId` links the real gift and copies its amount into `gift_amount` (or takes an explicit `giftAmount` when there's no gift row yet); `lost`/reopen clear the linkage. **`DELETE /opportunities/:id`** ungated (DELETE convention).
- **Pipeline forecast** = `SUM(target_amount)` over **open** opportunities (`forecast.open`), plus a **stage-weighted** figure (`forecast.weighted`) = `Σ ask × STAGE_WEIGHT[donor.stage]` (`prospect .1 / qualify .2 / cultivate .4 / solicit .7 / steward .9 / lapsed .05` — a donor's stage is a rough close-probability). Also `wonThisPeriod` (fiscal-FY via the shared `finPeriodBounds`, one period source of truth with Finance/Fundraising). This is the ask-vs-gift accountability: asked how much, closed how much.

### Board + officer activity
- **`GET /pipeline`** — the board: donors grouped by stage; per-card ask amount + open-opp count, **stage age** (days since the most recent move INTO the donor's current stage, fallback updated_at/created_at), and next open task; officer color map; forecast. **Batched queries only, no N+1** (donors + one aggregated opps query + one last-move-per-stage query + one next-task-per-donor query). Optional `?assignedTo=` (portfolio filter) and `?designation=` (EXISTS on donor_designations). For a Core org returns `{tier:'core', locked:true}` so the UI renders the upgrade card. `single_user` drives the single-officer grace.
- **`GET /pipeline/officer-activity`** — per-officer moves made / asks made (count + $) / gifts closed (count + $) over `?from`/`?to` (default trailing 90 days). The raw data BUILD-17's per-officer reports read; recorded cleanly here, reported there.

### UI (`Pipeline.jsx`, tab between Donors and Fundraising; sidebar icon ◫)
Kanban columns per stage; cards **color-coded by officer** (BUILD-14 color map, left border + avatar) with ask/stage-age/next-task; officer legend; portfolio + designation filter selects; forecast stats (open / weighted / closed-this-FY). A card's body is `interactive()` → the donor profile; a **Move →** button opens `MoveModal` which **requires a description** (client + server enforce). Core org → the gold upgrade card. `isReadOnly` hides write controls. **Prospect profile** (Donors.jsx `DonorProfile` Overview): a "Pipeline — moves & asks" panel shows open/closed asks (ask → gift, Won/Lost buttons) with a **+ Add ask** inline form, plus the recent move history (from→to · officer · date · description). Team-gated via a `/portfolio/officers` tier probe; shows history even on Core but hides the write controls.

- **Verified**: `tests/moves.test.js` — **60/60** against local scratch server + Postgres (incl. the donor-profile Core/Team split FIX cases — Core→403 / Team→200 on stage, bulk-stage, assign, bulk-assign, wealth-score, sequence-enroll; Core reads open) (board unlock/lock by tier + single-user grace; a move writes a move row with officer/from→to/required-description AND updates stage AND logs a stage_change interaction; move validation 400s incl. blank-description + same-stage + bad-stage; Core move → 403 plan_required, Team read_only → 402; ask CRUD, officer = owner, non-positive 400, Core ask → 403; forecast raw + stage-weighted self-consistent with the board, openCount; close-won links gift + records actual amount with ask≠gift preserved, won leaves open + counts wonThisPeriod, lost drops, reopen restores, won-by-amount-only; portfolio + designation filters; officer-activity aggregation; DELETE ungated; two-way org isolation — move/moves-read/ask on a foreign donor all 404 with no row planted). portfolios 19 / designations 21 / households 45 / tasks 31 / tenant-isolation 30 still green (no regression). DSF3 screenshots: `docs/build15-2026-07-18/` (pipeline-board, prospect-profile-moves-asks, core-upgrade) via `scripts/build15-capture.js`.

## Home command center · typed roll-up goals · instant gift alerts (BUILD-16, 2026-07-18)
Three surface-level reworks that make Steward feel like a development officer's daily driver (from the Brad session). Same checkpoint discipline: org-scoping + `checkWriteAccess` + idempotency; plan tags `[Core]` (everyone) / `[Team]` (growth/impact/trial via `orgPlanTier`).

### Part 1 — Home becomes a command center `[Core]`+`[Team]`
The four headers a fundraiser opens the app to see, replacing first-touch-delay / stewardship-debt as the headline metrics (Brad: clever but not what you open the app for).
- **`GET /dashboard/home?scope=mine|all`** returns `{ tier, scope, portfolio, tasks, pipeline }`. **Portfolio** `[Team]` = the caller's assigned donors (`count` + lifetime `value` + officer `color`), null on Core. **Tasks** `[Core]` = open-task buckets `{overdue, today, upcoming, noDate, total}` (`left(due,10)` date compares; scope `mine`→`assigned_to`). **Pipeline** `[Team]` = per-stage `{count,value}` across `ALL_PIPELINE_STAGES` + `forecastOpen` (open-ask SUM), null on Core. **Need to Do** is NOT in this payload — it's the existing `/dashboard/today` queue the client already fetches (gifts to thank, moves due, un-receipted $250+…); its header card counts that queue and scrolls to it (`#dash-needtodo`).
- **Dashboard.jsx**: the four command cards render in a `.dash-cmd-grid` right under the goal banner (keyboard-accessible via `interactive()`; Team shows 4, Core shows 2 — the goal banner is Core's giving snapshot). **First-touch-delay + stewardship-debt are demoted** from headline sections to small clickable "Signals" chips (first-touch expands inline; stewardship-debt opens its existing `MetricBreakdownPanel`). Retention Rate stays as a modest secondary card (Brad didn't object to it). The demotion is deliberate founder direction — do NOT restore them as headline cards without new direction.
- **My Portfolio leads + opens expanded (BUILD-19 `7a5bbe6`, re-confirmed BUILD-20).** The `MY PORTFOLIO` panel (the six FY drill-down stats from `/dashboard/my-stats`) renders **above** the Donor Retention Rate card + the first-touch/stewardship Signals chips, and defaults to **expanded** (`portfolioOpen=useState(true)` — the stat row is visible on load, no click). It reads sensibly on Core (own donor/gift counts) as well as Team. Its "Portfolio" stat routes to the canonical Pipeline tab (a locked preview on Core, per BUILD-20 Part 4).

### Part 2 — Typed, multiple, roll-up goals `[Core]` (supersedes BUILD-11's single-goal Overview header)
Brad: a single campaign goal as the Fundraising header "doesn't make a ton of sense" — real orgs run many at once.
- **A "goal" is a goal'd `campaigns` row** (unchanged); BUILD-16 adds **`campaigns.goal_category`** (`annual`|`project`|`capital`, default `project`; `GOAL_CATEGORIES` in server.js) and **`campaigns.parent_goal_id`** (nullable — a campaign rolls up under an overarching goal, another campaigns row). Both nullable → un-set is identical to pre-BUILD-16.
- **Roll-up is a live derived view, never a stored counter** (same invariant as everything money): `fundraisingGoalsPortfolio(rows)` enriches each goal — an **overarching** goal (one others name as parent) shows `rolledRaised = Σ(children's live raised)` / `rolledPercent` / `rolledPaceState`; the org **roll-up header** = `Σ(top-level active goals' rolledRaised)` vs `Σ(their goalAmount)` — children are NOT double-counted (they're inside their parent's roll-up; excluded from the header sum). `computeFundraisingPace` reused per goal (on_track/met/behind/null degradation unchanged).
- **Routes**: `GET /fundraising/goals` → `{goals, rollup}` (the portfolio + header); `GET /fundraising/overview` now also carries `rollup` + `goals`. `POST`/`PUT /fundraising/campaigns` accept+validate `goalCategory` (bad on POST → falls back to project; bad on PUT → 400) and `parentGoalId` (foreign → 400, self-parent → 400). `checkWriteAccess` unchanged.
- **Fundraising.jsx Overview reworked**: the single-goal dark hero → a **roll-up header** (`RollupThermometer`) + a **typed goal portfolio** (`GoalCard` per top-level goal, category badge, own thermometer/pace; overarching cards list their children + rolled-up progress). Degrades: 0 goals → StartHere signpost; 1 goal → `activeGoalCount 1`, that goal prominent; many → the portfolio. CampaignModal gained a category picker (Annual/Project/Capital) + an optional "rolls up under" parent select (one level deep).

### Part 3 — Real-time stewardship notification `[Core]`
The `instant_gift_thanks` workflow recipe (see "Workflows engine" → recipe (5) above for the full behavior). Brad: "when someone makes a gift I need to know *immediately* — they need to be thanked."

- **Verified**: `tests/home.test.js` **25/25** (four headers per plan, tasks-bucket classification, portfolio/pipeline scoping mine-vs-all, **plan grace** — Core → portfolio+pipeline null but Tasks present, org isolation); `tests/goals.test.js` **27/27** (typed persist + validation, overarching roll-up = Σ children live-recomputed-not-stored, header roll-up no double-count, pace per goal, 0/1/many degradation, foreign/self parent 400, org isolation); `tests/workflows.test.js` extended to **37/37** (+8: instant_gift_thanks fires per gift → notify_gift, notify both/ed/owner recipient resolution, threshold gate, idempotency, task assigned to officer). fundraising 34 / tasks 31 / portfolios 19 / finance-overview 33 / clickability 43 / donors-pagination 31 still green (no regression). Visual pass driving the real UI at desktop (Home command center + demoted Signals chips, Fundraising roll-up + typed portfolio with a working overarching goal, Workflows 5th recipe with its Notify+threshold config).

## Development reporting cadence (BUILD-17, 2026-07-18)
The oversight rhythm that runs a development office (from the Brad session). Two scheduled **digest emails** + three new **Reports views**, built on the BUILD-14/15/16 feeds. Same checkpoint discipline: org-scoping + `checkWriteAccess` + **idempotent sends**. Plan tags `[Core]` (everyone) / `[Team]` (growth/impact/trial via `orgPlanTier`). **Depends on BUILD-14/15/16** — built last so the digests have rich data to read.

### Digests — reuse the 5-min tick, NEVER a second scheduler
- **Table `digest_sends`** (db.js): append-only log of every digest actually sent. `UNIQUE(org_id, digest_type, period_key, recipient_user_id)` is the **idempotency guarantee** — `reserveDigest()` does `INSERT … ON CONFLICT DO NOTHING RETURNING id` BEFORE composing/sending, so re-ticking within the same week/month is a strict no-op (same discipline as `workflow_runs`). A double-sent digest is a trust disaster; the reservation is non-negotiable. `meta JSONB` stores a small section-count summary.
- **Windows** (server.js): `weekBounds(offset)` = Monday-based ISO week (`wk:YYYY-MM-DD` key); `monthBounds(offset)` = calendar month (`mo:YYYY-MM` key). The tick (`processDigests`) always targets the most-recently-**completed** period (`offset -1`), so a period's digest goes out exactly once, on the first tick after it rolls over. Registered via `setTimeout(30s)` + `setInterval(5min)` — the same cadence as `processScheduledCampaigns`, NOT a new scheduler.
- **(1) Week in Review `[Core]` (per-officer scope `[Team]`)** — `composeWeekInReview(orgId, win, officerId?)` pulls the completed week's **gifts received**, **asks/pledges made**, **moves (with their required descriptions)**, and **past-due tasks**. Sent to **every user**: on Team an admin/ED sees org-wide, a non-admin officer sees their **portfolio only** (donors `assigned_to` them, tasks assigned to them) **plus a team roll-up** summary; on Core (incl. single-user) everyone gets the whole org-wide digest.
- **(2) Monthly per-officer report `[Team]`** — `composeOfficerMonthly(orgId, win, officer)` = that officer's month: asks made ($ + count), moves made, gifts closed ($ + count), portfolio (count + value). One email per officer; suppressed entirely on Core.
- **Delivery**: `sendDigestEmail` = `brandEmailHeaderHtml` (BUILD-13 branded band) + rendered body, **no donor unsubscribe footer** (internal staff mail, like `sendGiftAlertEmail`); no-ops cleanly without `RESEND_API_KEY`, the reservation/run is still logged.
- **Routes**: `GET /digests/preview?type=weekly|monthly` (requireAuth) — compose (never send/reserve) the caller's current digest for the in-app **Week in Review** view; scope follows the caller's role/plan; monthly on Core → 403 plan_required. `POST /digests/run` (requireAuth + **requireAdmin**) — actually reserve+send the caller's org digests now (drives the exact tick path; optional `{weekStart, monthStart, type, dryRun}` overrides pin the period for ops/tests). The tick calls `runDigestsForOrg(org, {wk, mo})` per onboarded org.

### Reports views (extend the BUILD-02 `/reports/:key` family)
- **(3) `three-year` `[Core]`** — per-donor giving this year vs last vs prior (YoYoY columns + YoY change %), org 3-year trend + `orgGrowthPct`. Reuses `reportYearBounds`/`yearMode` (one FY definition with Finance).
- **(4) `annual` `[Core]`** — year-end summary: total, gift/donor counts, new vs returning, growth vs prior year, donor retention, by-fund + by-campaign breakdown.
- **(5) `solicitations` `[Team]`** — the marquee oversight artifact: open-asks-by-stage + **stage-weighted forecast** (`STAGE_WEIGHT`, self-consistent with the pipeline board), asks-vs-closes by officer over the period, and aging prospects (open asks whose donor has stalled longest in-stage, via the most-recent move-into-stage). Gated in `/reports/:key` by `TEAM_ONLY_REPORTS` → 403 plan_required on Core (client renders an upgrade card).
- All three plug into `REPORT_HANDLERS` + `reportToCsv` (CSV with the existing `reportCsvCell` injection guard). `Reports.jsx` adds four tabs — **Week in Review** (digest preview, weekly/monthly toggle, no CSV), **3-Year Comparison**, **Annual Report**, **Solicitations** (Team badge; 403 → gold upgrade card) — via `YEAR_SELECT_REPORTS`/`YEARMODE_TOGGLE_REPORTS`/`DIGEST_REPORTS` control sets and a `planLocked` state.
- **Verified**: `tests/digests.test.js` **38/38** (Week-in-Review composition — each section pulls the target week's data, out-of-week excluded; **idempotent weekly send** = run twice → 1 email / exactly 2 `digest_sends` rows one-per-recipient; per-recipient scoping ED-org vs officer-portfolio + team roll-up; monthly per-officer composition; Core grace — weekly org-wide, monthly suppressed + preview 403; org isolation; requireAdmin/no-token gates). `tests/reports-cadence.test.js` **31/31** (three-year YoYoY + org growth vs hand-computed; annual totals/growth/new-returning/retention/by-fund/by-campaign; solicitations forecast raw + stage-weighted self-consistent, by-officer, aging; `[Team]` gating 403; CSV injection guard on the new reports; org isolation). reports 32 / home 25 / moves 45 / goals 27 / tenant-isolation 30 still green. DSF3 screenshots: `docs/build17-2026-07-18/` (week-in-review, three-year-comparison, annual-report, solicitations) via `scripts/build17-capture.js`.
- **Coverage note**: BUILD-14→17 cover every Brad-session item **except** the Foundations/Grants **portal** — deliberately parked as **BUILD-18, pending one clarification with Brad** (prospect directory vs two-sided marketplace vs grant-lifecycle manager are three different products; speccing it wrong wastes a large build).

## Donor list pagination (BUILD-06 Phase A — 2026-07-17)
- **`GET /donors`**: `limit` (1-200)/`offset` + `search` (lower LIKE name/email) + `stage`/`status`/`assignedTo` + `sort` whitelist (`DONOR_SORTS`: total_giving/name/last_gift_date/created_at, always with `, id` tiebreak for stable pages). **Unpaginated legacy array shape when `limit` is absent** — back-compat for un-migrated callers; `{donors, total}` when present. Filter building shared via `buildDonorListFilter()` with the export route.
- **`GET /donors/summaries`** — whole org minus heavy text columns (notes, score_rationale, etc.), same column names so `adaptDonor` works unchanged. This is what App.jsx's shared `data.donors` now loads; DonorProfile upgrades to the full record via `GET /donors/:id` on select (`selectDonor` in Donors.jsx). Declared before `/donors/:id` (Express order).
- **`GET /donors/export/csv`** — same query params, every matching row, `toCsv`/`reportCsvCell` (BOM + injection guard). requireAuth staff-level, never `checkWriteAccess` (export convention). Directory's Export CSV button uses this; the old client-side `downloadDirectoryCsv` was removed.
- **Directory** is server-paginated 50/page (Prev/Next footer, count = server total). **Advanced + custom-field filters remain client-side within the loaded page** with a "filtering current page" note pill — documented compromise; server-side custom-field querying is an explicit non-goal (BUILD-06).
- **Kanban/Team/Re-engage/Map** feed from summaries via `data.donors`. `buildContext` (shared.jsx) caps its donor list at top-60 by giving.
- **`compression()` is mounted on the `/donors` family only** — deliberately not app-wide so SSE (`/ai/stream`) and webhooks are never buffered.
- **LoginPage now uses the shared `API` constant** (api.js) instead of a hardcoded Railway URL — same target in production, but `VITE_API_URL` is honored so local/E2E stacks can log in against a local backend.
- Verification: `tests/donors-pagination.test.js` (31 assertions: page-concat parity vs full id set, filters vs client-side ground truth, wire sizes, org isolation, Home-stack non-regression).

## Data export (BUILD-03 — 2026-07-16)
"Your data is yours" — the answer to "what happens to our data if we leave?" is one click, a zip of clean CSVs, anytime, even if the subscription lapsed. Trust/sales feature, not a data feature.

- **`GET /org/export/csv`** (requireAuth + requireAdmin — full-org PII dump, matching the billing/org-settings convention; staff can already export the per-view slices they see). **NEVER `checkWriteAccess`-gated** — a read_only (lapsed) org's admin must always be able to leave with its data; this is the export-routes convention and it's the whole point. Streams a zip (`archiver` v8 — note the v8 API is `new ZipArchive({...})`, a class export, NOT the old `archiver("zip", ...)` factory) named `steward-export-{orgSlug}-{YYYY-MM-DD}.zip`, piped to the response (no full-zip buffering; headers are set only after every query succeeds so a DB error still returns a clean JSON 500). Contents: `README.txt` (what's here, export date, per-file row counts) + `donors.csv` (all useful columns, tags pipe-joined, **one column per org custom field** with the field label as header), `gifts.csv` (donor name+email denormalized; fund/campaign/giving-page/peer-fundraiser *names* joined, not ids; campaign honors the legacy `COALESCE(campaigns.name, gifts.campaign)` dual attribution), `interactions.csv` (direction extracted from Gmail metadata), `grants.csv`, `pledges.csv`, `planned_gifts.csv`, `recurring.csv` (from `recurring_subscriptions`), `giving_pages.csv`, `peer_fundraisers.csv` (**explicit column list omitting `edit_token`** — a supporter credential never leaves the system, same rule as the admin fundraiser routes), `receipts.csv` (no `pdf_data`/`snapshot`).
- **Sample rows are INCLUDED, flagged by a "Sample data" column** where the table has `is_sample` — honest and reversible (filter in a spreadsheet) beats silently dropping rows from "everything". Documented decision, don't flip it casually.
- **`toCsv(columns, rows)`** helper (server.js, next to the route): reuses `reportCsvCell` (BUILD-02's RFC-4180 quoting + formula-injection guard) and prepends a UTF-8 BOM so Excel opens accented names correctly. Report CSVs (`sendReportCsv`) deliberately left byte-identical (no BOM added there).
- **`GET /org/export` (JSON) unchanged** — still requireAuth (staff-level), still the machine-readable path.
- **Directory "Export CSV" is client-side, not a server route** — BUILD-03's spec assumed the directory list used query params; it doesn't (all directory filtering — search, advanced filters, custom-field filters, stage/owner — is client-side over one `GET /donors` payload), so a server route could never match what's on screen. `downloadDirectoryCsv(filtered)` in Donors.jsx (module level, next to `DirectoryView`) builds the CSV from the exact filtered rows with the same formula-injection guard + BOM, downloaded as `donors-{YYYY-MM-DD}.csv`. Button sits next to the density toggle, no role gating (it's data staff already see).
- **Frontend wiring**: Settings.jsx "Your Data" card — copy leads with the promise ("Your data is yours. Export everything as CSV anytime — including if you cancel."), gold "Export all data (CSV)" button (admin-only, matching route gating) + outline "Export as JSON" (all roles). App.jsx read_only/warning banner "Export data" now downloads the CSV zip for admins (what a departing org wants), JSON for staff (the CSV route would 403 them).
- **Verified** (2026-07-16, scripted — real server.js + real local Postgres 16 w/ SSL on port 5544, no mocks): 41/41 assertions — staff 403 / no-token 401 / **trial_expired-org admin 200**, chunked streaming (no Content-Length), every expected file present, custom-field headers+values, pipe-joined tags, `=SUM(...)` donor name escaped, sample rows flagged, all four gift joins by name, Gmail direction extraction, `edit_token` absent from extracted files AND raw zip bytes, two-way org isolation, README counts matching actual rows, JSON export unchanged. Plus live production check on the demo org after deploy.

## Reports (BUILD-02 — 2026-07-16)
The Analytics replacement that answers buyer questions — six fixed, parameterized, table-first, CSV-downloadable reports. Deliberately NOT an Analytics revival: no chart dashboard, no PDF builder (Board Report covers that), no scheduled emails, no custom report builder.

- **Route family**: `GET /reports/:key` (requireAuth only — reports are read paths, never `checkWriteAccess`-gated; read_only orgs keep full access), `:key` ∈ `giving-summary | by-group | lybunt | sybunt | retention | top-donors`. Declared AFTER the `/reports/board*` routes in server.js so Express matches "board" there first — keep it that way.
- **Shared param parser** (`parseReportParams`): `from`/`to` (YYYY-MM-DD) OR `year`+`yearMode` (`fiscal`|`calendar`, default fiscal). **Fiscal year N = Jul 1 (N-1) → Jun 30 N** — same July-1 boundary as `/dashboard/my-stats` and `/finance/summary`; a gift dated 2025-12-15 is in FY2026 AND CY2025 (verified both ways). Validates and 400s on garbage; ranges capped at 10 years. Optional `fundId`/`campaignId` filters (giving-summary, by-group, top-donors period), `groupBy` (`funds`|`campaigns`|`giving_pages`) for by-group, `scope=lifetime` + `limit` (≤100) for top-donors.
- **All aggregation in SQL**, org-scoped, soft-deleted donors excluded (`JOIN donors … deleted_at IS NULL`), `is_sample` rows deliberately included (they're org data). Median via `PERCENTILE_CONT(0.5)`. Online = `stripe_payment_id IS NOT NULL`. "New donor" = first-ever gift (unfiltered) falls in period. LYBUNT/SYBUNT predicates live ONLY in `reportBuntList()`: LYBUNT = gift in prior year + none in selected year; SYBUNT = any gift before selected year + none in it (so SYBUNT ⊇ LYBUNT by design, per spec). Retention rows = last 3 COMPLETED years; retention % = prior-year donors who gave again; $ retention = their current-year dollars / all prior-year dollars (can exceed 100%); first-year retention = same restricted to donors whose first-ever gift was the prior year. Top Donors lifetime scope reads `donors.total_giving` (not SUM(gifts)) because imported history often has no gifts rows. by-group campaigns honors the legacy dual attribution (`campaign_id` join, falling back to the old `gifts.campaign` text column).
- **CSV**: same route + `?format=csv` → `Content-Disposition: attachment`, proper quoting, and a formula-injection guard (leading `=`/`+`/`-`/`@` in TEXT cells gets a `'` prefix; numbers pass through). Client builds the download filename itself — `Content-Disposition` isn't CORS-exposed cross-origin (Vercel→Railway).
- **Indexes** (db.js initSchema): `gifts(org_id,date)`, `gifts(org_id,fund_id)`, `gifts(org_id,campaign_id)`, `donors(org_id,last_gift_date)`.
- **Frontend** (`Reports.jsx`): left rail (six reports + question subtitles), param bar (This FY/Last FY/This CY/Last CY/Custom preset chips for period reports; **the default preset resolves from data, not the calendar** — one giving-summary probe on mount; if the current year has no real volume yet (<10 gifts AND <1% of the prior year's dollars, with a prior year to compare against) the tab opens on Last FY/CY instead of a nearly-empty This FY — early-July "you've raised $1" first impressions were the motivating case; user chip clicks override for the session; fiscal/calendar toggle persisted to localStorage `steward_reports_yearmode` + year select for LYBUNT/SYBUNT; toggle only for retention; period/lifetime toggle for top-donors), narrative sentence first with numbers as evidence, dense sortable table (client-side column-click sort), Download CSV. LYBUNT/SYBUNT rows are terracotta-accented (they ARE the leak) and click through to the donor profile. Five-color palette only; % shares render as thin gold bars. Fetched data is tagged `{key, d}` — between switching reports and the fetch effect firing there's one render where stale data has the wrong shape (this was a real crash, found in live testing). Mobile (GlobalStyles): rail → horizontal chip strip (subtitles hidden), tables scroll inside `.reports-table-wrap`, page never scrolls horizontally.
- **Verified** (2026-07-16, real server.js + real local Postgres 16, no mocks): 63/63 scripted assertions — every report's numbers vs hand-computed expectations (median odd+even, new/returning splits, retention incl. 466.7% dollar-retention edge, LYBUNT/SYBUNT membership in both year modes), org-B isolation on every key, the FY2026/CY2025 boundary flip, CSV quoting + `=HYPERLINK` injection guard, param validation (400s), `/reports/board` not shadowed. Plus a live Playwright pass: all six reports screenshotted, CSV downloaded through the real UI button, LYBUNT row → donor profile deep-link confirmed, mobile viewport checked.

## Scale (BUILD-05 load test, 2026-07-16 — see LOADTEST_REPORT.md)
**Tested ceiling: 25,000 donors / 200k gifts / 150k interactions per org** (local Postgres 16 + real server.js; synthetic power-law org via `scripts/seed-loadtest.js`, driven by `scripts/loadtest.js`). Post-fix, every read endpoint is ≤1s per request at that scale; 25k-row combined import runs in ~24s; the hourly/6-hourly job sweeps are sub-second per org.
- **What the load test changed**: three indexes in `initSchema` (`interactions(donor_id,date)`, `interactions(org_id,donor_id,date)`, `gifts(donor_id,date)` — before this, `interactions` had NO index beyond its pkey, so every per-donor gift/interaction path seq-scanned the whole table); `computeStewardshipDebtBreakdown()`/`computeFirstTouchDelay()` rewritten from per-donor correlated subqueries to one LEFT JOIN + GROUP BY (result-identical — parity-checked with EXCEPT both ways; at 25k donors the old shape made a Home load take **>15 minutes**, now ~150ms per aggregate); `computeRetentionRate` SELECTs only `donor_id, date` (the JS year-bucketing stays, per its timezone-parity comment); import routes (`/donors/import-combined`, `/donors/import`, `/gifts/import-history`) get a 30mb body parser — a 25k-row payload is ~12.6MB and the global 5mb cap (still guarding every other route) made mid-size imports physically impossible.
- **First boot after deploying this builds the new indexes** — ~2 min one-time at 25k-donor scale, ~2s thereafter.
- **`DISABLE_RATE_LIMIT=1`** is a load-test/local-suite-only env hook (skips the general, login, register, and donate limiters). Never set it in production.
- **The `GET /donors` 21.7MB cliff is FIXED (BUILD-06 Phase A, 2026-07-17)** — see "Donor list pagination" below. Measured post-fix at 25k: Directory page 20ms/3.6KB wire; whole-org summaries 183-311ms/923KB wire.
- **Remaining next cliffs (flagged in LOADTEST_REPORT.md, deliberately not fixed)**: Retention still JS-parses every gift row (~150ms per Home load at 200k gifts). Import recalc and autoEnroll enrollment checks are cheap-but-N+1. bcrypt serializes logins at ~10/s under burst (by design).

---

# Status snapshots (undated, from the old CLAUDE.md; likely stale)

## What's built
- Auth + 5-step onboarding that finishes with real data (org basics → import donors → set first goal → first impact metric → finish) — see "Onboarding flow" above
- Dashboard — now an **action-queue-first home screen**, not a KPI stat grid: goal banner (from `fundraising_goals`), "Needs Your Attention" queue (milestone drafts, note reminders, lapsed donors, never-contacted donors — mixed and prioritized), pipeline funnel, next-grant-deadline tile (deep-links into GrantProfile via `initialGrantId`), Stewardship Debt / First-Touch Delay headline metrics (see "Product design patterns"). The old hero stat cards, AI daily briefing, Quick Actions sidebar, and standalone Recent Activity feed are gone, not just restyled — deep-links go straight to Communications' Milestone Drafts queue (`initialNav`/`highlightDraftId`) or a donor profile.
- Donors — Kanban pipeline, CSV import (now also the centerpiece of onboarding step 2 — `DonorImport` exported from Donors.jsx), AI features, editing, interaction timeline (dynamic templates by type: Call/Meeting/Email/Event/Gift/Other), auto follow-up task on touchpoint save, wealth score card (5-component scoring, DB columns, recalculate button), per-donor Impact Summary PDF download (`GET /donors/:id/impact-summary/pdf`)
- Grants — CRUD, AI strategy, LOI drafting, grant discovery (FindGrants merged into Grants tab)
- Communications — segmented email campaigns (Resend HTTP API), AI copy, open rate tracking via pixel, audience filters, Sequences, **Milestone Drafts review queue** (staff approves/edits/dismisses AI-drafted milestone emails before sending — see "Retention & stewardship")
- Reports — six fixed, parameterized, CSV-downloadable reports (Giving Summary, Gifts by Fund/Campaign/Page, LYBUNT, SYBUNT, Retention, Top Donors) — the deliberate Analytics replacement, see "Reports" section
- Finance — **reintegrated + redesigned 2026-07-17 (BUILD-09)**: visible again, rebuilt to current design standards with Stripe woven in. SectionTabs (Overview · Transactions · Funds · Budgets · Accounts · Audit Log), Money-in Stripe strip (balance + payouts) on Overview, unified ledger badging each row's source (Online·Stripe / Gift / Manual / Import) and linking donors through to their profile. See "Finance (reintegrated)" below.
- Volunteers, Board, Tasks — **hidden from nav** as of the 2026-07-12 pivot (see "Strategic pivot" at top); code/routes/tables fully intact, reversible by uncommenting. (Analytics was hidden by the same pivot but then deleted outright 2026-07-16 — see Strategic pivot.) Descriptions below are the still-accurate feature list, kept for whenever these are re-enabled:
  - Volunteers — hours tracking, conversion to donor, board candidate AI
  - Board — giving levels, attendance, committees, AI board report
  - Tasks — priority queue, AI prioritization, add/complete, due dates
- Settings — Stripe Connect Express flow, QR code generator, embeddable iframe widget, team management, invite staff (email + link fallback), Custom Fields manager, **Impact Metrics manager** (same UI pattern as Custom Fields), NO billing/plan UI; Demo Data card (gold left border) at top
- Sample data loader — `POST /org/load-sample-data` (refused if >5 real donors; seeds 25 donors across all stages, gifts, funds, transactions, grants, events, campaign, interactions, tasks, volunteers, board members; all tagged `is_sample=true`); `POST /org/clear-sample-data` (per-table `.catch(()=>{})` deletes); `GET /org/sample-data-status` → `{ hasSampleData, sampleDonorCount }`; DirectoryView shows inviting empty state with Load button when org has 0 donors; also offered inline on onboarding's "ready" screen when a new org skipped CSV import and still has 0 donors
- RBAC — requireAdmin middleware, admin/staff roles
- Public donation page (/give/:orgSlug) — Stripe Checkout, campaign links, recurring gifts via Subscriptions, email gift request from donor profile
- Recurring gift recovery — detects failed/expired-card payments on donors' recurring gifts (invoice.payment_failed on the connected Stripe account), auto-sends a warm branded card-update link on a fixed 0/3/7/14-day cadence, tracks recovery, and surfaces revenue-at-risk + recovery rate to staff (home-screen queue + card, DonorProfile status chip) — see "Recurring gift recovery" under Database
- Tax receipting & year-end giving statements — auto-sent IRS-compliant receipts for online gifts once an org completes tax settings, one-click (never automatic) receipts for offline gifts, consolidated calendar-year statements per donor, staff queue for un-receipted $250+ gifts — see "Tax Receipting & Year-End Giving Statements" under Database. US-only, cash/cash-equivalent gifts only in v1
- Landing page — rebuilt wholesale (BUILD-07, 2026-07-17) as a warm-serious, book-set page: hero + three real product moments + money strip + candor section + founder letter + close; no feature grid, no ROI calculator, no pricing cards on the page (pricing lives at /pricing, linked). All product imagery is real captures of the deployed product. See the Landing.jsx bullet under "Project structure" for full detail

## What's NOT built (despite prior docs)
- **No guided tour / OnboardingWizard component exists.** One was built and then deleted the same day (commit b9fcf7a, "Kill guided tour...", 2026-06-07) — PROGRESS.md documented the build but was never updated for the removal until this pass. Do not assume `GuidedTour`/`OnboardingWizard` exists without checking the actual file tree first.
- **No general-purpose AI chat.** `AIChat` (the floating "Ask AI" overlay, previously exported from Dashboard.jsx) was deleted entirely, not hidden — see "Strategic pivot."
- **No donor-facing portal, donor login, or donor-visible tiers/badges** — explored and deliberately rejected, see "Strategic pivot."

## Current priorities
- Stripe live mode: confirmed working (production keys active)
- Email: Resend SPF/DKIM verified, sending from noreply@stewardapp.dev
- Custom domain: stewardapp.dev live and routing correctly on all paths
- **QA sweep dated 2026-07-10 (`QA_REPORT.md`) — both Blocking findings now confirmed resolved (2026-07-16 code-inspection pass, not a live re-run of the Playwright suite itself)**: #1 signup mobile overflow — `shared.jsx`'s `GlobalStyles()` `@media(max-width:768px)` block has `.signup-shell`/`.signup-left`/`.signup-right`/`.signup-card` rules matching `SignupPage.jsx`'s actual class names, stacking correctly. #2 read-only/`checkWriteAccess` gaps — confirmed both server-side (`checkWriteAccess` present on the documented route list, see "SaaS billing" below) and client-side (`isReadOnly`-gated buttons present in Volunteers.jsx, Tasks.jsx, Events.jsx, Communications.jsx, Board.jsx, Settings.jsx, matching the button list already documented in "SaaS billing" below). This file previously said both findings were "possibly still open" pending re-verification — they were already fixed by the time that caution was written, same staleness pattern as `SECURITY_REPORT.md` (see below).
- **`SECURITY_REPORT.md`'s 2026-07-10 findings — CRITICALs (C1–C4), the RBAC gap, and the file-upload gap are all confirmed fixed** (re-verified 2026-07-16, see the file's own inline update notes for exact file:line evidence). The Giving Pages/peer-to-peer fundraising surface (built after that report) was separately audited 2026-07-16 with no CRITICALs found; two small gaps found there (a stale RBAC comment, missing input validation on the admin Giving Pages routes) are also fixed. The only items from the original 2026-07-10 report **not** re-verified: the §1 org-scoping edge cases (`programs/:id/grants` link+delete, `gmail/send`→`interactions`, `finance/transactions`) and the JWT-algorithm-pinning hardening recommendation (§5) — still open.
- **Data integrity check requested but not completed**: after manually deleting several test-user rows from Supabase's Table Editor, the user asked for a check of orphaned orgs (no matching `users` row), specifically whether `org_ec6340db` ("SMOKE TEST — DELETE ME") still exists and needs deleting, and any dangling FK references (`created_by`/`assigned_to`/etc.) to the deleted user IDs. Tooling for this was built (see "Admin data integrity" below) but the actual queries were never run against production — blocked on missing super-admin credentials in that session. Still needs to be run.
