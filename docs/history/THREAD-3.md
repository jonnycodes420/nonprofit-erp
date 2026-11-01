## THREAD-3 · Nothing that needs a human slips (2026-10-07)

WIRE-1 left two next steps missing and two decisions for Jonathan. (1) A donor's or funder's own email, logged from a
connected mailbox, with no reply after one business day (Friday 3pm is due Monday 3pm, weekdays in the org's zone) opens
a "Reply to [Name]: [subject]" step (`processUnansweredMail`, type `reply`, hourly tick + every sync + `POST
/mailbox/run-replies`), or a task when the person already has an open step. Mail is told apart by `mailKind`
(shared/mailboxLog.js): automatic replies by their headers and subject, receipts by subject (never a Re: or Fwd:) or a
receipts@/billing@ sender, newsletters by List-Unsubscribe/List-Id/Precedence or a no-reply sender; everything else is
personal. A reply is an outbound email, or a call, meeting or email a person logged, written after it AND dated on or
after its day: the first version counted the seed's old history (written today, dated August) as a reply, which the walk
caught. Only the last 14 days count. (2) An event's no-shows open ONE `event_no_show` task (`tasks.event_id`, unique) and a
"Missed you at" draft per person with an email in Drafts (`openNoShowTask`, every door that marks a no-show). (3) Delete
and bulk delete are refused while a plan is live with "[Name] has a $X monthly plan. Cancel it first, or archive them
instead."; `donors.archived_at` takes a person off the Donors list and Groups and nothing else. (4) The calendar's
`recurring` type: one line a day from `current_period_end` forward, opening its rows; failed charges and cards expiring
this month one by one. (5) The Agent reads plans and documents (`agentObjects`), plan steps are never blank
(`describedPlan`, and the seed's two steps carry sentences). The Groups "Email this group" link was walked and already
works; no cross-screen link drops its target. Test `tests/thread3-human.test.js` (16). Map 157 / 58 / 7 to 163 / 55 / 4.
