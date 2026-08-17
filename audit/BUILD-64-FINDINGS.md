# BUILD-64 — THE DONOR-FACING THINGS NOBODY HAS EVER LOOKED AT

_2026-08-17. The receipt that arrived in a real inbox had a Steward-green header
band on an org whose identity is warm brown. The BUILD-60 battery went green
because it asserted the rendered **page**, never the **email** or the **PDF**.
This build makes every off-web artifact carry the org's identity from the SAME
resolver as the portal, and makes the brand assertion cover the artifact, not
the page._

Scope note (BUILD-63 Part 5, the post-charge verification, remains open pending
Jonathan's fresh live charge — not blocked by this build, and this build is not
blocked by it).

---

## PART 1 — THE ARTIFACTS (enumerated)

Every donor-facing artifact that is **not a web page**. The brief's starter list
was ~9 emails + 2 documents. The real count is larger — **and that is the
finding**: nobody had ever listed them, so nobody had checked them.

### Emails — donor-facing, org-branded (now From the org, header from the shared resolver)
| # | Artifact | Sender fn (server.js) | Rewired to org identity? |
|---|---|---|---|
| 1 | Donation receipt (cover) | `sendReceiptEmail` (type `gift`) | ✅ band + From + white-label name |
| 2 | Year-end giving statement (cover) | `sendReceiptEmail` (type `year_end`) | ✅ |
| 3 | Recurring gift — staff/donor change + confirmation | `sendRecurringDonorEmail` | ✅ |
| 4 | Recurring **proposal** (create / amount / frequency / card-update) | `sendRecurringDonorEmail` (BUILD-57) | ✅ |
| 5 | Card-failure / dunning | `sendDunningEmail` | ✅ |
| 6 | Card-updated / recovered thank-you | `sendRecoveredThankYouEmail` | ✅ |
| 7 | Portal mutation confirmation (pause / cancel / amount) | `sendPortalMutationEmail` | ✅ |
| 8 | Magic-link sign-in | `sendPortalMagicLinkEmail` → `sendDonorLifecycleEmail` | ✅ From now org-named |
| 9 | Workflow thank-you / re-engage recipe | `sendWorkflowEmail` | ✅ |
| 10 | Milestone draft (staff-reviewed) | `POST /milestone-drafts/:id/send` | ✅ From |
| 11 | Email campaign | `runCampaignSend` | ✅ From (header already branded) |
| 12 | Email sequence step | `processSequences` | ✅ From (non-onboarding) |
| 13 | Pledge reminder | `sendPledgeReminderEmail` | ✅ From |
| 14 | Peer-fundraiser "manage your page" link | `sendFundraiserManageEmail` | ✅ From |

### Emails — NETWORK-level, deliberately from **Steward**, not an org (correct as-is)
| Artifact | Why it stays Steward-sender |
|---|---|
| Donor **account** verify / reset / alias / email-change (`sendDonorLifecycleEmail`) | These belong to the cross-org *giving account* (`donor_accounts`), which is Steward's own consumer surface (`/giving`), not any single org. Branding them as one org would be a lie about who holds the account. |
| Account sign-in link (BUILD-49 `donor_account_signin_links`) | Same — the account, not an org. |

### Emails that DON'T exist (checked, so the list is honest)
- **Impact-update notification email** — there is **none**. Impact updates render
  in the portal + the cross-org feed only; nothing is emailed when one publishes.
  (If one is ever built, it joins the org-branded family above and the battery.)

### Documents (PDFs)
| # | Artifact | Renderer | Rewired? |
|---|---|---|---|
| 1 | Donation receipt PDF | `renderReceiptPdf` (`gift`) | ✅ band frozen from resolver at issue |
| 2 | Year-end statement PDF | `renderReceiptPdf` (`year_end`) | ✅ |
| 3 | **Donor impact-summary PDF** | `GET /donors/:id/impact-summary/pdf` | ✅ **new finding** — see below |

**Board report PDF** exists but is staff-facing (a board packet), not a donor
artifact — deliberately out of scope.

**The impact-summary PDF was the hidden third document.** It was drawn with a
**hardcoded `#1a6b4a` green band**, mint/emerald tint text (`#a7f3d0` / `#d1fae5`),
AND the staff-side `orgs.name` ("… (Demo)") — a per-donor document a nonprofit
prints or mails, wearing Steward's colors and leaking the demo suffix. Rewired
to the shared resolver (band + accessible foreground + white-label display name).

---

## PART 2 — THEY BELONG TO THE ORG

### One resolver, not a second copy
The root cause: the give page + portal read the org's identity from
`portal_settings` (via `portalCardTheme` / `portalThemePayload`), while the email
header (`brandEmailHeaderHtml`) and the receipt PDF read a **second, unrelated
copy — `orgs.brand_accent`** (the old BUILD-13 white-label), unset on the demo
orgs and falling back to Steward green.

- New **`resolveOrgBrandTheme(orgId)`** (server.js) is now THE resolver every
  off-web artifact reads: band color + accessible foreground, accent, embeddable
  logo (base64 for the PDF/inline `<img>`; an absolute asset URL for email when
  that's all the org has), and the white-label display name.
- `brandEmailHeaderHtml` rewritten onto it. The receipt/year-end snapshots freeze
  `orgAccent`/`orgAccentFg`/`orgLogo` from it **at issue time** (a later theme
  change never alters an already-issued receipt). The impact-summary PDF reads it
  live. Legal fields (legal name, EIN, address on a receipt) still come from
  `orgs` — only the **brand surface** moved.

### Sender identity — the org's name in the inbox
Every donor-facing send's `From` is now `"<Org display name> <noreply@stewardapp.dev>"`
via `donorFromAddress(orgId)` (header-injection-safe). "CREO Arts", not a bare
unfamiliar domain. Per-org **sending domains** (SPF/DKIM) are scoped, not built —
see `BLOCKED-sending-domains.md`.

### The account CTA in receipts — kept, quiet, in the org's palette
"See all your giving in one place — create your free giving account" **stays** in
the transactional receipt cover (it's the single best network-growth surface in
the product). But it now renders **below a divider, in muted sage, with the link
in the ORG's own primary color** — never Steward emerald (`#0d5c3a`, which is
literally what the hardcoded link color was). It reads as a service the org
offers, not a house ad. Implemented that way; **Jonathan may overrule** (one
line: `givingAccountEmailFooterHtml`).

---

## PART 3 — THE ASSERTION COVERS THE ARTIFACT, NOT THE PAGE

`tests/giving-flow-brand.test.js` (the BUILD-60 battery) now **enumerates
artifact media** — `page`, `email`, `pdf` — and runs against the **rendered
output of each**, for two themed orgs (terracotta, blue):

- **email** — drives the real issue route; a capturing Resend sink records the
  actual outbound bytes; asserts the header band is the org's OWN resolved
  primary, no `#0d5c3a`/`#10b981`, not the neutral `#1a6b4a` default, no visible
  "Steward" wordmark (the canonical domain in the CTA href is allowed), no
  "(Demo)" leak, the `From` carries the org display name, and the account CTA
  link is in the org's palette.
- **pdf** — asserts the frozen `snapshot.orgAccent` equals the give page's
  `theme.primary` (same resolver, proven by equality — not a hand-built copy),
  isn't the neutral default or emerald, and that the PDF actually renders (`%PDF`).
- **the class fix, encoded** — an `ARTIFACT_MEDIA` list + a structural self-check:
  a new donor-facing medium with no assertion, or a removed leg, **fails the
  suite** (same total-classification shape as `script-guards` / `asset-retention`).

**Captures:** `docs/build64/artifacts/` — the receipt cover email, year-end cover
email, and magic-link email rendered to PNG, for two themed orgs **and one
unthemed org** (the designed neutral default), plus the real receipt / year-end
**PDF bytes** (openable). NB this environment has no PDF→image converter
(`pdftoppm`/`mutool`/`gs`/ImageMagick all absent; headless Chromium treats a PDF
as a download, not an inline render) — so the PDFs are committed as their real
bytes rather than PNGs, and the battery is what proves each PDF's band color.

---

## PART 4 — THE GIVING SUMMARY

1. **Dates.** `fmtDay` is now the ONE donor-facing date formatter (`lib/money.js`,
   shared by the org portal and the cross-org dashboard). The expanded gift rows
   and impact updates rendered raw ISO (`2026-08-17`) while the cross-org
   dashboard already read `Aug 17, 2026`; both now use `fmtDay`. Pinned:
   `tests/giving-summary.test.js` fails on any `.slice(0,10)` date render or a
   second `fmtDay` definition.
2. **Recurring tag.** The portal `/me` payload now derives `recurring` from
   `gifts.recurring_subscription_id`, and the history renders a quiet "Recurring"
   chip — so a column of identical monthly amounts explains itself.
3. **Fund designation.** Shown on the expanded rows where one exists (alongside
   the campaign when both are present).
4. **"Largest gift" → gift count.** Replaced outright. It's a fundraiser's metric
   on a donor's own page — it reads as being sized up.

### The "Largest gift" mystery, explained (as requested)
The 5→6 signal disappeared **by accident, in code, not by decision.** The old
branch showed *Largest gift* whenever it "differed from both YTD and lifetime"
and only substituted the gift count otherwise. For any donor with more than one
distinct gift amount, the largest gift almost always differs from both figures —
so the count branch essentially never fired, and the count silently vanished for
most donors. Nobody decided to hide it; a conditional that read reasonable in
isolation hid it as a side effect. Replacing the stat with the count restores it
for everyone.

---

## §WORRY

- **The resolver has a fallback, and the fallback is a color.** An org with no
  `portal_settings` theme renders the neutral `#1a6b4a` band on its receipts —
  designed and legible, and *not* Steward's emerald, but also not the org's own
  color. The battery treats `#1a6b4a` as "the default an org must override," but a
  real org that never set a theme still ships a receipt that isn't visibly
  *theirs*. The honest fix is onboarding pressure to set a color, not a cleverer
  default. Flagged, not solved.
- **Logos in the PDF are base64-only.** An org whose logo lives as an *asset URL*
  (`portal_settings.logo_url`, the BUILD-51 content-addressed store) gets its
  color on the receipt but **no logo** — pdfkit can't fetch a URL mid-render, and
  fetching remote bytes into a synchronous PDF path is its own reliability
  question. Email carries the URL logo fine (absolute `<img src>`); the PDF
  quietly omits it. Nobody will notice until an org with a URL-only logo prints a
  receipt and asks where their mark went.
- **"Every donor-facing artifact" is only as complete as this enumeration.** The
  Part-1 table is hand-built from a source read; the battery's structural
  self-check enforces the three *media*, but it does not *discover* a brand-new
  email template that someone adds to a flow the battery doesn't drive. The
  strongest guard here is that the battery scans **every** email the receipt flow
  actually emits to the sink — so a new email injected into that flow is caught —
  but a new flow (a new trigger, a new document) needs its own leg. That is the
  same class of gap this whole build exists to close, now one level up.
- **The account CTA is a judgment call wearing a test.** The suite pins that the
  CTA link is in the org's palette, which encodes "keep it, quietly." If Jonathan
  decides the CTA shouldn't be in an org-branded tax document at all, that
  assertion is the thing to delete — it's a decision, not a correctness fact.
- **`brandEmailHeaderHtml` now does a JOIN on every send.** One extra indexed
  query per email (hoisted once per campaign send, but per-message elsewhere).
  Cheap, but it's a new dependency of the mail path on `portal_settings` — if that
  table is ever slow or contended, it's now in the critical path of a receipt.
