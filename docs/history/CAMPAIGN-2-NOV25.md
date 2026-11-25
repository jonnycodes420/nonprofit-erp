# CAMPAIGN-2 (2026-11-25) · Who a campaign reaches is right, and every button in the editors says what it did

The second brief to carry the name (the first, 2026-10-02, is `CAMPAIGN-2.md`: campaign pages). From Jarvis's
power-use sweep (24 Nov) and SENDS-3's held item 3. Each item was reproduced first on staging with real clicks
(Harborlight, read only) or, for writes, on a local production build.

- **The editor is a fixed-height shell** (added by Jonathan mid-build: staging edd466f, "can not see the top of
  the screen" after clicking an image block). Both email editors sat at a fixed `top: 52` that ignored the
  staging strip, and bringing a block into view called `scrollIntoView` in the email frame, which scrolls every
  box around it. The shell now starts under the header and the strip, measured (`useShellTop`), is exactly as
  tall as what is left (`shellStyle`), and pins itself and its frames at scroll 0 (`pinShell`); a block is
  brought into view by setting the email pane's scroll (`scrollEmailTo`), a rail section by its own pane's
  (`scrollWithinPane`). On a phone the takeover sits under the strip instead of under nothing.
- **All donors means all donors.** "By stage > Lapsed (281)", then "All donors", kept the count at 281 through three
  clicks. Two causes: the picker kept `stages` on the segment when the kind changed, and `filterBySegment` narrowed
  "all" by any `stages` it carried (a rule meant for legacy segments with no mode). Now a new kind starts clean
  (only her never-given tick carries over), and only a segment with no mode reads stages or statuses, so a draft
  already saved with a stale stage reads as all donors with no repair.
- **Tiers are the giving levels.** The campaign's five tiers (transformational … micro) matched
  `donors.capacity_tier`, a wealth-score column almost nobody has: all five gave 0. Steward has one tier
  definition, the giving level (`donorStatus.statusSql`: General, Mid, Major on the last 12 months, Settings,
  Giving levels). "By tier" offers those three (`server/outreach/campaignTiers.js`), each holding only people who
  gave in the 12 months, so the three together are everyone with a gift in that window and Major is the Donors
  list's Major. An old tier key on a saved draft selects nobody (`scripts/ops/campaign2-old-rows.js` lists them).
- **Who can receive it, first.** The audience line said the switch last ("· 1,117 wait until Campaign emails are
  on"). The segment preview now carries `canReceive` (`server/outreach/canReceive.js`): "1,117 of 1,119 can't
  receive this yet: Campaign emails are off for your organization.", leading "Who it goes to" with the switch's
  place (COMMS-1's note), then the other reasons as figures that open their people. "Who it goes to" moved above
  the subject. Nothing is turned on.
- **"Start a campaign from this" goes somewhere.** It made the draft and wrote its answer into a note at the top of
  a rail scrolled down to More. It now opens the new draft in the campaign editor with its toast, and the server
  reuses an untouched draft the same person started from the same template in the last 30 minutes (`reuse`), so
  a second press opens the same draft. The staging re-check (a625869) found the second press opened it in silence: its
  answer went to the template editor's toast, which leaves with the template editor. The campaign editor now
  says it as it opens (`openedSay`, follow-up PR). The twins already made are listed by `campaign2-old-rows.js`.
- **Every AI button drafts or says why.** `server/ai/whyNot.js` turns the AI gate's reason into one sentence and
  what to do (AI off: Settings, Your Data, the switch; no key: not available on this server; the day's budget).
  "Draft with AI" answers beside its button and as a toast; with unsaved changes it says "Save your changes first"
  with Save and draft. The sequence step's "Write with AI" no longer replaces her words with Steward's starting
  words when nothing was drafted: it says why, offers the starting words as her choice, and says "Tried again"
  on a repeat press. Staging has no `ANTHROPIC_API_KEY`, which is why nothing drafts there
  (`docs/needs-jonathan/CAMPAIGN-2.md`).
- **The census.** The "+ Field" menu Jarvis found open is gone (BUILDER-1's Fields tab replaced it); the menu
  left in the editors' top bar, Preview as, now closes on Escape and on a click outside it.
  `tests/lib/deadClickCensus.js` presses every button in the template, campaign and sequence editors twice and
  fails a press whose settled, visible page is unchanged (a spinner that comes and goes, or a note drawn out of
  sight, is not a change; a request with nothing seen is a dead click).

Tests: `tests/fix39-campaigns.test.js` (the campaign suite) runs `tests/campaign2/sections.js`. Red on main
(edd466f, the same sections against main's server and dist): All donors with a stale stage 2 of 9; the three
levels 0 of 7; Major 0 against the list's 2; no `canReceive`; a second press made a second draft; no `whyNot`;
the real clicks 2,2,2 after Lapsed; at 1440 under a staging strip, Save's top at 61 px under 76 px of strip
and header; and the census: "Write with AI (a request, nothing seen)", first press and
again. Green on the branch.
