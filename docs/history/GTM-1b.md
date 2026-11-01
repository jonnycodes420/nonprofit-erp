## GTM-1b — after they sign up (2026-09-27)

**Growing past your band is a conversation, not a surprise.** Steward counts active donors after
every import — the count is `pricing.json`'s own sentence in SQL, a distinct non-deleted donor with
a gift *or* a logged conversation inside twenty-four months — and compares it to the band the org
pays for. Over it, one notice is recorded, the admin is told in the product and by email, and the
date attached is at least thirty days out. **It never writes `orgs.plan`, never calls Stripe and
never changes an amount.** That is the whole promise, and it is what the build's one new test
guards; the test was watched go red twice, once with the notice quietly bumping the plan and once
with the thirty days cut to seven.

A second import that finds the same band is the *same* notice — it does not restart the clock or
send a second email. Falling back inside the band withdraws the notice rather than leaving a
warning standing that is no longer true. Dismissing hides the banner and keeps the notice: a price
change somebody has been told about cannot be un-told by closing a card. A legacy Core/Team/Founding
org has no band in the new catalogue and is never measured against one — those organisations bought
a price that was never sold by size, and inventing a band for them would be inventing a bill.

**The Agent's free thirty days allow twenty-five plans.** A paid model on somebody else's key with
no ceiling is an invoice waiting to happen. The unit is the PLAN — the instruction she wrote, which
is the unit she thinks in — counted per org for ever, not per day, and a plan she wrote and deleted
still counts, because it was still a model call and refunding on delete makes a cap advisory. The
check sits ABOVE `agentBuildPlan`: a refusal after the model has answered has already spent the
thing the cap exists to prevent. The cap lifts entirely at `subscription_status = 'active'`.

**Before the import, the Agent shows itself on Harborlight.** An org with no donors opened the
Agent to an empty room and a prompt to write an instruction about nobody. It now shows a worked
example on the demo organisation: real rows read live (so the example cannot drift from what the
demo contains), no model call at all (so the tour costs nothing and spends none of the allowance),
and labelled as Harborlight's by the route rather than by copy a page could forget to render.

**The start page.** The first thing after signing up is a choice, not a form: bring your file, or
look around. Both doors are the same size because both are real answers — an ED who has just put a
card in and wants to see the thing work before hunting for her spreadsheet is behaving sensibly.

**Founding partners keep their $50 on any band.** It used to be a PRICE, and a price cannot follow
an org that grows: the day a founding partner moved off it they would lose what they were promised.
It is a Stripe coupon now (`Gv9E1KkK`), applied at checkout, backfilled from `plan='founding'`.

**The sidebar folds.** 240px to 64px, icons kept — a rail, not a disappearance. Remembered per USER
(the localStorage key carries the user id, so two people sharing a laptop do not fight over it),
⌘\ toggles it, and the panel button says the shortcut so it is discoverable from the button.

**The defect only the browser caught:** the "More" disclosure is a word with a chevron, and 64px of
rail truncated it to "MO…". A rail that is only icons cannot carry a heading, so collapsing now
shows that group's items inline as icons. `navMoreOpen` is untouched, so expanding returns the
sidebar to exactly the state it was left in.

Battery: 38 suites, 0 failed, browser legs running.
