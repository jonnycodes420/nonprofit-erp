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
