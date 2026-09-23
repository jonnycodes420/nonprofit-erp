# INCIDENT — production sent real email to invented people

**22 September 2026. Written up overnight 22→23 September.**

Three messages left Steward and reached real mailboxes. Two went to a real
prospect eight hours before anyone meant to contact her; one went to a stranger
who happens to own an address a fixture made up.

---

## WHAT WAS DELIVERED

Read off the Resend sending log (8 Sep – 22 Sep window), which is the whole
recent sending history of the account.

| To | Subject | Status |
|---|---|---|
| `levi.johnson88@yahoo.com` | A quick reminder about your pledge to F… | **Delivered** |
| `hello@justinsplaceky.com` | You just made a great decision for your mission | **Delivered** |
| `hello@justinsplaceky.com` | Week in Review — Justin's Place | **Delivered** |

**Attempted and caught by Resend's own suppression list** (not by Steward):
`dmitri.green27@icloud.com`, `denise.nolasco72@aol.com`,
`austin.kane39@hotmail.com`, `laura.vanterpool76@aol.com`,
`nathan.devereaux79@twc.com`.

Steward attempted eight pledge reminders. Five were stopped by the *provider*.
That is luck, not a control, and it is the reason this reads as three delivered
messages rather than eight.

The pledge-reminder subject renders `{{org_name}}`, and the truncated subject
begins **"…pledge to F"** — so those reminders did **not** come from Justin's
Place. They came from another org whose name begins with F, which does not
exist in this repo and was therefore created directly on production.

---

## WHAT SENT EACH ONE

### 1 · The pledge reminders — `processPledgeReminders()`, `server.js`

Hourly tick, five seconds after boot. Step 1 scans **every org** (`SELECT id,
timezone FROM orgs`, unfiltered) and starts a dunning cadence on any open
pledge past its due date. Step 2 selects `pledges JOIN donors` with **no
`is_sample` filter**, and sends.

### 2 · "You just made a great decision for your mission" — `sendOnboardingSequence()`

Fired from **`POST /auth/register-org`**. Step 0 of the founder drip has
`delay_days: 0`, so it goes immediately. Allie's organisation was *provisioned*
through the same door a member of the public would use to *sign up*, and the
route could not tell the two apart.

### 3 · "Week in Review — Justin's Place" — `processDigests()`

Tick every **five minutes**, thirty seconds after boot. There is a suppression
for an empty week — but the org had 122 invented gifts in it, so the week was
not empty. It composed and delivered a full staff digest whose every figure was
fiction, to the prospect.

---

## THE ROOT CAUSE

Three messages, three different send paths, **one shape of mistake**.

`donorMailDecision()` is the single function every donor-facing send passes
through. It already knew how to refuse on behalf of a person — deceased,
hard-bounced, unsubscribed, do-not-contact, suppressed. **It had no concept of
a person who does not exist.**

The product already believed the rule. `getDraftFor()` has carried
`if (d.is_sample) return null;` — *"demo fiction never generates work"* — since
BUILD-83. Fiction was stopped from generating **work** and never stopped from
generating **mail**.

And there was no org-level answer at all: no way to silence one organisation
without silencing every organisation. On the night, the only available lever
was the Resend API key itself.

### The systemic half

Almost every seeding script wrote rows with **no `is_sample` flag whatsoever** —
`seed-build72-demo.js`, which writes `status='open'` pledges with due dates,
tagged nothing. Only `db.js`'s built-in seed and `POST /org/load-sample-data`
ever tagged anything. To the mail engine, a seeded donor was an ordinary
customer.

Separately, the fixtures carried **743 addresses at real mailbox providers**
across `steward-messy-2500.csv` (303) and `steward-messy-2500-v2.csv` (440).
Every one of those is a live mailbox belonging to a real person.

---

## WHAT WAS DONE ON THE NIGHT (containment)

Both applied to Railway project `nonprofit-erp` → service `nonprofit-erp` →
`production`, and both **verified live** (`/health` ok at `38784ee`, boot log
reading `background ticks DISABLED`).

1. **`RESEND_API_KEY`** set to an invalid sentinel
   (`re_DISABLED_incident_20260923_…`). Every send now 401s and the calling
   code logs and continues.
   **The live key was first copied to `RESEND_API_KEY_INCIDENT_BACKUP`**, so
   restoring is one copy, not a trip to the Resend console.
   **It was NOT unset.** `new Resend(undefined)` throws at module load, so
   removing the variable crash-loops the API. That mistake would have been
   worse than the incident.
2. **`DISABLE_BACKGROUND_TICKS=1`** — stops every periodic job (pledge
   reminders, digests, sequences, dunning, sweeps, auto-lapse).

**Neither stops request- or webhook-triggered mail.** `register-org` sends its
welcome inline, on the request. **Do not provision another org until the code
fix below is deployed.**

### To restore, once the fix is live

```
railway variables --service nonprofit-erp --json | python3 -c \
  "import sys,json;print(json.load(sys.stdin)['RESEND_API_KEY_INCIDENT_BACKUP'])"
# then set RESEND_API_KEY back to that value, and:
railway variables --service nonprofit-erp --set "DISABLE_BACKGROUND_TICKS=0"
```

---

## THE FIX

**Two gates, and neither is in a send path** — they are in the places every
send path already has to pass.

1. **`donorMailDecision` refuses `is_sample`**, for every kind, *above* the
   marketing/transactional split. A receipt to an invented donor is not a legal
   acknowledgment; it is mail to a stranger who owns the address.
2. **`orgMaySendEmail(orgId)`** — one org-level answer, read by all three
   seams: `donorMailDecision`, `sendDigestEmail` + `runDigestsForOrg`, and
   `sendOnboardingSequence`. It **fails closed**: an unreadable org row sends
   nothing. `orgs.emails_enabled` (default **true**, so no customer goes quiet
   on deploy) and `orgs.is_demo_org` (default **false**).
3. **`POST /auth/register-org` accepts `provisioned: true`** — the difference
   between a signup and a handover. The org is born with mail **off** and
   marked as fiction, and **no onboarding sequence row is created at all**. Not
   merely unsent: a dormant enrolment is a loaded gun, and the hourly engine
   would have delivered a "welcome!" to a month-old customer the moment mail
   came back on.
4. **`POST /admin/orgs/:id/email-switch`** (super-admin) — the lever that did
   not exist. It **refuses** to enable mail on an org still marked as a demo
   org, because that disagreement is exactly how this repeats.
5. **Every seeded address is now `<local>@<provider>.example.com`** — 752
   rewritten. The provider is kept as a *subdomain* rather than flattened,
   because flattening `jduong@icloud.com` and `jduong@twc.com` to one address
   would have silently merged two donors and moved a dedupe answer key. All
   distinct-address counts were verified unchanged (303→303, 440→440).
   `example.com` is IANA-reserved (RFC 2606) and publishes no MX.
6. **`seed-*.js` scripts create orgs with `emails_enabled=false, is_demo_org=true`**,
   enforced by a new `script-guards` assertion so the next seed cannot forget.

`tests/incident-mail-gate.test.js` — **27 assertions**, including that a real
signup still gets its drip, so the guard did not buy safety by breaking the
ordinary path.

---

## WHAT THIS COST, AND THE ONE TO REMEMBER

**`grep` silently skipped a 440-address fixture.** A scan that reported the
tree clean was wrong, and only the new test — which reads files as text in Node
rather than shelling out — found `steward-messy-2500-v2.csv`. This repo has
been bitten by grep's binary-file heuristic before. **For a safety sweep, read
the bytes; do not trust `grep -r`.**

---

## WHAT THE PRODUCTION QUERY FOUND (23 Sep, read-only)

The incident was **twelve days old**, not one evening.

| | |
|---|---|
| The "F" org | **`org_52c91560`, literally named "f"** — created 2026-09-08 18:17 via `/auth/register-org` (no close link; an onboarding drip appears 3s later, that route's signature) |
| Its data | **25,034 donors**, **0 tagged `is_sample`**, 17,923 addresses outside reserved domains |
| What it sent | **155 pledge reminders to 41 donors, 39 of them at real mailbox providers**, from 2026-09-10 |
| Its twin | **`org_375ffb10`, named "s"** — same 25,034-donor import, **164 reminders to 41 donors, 39 at real providers** |
| Combined | **319 reminders to 82 donors.** `reminder_step` reached 3, so the full 0/3/7/14 cadence ran — four emails each |
| Still armed | 28 open pledge cadences on "f", 19 on "s", which would fire the moment ticks resume |

`ava.moore80@yahoo.com`, `amy.castellanos34@twc.com`, `kwame.quimby20@hotmail.com`,
`mary.gomez39@yahoo.com` — the same `firstname.lastname##@provider` shape as
`levi.johnson88@yahoo.com`. Steward was dunning invented people for invented
five-figure pledges at real addresses for twelve days.

**`org_justinsplace` does not exist.** There are two orgs named *Justin's
Place*, created three seconds apart: `org_a69dbc4f` (the real one — one user,
`hello@justinsplaceky.com`, 53 donors, 122 gifts) and `org_35a1e5f3` (an
accidental duplicate: no users, no donors). Allie's 53 donors are **all at
`@example.com`** — the two emails that reached her went to the *user*, never to
a donor.

### Marked 23 Sep (mail off + demo)

`org_52c91560` ("f"), `org_375ffb10` ("s"), `org_creo`, `org_a69dbc4f` and
`org_35a1e5f3`. Justin's Place's onboarding drip was **deleted** — 1 enrolment,
7 steps, 1 sequence — so no dormant row can fire when mail returns.

"s" was not on the original list. Disabling one twin and leaving the other
armed, when the other had sent *more*, was not defensible.

### Still reachable if the key came back

**3,514 addresses at real mailbox providers** across seven orgs that are still
`emails_enabled=true`: Test1 (1,249), atkinson (1,249), 32 (407), Lit & culture
(303), Poppy the pitty (303), Steward LLC (SALES) (2), Harbor Music School (1).
**None of their donors are tagged `is_sample`** — so the donor-level gate does
nothing for them. Only the org-level flag would, and they do not have it.

## STILL OPEN

- **Resend suppressions** for `levi.johnson88@yahoo.com` and the seven other
  seeded addresses (item 4). Not done: the API key is deliberately invalid, so
  the Resend API cannot be called until it is restored. Belt-and-braces now
  that the addresses are unroutable, but it should still be done.
- **Which org is "F"** — needs a production query. It is not in this repo.
- **`org_creo`** still holds ~1,000 untagged demo donors from
  `scripts/build89-demo-seed.js`. Their addresses are `@example.org` so nothing
  was delivered, but they are untagged and would generate digests. Decide
  whether to mark that org `is_demo_org`.
- **`server.js` still has ~20 separate `resend.emails.send(` call sites.** The
  two gates cover every one that matters today, but there is no single choke
  point, and the next send path added will not automatically pass through
  either gate.
