# ONBOARD-4 Part B · For the fleet

**Surfaces changed:** Home → **Set up Steward** (the five-step guided setup; replaces "Getting set up" on Home for an
org in onboarding, and holds "Your first 30 minutes" as step 3); its step 2 **Bring your people** with three ways
side by side (Upload a file, Start from where gifts come in, **Send it to us**); /ops → Onboarding: the **Stuck**
column beside the board, the **Send it to us** list (Read the file, Load, Download), and the summary line's
"Stuck: N" renamed **Late: N**; the onboarding board's Paper gate now counts a completed close link; Home's
"Your moves" empty card now reads "Once your donors are in (the step above)".

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk, as an org in onboarding.)** Open Home. "Set up Steward" shows "N of 5 done" and
   the first step not done is open. Press **Skip for now**: the count adds "1 skipped for now", the next step opens.
   Reload: still skipped. Press **Skipped · Bring it back**: it opens again.
2. **(Needs a write.)** Step 2 → Send it to us → choose a small CSV of 2 people → **Send it to us**. The file shows
   Received and Being mapped, each dated; Ready for you to check and Loaded are not ticked. Donors: still nobody new.
3. **(Needs a write; super-admin on /ops.)** Onboarding → Send it to us: the file reads "The importer read 2 people and
   2 gifts of $…". Press **Load**: "Loaded as import imp_…". Back on her Home, the file reads Ready for you to check
   and Home sends her to "Does this match your old system?". Its totals equal the $ the importer read. Off the path:
   press Load a second time on the same row (the button is gone; a direct POST answers "already loaded").
4. **(Needs a write.)** Settings → Imports → that import → Undo. Home's file reads Being mapped again with "The load
   was undone." /ops shows the row as Being mapped (undone) with Load offered again.
5. **(Read only, /ops.)** Onboarding → Stuck: each row names its rule (Booked, no close link · Signed, no people ·
   People in, not checked · No call logged · File waiting), why, and "Your note to …". Open a note: Copy and Open in
   my mail; nothing is sent. The summary line says "Late: N" and the Stuck column its own count.
6. **(Read only, Harborlight.)** Harborlight is not in onboarding: Home shows no "Set up Steward" card.

**What could have broken nearby:** Home's first card for any org in onboarding (FirstWin, the totals redirect, Your
first 30 minutes now inside step 3); Settings → Account's "Getting set up" (unchanged, still the five stages); the
/ops Onboarding board for close-link orgs (Paper met from the close link's completion, signer = its contact); the
spreadsheet import (a new internal entry point, same job); ONBOARD-3's totals check now due for close-link orgs.
