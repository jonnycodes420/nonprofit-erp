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
