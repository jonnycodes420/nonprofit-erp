# BLOCKED — BUILD-91 (the QuickBooks remainder)

Revised brief of 21 September 2026. Parts 91a, 91b and 91h had already shipped
under BUILD-92; 91c/91d/91e belong to BUILD-93 Part 4 and were not touched here.
What is left is 91f, 91g and 91i. Two of the three are blocked, and the brief
itself says to stop rather than guess at either.

## 1. 91f — QuickBooks Online, reading. BLOCKED ON THE INTUIT KEYS.

`QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` are not set for any environment this
build can see: not in the shell, not in a `.env` (the repo has only
`.env.example`, which names neither), and there is no prior mention of Intuit
anywhere in the source beyond a matching-gift employer name.

The brief's own instruction for exactly this case:

> If `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` are not set for the environment
> being built against, write one line in `BLOCKED-build91.md` and stop this
> part. Do not build the OAuth flow blind.

So nothing of 91f was built. No adapter file, no callback route, no migration,
no tile. Refresh-token rotation and realm-ID storage are the two things that
kill a QuickBooks connection silently when they are guessed at, and neither is
verifiable without a sandbox company to authorise against.

**To unblock:** developer.intuit.com → create an app named Steward with the
Accounting scope, then hand over the *development* Client ID and Secret. The
redirect URI is reported back in the first commit of 91f, not before it: the
callback path is fixed in that commit and it is not useful to invent one now.
Production keys need Intuit's questionnaire (live Terms and Privacy URLs, host
domain) and then go on Railway under the same two names.

## 2. 91g — QuickBooks Online, sending. BLOCKED BEHIND 91f, BY THE BRIEF.

> Does not run until Jonathan has walked 91f on the sandbox and says go. It
> writes to someone's books.

91f does not exist, so there is nothing to walk and nothing here to say go to.
Not started. This is the one part of the whole product that writes to a system
Steward does not own, and it is correctly the last thing built, not the first.

## 3. 91i — the landing logo row. BUILT, AND ITS ALLOWLIST IS EMPTY ON PURPOSE.

Built and not blocked, but it ships showing no direct source at all, because
the brief's three conditions are met by none of them today. See section 4.

## 4. WHAT 91i NEEDS FROM JONATHAN BEFORE ANY LOGO APPEARS

The rule, verbatim: a source appears in the public row only when its adapter is
merged and green, **and** Jonathan has walked it on a real account on prod,
**and** its row in `SOURCES.md` is marked as cleared by him.

| Source | Adapter merged + green | Walked on a real account | Row cleared | In the public row |
|---|---|---|---|---|
| PayPal | yes | **no — reads zero, no real payment seen yet** | no | no |
| Zeffy | yes | no | no | no |
| Stripe | yes | no | no | no |
| Givebutter | yes | no | no | no |

PayPal is the closest and is still short by two. The connection authenticates
and returns nothing, which is not evidence that the mapping is right — it is
the absence of evidence either way. The brief's own NEEDS JONATHAN item 4 is
the fix: send the business account $1 from a personal one, press Check now a
few hours later, and confirm it shows once at $1.00 gross with the fee beside
it. That is the first time the PayPal mapping touches real data.

Until then `SOURCE_ROW_ALLOWLIST` in `shared/publicSources.js` stays `[]` and
the public page claims no direct connection to anybody.

## 5. NO LOGO FILE IS IN THE REPO, AND THAT IS ALSO DELIBERATE

`client/src/assets/sources/` now exists and holds `SOURCES.md` — one row per
source, with the brand-page URL to read and a `Cleared` column that is `no` for
every one of them. No image was fetched, drawn, traced or recoloured. A source
with no cleared logo shows its name in type, which is every source today, so
the row renders entirely in type and nothing is riding on somebody else's
trademark terms.

Intuit's brand terms are the strict one and are not yet relevant, because there
is no QuickBooks adapter to put a tile behind.

## 6. ONE COPY OVERLAP THE ROW CREATES WHILE THE ALLOWLIST IS EMPTY

Jonathan chose the layered option: the existing prose lines stay, and only the
tile row is gated. That is the right call while the adapters are real and the
walks are not. It does mean that TODAY the section says this, in this order:

> **Statement upload:** Cash App and Venmo have no way to let software read an
> account. Once a month you drop the statement in.
>
> UPLOAD A STATEMENT
> [ Cash App ] [ Venmo ]

The names are said twice, because the only group with anything in it is the one
the prose already covered. It stops looking like duplication the moment the
direct group has a tile in it, which is the first walk. If the walks slip, the
fix is to trim the prose line to its explanation and let the tiles carry the
names — that edit also touches the BUILD-89S gate in
scripts/landing-prod-verify.js §7c which asserts the prose names both, so the
two move together or not at all.

## 7. TWO PRE-EXISTING REDS IN THE BATTERY, BOTH CLOCK-DEPENDENT

The full battery is 175 of 177 green. The two failures are **not** 91i's: both
fail identically with this build's work stashed, on the same freshly rebuilt
scratch stack. Both are the clock, and they are recorded here rather than left
for the next build to rediscover as a mystery.

### build89s-sources §9 — the sweep is told a date and does not use it

    FAIL  it is due TODAY - the payment is already five days past the date
          it was expected - "2026-09-21"

`sweepMissedRecurring` (server.js:2354) resolves the day it was given
correctly: `const day = today || orgToday(org)`. It then calls
`openMissedRecurringThread` **without passing it**, and that function
(server.js:2232) does its own `const today = orgToday(org)` and stamps the
thread's due date from the wall clock. So a sweep driven for 2026-09-20 opens a
thread due 2026-09-21.

The suite pins `today: "2026-09-20"` and asserts the due date equals it. That
assertion was true until the calendar passed the pin, which it did today. The
test is right and the product is wrong: this is BUILD-93 Part 1's own rule — a
date written for an organisation is the org's civil date — applied to a civil
date the caller supplied explicitly.

Production impact is narrow, because the scheduled sweep passes no `today` and
the two values then coincide. It bites the ops route and any backfill driven
with an explicit date.

**The fix is one line** — thread `day` through as the thread's `due`/`openedOn`
— and it belongs in BUILD-93 Part 1, beside the rest of that family, not buried
in a landing-page commit. Deliberately not applied here.

### build93-civil-date §2 — an assertion that names the defect by arithmetic

    FAIL  ...while the UTC day falls OUTSIDE it - the defect, named -
          {"wkStart":"2026-09-21","UTC":"2026-09-22","wkEnd":"2026-09-27"}

The gate demonstrates the bug it guards by requiring the UTC day to fall
outside the org's week window. The window is 21-27 September and the UTC day is
the 22nd, which is inside it. The assertion can only hold when the org's civil
today is the LAST day of its own week window and UTC has already rolled past
it — one evening in seven.

So this suite is green on some days and red on others, whatever the code does,
which makes it a worse guard than the thing it is guarding. The subject is
worth keeping; the assertion needs pinning to a constructed clock rather than
synchronised to the real one, which is the standing rule for clock-dependent
goldens in this repo. Also BUILD-93's, not 91i's.
