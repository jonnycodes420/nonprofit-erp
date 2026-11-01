## CHECK-2 · Checks land on the right donor, from anywhere (2026-10-23)

Jonathan, prod, 21 Oct: a joint check from "HENRIETTA M. DUFFIELD / GEORGE A. DUFFIELD" for $2,500, memo "Gala - in
memory of Walter", made a new donor in capitals with "Thank you for your first gift", dropped the tribute and George,
while Harborlight already had Henrietta Duffield (4 gifts since 2023, $153,117) among 27 Henriettas. Cause: capture
matched only an exact full name, and with no match the card defaulted to a new person. Built: `donorMatch.js`, the one
matcher (email; names against the same last name only, with initials and nicknames; spouse and household; street or
ZIP), which IMPORT-3 calls too; "New donor" is a choice, never the default; proper case for names read in capitals;
tributes and "pledge pmt 2 of 4" from the memo; `gifts.memo`; `orgs.joint_gift_credit` (first name on the check, or
the household's primary contact), with the card saying who got what. The bank-account fingerprint was not built: it
needs the MICR line read and a hash a server key can reverse by trying every number. Part 3: one check window
(`CheckSnap.jsx`) from the mic window, Home's tile, the profile's Giving tab, the phone's Check tab and a drop on any
page; one thank-you draft list (`ThankYouDrafts.jsx`, GET /thank-yous) in Communications, the profile's Emails tab and
Acknowledgments, and "Read and send it" opens that draft. Part 4: timeline and Thread dates read "Fri, Oct 23" at the
one write path; the calendar drew a written-up meeting AND its "Met" line (and a twice-written meeting twice), so a
written-up meeting now folds its write-ups in and `closeMeeting` links a memo to it; "N more" opens the day's list; an
org that is a demo only by its name "(Demo)" is now a demo org to the mail gate and the sweeps. check2-match failed on
main (13 passed, 21 failed); fix28-calendar-rule and incident-mail-gate were extended, each red on main. Seed unchanged.
Found, not fixed: a refused pledge reminder never advances its step, so it retries hourly; the seeded Hollis Tran card
still says "confirming adds them".
