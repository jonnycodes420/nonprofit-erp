## FIX-27 · A director's Monday morning (2026-10-04)

- **Campaigns had no page.** "Opening" one scrolled its card and outlined it. `CampaignsList.jsx` (out of
  Fundraising.jsx so the census can hold it) is the list and a page at `?fr=campaigns&campaign=<id>`;
  every figure is a `<Figure>` whose source the server attaches to each goal row (`sources`:
  goal-raised, campaign-goal, goal-progress, campaign-donors, pledges-open by campaign, campaign-grants,
  and goal-rollup-* for an umbrella). `fix2-a-footing` foots them and now runs the source census.
- **Shared filter:** `gaveCampaign`/`gaveCampaignYear`, `notGaveCampaign`/`notGaveCampaignYear`, `noAsk`
  (no open proposal, no proposal made or ask logged in twelve months). Show me reads them (templates and the
  model's form) and "what should I ask them" adds each row's `engagement.suggestedAsk` and Room to give.
  The Agent's `find_people` is `agentFindPeople`: the WHO in her words through the same templates, then the
  model's filter form only when a campaign, event or ask is named; `plan` and `calls` joined DO_WORDS
  because "Plan calls to … last year … not this year" was being answered as the LYBUNT report.
- **Drafts:** `guardDraft` in shared/suggestionGuard.js (video only when one is ready, with its link; links,
  gift amounts, dates, meetings and events must be on the record). `/ai/draft-email` replaced the two
  Communications streams; milestone, check-in and Agent drafts are checked too. A failed draft is the template.
- **Volunteers on prod (Railway logs):** Availability was `availability ? ?`, which the query layer turned
  into two parameters (syntax error at `$5`); Muse's three Log a shift POSTs were 401s (the session ended,
  most likely a mid-walk re-seed), and the hub's once-read roster explains names that differed from the list.
  The seed gives 24 roster volunteers an approved application with days, and confirms the timezone.
- **Not reproduced:** a blank New group page. Groups now opens on its list with New group in the title row
  and says when it is loading.
