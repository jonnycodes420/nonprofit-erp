# Ask why

Read this when you touch Ask why (`why.js`, `routes/why.js`, `shared/whyShape.js`,
`client/src/components/WhyAnswer.jsx`), the figure source `why`, or any screen that ends in a decision.

## How Steward is built (the thesis, WHY-1)

Most donor software answers what happened; Steward answers why it happened and what to do next.
Every screen ends in a decision: a name, a reason and a step. Every reason is a computed fact that
opens its rows; Steward never states a cause it can't show. Rank the reasons by dollars and say which
matters most. The step is taken by a person. Say plainly what the data can't see. AI writes the
sentence, never the facts, and goes through the AI switch; with AI off, the same answer shows in
template sentences. Every future build is checked against this.

## Rules
- **One answer shape for every question.** `sentence`, `reasons` (ranked, each `{label, cents, count,
  definition, source}`), `who` (real links, ranked), `step` (one action), `cantSee` (one honest line or
  null). `WhyAnswerBody` renders it; nothing renders an answer any other way. (WHY-1)
- **A reason is built from its rows.** `why.js`'s `reason()` sums the rows it is given; the figure source
  `why` returns the same rows by recomputing the same answer. A reason's number cannot disagree with its
  rows. `tests/why1-appeal-variance.test.js` foots them. (WHY-1)
- **The appeal breakdown is a partition.** Every donor of either campaign is in exactly one part
  (lapsed, timing, less, more, new, back) or moves nothing (gave the same), so the parts sum to the
  variance to the cent. Add a part, never an overlap. (WHY-1)
- **The facts are code; the sentence is checked.** The model gets the facts and the job
  (`sentencePrompt`), through `aiClient.js`. Its sentence is shown only if `sentencePasses`: every
  numeral, dollar amount, percentage and number word in it is one Steward computed, and it has no em
  dash. Anything else shows the template. AI off shows the template and asks no model. (WHY-1)
- **The model sees the facts, not the file.** `sentenceFacts` is the question's facts plus the reasons'
  labels and sums. At most the first person on the list is named. Never a donor list, never an email. (WHY-1)
- **Steward never says "because" about a person.** Question (d) lists what is on their record ("On their
  record, their last gift was never marked thanked"), not why they left. (WHY-1)
- **The step never sends.** It opens Thread steps (`POST /donors/:id/threads`, one per person, a donor
  who already has an open step keeps it), starts a journey by hand (`POST /journeys/:id/apply`), or opens
  Log a conversation. (WHY-1)
- **Every question goes in the question log, text only.** `question_log.surface = 'why'`, `topic` = the
  question's key or `not covered`, `answered` true or false. A tapped question logs its generic words,
  never the donor's name. Super-admin's "What Steward could not answer" is the roadmap. (WHY-1)
- **No statistic without a source.** Every number in an answer is the org's own. Never quote another
  company's research as Steward's, and never name a competitor in the product or site. (WHY-1)

## The seven questions (how each is computed)

| key | question | facts | ranked by | step |
|---|---|---|---|---|
| appeal | Why did <campaign> come in under (or over) last year? | `appealWhy.comparableFor`; donors split into lapsed, timing (gave last time later than this year's window has run; the late-send days are a fact), less, more, new to the org, back after skipping last year's | dollars moved | plan calls to the top five lapsed/late/downgraded, by last year's gift |
| call | Who should I call tomorrow? | the signed-in person's donors and the unassigned, not already on the Thread: a live gift of at least $250 and the org's p75 in 60 days not thanked; an open ask past `expected_close`; a failed recurring card (a year of it); a meeting tomorrow (12 months' giving); gave in this month last year and nothing since; drifting (`computeDriftForDonors`, usual gift). One reason per person (the largest), the largest of each kind first, then by dollars | dollars at stake | put all five on tomorrow's Thread |
| retention | Why is retention down this year? | last year's donors who gave this year to today's date, against the same measure a year earlier to the same day; split first-year/repeat, monthly/one-time, and how they first gave | donors lost | start Welcome back for the ten most recent (falls back to calls) |
| stopped | Why did <donor> stop giving? | failed card, email on the suppression list, last gift not thanked, an ask above their largest gift, no logged contact for six months or more. Only what is there | (one donor) | the touch that fits: call about the card, log the thank-you, or a call to reconnect |
| lapse | Who is about to lapse, and why? | `computeDriftForDonors` state drifting, split by confidence (clear pattern / early signs), drift's own sentence | usual gift | plan calls to the top five |
| volunteers | Which volunteers should we ask to give? | volunteer type, hours on file, no gift ever, not do-not-solicit; hours this year, last served, asked or not; who knows them best is the staff member who logged most of their shifts, else their owner, else the volunteer coordinator | hours this year, then recency | plan a personal ask from that person (owner on the step) |
| second | Which first-time donors need a second ask? | first gift ever in the last 90 days, one gift only, no call or meeting logged; split thanked / not thanked | first gift | plan the thank-you call for the top five |

## Template sentences

In `shared/whyShape.js templateSentence`. Spell numbers under ten, no colons, no em dashes.
- appeal: "<Campaign> came in <$diff> under <compare>, mostly because <top reason's phrase>."
- call: "Start with <name>. <their reason> <N> more names follow; <$> is at stake across all <N+1>."
- retention: "Retention is <r>% this year against <p>% last year; the most donors were lost among <group, lost of base>."
- stopped: "<name> last gave <$> <when>. On their record, <first fact>."
- lapse: "<N> donors are past their own usual gap between gifts, with <$> of usual gifts between them; <name> has gone longest."
- volunteers: "<N> volunteers have served and never given; <name> leads with <h> hours this year."
- second: "<N> first-time donors from the last 90 days have no second gift and no thank-you call, <$> in first gifts; <name> gave the most."
- not matched: "Steward can't answer that one yet. We've noted it."

## The suggested journey (Part 7)

`GET /donors/:id/journey-suggestion`, first fact that holds, and only a journey the org has (by catalogue key):
monthly (an active recurring gift) → Monthly giver; lapsed (stage lapsed, or drift.js drifting or lapsed, the
same engine as question (e)) → Welcome back; first gift in the last 365 days → New donor, first year;
generosity 80 or more → Major donor; a meeting logged in the last 30 days → Major donor. A finished journey is
excluded from the next suggestion. Starting it is `POST /journeys/:id/apply`, by a person.
