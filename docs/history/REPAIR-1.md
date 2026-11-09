# REPAIR-1 · rows written before a fix keep the old state until something repairs them

The 8 Nov fleet repeated five fails whose code fixes had shipped the day before (SENDS-1, STALE-2, PLEDGES-2). The fixes changed how new rows are written; the rows already on CREO were written before them, and every repair script skipped org_creo. So a fix that only stops new bad rows does not close an item whose bad rows already exist.

The demo tidy (the one script allowed to write org_creo) gained steps 6 to 10, each applying a shipped rule to the rows as they stand, journaled and undoable: send switches under an Off master, sequences that can't be Active or carry another kind's trigger, duplicate thank-you tasks, attendance lines that no longer match their guest, and pledge installment flags from before the oldest-due-first relay. `scripts/ops/repair1-all-orgs.js` runs steps 8 to 10 everywhere else.

The 8 Nov `--apply` also crashed after committing steps 1 to 5: loading the app for recordGift needs JWT_SECRET, which the script's shell didn't have. The script now makes a throwaway secret for that process, and step 4 records any plan payment that is missing, joined to the run that made the plan.

Reproduction on a production build (NODE_ENV=production, the built client) found four of the five on screen. The fifth, Home saying "Steward is sending journey steps for you" while email is Off, did not reproduce: with the master Off, Home already says "sends nothing" on current code.
