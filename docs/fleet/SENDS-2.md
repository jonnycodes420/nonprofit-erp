# SENDS-2 · For the fleet

**Surfaces changed:** Volunteers → Schedule → To send (nothing ticked; Select all; the send list dialog; Older drafts;
the rule under the list). Communications → Drafts to review → Send all reviewed (opens the send list dialog).
Auctions → an auction's winner drafts → Send all (opens the dialog). Recurring giving → Not yet connected → Send
reconnect links (opens the dialog). Campaign editor → Send me a test (her own address in any case).

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Volunteers → Schedule → To send → Draft tomorrow's reminders now. Nothing is
   ticked and the button reads "Tick the ones to send". Press Select all: the button reads "Send N emails…". Press it:
   a dialog titled "Send N reminders?" lists every person with their address and subject, says "To A, B, C and N more.
   Each goes now.", and has an emerald Send. Press Cancel: nothing is sent (the drafts stay). Press it again, then Send:
   "N reminders sent." and the drafts leave the list.
2. **(Read only, Harborlight.)** To send never lists a "Reminder for tomorrow" whose shift is today or earlier. If the
   list has drafts older than 14 days they sit under "Older drafts (n)", closed; opening it shows them. The sentence
   under the list says the rule.
3. **(Needs a write.)** Off the happy path: open the send list for two people, then in another tab edit one of those
   drafts (or discard it), then press Send in the first tab. One sends; the other is named as skipped because it changed
   after you looked. Press Send again on the same list (reload and retry): nothing sends twice.
4. **(Needs a write.)** Communications → Drafts to review: mark two reviewed, leave one not. Send all reviewed opens the
   dialog with the two reviewed only, and a draft whose video link is broken is listed under "won't go" with why.
5. **(Read only.)** Read it → Send this one on a single volunteer draft still sends at once, with no list (one person,
   one press).

**What could have broken nearby:** every single-draft Send (Communications' per-draft Send, a task's email and thank-you,
Auctions' per-winner Send, Going out's held Send, a profile's held Send, receipts, pledge and dunning resends, the gift
started-not-finished note): each still mints exactly one confirm per press, and a second in one request is now refused,
so a "plan_required" answer on any of them is a defect. The volunteer reminder sweep (it now expires as well as drafts).
Org deletion (send_plans goes with the org).

**Needs a write:** 1, 3 and 4 in org_stagewalk. 2 and 5 read only.
