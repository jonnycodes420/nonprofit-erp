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
