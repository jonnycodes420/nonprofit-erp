## VOL-1 — Steward Volunteer (2026-09-28)

Steward already knew who volunteered and how many hours they had given
(BUILD-98, FIX-1). What it could not do is the job a volunteer coordinator
does every week: put a shift on a page, let people sign up for it, know who
turned up, and keep a waiver from quietly lapsing.

**The four nouns, and why they are four.** An OPPORTUNITY is a standing thing
to do ("Saturday harbour clean-up"); a SLOT is one dated occurrence of it with
a capacity; a SIGN-UP is one person on one slot; a SHIFT is hours that were
WORKED, which is the table BUILD-98 already had. A slot becomes a shift at
CHECK-OUT and never before, because a sign-up nobody attended is not hours
anybody gave, and a tool that counts it as hours produces a grant report that
is a lie.

**Capacity is decided by the database.** The failure mode of every volunteer
tool is a capacity that is advisory: twelve people confirmed for eight places,
four of them driving across town on a Saturday morning and finding out at the
door. Signing up takes a row lock on the slot and re-reads the confirmed count
inside the transaction, so two people pressing the button in the same second
cannot both take the last place; the second waits, re-reads, and is waitlisted
with the sentence that says so. Cancelling frees the place and promotes the
first person waiting in the same transaction. `slotState` in
`shared/volunteerShifts.js` is the one piece of arithmetic the public page,
the coordinator's screen and the route all read, so none of them can disagree
about whether a shift is full.

**The public page is the org's, and it is embeddable.** Its band carries the
colour and logo that `resolveOrgBrandTheme` already gives the receipt, the
portal and every donor-facing artifact, so a volunteer page cannot be the one
surface wearing a different brand. It frames (`frame-ancestors *`), like a
donation form. Signing up takes no account and no password, and it NAMES
NOBODY who already signed up: a volunteer list is names, addresses and
availability, and it is not public because the shift is.

**The volunteer's own page** is a magic link in its own family, deliberately
separate from the donor portal's: a volunteer is not a donor account, and a
link that opens a roster must never open a giving history. Thirty days,
because somebody signs up in September for a shift in October.

**Check-in** is a tablet at the door or a phone in your hand: tap a name to
check in, tap again to check out, and the hours are the difference, rounded to
the nearest quarter hour because nobody's day is 3.7166 hours. The hours are
dated THE DAY THEY WERE HERE, not the day the slot was planned for; those are
the same date almost always and different in the one case that matters.

**Waivers and background checks** are one table, because they are the same
shape: a thing done on a date that stops being true on another date. An expiry
is not a deadline. The warning is thirty days, not seven, because a background
check takes two to three weeks to come back, and the Thread step it raises is
addressed to the coordinator and phrased as the thing to do: "Book the next
background check for Bertie Delacroix", never "Bertie's check has expired".

**The volunteer coordinator role is a SECURITY boundary**, decided in
`auth.js` at the one place every authenticated request passes, reading the
LIVE role rather than the JWT's. It is an ALLOWLIST, matched on the first path
SEGMENT: a deny-list of money routes is a list somebody forgets to add to, and
the thing they forget is a donor's giving history. The first version used raw
string prefixes and `/volunteer` matched `/volunteers-of-other-things` — the
new suite caught it, which is the whole reason it exists. The roster read
strips the giving columns for that role, and the VOL-1 walk caught that the
ROWS were stripped while the summary sentence still said "and three of them
also give", which is a count of donors on a screen that must not have one.

**Nothing is sent that the org did not turn on.** Shift reminders are off by
default per org and the demo org never sends at all, proven both ways. An hour
milestone (25, 50, 100) writes a DRAFT into `milestone_drafts`, the table the
review queue already reads, and fires once.

**Two things that were the ENVIRONMENT, not the build,** and both cost real
time, so both are fixed rather than remembered: `scripts/build-local-dist.sh`
baked `:5601` into every dist, so a second worktree's browser legs talked to
the FIRST worktree's server and read its database — a fully working app
showing another build's data, with the walk failing on what looked like
product defects. It takes `API=` now. And `seed-demo.js`'s scratch-database
allowlist had grown one prefix per build family, so every new family met a
refusal that read as a product bug; it is one pattern, still incapable of
matching `postgres` or a Kingdom Builders database.

**The walk (`scripts/vol1-walk.js`, 75 checks at 1440 and 390)** drives the
public page, a real sign-up, the volunteer's own page on a phone, kiosk
check-in end to end, every part of the hub, Home, a record with both halves on
it, and the coordinator boundary through the real routes with the role
switched in the database and switched back. It taught the same lesson FIX-4's
did, for the second time: a walk that WRITES cannot pick "the first one" — its
second run met a kiosk tile already checked out and hung for thirty seconds on
what looked like a broken kiosk.

**What VOL-1 did not finish**, and is in the next brief rather than half-built:
the group sign-up has its route and its seed but no screen of its own (a
coordinator adds a group through the API or one person at a time); the
SignUpGenius/VolunteerHub/Wranglr import reads the new preset but the hub
still offers only the existing hours-import modal; and the reminder sweep is
driven by its admin route rather than by a timer.
