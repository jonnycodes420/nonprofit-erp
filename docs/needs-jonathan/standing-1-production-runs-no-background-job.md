## 1 · PRODUCTION RUNS NO BACKGROUND JOB, AND HAS NOT SINCE 23 SEPTEMBER

**`DISABLE_BACKGROUND_TICKS=1` is still set on Railway.** Every boot since
2026-09-23 04:10 logs `background ticks DISABLED`, including right now. No
sequence, digest, dunning run, pledge reminder, geocode sweep or recurring sweep
has fired in production since. (The incident was on the 22nd; the switch took
effect at 04:10 on the 23rd.) The incident fix it was applied for is
live and verified; the switch was never turned back.

It is left **off** deliberately — turning it on resumes email to real donors, and
that is your call, not mine. `RESEND_API_KEY` may also still hold the disabled
value (`RESEND_API_KEY_INCIDENT_BACKUP` still exists beside it, which is the
tell, and I cannot read either value).

**Do this:** follow `MANUAL-STEPS.md` §12 → "Restoring, once the fix is live and
verified" — read the backup value, set `RESEND_API_KEY` back to it, then
`railway variables --service nonprofit-erp --set "DISABLE_BACKGROUND_TICKS=0"`,
then confirm `/health` is ok and the boot log no longer says ticks disabled.
