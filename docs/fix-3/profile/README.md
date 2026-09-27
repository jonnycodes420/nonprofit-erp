# The donor profile — two directions (FIX-3 finding 10)

**Jonathan picked Direction 1, and it is built.** See `built-*.png` and the section
"Built" at the end. The mockups below are what he chose from.

Every screenshot shows the same invented major-gift prospect on a fixture org:
Eleanor Whitcombe at Riverbend Music School. She has six gifts ($41,500 in total),
an open $50,000 proposal, a three-step cultivation plan, two conversations, a
sequence and three custom fields. The mockups use Steward's four colours and
nothing else. Emerald marks the one primary action, "Log a conversation".

| | 1440 | 390 |
|---|---|---|
| Today | `today-1440.png`, `today-1440-full.png` | `today-390.png`, `today-390-full.png` |
| Direction 1 | `direction-1-1440.png`, `-full.png`, `-full-open.png` | `direction-1-390.png`, `-full.png`, `-full-open.png` |
| Direction 2 | `direction-2-1440.png`, `-full.png`, `-full-open.png` | `direction-2-390.png`, `-full.png`, `-full-open.png` |

`-full-open` shots have the More menu and every collapsed group opened, so you can
see that nothing was dropped. The mockups' HTML is in `mockups/`. To re-render them,
run `scripts/fix3-d-profile-capture.js mockups`.

## Direction 1: one column, the four questions from top to bottom

- **The top band** stays pinned on desktop. It holds the name, stage, role chips and
  three figures (lifetime, last gift, last contact), and each figure opens its rows.
  Beside them sit the one emerald action and a quiet **More** menu, grouped as
  Reach out / Suggest / This record.
- **What do I do next** puts the open step and the open proposal side by side, with
  the plan's steps under the proposal and the suggestion under the step.
- **What has happened** has one filter row (Everything · Gifts · Conversations ·
  Pledges · Funds · Soft credit), the giving chart and table, the conversation
  timeline and her notes.
- **How we manage them** is eight collapsed groups. Each one carries a one-line
  summary, so a closed group still says what is inside it.

## Direction 2: two panes and a drawer

- **The left pane** stays in view and answers "where we stand" and "what next":
  identity, chips, the three figures, the primary action and More, the next step,
  the open proposal and the suggestion.
- **The right pane** is the history, as tabs: Timeline (one list of conversations,
  gifts, proposals and plans), Gifts, Pledges, Funds, Related and Files.
- **Management** sits behind one **Manage** button. It opens a side drawer on
  desktop and a bottom sheet on a phone, and it has the same eight groups.

## The trade-off

- **Direction 1** reads like a page. On a phone and on desktop it is the same layout
  in the same order, so there is one layout to build and test. It is also the smaller
  change from today's code. The cost is that on desktop the next step scrolls away
  once she reads down into the history, and only the top band stays.
- **Direction 2** keeps "what next" on screen while she digs through history, which
  is what an officer does before a call. It uses a wide screen well. The costs are a
  second layout to maintain (at 390 it stacks into Direction 1's order anyway), a
  drawer that hides management one step further away, and the width it needs. A
  400px left pane is tight at 1024–1280.

## Recommendation

**Direction 1.** The four questions are an order, and one column says that order
most plainly on every screen size. It also turns into one build: today's tabs become
the history filter, and the rail becomes the collapsed groups. From Direction 2, keep
one idea: at 1440, pin the next step inside the top band, so it does not scroll away.

## Seen while capturing today's profile (not fixed here)

- At 390, today's **Proposals** panel wraps the proposal's name one letter per line
  (`today-390.png`). It lives in `MajorGifts.jsx` `ProposalsPanel`. Fix it with the
  build, or earlier.
- The Suggested panel reads "Stream failed: 503" locally, because this stack has no
  Anthropic key. That is expected.

## Built (Direction 1, with the pinned next step)

| | 1440 | 390 |
|---|---|---|
| Built | `built-1440.png`, `built-1440-more-open.png`, `built-1440-groups-open.png`, `built-1440-full.png` | `built-390.png`, `built-390-more-open.png`, `built-390-groups-open.png`, `built-390-full.png` |

- The band, the next step, the history and the groups are as mocked.
- Two differences from the mockup:
  - The last-contact figure keeps its existing "Nd ago" form, because a suite pins it.
  - The suggestion shows the panel it has always used.
- The ProposalRow / plan-step wrap noted above is fixed.
