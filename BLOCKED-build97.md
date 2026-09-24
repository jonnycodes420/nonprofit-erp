# BLOCKED — BUILD-97

Decisions this build could not make for itself, and the evidence for each.
Nothing here is guessed at: every item touches money, a donor communication,
or a public claim, which is the line the brief draws.

---

## 1 · `claude/BUILD-96.md` does not exist — Part 0 cannot be run as written

Part 0 says: *"Run `claude/BUILD-96.md` Parts 1 through 6 as written, in that
order."* That file is **not in the working tree and not in git history**:

```
$ ls claude/
BUILD-95.md  messy-2500-v2-fixture-key.md  messy-25k-v3-fixture-key.md
steward-customer-agreement.md
$ git log --all -- claude/BUILD-96.md     # (no output)
```

BUILD-96 was evidently handed over in a conversation rather than committed, as
this brief was. What CAN be reconstructed, and what was done about it:

| BUILD-96 part | Known from | State |
|---|---|---|
| Part 1 — the BUILD-95 record | commit `f3ed636` | **Done** before this build |
| Part 2 — sample data tagged, clear action, Home banner | named in BUILD-97 Part 0 | **Done in this build** (see the Part 0 commit) |
| Parts 3, 4, 5, 6 | **nothing** | **NOT RUN — their contents are unknown** |

**Decision needed:** paste BUILD-96 Parts 3–6, or say they are superseded.
Until then this build treats Part 0 as "the incident closeout plus the three
things BUILD-97 itself names", which is everything BUILD-97 quotes of it.

---

## 2 · Part 1 has no real file — the audit cannot be completed

*"Nothing else in this build matters until this part is green on a real
export."* No real export is in the repo:

- Justin's Place Salesforce reports — **not supplied**.
- Jonathan's own 444-row prospect org — not present locally as a file; it is
  referred to in the BUILD-84 record as a *production* org, and Part 1 forbids
  invented data as a substitute.

**What was built anyway, because it does not depend on the file:** the
Salesforce NPSP preset (`shared/npspPreset.js`) and a fixture built from NPSP's
documented export shape. The preset's `confidence` is
`documented-not-walked` and says so on screen.

**What is waiting:** `audit/BUILD-97-REAL-FILE.md` exists with every heading and
every figure marked `PENDING — no real file`. It is filled in, by hand, against
the first real export. **Do not treat the preset as proven until it is.**

**Decision needed:** the file. Ten minutes with a real export closes this.

---

## 3 · The Resend key stays out until Part 0 reports safe — and it now has

Per the brief: *"Restore the Resend key only after Part 0's incident closeout
reports safe."*

**Closeout status, read off production on 23 Sep (see `INCIDENT-2026-09-22-outbound-email.md`):**

- "F" identified — `org_52c91560`, and its twin `org_375ffb10` — **both marked
  demo + mail off.** ✅
- `org_creo` marked. ✅
- Both Justin's Place orgs marked; the dormant onboarding drip **deleted**, not
  merely disabled. ✅
- **Resend suppressions for the eight seeded addresses — NOT DONE.** The API key
  is deliberately invalid, so the Resend API cannot be called. This is the one
  item that genuinely requires the key back to complete, and it is
  belt-and-braces: every one of those addresses is now unroutable
  (`<local>@<provider>.example.com`, RFC 2606, no MX).

### THE THING THAT IS NOT SAFE YET, AND IT IS NOT THE SUPPRESSIONS

**3,514 addresses at real mailbox providers sit in seven orgs that still have
`emails_enabled = true`, and none of their donors are tagged `is_sample`.**

| Org | Real-provider addresses |
|---|---|
| Test1 | 1,249 |
| atkinson | 1,249 |
| 32 | 407 |
| Lit & culture | 303 |
| Poppy the pitty | 303 |
| Steward LLC (SALES) | 2 |
| Harbor Music School | 1 |

The donor-level gate does nothing for them — they are not tagged. Only the
org-level flag would, and they do not have it. **The moment the key comes back,
the pledge-reminder cadence that sent 319 emails over twelve days is armed
against these orgs.**

Five of those seven names read as fixtures. Two do not: **"Steward LLC (SALES)"**
and **"Harbor Music School"**. Marking a real customer's org `is_demo_org`
silences their mail, and that is not a call this build may make.

**Decision needed, per org, before the key returns:** fixture (mark demo + mail
off) or customer (leave on). `POST /admin/orgs/:id/email-switch` is the lever
and it is already built. The safe default while the answer is pending is that
the key stays out.

---

## 4 · `ANTHROPIC_API_KEY` on Railway — Part 3 does not run in production without it

Part 3's agent calls the model server-side. `server.js` constructs
`new Anthropic()`, which reads `ANTHROPIC_API_KEY` from the environment.

**Needed:** `ANTHROPIC_API_KEY` set on Railway → `nonprofit-erp` →
`production`, **with a spend cap**, as the brief itself asks.

Until it is set, the agent's routes answer `503 { error: "agent_unavailable" }`
by design — the same shape `/cheque/read` already uses — rather than failing in
a way that looks like a bug. Everything else in Part 3 (the plan, the guards,
the Activity screen, the undo, the pause) works without a key, because none of
it is the model's job.

---

## 5 · The ten real instructions in Allie's words were not supplied

*"Write ten real instructions in Allie's words before Part 3 starts. They are
the fixture and the product spec."*

Not supplied. The fixture was built from **the brief's own eight examples**,
which are the nearest thing to her words in hand, and they are marked in the
fixture as the brief's, not hers.

**Why this matters more than it looks:** the instruction fixture is what decides
which verbs the agent understands. Built from eight examples written by the
person specifying the product, it will be biased toward what the product can
already do. Ten sentences from the person who will actually type them is the
difference between a demo and a feature.

---

## 6 · Part 4 — every integration proof needs an account nobody here has

Nothing in Part 4 is code. Each item is a walked sync on prod with the figures
read back, and each needs a credential:

| Adapter | Waiting on | Date named in the brief |
|---|---|---|
| Zeffy | Laura's key | 29 Sept |
| Square | Allie's token | the second visit |
| QuickBooks (91f/91g) | Intuit keys | — |
| PayPal | the $1 walk | — |

`STEWARD_CREDENTIAL_KEY` must also be set on Railway before any source
credential can be sealed (carried over from BUILD-89S; still open).

---

## 7 · Still open from earlier builds, and still unanswered here

- **`BLOCKED-build87.md` P3-1** — who receives inbound donor mail, and the DNS
  that points at them. A new subprocessor and an MX change; untouched.
- **`STEWARD_CREDENTIAL_KEY` on Railway** (BUILD-89S) — no giving-source
  credential can be sealed until it is set.
- **`GEOCODIO_API_KEY` on Railway** (BUILD-84) — without it the donor map has
  no pins. Cosmetic beside the rest of this list, and still not set.
## 8 · One refusal field, two refusal columns — a decision about contacting real people

Found building the NPSP preset, and it is not Salesforce-specific.

NPSP's Contact export ships **both** `Do Not Contact` (`npsp__Do_Not_Contact__c`)
and `Email Opt Out` (`HasOptedOutOfEmail`), and they are **different people**:
one asked the organisation to stop entirely, the other asked it to stop
emailing. Steward's CSV donor import has **one** such field (`doNotContact`),
and `buildAutoMapping` gives a target to exactly one column, so the second
column's people import as reachable.

**Two things were done, and one was deliberately not:**

- **Done:** `Email Opt Out` is now *recognised at all*. It was not — the
  anchored `DNC_HDR` pattern wanted the whole header to be "opt out", and no
  `CSV_FIELDS` label matched either, so the column was silently unrecognised and
  every donor in it imported as reachable. That is the BUILD-58 Part 2 class,
  one spelling wider, and it would have shipped with the first real Salesforce
  file.
- **Done:** when a file carries two such columns, the mapper says so on screen,
  names both, and says what the consequence is — "anyone marked only in
  *Email Opt Out* will import as reachable — check that column before you send
  anything."
- **NOT done, deliberately:** making the flag field the **OR of several
  columns**. That is the right fix, and it needs a decision this build may not
  make for itself: which refusal outranks which, and whether an org that marked
  somebody "do not email" but not "do not contact" should be reachable by post.
  Guessing it silences people who did not ask to be silenced, or mails people
  who did.

**Decision needed:** should a donor flagged in *any* recognised refusal column
import as `doNotContact`? The conservative answer (yes — the union) is probably
right and is one line, but it is a decision about contacting real people, so it
is written here rather than taken.

`do_not_call` is already excluded from that union on purpose, and stays
excluded: it blocks the **phone**, and folding it into a flag that blocks email
would silence people who only asked not to be rung up.

