# Needs Jonathan

Everything in this file **physically requires you**: a credential, a password, a
real customer's file or token, a payment, or a legal signature. Nothing else
belongs here — every other open question has been decided and the decision is in
the commit that made it.

One line each, with the exact click or paste. Replaces 53 `BLOCKED-*.md` files
(deleted 2026-09-25); every item below was re-checked against production that
day, so several long-standing asks are gone because they turned out to be done.

Historical `audit/BUILD-NN-FINDINGS.md` documents still cite the old
`BLOCKED-*.md` filenames. Those are dated records of what was true when they
were written and have deliberately not been rewritten; the live pointers in
source, tests and CI all name this file instead.

**Checked and already done — do not redo:** `ANTHROPIC_API_KEY`,
`STEWARD_CREDENTIAL_KEY`, `FOUNDER_EMAIL`, the three live Stripe price ids
(`/health.billing` = live, ok, checked), and the Vercel deploy token
(`VERCEL_TOKEN` + `VERCEL_DEPLOY_ENABLED=true`, job green).

---

**Where the items are (ARCH-1, 1 Nov 2026):** one file per brief in `docs/needs-jonathan/<BRIEF>.md`.
A build adds its own file and never edits another brief's, so this file no longer changes with
every build. When an item is done, delete its line (or its file, once it is empty).

To read the whole open list, newest first:

    node scripts/ci/needs-jonathan.js

Older code comments cite sections of this file by number (`NEEDS-JONATHAN.md §7`); those are
`docs/needs-jonathan/standing-7-….md` and the like.

