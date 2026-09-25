# BLOCKED — BUILD-95

## 1. Square has never seen a real payload (§5A)

`sources/square.js` is written against Square's published API reference, read
22 September 2026. Confirmed from the docs: the base, the auth header, the
pinned `Square-Version`, `GET /v2/payments`, cursor paging, and — the one that
matters most — that **amounts are in MINOR UNITS** (`amount_money.amount` of
250 is $2.50). Getting that wrong is a 100x error on a giving total in the
direction nobody notices until year end, so it is asserted first in the suite.

**Not confirmed, because the reference cannot be exercised without a live
account:** whether a donation taken through Square's own "Donations" item
surfaces any field that distinguishes it from a lesson fee. Until a real
payload says otherwise, the location/phrase gate is the answer, and it refuses
to import anything until a human sets it.

**The ten-minute walk that closes this:** one production access token on a real
Square account with at least one donation and one non-donation in the last
week. Connect it, press Test, and read what comes back. If Square does surface
a distinguishing field, `FIELD_MAP` gains one line and the gate becomes a
default rather than a requirement.

**Square is NOT on the public allowlist and must not go there** until a real
dollar has come out of a real Square account — `shared/publicSources.js`
mirrors it structurally and `PUBLIC_SOURCE_ALLOWLIST` stays empty. That file's
own header uses Square as the cautionary example, which is now literal.

## 2. Zeffy still has never seen a real payload

Unchanged from `BLOCKED-build89c.md`, and it matters more now that partnering
on Zeffy has been raised. Zeffy's public API is **six endpoints, all GET** —
re-confirmed 22 September 2026 — so Steward can never process a payment
through Zeffy, only read one. A Steward giving page on a Zeffy org therefore
means **our page wrapping their embedded form**, which works because Zeffy's
embed deliberately strips their own description, images, logo and name.

**And the division of labour on recurring has to be said out loud before any
partner is promised anything:** Zeffy runs its own dunning — 4 to 5 retries
about four days apart, a donor email with a self-service card-update link each
time, and auto-cancellation if they all fail. Steward cannot retry a Zeffy
card and must not imply it can. What Steward can do, and what Zeffy does not,
is tell the ORGANISATION that a three-year monthly sponsor was quietly
cancelled. **Zeffy recovers the card; Steward recovers the relationship.**

**What is needed:** one real Zeffy API key, or a scrubbed export.

## 3. Cheque reading has never run against a real photograph

`scripts/build95-cheque-drill.js` exists and has never been run against
anything but the fixture. Everything the reading is supposed to do — read a
handwritten amount, read the written-out words, and **refuse when the two
disagree** — is asserted against synthetic input only, and handwriting is the
single thing a fixture cannot honestly stand in for.

Until the drill has run, `claude/BUILD-95.md` says **"reading unproven"**, and
that line stays there regardless of how green the suite is.

**What is needed:** three real cheque photographs, photographed the way a
treasurer would actually photograph them — on a desk, in ordinary light, at an
angle, one of them handwritten badly. Not scans, and not three that are all
easy. Then:

```
ANTHROPIC_API_KEY=sk-ant-… node scripts/build95-cheque-drill.js a.jpg b.jpg c.jpg
```

Record **what came back beside what was actually written**, including whether
the figures and the words settled. The interesting outcome is not "it read
them" — it is what it did with the one it could not read.

A real cheque is a real donor's name, account number and signature. Use three
from an organisation that has agreed to it, or three written for the purpose,
and do not commit the images.

## 4. `ANTHROPIC_API_KEY` is not on Railway (BUILD-96 Part 3)

Both model features — cheque reading and the BUILD-97 agent — are off on
production, and fail absent rather than broken: the deposit sheet still
photographs the cheques, and the agent box on Home says "Not enabled for this
organization yet."

**What is needed:** the key, **and a monthly spend cap set in the Anthropic
console before it goes live.** The deposit sheet accepts twenty photographs in
one press, so an unbounded key is an unbounded invoice. Full recipe in
`MANUAL-STEPS.md` §13, including the notice obligation for orgs that were
already on Steward when it is switched on.

## 5. The two asks, in one sentence each (BUILD-96 Part 4)

Zeffy and Square both have merged, green adapters that have **never seen a real
payload**, and there is an organisation in the pipeline for each. Until one
real account has synced, both stay off the public allowlist
(`shared/publicSources.js`, still empty) and both show in-app as *"Available,
being verified with a first organization."*

**Ask Laura (Hooves of Hope — Zeffy):** for a read-only API key from her Zeffy
account, which an admin copies from Settings → Integrations → API.

**Ask Allie (Justin's Place — Square):** for a production access token from her
Square account, and for which of her Square locations (or which item name)
counts as a donation, because Square is a point of sale and the same row shape
carries a lesson fee and a gift.

Each is one screen and about two minutes at their end. Neither can be
substituted with a sandbox: a sandbox confirms the password was accepted and
tells us nothing about whether the mapping is right, which is the whole
question.

**When one comes back:** connect it, press Test, read the first payload against
what the provider's own dashboard says the money was, and only then mark its
`SOURCES.md` row and add the key to `PUBLIC_SOURCE_ALLOWLIST` — in that order,
never any other.

**And for Laura specifically:** Steward will not send her donors reconnect
links, and her Recurring screen says so in one line. Zeffy runs its own
dunning — 4 to 5 retries about four days apart with a card-update link each
time — so a Steward link would land in the same inbox about the same card.
Zeffy recovers the card; Steward recovers the relationship, by telling her a
three-year sponsor was quietly cancelled, which Zeffy does not.

## 6. Where did the horse come from? (BUILD-96 Part 6)

**One question, for Jonathan only: was the reference bitmap you supplied for the
horse your own image, or did it come from a stock library or a web search?**

The motif is a single SVG path traced from that bitmap. The bitmap and the
tracing script were never committed — they lived in a scratchpad — so the file
is gone and nobody can inspect it. Tracing does not make it new work: a
silhouette traced from a photograph is a derivative of the photograph.

**This is not hypothetical.** `orgs.welcome_motif` is `horse` on
`org_justinsplace`, which is a REAL organisation. The greeting is armed and
draws the herd the first time Allie signs in. BUILD-96 did not disable it —
that greeting is hers and this build was told not to touch her org — so the
answer is needed BEFORE she signs in, not after.

Recorded in `docs/ASSETS.md`, whose row stays open until it has his initials.
