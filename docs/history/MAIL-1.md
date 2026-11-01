## MAIL-1 · Email back on, no onboarding sequence, nothing until a donor file is in (2026-10-04)

Jonathan's decision, 4 Oct: the founder onboarding drip is off for good (he writes onboarding himself);
everything else is a green light, but an org gets no staff or donor mail until it has onboarded, meaning
its first real donor file is imported. One policy, `mailPolicy.js`, sorts every send into staff, donor,
account, billing, Jonathan or onboarding, and `orgMaySendEmail` and the Resend client proxy both ask it.
`orgs.onboarded_at` is stamped by the first committed donor-file import with a real donor
(`onboarded.js`, also the boot backfill) or by a super-admin's "Mark onboarded". Sign-in mail and mail to
Jonathan always go; Steward's billing mail goes before onboarding too (MAIL_BILLING_BEFORE_ONBOARDING=0
turns that off); demo orgs, Harborlight and the CREO fixture by id included, send only sign-in mail. The
inventory found staff notices, board packs, event tickets, waitlist offers, page links, portal changes,
fundraiser mail and the trial reminder reaching the provider with no org gate at all; each is now tagged
or gated. `sendOnboardingSequence` is deleted, the engine stops any leftover onboarding enrolment, and
the super-admin org panel gained an Email section (onboarded, donor-mail switch, domain and From, a test
send to your own address). The one setting for "nothing until the donor file is in" is
`MAIL_WAIT_FOR_ONBOARDING` (anything but 0 keeps the wait).
Part 3: the Communications hub says one sentence from the policy ("Email turns on once your donor
file is in." before onboarding, the From address after), and two send screens stopped printing raw
reasons. `scripts/mail-preflight.js` is a read-only check to run against prod before the real key goes
back on: each org's switch, demo, onboarded and what each family of mail would do, plus what would fire
when ticks resume. Leftover onboarding sequences are archived (paused, enrolments stopped) at boot, not
deleted, so the record of what was sent stays.
