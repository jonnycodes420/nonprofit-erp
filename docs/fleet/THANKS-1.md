# THANKS-1 · For the fleet

**Surfaces changed:** a person's profile → Giving (the column headed **Thanked**, was "Ack", shows ✓ only for a thank-you;
the receipt stays in its own Receipt column; the gift form's box is now **Thanked**, was "Acknowledgement sent"), the
profile's timeline (a gift's line says "Receipt issued, not thanked yet. Receipt #… issued." when that is the truth; no
"Gift removed" note after a delete), the profile's
**Next move** panel after a second gift, **Delete gift** (one dialog), Recent changes (a "Removed <name>'s $… gift of
<date>." line with **Undo**), **Record a gift** (Donors and the profile: a new "In honor or in memory of someone" link and a
line about posting to the books), Finance → Waiting to post (its definition), Reports → Report builder's **Thanked**
column, Home's "gifts not yet thanked", the thank-you task's dialog, Ask ("who gave over $500 but hasn't been thanked"),
the gifts CSV export (a **Thanked** column beside "Acknowledged (receipt or thank-you)").

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk, with tax receipts on in Settings.)** Record a $300 gift for a made-up person. On
   Giving, press **Send receipt** on that row. Right: the row still says "Not yet" under Thanked and "Receipt #… ready"
   under Receipt; the profile's Thank-yous count and Home's "gifts not yet thanked" both still count it; the
   thank-you task (if one opened) is still open. Then mark it thanked (the task's Done, or Thank-yous → mark): ✓.
2. **(Needs a write.)** Off the happy path: Edit that gift, un-tick **Thanked**, Save. Right: "Not yet" again, and the
   receipt line is still there (the receipt was not taken back).
3. **(Needs a write.)** Record a $25 gift, then **Delete** it. Right: one dialog ("Delete this gift?" … "Recent changes
   keeps an Undo for 30 days. Nothing is added to their timeline."); after it, the timeline has no "Gift removed" line
   and the totals drop by $25. Open Recent changes: "Removed <name>'s $25 gift of <date>." Press **Undo**: the gift, the
   total and its thank-you task are back. Press Undo again from a stale tab: "That gift was already put back."
4. **(Needs a write.)** A gift with a receipt made and never sent → Delete: "Receipt #… was generated but never sent;
   it will be voided." → **Void and delete**. Same with a receipt emailed to the donor: "…was sent to the donor; it will
   be voided and they won't get a new one."
5. **(Needs a write.)** A person with one gift 40 days ago; record a $25 second gift today. Right: Next move reads
   "Next: thank <first name> for the $25 gift on <date>." Mark it thanked: "Nothing due for <name> right now." with the
   reason on its own line (never a bare "Nothing due" with no why).
6. **(Needs a write.)** Donors → Record a gift → "In honor or in memory of someone" → In memory of, pick a person → Save.
   The gift carries the tribute. Type a name without picking one: "You typed … but did not pick one."
7. **(Read only, Harborlight.)** Reports → Report builder → Gifts with the Thanked column; filter Thanked = No. The count
   matches Home's "gifts not yet thanked" for the same period.

**What could have broken nearby:** every thank-you list (Home's Thread, the dashboard's thank-you bucket and "$250+ needs
a tax receipt" bucket, Thank-yous backlog, letters and labels), Atlas's "mark gift thanked" and its Undo, the approval
queue's thank-you draft and its reopen, the task thank-you dialog and its Undo, Ask's thanked filters, the weekly
activity's "Thank-yous marked sent", year-end statements and receipt void/reissue, refunds (a gift refunded in full still
reads "Refunded, no thank-you needed"), the gift delete with refunds ("Delete the gift and its refund" has no Undo), event
registration gifts (delete then Undo: the guest list stays as it is and the answer says so), Finance's waiting-to-post.

**Needs a write:** 1 to 6 must run in org_stagewalk, not Harborlight. Note org_stagewalk has tax receipts off; 1, 2 and 4
need them on there.
