## WIRE-1-ADDENDUM · Templates, Agent drafts and Gervase (2026-10-06)

Found on Harborlight after WIRE-1 shipped. Three parts, built in parallel worktrees (templates, profile) with the
Agent part done by the lead.
- **One Templates tab.** Communications' "Templates" and "Email templates" merged into one view in four sections
  (thank-yous and receipts, appeals and campaigns, events and volunteers, grants and funders); the three stores are
  untouched. 29 templates before and after, none doubled. Old `?subtab=` links land on it. Not done: the five
  one-person emails and six campaign starters still open their own editors, not EMAIL-1's (needs a bridge).
- **Agent drafts land on the person.** A draft was a row in the Agent queue and nowhere else, so Gervase's profile
  said "Nothing is open" beside four gifts "Not thanked yet". Now `draft_note` opens (or relabels an open thank-you)
  Thread step "Thank-you draft ready, review and send" and writes a timeline line, in the run's transaction. Approving
  marks the drafted gifts thanked and closes the step; `/agent/waiting/agent_draft/:id/reopen` is the Undo, putting
  back only what that approval changed. Review all N walks a plan's drafts in a row (Agent sheet, Drafts to review).
  The plan list counted "waiting" as done ("Done · 22 of 22"): one rule now, `agentShape.runProgress`.
- **A plan of any size finishes.** PLAN_SCHEMA is strict, so every step carries all 37 fields (~170 tokens) and 42
  thank-yous overran the 8,000-token plan call. A drafting instruction now writes drafts ten at a time with
  DRAFTS_SCHEMA ({donorId, subject, body}, 0 unions), three batches in parallel, each grounded on the gift rows it
  was shown (guardDraft `rows`). 42 on Harborlight: 42 drafted, 42s, about $0.23 per run with the real API.
  The guard caught a model-summed total ($20,653) once; the prompt now forbids computing amounts.
- **Gervase.** Cooling is judged against the person's own rhythm (drift.js, `donor_scores.pattern`, On track);
  engagement counts peer-to-peer pages, tickets, auction bids and memberships; the ask beside "monthly giving" is
  monthly and sized from annual giving, and a step-up needs Room to give. Seed: gifts older than 30 days are thanked.
  Open: his lifecycle tag reads "Recaptured" though he gave every year; Dashboard's `section: "sequences"` link lands
  on Overview (Communications reads only `subtab`).
