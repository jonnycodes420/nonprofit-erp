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
