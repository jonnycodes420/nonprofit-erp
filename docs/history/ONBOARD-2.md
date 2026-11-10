# ONBOARD-2 · The onboarding board, connections, kickoff and the first month (9 Nov 2026)

A customer counts when they are billing, and the stretch from a yes to billing is onboarding. Nobody
could see where each deal was stuck (one at paper, one with files in and no kickoff, one at paper,
one waiting on features). This build makes the stretch a board, from signals alone.

- **Five gates, read never set** (`server/onboard/stages.js`, pure). Paper (`orgs.paper_done_at`,
  ONBOARD-1), data in (`orgs.data_in_at`, ONBOARD-1), connections (Stripe's own `charges_enabled`, asked
  by the worker; a giving page live with the org's logo; each source named at setup connected, a
  statement source such as Cash App counted as "statement monthly"), kickoff (the champion signed in,
  opened Home, and logged a call from a move: `interactions.metadata.from_move`), the first month (a
  gift not from an import or sample data, and a paid invoice on an active subscription). The stage is
  the first gate not met. The only hand-typed facts are the verbal-yes date and "Waiting on".
- **Windows on their own clocks.** Paper over 3 days from the verbal yes, data over 10 days from paper,
  kickoff over 7 days from data in, day 14 from data in with no first gift, a failed payment. The walk
  found the first version counting kickoff from when connections finished, so a deal whose files were
  in 9 days read "Kickoff 0 days" and not late; the windows and the Days column now share one clock.
- **Stored by one writer.** `org_onboarding` (stage, entered_at, blockers, flags) is written only by
  `board.recompute`, every 15 minutes on the worker and after a signal this build owns. The board reads
  live. A stage in POST /ops/onboarding's body is ignored; the planted defect (`ONBOARD2_PLANT=manual`)
  honours it, and `tests/onboard2-board.test.js` §6 goes red.
- **Red is brass.** The brief says red; CLAUDE.md says overdue is brass and red is only a destructive
  confirm, so a late deal is a brass "late" and "Past its window".
- **Jonathan's morning line.** No morning email to Jonathan existed. `board.sendMorning` sends one, once a
  day after 7 AM New York, to `FOUNDER_EMAIL` through `opsAlert` (the mail block applies), only when a
  first-month flag exists. Nothing goes to the customer.
- **The BUILD-90 day-minus-7 reminder** covers start-link orgs: ONBOARD-1's checkout sets
  `subscription_status='trialing'` and `stripe_subscription_id`, which is what `processTrialReminders`
  selects, and it names the custom price. A $0 start link has nothing to charge and no reminder.
