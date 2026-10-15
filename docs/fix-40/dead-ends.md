# FIX-40 · What in Communications opened nothing (origin/main 20176d4)

Walked on Harborlight at 1440, every Communications tab. Each row is a name, number, row, bar or campaign
that was plain text or opened nothing, what it opens now, and the probe `tests/fix40-comms-opens.test.js`
reads (`tab · selector · how`). `how` is `link` (a real link to a profile), `rows` (opens a figure's rows),
`page` (opens the campaign's own page), `tab` (switches to the screen that lists them) or `gone`.

| Tab | What | Was | Now | Probe |
|---|---|---|---|---|
| Overview | Emails sent (0, and wrong: it summed only the six newest campaigns, all drafts) | plain | every email sent, one row per person (`emails-sent`) | hub · `[data-testid=hub-stat-sent]` · rows |
| Overview | Open rate | plain | the sent campaigns, each with its rate | hub · `[data-testid=hub-stat-rate]` · tab |
| Overview | Sequences running | plain | Sequences | hub · `[data-testid=hub-stat-sequences]` · tab |
| Overview | Recent sends rows | plain | a sent campaign opens its page; a draft opens Campaigns | hub · `[data-testid=hub-recent]` · page |
| Overview | Audience counts in the rail (1,158, 55, 569 …) | plain | a group's count opens its members (`group-members`); the others open the screen their people live on | hub · `[data-testid=hub-audience-count] button` · rows |
| Campaigns | Sent (180) | plain | that campaign's emails, one row per person (`emails-sent` with `campaign`) | campaigns · `[data-testid=camp-sent-open]` · rows |
| Campaigns | Opened (80, 44%) | plain | the campaign's page | campaigns · `[data-testid=camp-rate-open]` · page |
| Campaigns | Names in an expanded campaign's recipient list | plain | the profile | campaigns · expanded row · link |
| Templates | (nothing: every template opens in the editor since FIX-39) | | | |
| Audience | Segment counts (All Donors 1206, Lapsed 0 …) | the chip filtered a list capped at 50, "+1156 more" opened nothing | the chip shows every person in it ("Show all"), counted by the server's rules | audience · `[data-testid=audience-seg]` · rows |
| Audience | Each person's row | plain | the profile | audience · `[data-testid=audience-row] a[data-donor-link]` · link |
| Audience | Total Giving on each row | plain | that person's gifts (`donor-lifetime`) | audience · `[data-testid=audience-row] [data-source-key=donor-lifetime]` · rows |
| Analytics | Total emails sent (180) | plain ("no filtered-list destination") | every email sent (`emails-sent`) | analytics · `[data-source-key=emails-sent]` · rows |
| Analytics | Overall open rate (44%) | plain | the sent campaigns | analytics · `[data-testid=analytics-open-rate]` · tab |
| Analytics | "Industry avg ~20%" | unsourced | gone, nothing in its place | analytics · `text=Industry avg` · gone |
| Analytics | Campaigns sent (1) | went to Campaigns, unfiltered | the sent campaigns | analytics · `[data-testid=analytics-campaigns-sent]` · tab |
| Analytics | Best campaign | went to Campaigns | the campaign's page | analytics · `[data-testid=analytics-best]` · page |
| Analytics | Sends per month (one bar stretched across the box) | plain | twelve labelled months, each bar opens that month's sends | analytics · `[data-testid=sends-bar]` · rows |
| Analytics | Top campaigns by open rate rows | plain | the campaign's page | analytics · `[data-testid=analytics-top-row]` · page |
| Sequences | (Harborlight has none; a step that sent opens `GET /sequences/:id/steps/:order/as-sent`) | | | |
| Your email tool | Campaign name | plain | its page: subject, send date, delivered, then everyone Steward can name on it | emailtool · `[data-testid=emailtool-name]` · page |
| Your email tool | Delivered (415) | plain | who it went to, as far as the tool tells Steward | emailtool · `[data-testid=emailtool-delivered]` · rows |
| Your email tool | Names in Opened and Clicked | plain text | the profile | emailtool · `[data-testid=emailtool-person]` · link |
| Your email tool | Gifts within 30 days ("1 · $55,000.00") | plain | "1 gift, $55,000", opening those gifts (`email-tool-gifts`) | emailtool · `[data-testid=emailtool-gifts]` · rows |
| Drafts to review | The person's name | plain | the profile | milestones · `[data-testid=draft-person]` · link |
| Drafts to review | Lifetime giving ($187,500) | plain | their gifts (`donor-lifetime`) | milestones · `[data-source-key=donor-lifetime]` · rows |
| Surveys | (nothing: no names, counts or money shown) | | | |

## The rest of the app (the guard's first run)

| Page | What | Now |
|---|---|---|
| Donors | Officer portfolio chip "717 · $4,020,376.66" | both open the portfolio (`officer-portfolio`) |
| A profile | The open ask "$25,000" on the ask card | the open ask's rows (`donor-open-ask`) |
| Finance | "$6,596,710.72 of imported giving" | opens Reports, where that giving lives |
| Reports | A table's Total row | **left plain on purpose:** it is the sum of the rows directly above it, and each of those opens |

## Not placed

- **The body of an email-tool campaign, and the list it went to.** Steward reads the counts and who
  opened, clicked or stopped from Mailchimp and Constant Contact, not the email itself or the list name.
  The campaign page says so and points to the tool.
- **Who exactly an email-tool campaign was delivered to.** The tool reports a delivered count and the
  people who did something; Delivered opens those people and says how many of the count it can name.
