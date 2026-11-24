# UNDO-1 · For the fleet

**Surfaces changed:** a person's profile → Giving → a refund row's **Undo refund** (and its dialog); Recent changes (profile
menu, and the toast's "See all"): new lines for a refund ("Refunded $… of …'s $… gift. Reason: …", Undo refund asks why),
a task tick ("Ticked: …"), Home's or the profile's Mark done ("Marked done: …"), and a touch that closed a step ("Logged a
call with …; it closed the next step: …"); the **Log a touch** dialog (a "This closes the next step: …" box with Close it /
Keep it open); Events → a guest list after a registration; the audit log's refund lines.

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Give a person a $100 gift, Make receipt, then Refund → $100, reason "test". Open
   Recent changes: "Refunded $100 of <name>'s $100 gift. Reason: test" with **Undo refund**. Press it, type a reason,
   press Undo refund: "The $100 refund is undone. The $100 gift counts in full again. Receipt #… is live again." The
   profile's total and Giving list are back to $100, the receipt shows live, and the line has left Recent changes.
2. **(Needs a write.)** Same, but undo from the gift list: the refund row's **Undo refund**. Press it with the reason
   empty: "Say why the refund is being undone." Then a second click on a refund already undone: "That refund was already
   undone."
3. **(Needs a write.)** Put a person in a one-step journey (Journeys → a journey with one step → add them). On the profile,
   Mark done on the step. Journeys → that journey: Completed went up by one. Recent changes: "Marked done: <step> for
   <name>." Press Undo: the step is open on the profile again AND the journey shows them In it again (Completed back down).
   Same with the task's tick on the profile's Tasks tab, then untick.
4. **(Needs a write.)** A person with an open next step "Call about the spring visit". Log a touch → Call, type a next
   step "Send the brochure". The dialog says "This closes the next step: Call about the spring visit." Choose **Keep it
   open** and save: the spring-visit step is still the open one and no brochure step was made. Log again with Close it:
   Recent changes reads "Logged a call with <name>; it closed the next step: Call about the spring visit." Press Undo: the
   spring-visit step is open again and the brochure step is gone.
5. **(Needs a write.)** Events → an event with a $100 ticket (5 places). Add a person to the guest list (invited), then
   Register them for one ticket. The ticket shows 1 of 5 taken and the guest shows registered, ×1 (not ×2). Register them
   for a second ticket: ×2. Delete the second ticket's gift on their profile: ×1, registered. Delete the first: back to
   invited ×1.
6. **(Read only, Harborlight.)** Settings → Audit log: a refund reads as one sentence with its reason, not a list of fields.

**What could have broken nearby:** the gift list's Refund and Delete (a gift with a refund, a registration gift);
receipts (void, reissue, year-end statements count live receipts); Home's Thread Done and its toast Undo; the Tasks page
and Calendar ticks (same /tasks/:id/complete); journeys' In it / Completed counts and their rows; Log a touch from Home's
moves, the Top 100 and the plan of care; event capacity ("n of m taken"), check-in and the guest list; Recent changes'
other lines (trash, skipped cards, bulk touches).

**Needs a write:** 1 to 5 must run in org_stagewalk, not Harborlight.
