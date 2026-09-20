# BLOCKED-build89a — what 89a could not close, and the one thing an operator must do

Written 20 September 2026, at the end of BUILD-89S 89a (giving sources: the pipe).

---

## 1. THERE WAS NO ENCRYPTION IN THIS REPO. THERE IS NOW, FOR NEW SECRETS ONLY.

89a's brief said credentials use "the same encryption already used for secrets
in the repo; if there is none, write BLOCKED-build89a.md and stop rather than
storing a key in plain text."

**There was none.** Searched for `createCipheriv`, `aes-256`, any cipher or
seal helper: nothing. Everything secret this product holds in Postgres today
sits readable:

| Column | What it is | Status |
|---|---|---|
| `gmail_connections.access_token` | a live Google OAuth access token | PLAIN TEXT |
| `gmail_connections.refresh_token` | a long-lived Google refresh token | PLAIN TEXT |
| `users.mfa_secret` | a TOTP shared secret | PLAIN TEXT (column exists, unused) |

Jonathan's decision, asked and answered before any code was written: build the
sealer with no plaintext path, rather than stop the build.

So `shared/secretBox.js` exists (AES-256-GCM, per-envelope HKDF, AAD bound to
the org id) and `giving_sources.credentials_sealed` carries a CHECK constraint
that **the database itself refuses a value that is not a sealed envelope**.
There is no fallback: with no key configured, `seal()` throws, the connect
route answers 503, and nothing is written. A missing key makes the feature
unavailable, never available-and-insecure.

**What this does NOT do: it does not retroactively fix the three columns
above.** Those are somebody else's build, and pretending otherwise would be
worse than the gap. The work is: seal on write, open on read, one migration
pass to re-seal existing rows, and a decision about what happens to a row that
cannot be opened after a key rotation. It is not large. It is not this build.

### THE ONE THING AN OPERATOR MUST DO

**`STEWARD_CREDENTIAL_KEY` must be set on Railway before any organisation can
connect a giving source.** At least 32 characters:

```
openssl rand -base64 32
```

Until it is set, `GET /giving-sources/providers` reports
`credentialsReady: false` with `credentialsProblem: "unset"`, and the connect
screen says so plainly rather than failing at the moment somebody pastes a key.

**Rotating this key orphans every stored credential.** There is no re-seal
path yet; a rotated key means every source must be disconnected and connected
again. Write that down before rotating.

---

## 2. REFUNDS ARE COUNTED AND NAMED, NOT REVERSED

The brief: use whatever refund path exists today, and if there is none, "skip
the row, count it in the run summary, and note it in the commit. Do not invent
refund accounting in this build."

**What exists today is not reusable here.** The Stripe webhook's full-refund
branch (server.js, `charge.refunded`) DELETES the gift row, its ledger stamp
and its receipt. On a giving-source path that is actively wrong: the provider
still returns the original payment as a completed row on every subsequent
sync, so the next run would re-create the gift it had just deleted, forever.

So 89a does this instead, and says so on the screen:

- a row that arrives **already refunded**, with no gift on file, is not
  written at all — money that came in and went back out is not a gift — and is
  counted as `refundsSkipped`;
- a row that reads refunded and whose gift **is** already on file is counted
  and **named** on the run summary (`refundsOnFile`: the gift id, the donor and
  the amount), so a human is told exactly which gift to look at rather than a
  number being quietly wrong.

**The follow-up build**, roughly in order: extract one `reverseGift(giftId,
reason)` that both the Stripe webhook and this path call; decide whether a
reversal keeps a tombstone row carrying the external id (it must, or source
dedupe re-creates it); decide what a partially refunded source gift means for
the donor's lifetime total. That is refund accounting and it deserves its own
brief.

---

## 3. WHAT 89a DELIBERATELY DID NOT BUILD

- **Webhooks from any provider.** Polling only, every six hours, plus "Check
  now". Zeffy's `payment.completed` webhook exists and is a later build.
- **Any write to any provider, ever.** The adapters are handed a read-only
  HTTP handle that refuses a non-GET; the single exception is PayPal's OAuth
  token POST, named in `READ_ONLY_EXCEPTIONS` and pinned by the suite, which
  also proves a PayPal *payout* POST is still refused.
- **A second importer.** A statement file is a preset on the existing mapper
  (89d), never a new path.

---

## 4. A PRE-EXISTING DEFECT FOUND WHILE WORKING, NOT MINE AND NOT FIXED

On every boot, against a clean checkout of main with none of this build's
changes present, the demo seed logs:

```
[seed] CRITICAL: demo seed failed (server continues): there is no unique or
exclusion constraint matching the ON CONFLICT specification
```

Confirmed pre-existing by stashing this build's work and rebooting: the line
appears identically. The server continues by design (BUILD-45's "seed failure
is not fatal" rule), so nothing is down — but the demo org's seed has not run
to completion on any recent boot, and nobody is being told. Worth ten minutes
from whoever owns the seed.
