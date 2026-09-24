# MANUAL-STEPS — BUILD-38 things code can't do

These require dashboard/console access. Do them from the UI/CLI as yourself; they
are NOT attempted from code (per the build's rules of engagement).

## 1. Branch protection on `main` (make CI a required check)

The CI workflow (`.github/workflows/ci.yml`) runs on every push/PR but does not
by itself block anything. Require it:

1. GitHub → repo → **Settings → Branches → Add branch ruleset** (or "Add rule")
   targeting `main`.
2. Enable **Require status checks to pass before merging** → add the **`test`**
   job (from the `CI` workflow) as required.
3. Enable **Require branches to be up to date before merging**.
4. (Solo-repo caveat) You currently push straight to `main`. Either start using
   PRs so the required check gates merges, or rely on the **pre-push hook** below
   as the pre-deploy gate for direct pushes. CI-on-push runs *after* the push and
   races the deploy — it catches regressions but doesn't prevent the bad deploy.

## 2. Block deploy when CI hasn't passed (Vercel Ignored Build Step)

Auto-deploy on push to `main` will otherwise ship a red commit before CI finishes.

- Vercel → Project → **Settings → Git → Ignored Build Step** → set a command that
  exits non-zero unless the commit's CI succeeded. Simplest robust option:
  **only deploy the commit CI has blessed.** Options, easiest first:
  - Use the **GitHub Deployments / Checks integration**: in Vercel Git settings,
    require the GitHub check to be successful before deploying (if available on
    the plan).
  - Or an Ignored Build Step script that queries the GitHub API for the head
    commit's `CI / test` check-run conclusion and `exit 1` unless it's `success`.
- Railway (backend) has no native "wait for CI" gate. Enable the pre-push hook
  (below) so the suite runs before the push that triggers Railway's deploy.

## 3. Enable the local pre-push gate (do this now, once)

```
npm run setup:hooks   # sets core.hooksPath=.githooks
```

Then every `git push` runs the full suite first and blocks on failure. It assumes
the local scratch stack is up (scratch Postgres :5544 + the API server booted per
`tests/README.md`, with `SESSION_CACHE_TTL_MS=0`). Emergency bypass:
`git push --no-verify` (don't make it a habit).

## 4. Pin GitHub Actions to commit SHAs (supply-chain hardening)

`ci.yml` pins `actions/checkout@v4` and `actions/setup-node@v4` to tags. Tags are
mutable; convert to immutable SHAs when you can resolve them:

```
gh api repos/actions/checkout/git/refs/tags/v4 --jq .object.sha
gh api repos/actions/setup-node/git/refs/tags/v4 --jq .object.sha
```

Replace `@v4` with `@<sha>  # v4` in `ci.yml`.

## 5. First CI run — watch it

CI could not be executed from this environment (no GitHub runner here). The
workflow is correct by construction and mirrors the local boot recipe, but the
first run on GitHub should be watched: the likely first-run snags are the
Postgres service readiness and the server-boot wait loop. The full suite is
proven green locally (56 suites) with the same env the workflow sets.

## 6. Tigris bucket versioning on `steward-portal-assets` (BUILD-56, belt-and-braces)

BUILD-56 makes asset destruction impossible-by-default in the APP (soft delete +
90-day retention + pointer history + restore script). Bucket versioning is the
storage-layer BELT on top — it does NOT substitute for any of that (opaque S3
version IDs with no pointer history are not a recovery path), but it means even
a bug inside the destruction seam can't permanently lose S3 bytes.

Console path (Railway buckets are Tigris under the hood):

1. Railway dashboard → project **nonprofit-erp** → prod environment → bucket
   **steward-portal-assets** → open the Tigris console/storage settings for the
   bucket (Railway surfaces a "Open in Tigris" / storage settings link).
2. Enable **Object Versioning** on the bucket.
3. Add a **lifecycle rule** to expire *noncurrent versions* after **180 days**
   (double the app's 90-day window, so the belt outlives the suspenders; keeps
   storage bounded).

CLI alternative (Tigris speaks the S3 API; use the `PORTAL_ASSETS_S3_*` creds):

```
aws s3api put-bucket-versioning --bucket steward-portal-assets \
  --endpoint-url https://t3.storageapi.dev \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration --bucket steward-portal-assets \
  --endpoint-url https://t3.storageapi.dev \
  --lifecycle-configuration '{"Rules":[{"ID":"expire-noncurrent","Status":"Enabled",
    "Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":180}}]}'
```

Verify: `aws s3api get-bucket-versioning --bucket steward-portal-assets
--endpoint-url https://t3.storageapi.dev` → `"Status": "Enabled"`.

## Founding-partner onboarding call — verify the org's sending domain (BUILD-88c C.1)

Add to the import call, after the file is in and before the first appeal goes out:

1. Settings → **Send from your own address** → type the address donors should
   see (`ada@theircharity.org`) → **Use this address**.
2. Steward shows the three DNS records Resend asked for (DKIM TXT, an MX and a
   TXT for the return path). Copy each and give them to whoever runs the
   organisation's DNS — usually their web host, sometimes a volunteer.
3. Press **Check** when they say it is published. Records usually propagate in
   minutes; occasionally hours. **Nothing is blocked while it is pending** —
   appeals, receipts and reconnect links all still send on Steward's shared
   domain with the org's name on them and a Reply-To that reaches them.
4. When it flips to **Verified**, send yourself one test from Communications and
   read it on a phone: the From should be their address at their domain, and
   nothing in the header should say Steward.

Why it is on the call and not left to them: an unfamiliar sending domain costs
deliverability, and a receipt in a donor's spam folder becomes a support ticket
the donor opens **with the organisation**. It is fifteen minutes on a call and
it is the difference between their mail arriving and their mail arriving
sometimes.

## §7 — STEWARD_CREDENTIAL_KEY (BUILD-89S 89a, 2026-09-20)

**Required before any organisation can connect a giving source (PayPal, Zeffy,
Stripe, Givebutter).** A provider credential is a key to the organisation's own
money, so Steward refuses to store one unless it can seal it.

1. Generate a key (at least 32 characters):
   ```
   openssl rand -base64 32
   ```
2. Railway → the `nonprofit-erp` service → Variables → add
   `STEWARD_CREDENTIAL_KEY=<the value>`. Redeploy.
3. Confirm: `GET /giving-sources/providers` as any signed-in user returns
   `"credentialsReady": true`.

Until it is set, every connect attempt answers 503 with a sentence naming the
variable, and nothing is written — the feature is unavailable rather than
insecure.

**Rotating this key orphans every stored credential** (there is no re-seal path
yet — see BLOCKED-build89a.md §1). After a rotation every source must be
disconnected and connected again.

### DONE 2026-09-22 — the key is set on prod

`STEWARD_CREDENTIAL_KEY` is present on Railway project **nonprofit-erp** →
service **nonprofit-erp** → environment `production`. Verified by listing the
service's variables; the value itself was not read back. Giving-source connects
no longer answer 503 for want of a sealing key, so **PayPal, Zeffy, Stripe and
Givebutter can now be connected.**

The rotation warning above still stands and does not expire.

## §8 — THE THREE LIVE STRIPE PRICES (BUILD-90, 2026-09-20)

The close link is the only door a customer comes through, and it refuses to
mint a Checkout session for a plan with no Stripe price id configured. That is
deliberate — a link that cannot charge beats one that quietly charges the wrong
amount — but it means **nobody can be closed until these three exist**.

Amounts: Founding **$199**, Core **$249**, Team **$499**.

```bash
STRIPE_BILLING_SECRET_KEY=sk_test_… node scripts/create-billing-products.js          # test first
STRIPE_BILLING_SECRET_KEY=sk_live_… node scripts/create-billing-products.js --live   # then live
```

Paste the printed `STRIPE_PRICE_FOUNDING` / `STRIPE_PRICE_CORE` /
`STRIPE_PRICE_TEAM` into Railway, and set `FOUNDER_EMAIL` to a **verified
Resend sender** — it is the From on the welcome email and on the seven-day
pre-charge reminder, both of which should read as coming from Jonathan.

Then run one real close link on prod with your own card, confirm Stripe shows
a trialing subscription with no charge, and cancel it. Full checklist and the
reasoning: `BLOCKED-build90.md`.

**Never set `STRIPE_BILLING_API_BASE` in production** — it is the local-test
seam that points the billing client at a mock.

### DONE 2026-09-20 — and the script was NOT the answer

**No Stripe object was created.** All three correct prices ALREADY EXISTED in
live mode; the three Railway variables were simply pointed at older ones:

| Plan | Railway pointed at | Should quote | Now points at |
|---|---|---|---|
| Founding | $99/month | $199 | the existing $199/month price |
| Core | $149/month | $249 | the existing $249/month price |
| Team | $299/month | $499 | the existing $499/month price |

So the fix was three variable values, nothing else. `FOUNDER_EMAIL` was already
`jonathan@stewardapp.dev` and was left untouched.

**DO NOT run `scripts/create-billing-products.js --live` on this account.** It
finds a product by `metadata['steward_plan']`, and the three live products
(`Founding Partner`, `Core`, `Team`) carry **no metadata at all**. The script
would not recognise them, would create three NEW products named `Steward — Core`
/ `Steward — Team` / `Steward — Founding Partner`, and would mint a SECOND
$199/$249/$499 price under them — duplicating prices that already exist and
splitting the catalogue across six products. The script is idempotent only
against products it created itself.

Verified after the redeploy: `GET /admin/close-links` reports `ready: true` for
all three, with Stripe's own amount and interval matching what the page quotes.

**Still Jonathan's, and still not done:** §3 of `BLOCKED-build90.md` — one real
close link on prod, walked with his own card, confirmed `trialing` with no
charge, then cancelled and the throwaway org deleted. Nobody else can do that
step.

## §9 — ROTATE THE DEMO ADMIN PASSWORD (BUILD-93 Part 2, 2026-09-20)

**The seed does NOT reset it on every boot** — the brief suspected it did, and
it does not. `db.js` inserts `admin@creoarts.org` with `ON CONFLICT (id) DO
UPDATE SET name = EXCLUDED.name`: the name is the one column the upsert may
correct, and the password, email and role are left alone (BUILD-87 F.3.7 says
so in the comment). So production's password is whatever it is today, and
rotating it STICKS.

**Why rotate.** `demo1234` is written in `CLAUDE.md`, `PROGRESS.md` and the git
history, and it was rendered on the production sign-in page until 2026-07-30.
That account is an **admin of `org_creo`**, which is the org both of Jonathan's
accounts live in. BUILD-93 Part 2 now stops it removing a super-admin, but it
can still read and write every donor record in the demo org.

### The rotation (Jonathan's, two minutes)

1. Sign in to https://www.stewardapp.dev as `admin@creoarts.org`.
2. Settings → Account → change password. Pick something not in this repo.
3. Store it in your password manager, NOT in a file here.

Nothing in the product needs a code change: the password lives only in that
row.

### What depends on it, and whether rotation breaks it

**Safe — every one of these already honours an environment override:**

| Script | Override |
|---|---|
| `scripts/consistency-audit.js` | `ADMIN_PASSWORD` |
| `scripts/build12-ui-capture.js` | `PASSWORD` |
| `scripts/finance-overview-capture.js` | `PASSWORD` |
| `scripts/topbar-verify.js` | `PASSWORD` |
| `scripts/build59-install-demo-images.js` | `CREO_PASSWORD` |
| `scripts/seed-fundraising-demo.js` | `DEMO_PASSWORD` |
| `scripts/build88a-walk.js` | `DEMO_PASSWORD` **(added in BUILD-93 — it hardcoded the password until tonight)** |

**Documentation to correct after rotating** (they state the pair as fact):
`CLAUDE.md` line 25, `PROGRESS.md` line 25, `QA_REPORT.md`,
`BLOCKED-superadmin-removal.md`.

**Not affected:** the test suites. They mint their own fixture users and are
refused against any non-loopback `BASE`/`DATABASE_URL` (`tests/helpers.js`),
so none of them can reach the production demo org at all.

**The deeper fix is still open** and is not a password: Jonathan's super-admin
account should not live in the same organisation as a shared demo login. See
`BLOCKED-superadmin-removal.md`.

## §10 — THE RESEND BOUNCE/COMPLAINT WEBHOOK (BUILD-94 Part 4, 2026-09-22)

**Fifteen minutes, and Steward cannot do it for you.** Until this endpoint is
live, a hard bounce and a spam complaint reach nothing: the address keeps being
mailed, the shared sending domain keeps taking the damage, and nobody at the
organisation ever learns why a donor stopped hearing from them.

The code is already deployed and already signature-verified
(`POST /resend/webhook`, svix). It refuses every delivery with
`503 Resend webhook not configured` until `RESEND_WEBHOOK_SECRET` is set, which
is the correct failure — an unverified webhook endpoint is worse than none.

**The exact clicks:**

1. <https://resend.com> → sign in → **Webhooks** (left nav) → **Add Webhook**.
2. **Endpoint URL:**
   `https://nonprofit-erp-production.up.railway.app/resend/webhook`
3. **Events** — tick exactly these two, and nothing else:
   - `email.bounced`
   - `email.complained`
   (Do NOT tick `email.opened` or `email.clicked`. Steward counts opens per
   campaign from its own recipient rows; subscribing to per-event opens here
   would start a per-person open stream we have decided not to hold — see
   `steward-data-handling.md`.)
4. **Add** → the webhook's detail page now shows a **Signing Secret** beginning
   `whsec_`. Click **Reveal** → copy it.
5. Railway → project **nonprofit-erp** → service **nonprofit-erp** →
   **Variables** → **New Variable**:
   - name `RESEND_WEBHOOK_SECRET`
   - value the `whsec_…` you just copied
   → **Add**, then let the service redeploy.
   (Or: `railway variables --set RESEND_WEBHOOK_SECRET=whsec_… --service nonprofit-erp`.)
6. **Verify it, don't assume it.** Back on the Resend webhook page → **Send
   test event** → pick `email.bounced` → **Send**. Resend's own delivery log
   must show **200**. A **400** means the secret does not match what Railway
   has; a **503** means the variable has not reached the running process yet
   (wait for the redeploy to finish).
7. Confirm the real path once, with a real address: send a campaign to
   `bounce@simulator.amazonses.com` … actually, use Resend's own test address
   for a hard bounce (`bounced@resend.dev`). Within a minute the person's
   record carries **"Email to … hard-bounced and will not be tried again"** on
   the timeline and the profile shows the address as unreachable.

**What a delivery does, so you can recognise it working:** the address is
suppressed GLOBALLY (a bounce or complaint is a shared-domain reputation fact,
not one org's preference), the person is marked in the org whose **verified
sending address** the event came from — never from anything in the payload —
and a line lands on that person's timeline. An event from the shared
`stewardapp.dev` sender marks nobody, on purpose: a shared-domain From
identifies Steward, not a tenant, and guessing would mark the wrong person.

## §11 — GEOCODIO_API_KEY (BUILD-84, still open)

**Until this is set, the Map has no pins in production.** It is the one
outstanding step from BUILD-84, and it is a variable, not a code change.

The provider seam in `geocode.js` has three states and prod is in the third:
`GEOCODIO_API_KEY` → Geocodio, `GEOCODE_NOMINATIM_BASE` → a **self-hosted**
Nominatim, neither → **unconfigured**, in which case the background job does not
run, **no donor address leaves the server**, and the map says so in a sentence
instead of showing an empty box. The public Nominatim instance is refused by
hostname in code and is not an option.

**Decided: Geocodio** (Jonathan, 2026-09-10) — US/Canada matches the customer
base, nothing to operate, 2,500 lookups free per day then $1.00 per 1,000.

1. <https://dash.geocod.io> → sign in → **API Keys** → create a key with
   geocoding permission.
2. Railway → project **nonprofit-erp** → service **nonprofit-erp** →
   **Variables** → **New Variable**:
   - name `GEOCODIO_API_KEY`
   - value the key you just created
   → **Add**, then let the service redeploy.
   (Or: `railway variables --set GEOCODIO_API_KEY=… --service nonprofit-erp`.)
3. **Verify:** `GET /geocode/status` as any signed-in user stops reporting
   `unconfigured`. The map then fills in on the next five-minute tick — **no
   re-import is needed**: geocoding is triggered at write time and the standing
   backlog is drained by the same job.

**What it will spend:** the billable unit is a distinct ADDRESS, new or changed
— never a donor, never a render. The queue de-duplicates by address before it
spends anything and never re-resolves one it already holds, so a steady-state
org spends nothing. Measured on the 444-row file: 408 distinct addresses = one
batched request = **$0.00**. A 25,000-address first import is **$22.50** in a
single day, or **$0.00** spread over ten.

**Never set `GEOCODIO_API_BASE` in production** — like `STRIPE_BILLING_API_BASE`
it is the local-test seam that points the client at a mock.

Reasoning and the provider comparison: `BLOCKED-build84.md` §1.


## §12 — OUTBOUND EMAIL IS CURRENTLY BLOCKED ON PRODUCTION (incident 2026-09-22)

Set the night of 22 September after production delivered three real emails
built from invented data. Full account: `INCIDENT-2026-09-22-outbound-email.md`.

On Railway → project **nonprofit-erp** → service **nonprofit-erp** →
environment `production`:

| Variable | Value | Why |
|---|---|---|
| `RESEND_API_KEY` | `re_DISABLED_incident_20260923_…` | every send 401s; code logs and continues |
| `RESEND_API_KEY_INCIDENT_BACKUP` | the real key | so restoring is a copy, not a console trip |
| `DISABLE_BACKGROUND_TICKS` | `1` | no periodic job fires at all |

**Do not simply DELETE `RESEND_API_KEY` to turn mail off.** `new Resend(undefined)`
throws at module load and the API crash-loops. Set it to an invalid string.

**Neither variable stops request-triggered mail.** `register-org` sends its
welcome inline. **Do not provision an org until the gates are deployed** — and
once they are, provision with `provisioned: true`, which creates the org with
mail off and no onboarding drip.

### Restoring, once the fix is live and verified

1. Read the backup value (never paste it into a terminal that logs):
   `railway variables --service nonprofit-erp --json | python3 -c "import sys,json;print(json.load(sys.stdin)['RESEND_API_KEY_INCIDENT_BACKUP'])"`
2. Set `RESEND_API_KEY` back to it.
3. `railway variables --service nonprofit-erp --set "DISABLE_BACKGROUND_TICKS=0"`
4. Confirm `/health` is ok and the boot log no longer says "background ticks DISABLED".
5. Then, and only then, add the seeded addresses to Resend suppressions.

---

## §13 — `ANTHROPIC_API_KEY` AND A SPEND CAP (BUILD-96 Part 3, 2026-09-24)

> Numbered §13, not §12: §12 is the outbound-email incident and other
> documents already cite it by number. BUILD-96's brief said "§12"; this is
> the same step under a number that does not collide.

**Two features do nothing on production until this is set**, and both fail the
same way on purpose — absent, not broken:

| Feature | With no key |
|---|---|
| Reading cheque photographs (BUILD-95) | the deposit sheet **still photographs the cheques** and attaches them to each line. The "Steward reads them" sentence is replaced and no read is attempted. |
| Steward's agent (BUILD-97 Part 3) | the box on Home says "Not enabled for this organization yet." No textarea, no button. |

Both read one gate (`aiGate`, server.js). Neither sends anything anywhere
without it.

### 1. Set the key

```
railway variables --service nonprofit-erp --set "ANTHROPIC_API_KEY=sk-ant-…"
```

Use a key **created for this service only**, so it can be revoked without
touching anything else.

### 2. Set a monthly spend cap — do this BEFORE the key goes live

In the Anthropic console → **Billing → Usage limits**, set a monthly cap on the
workspace this key belongs to.

Why it is not optional: a cheque read is an image request, and the deposit
sheet accepts **twenty photographs in one press**. A treasurer working through
a year of banked cheques, or a loop that retries a failing read, is a cost with
no ceiling. The cap is the ceiling, and hitting it fails the feature — which is
exactly the harmless direction, because the photographs still attach and the
sheet still works by hand.

Suggested starting cap: low enough that a runaway month is an annoyance rather
than an invoice. Raise it when there is a real usage number to raise it against.

### 3. Tell the customers, before the first read

The disclosure is already written and deployed — `steward-data-handling.md`, the
customer agreement's subprocessor table (section 16), and one line in each org's
Settings → Your Data. Anthropic is named as a **subprocessor**, in the United
States, and the per-org switch defaults **on**.

No further notice is needed for an org that signs up after this is live. For an
organisation already on Steward when the key is switched on, the agreement says
notice is given within the Service before a new subprocessor receives donor
data — so **switch it on for demo and provisioned orgs first**, and give notice
before it reaches a paying customer's org.

### 4. Then run the drill

`scripts/build95-cheque-drill.js` has **never run against a real photograph**.
Until it has, `claude/BUILD-95.md` says "reading unproven" and that line stays.

```
ANTHROPIC_API_KEY=sk-ant-… node scripts/build95-cheque-drill.js cheque1.jpg cheque2.jpg cheque3.jpg
```

Three real cheques, and record what came back beside what was actually written
— including whether the figures and the words settled. See
`BLOCKED-build95.md` §4.
