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
