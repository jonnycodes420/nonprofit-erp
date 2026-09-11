# BLOCKED — the card-recovery work needs two things done in dashboards

Built 2026-09-11: the pre-failure half of the recurring recovery engine. Three
pieces — an expiry sweep, the network-updated handler, and the hand-off to a
human when the automation gives up. All three are live in code and pinned by
`tests/recurring-recovery.test.js` (29). Two of them cannot work in production
until something is changed outside this repo.

---

## 1. SUBSCRIBE `payment_method.automatically_updated` ON THE LIVE ENDPOINT

Steward now handles this event. **The production webhook endpoint does not
subscribe to it**, so the handler will never fire until you add it in the
Stripe dashboard (Developers → Webhooks → the Connect endpoint → add event).

This is the BUILD-62 class — working code wired to nothing — and it is visible
rather than silent on purpose: `stripeEvents.js` declares the event,
`tests/webhook-manifest.test.js` pins that the manifest equals the handler, and
`/health`'s `webhookSubscriptions` diff will report it **missing** until the
endpoint subscribes it. `scripts/check-webhook-subscriptions.js` prints the same
diff on demand.

**What it costs to leave it:** the expiry sweep will email donors whose card
Stripe's Card Account Updater already replaced at the network. That is worse
than sending nothing — it invents a problem and asks the donor to fix it. Until
this is subscribed, treat the expiry notices as slightly over-inclusive.

## 2. CONFIRM WHAT THE CONNECTED ACCOUNTS ACTUALLY DO

Two dashboard settings change how much of this matters, and I cannot read them
from here:

- **Card Account Updater.** If it is on for your connected accounts, a share of
  expiring cards are replaced silently and never need an email at all. That
  makes item 1 above more urgent, not less — the updater working is exactly
  what the handler exists to hear about.
- **Smart Retries.** Steward runs its own dunning cadence — `[0, 3, 7, 14]`
  days — on its own clock. If Stripe's retry schedule is also active, a donor
  can receive a Steward email and a Stripe email about the same failure. Worth
  checking what the connected accounts are set to before anyone tunes the
  cadence.

---

## Decisions I made that are one line to reverse

- **The expiry notice rides the existing `recurring_dunning_enabled` toggle.**
  An org that turned off failed-card email almost certainly does not want an
  earlier version of the same email. If the two ever need to be separable that
  is one column, not a rethink. (`notifyExpiringCards`, server.js)
- **The warning window is this month and next.** A card dies at the end of its
  expiry month, so this is roughly 30–60 days of notice — enough to act before
  the next charge, not so early it reads as noise. (`expiringCardRows`)
- **One notice per card per expiry, stamped with the expiry period itself**
  (`card_expiry_notified_for = 'YYYY-MM'`) rather than a send date. A re-read
  cannot re-notify; a genuinely new expiry becomes eligible again by
  construction, because the period changed.
- **Re-read budget: `CARD_RECHECK_DAYS` = 7, `CARD_CHECK_BUDGET` = 200/tick**,
  sweeping every 6 hours. One Stripe call per subscription per week at most.
  Both are env-overridable.
- **The hand-off opens a THREAD, not a task.** BUILD-81 made the thread the
  spine — one open per donor, closed only by a logged outcome or a stated
  reason. Note there is also an opt-in workflow recipe
  (`failed_recurring_recovery`) that creates a *task* at the FIRST failure, if
  an org enabled it. Different moment, different mechanism; they do not
  collide, but if you would rather have one of them, say which.
- **The thread is due TODAY, not +N days.** By the time the cadence is
  exhausted the gift has been failing a fortnight; a default window would be
  the automation stalling twice.
- **The person-surface gate is copied from `openGiftThread` verbatim** —
  sample, deceased, do-not-contact and non-person records never get a
  hand-off thread. **Worth your eye:** BUILD-84 gave organisations a
  `contact_name`, so a foundation with a named contact is arguably callable
  now. That is a change to BUILD-80 Part 7's contract and I did not make it
  here.
