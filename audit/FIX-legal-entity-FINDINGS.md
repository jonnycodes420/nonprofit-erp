# FIX: legal entity name — PART 0 CENSUS

**Entity:** Steward Software LLC · Kentucky · filed 12 September 2026.
**Address of record:** 101 W Main St Apt 3, Wilmore, KY 40390.
**Product name:** stays `Steward`. The LLC name is the *legal owner*, not the brand.

**THE ONE RULE — observed.** The EIN is nowhere in this repo, in this file, or in
any commit message from this pass. This file records the legal name (public) and
the address (public, and already required on the surfaces below). It records no
tax ID. The permanent guard for that rule is item **G**.

Census run 2026-09-12 against `b96374a` (HEAD ≡ origin/main; BUILD-84 `019e386`
/ `bc60e66` were already pushed, so nothing was waiting on this pass).

---

## Method

Searched on *families*, not strings, case-insensitively, over the whole repo
(client, server, shared, routes, emails, docs, scripts, public/, tests),
excluding only `node_modules/`, `.git/`, `client/dist/` and `package-lock.json`:

| Family | Pattern |
|---|---|
| the placeholder itself | `\[[A-Z][A-Z _]+\]`, then `[LEGAL ENTITY NAME]`, `LEGAL_ENTITY`, `ENTITY_NAME`, `LEGAL_NAME` |
| bare words | `\bentity\b`, `\bplaceholder\b`, `TODO.*(legal|entity|LLC|address|incorporat)` |
| ownership prose | `©`, `&copy;`, `copyright`, `operated by`, `a product of`, `owned by`, `powered by steward`, `limited liability`, `\bLLC\b`, `\bInc\b`, `\bCompany\b` |
| legal surfaces | `terms`, `privacy`, `data-handling`, `receipt`, `footer`, `About`, `Contact`, `legal` |
| identity metadata | `package.json` author/name, `site.webmanifest`, `robots.txt`, `humans.txt`, 404 |
| money surfaces | `statement_descriptor`, `business_profile`, `BUSINESS_NAME` |
| mail identity | `from:`, `FROM_NAME`, `MAIL_FROM`, `RESEND_FROM`, `EMAIL_FROM`, signature lines |
| address | `40390`, `40930`, `Wilmore`, `W Main St`, `West Main` |
| tax id | `\b\d{2}-\d{7}\b` |

The last three fills each missed a code path, so the two searches that exist
*only* to catch that were run deliberately: `.railwayignore` (does the new
shared module survive the deploy tarball — **yes**, `shared/` is not stripped,
and `tests/deploy-shape.test.js` already pins it) and `tests/affected.sh` (does
a change here reach the suites — **yes**, `shared/*` is unclassified → `FULL`).

---

## A · The placeholder, where it is actually rendered → **FILLED**

| File | Line | Current text |
|---|---|---|
| `client/src/pages/Landing.jsx` | 62 | `legalEntity: "[LEGAL ENTITY NAME]", // TODO: the registered entity for the © line` |
| `client/src/pages/Landing.jsx` | 645 | `<span>© 2026 <Placeholder value={PLACEHOLDERS.legalEntity} /></span>` |
| `client/src/pages/Landing.jsx` | 61–73 | the `PLACEHOLDERS` export + the `isPlaceholder` / `Placeholder` dashed-outline component that exists solely to flag this one blank |
| `scripts/landing-prod-verify.js` | 227 | `ok("the © placeholder is VISIBLE, not silently blank or invented", text.includes("[LEGAL ENTITY NAME]"), null);` |
| `scripts/landing-prod-verify.js` | 230–238 | the companion "never ships as bare bracket text" probe, which passes on the *absence* branch |
| `tests/landing-field.test.js` | 235 | `ok("the © placeholder is VISIBLE on the page, not silently blank", text.includes("[LEGAL ENTITY NAME]"), null);` |

`© 2026` on line 645 is a **hardcoded year** — fixed to a computed one.

This is the only rendered placeholder in the product. `[LAST NAME]` (the founder
bio) appears only in `CLAUDE.md` and `audit/BUILD-73/74-FINDINGS.md` as a record
of a blank that was filled in an earlier pass; it is not in any live source file.

## B · Legal-owner surfaces that named no owner at all → **FILLED**

Rendered copies of Cowork documents. Both link from the landing footer and from
signup; both are the live Terms/Privacy at `stewardapp.dev`.

| File | Line | Current text |
|---|---|---|
| `client/src/pages/TermsPage.jsx` | 37 | `Please read these Terms of Service ("Terms") carefully before using Steward.` — **no party is identified.** The agreement had no named counterparty. |
| `client/src/pages/PrivacyPage.jsx` | 37 | `This Privacy Policy describes how Steward ("we," "us," or "our") collects…` — **"we" was undefined.** No controller entity, no address. |

The fill defines the term **once**, at the top of each document, and every
downstream "Steward" then resolves to the LLC without a word of the body
changing. That is a blank being filled, not a meaning being changed — which is
the line this pass was told not to cross. Specifically **not** touched:

- Terms §12 and Privacy §12 already say *Commonwealth of Kentucky*. Correct
  already; left exactly as written.
- Terms §8 (`owned by Steward`, `trademarks of Steward`) and §10 (`STEWARD AND
  ITS OFFICERS…`, all-caps by design) — these now resolve to the LLC through the
  §intro definition. Rewriting them would have been a second copy of the name.
- Privacy §13's INTERIM marker and `BLOCKED-legal-network.md` — untouched.

## C · Identity metadata

| File | Line | Current text | Verdict |
|---|---|---|---|
| `package.json` | 14 | `"author": ""` | **FILLED** — the package's author is the legal owner. |
| `package.json` | 2 | `"name": "nonprofit-erp"` | left — repo name, not a brand or an owner. |
| `client/package.json` | — | no `author` field | left — private workspace package, never published. |
| `shared/package.json` | — | `{"type":"module"}` only | left — the ESM marker, nothing else belongs in it. |
| `client/public/site.webmanifest` | 2–3 | `"name": "Steward"`, `"short_name": "Steward"` | left — **product** name, and the brief says the product name stays. |
| `robots.txt` / `humans.txt` | — | **do not exist** | nothing to fill. |
| 404 page | — | **does not exist** (SPA catch-all in `vercel.json`) | nothing to fill. |
| `client/index.html`, `client/giving.html` | — | no author/copyright meta | nothing to fill. |

## D · Surfaces checked and deliberately **NOT** changed

These are the places a careless fill would have put the name, and each is wrong
for a specific reason. Recorded so the next pass does not "find" them.

1. **The receipt PDF — `server.js:6055–6170` (`renderReceiptPdf`).** A charitable
   gift receipt names **the nonprofit**: `snapshot.orgLegalName`, the org's EIN,
   `snapshot.orgAddress`, and a footer reading `<org> is a tax-exempt
   organization. EIN: <org ein>.` Steward Software LLC is the software vendor,
   not the donee. **Putting it on this document is the exact failure the brief
   names** ("a gift receipt naming the wrong entity is a real problem") — it
   would read as a claim that the donation went to an LLC. See **§BLOCKED-1**.
2. **The receipt cover email — `server.js:6201` (`sendReceiptEmail`).** `from` is
   the *org's* address (`donorFromAddress`), the header band is the *org's*
   brand (`resolveOrgBrandTheme`), the display name is the org's white-label
   name. BUILD-64 deliberately removed Steward's mark from this surface.
3. **The CAN-SPAM footer — `server.js:10161` (`unsubscribeEmailFooterHtml`).**
   Renders `orgs.legal_name · orgs.receipt_address`. Correct as-is: the sender of
   a campaign is the nonprofit.
4. **`server.js:1974` — `from: "Steward <noreply@stewardapp.dev>"`.** The sender
   display name. The brief holds it fixed. Left.
5. **`server.js:12554` — `statement_descriptor`.** Derived from `org.name` on the
   **connected** account, so a donor's card statement reads the charity's name.
   Steward is not in this path. Left.
6. **`CONSUMER_BRAND = "Steward"` — `server.js:22470`,
   `client/src/pages/GivingDashboard.jsx:26`.** Described in source as "the
   placeholder pending the founder decision". It is a *brand* decision tracked in
   `BLOCKED-consumer-brand.md`, it holds a real value (not a bracketed blank),
   and it is not an entity name. Out of scope. **Noticed, left.**
7. **`audit/data-handling.md`, `audit/portal-data-handling.md`.** Internal
   engineering PII inventories that say so on line 3 ("not legal advice") — they
   are *source material* for the Cowork document, not a rendered copy of it, and
   `audit/` is stripped from the deploy tarball. No owner is named in either.
   Left.
8. **`docs/build81/landing/{proposal,reference-desktop,reference-mobile}.html`
   (line 183/242) and `docs/build81/landing-prod-verify-*.txt`.** Frozen capture
   artifacts of the page *as it was*, plus the recorded output of verifier runs.
   Editing them would falsify the record. Left — and excluded from the new
   guard for that stated reason (§G).
9. **`BLOCKED-build81.md:5` and `CLAUDE.md:90`.** Both assert the placeholder is
   *still present*, which stopped being true in this commit. Updated to say it
   was filled — that is maintenance of a stale claim, not new copy.

## E · Address and ZIP

- `40930` (the transposed ZIP the brief warned about): **zero occurrences.**
  Nothing to fix.
- `40390` and `Wilmore` appear only in donor **fixtures**
  (`tests/fixtures/build77/steward-messy-2500.csv`,
  `tests/fixtures/build84/org-donors.csv`, `tests/fixtures/build78/gen-messy-cf.mjs`)
  and in `tests/build84.test.js`'s geocoder key assertions. Those are invented
  donor addresses in a Kentucky town; unrelated to the entity. Left.
- No Steward postal address existed anywhere in the repo before this pass.

## F · Tax-ID-shaped strings already in the repo

Eleven distinct values, every one synthetic. Recorded here because the permanent
guard (§G) is an **allowlist**, and this is the allowlist's evidence.

`00-0000000` · `11-1111147` · `11-1114949` · `12-3456789` · `47-1234567` ·
`81-1234567` · `81-2345679` · `81-7654321` · `82-4331907` · `98-7654321` ·
`99-0001111`

They live in: `db.js:2573` (the CREO Arts demo org seed), `PROGRESS.md:242`,
`QA_FRESH_ORG.md:29`, `BLOCKED-build06-cleanup.md:16`,
`BLOCKED-network-review-prod.md:23`, `client/src/pages/JoinNetwork.jsx:87` and
`client/src/pages/PortalEditor.jsx:607` (both **input placeholders** showing the
shape of the field), `scripts/{seed-loadtest,seed-build45-portal-demo,build48-capture,build50-capture,build59-capture,build64-capture}.js`,
`docs/build57/walk/WALK.md`, and eleven test files.

Note that real nonprofit EINs are *public* data and legitimately flow through
this product (IRS Pub-78 verification, `orgs.ein`, the portal's `ein_line`). The
rule being guarded is narrower and absolute: **Steward Software LLC's own tax ID
never enters this repo.** An allowlist is the only guard that can tell those two
apart, which is why §G is built as one.

## G · The permanent guards added — and one honest caveat about the regex

`tests/legal-entity.test.js` (new, in `CORE`) walks the repo and fails the build
on four things. Two of them need their scope stated, because the literal
patterns in the brief do not survive contact with JavaScript:

- **The bracketed-placeholder family.** `/\[[A-Z][A-Z _]+\]/` as written matches
  ordinary JS and SQL: `[SCHEMA_HASH]` (`db.js:2563`), `[PORTAL_COOKIE]`
  (`server.js:20892`), `data: [DONE]` (`server.js:10063`), and every
  `[ORG]` parameter array in the suites. So the guard implements the *family* in
  two halves that are both precise: **(1)** any bracketed run of all-caps words
  containing a **space** — never valid JS, and the shape of every real
  placeholder (`[LEGAL ENTITY NAME]`, `[LAST NAME]`, `[YOUR ADDRESS]`); **(2)** a
  bracketed single token drawn from a placeholder **vocabulary** (`TODO`, `TBD`,
  `FIXME`, `PLACEHOLDER`, `ENTITY`, `LEGAL_ENTITY`, `LEGAL_ENTITY_NAME`,
  `ENTITY_NAME`, `COMPANY`, `COMPANY_NAME`, `LLC`, `ADDRESS`, `EIN`, `TAX_ID`),
  which catches the underscored cousins the space rule cannot see.
- **The tax-ID guard.** A bare "no `\b\d{2}-\d{7}\b` outside tests/fixtures"
  would fail on day one against §F — `db.js`, `scripts/`, `PROGRESS.md`. It is
  therefore an **allowlist**: any EIN-shaped string in the repo that is not one
  of the eleven enumerated fake values fails the build, anywhere, forever. A
  newly pasted real tax ID has nowhere to land. This is strictly stronger than
  the literal form, because it also covers `tests/` and `fixtures/`, which the
  literal form would have exempted.
- **Exclusions, each with a reason.** `tests/fixtures/` and `audit/` per the
  brief; `node_modules/`, `.git/`, `client/dist/`, `package-lock.json` as
  non-source; and **`docs/`** — frozen screenshot/HTML/verifier-output captures
  of past states (§D-8). `docs/` is an addition to the brief's exclusion list and
  is called out here rather than made silently.

Also asserted: the literal string `Steward Software LLC` appears in **exactly
one** module (`shared/legalEntity.js`) plus the pin in the guard itself —
nowhere else in `client/`, `server.js`, `shared/`, `routes/` or `scripts/`.

### Local-stack gotcha this pass paid for (costs an hour if rediscovered)

`tests/run-all.sh` reported **four** red suites — `portal-visual`,
`mapper-one-dropdown`, `donor-accounts`, `theme-depth` — and **none of them was
a regression.** Two causes, both environment:

1. **A stale `vite preview` was squatting :4173** from an earlier session,
   alongside the `scripts/local-preview.js` this repo requires. The proxy bound
   second, so `/portal-assets/…` returned `index.html` instead of image bytes and
   `portal-visual` timed out on `waiting for locator('header img')`. The
   diagnostic that names it in one line — the API serves the asset and the
   preview does not:
   ```
   curl -so /dev/null -w "%{http_code} %{content_type}\n" localhost:5601/portal-assets/<id>   # 200 image/webp
   curl -so /dev/null -w "%{http_code} %{content_type}\n" localhost:4173/portal-assets/<id>   # 200 text/html  ← squatter
   lsof -ti:4173   # two PIDs = the bug
   ```
   **`vite preview` is not a substitute for `scripts/local-preview.js`** — the
   README says so (BUILD-73), and a leftover one is worse than none because it
   answers.
2. **`client/dist` built without `VITE_API_URL=http://localhost:5601`** points
   the bundle at prod; the page loads, login succeeds at the API level, and the
   UI then renders nothing — which is how `mapper-one-dropdown` reported
   "button not found". Same class as the CORS gap the README already records:
   an environment fault wearing a UI fault's clothes.

Both were confirmed pre-existing by running the red suites in a **git worktree
at `b96374a`** (the commit before this pass) and watching them fail identically
— and note the trap in doing that: a fresh worktree has **no `client/dist`**, so
the browser suites SKIP and a skip is counted as a pass. The baseline comparison
only means anything after building dist in the worktree too.

After both were closed: **`bash tests/run-all.sh` → 133 suites passed, 0 failed.**

### Noticed while wiring the guard — not fixed, flagged

`tests/affected.sh`'s `CLIENT_SUITES` list omits **`landing-field`** and
**`donor-field`**, so a change to `client/src/pages/Landing.jsx` *alone* would
not run the landing golden locally (CI still runs the full battery, so it is a
pre-push speed gap, not a hole in verification). This pass touches `shared/` and
`package.json`, both of which force `FULL`, so it does not bite here. Worth one
line in a later pass. Not changed.

---

## §BLOCKED-1 — Part 2's fourth assertion, as written, cannot be made true

> *"A receipt rendered from the demo org names Steward Software LLC and the 40390
> address."*

The demo org is **CREO Arts** (`db.js:2566`, EIN `47-1234567`), a fictional NYC
nonprofit. Its receipt correctly names CREO Arts, CREO's EIN and CREO's address
(§D-1). Making this assertion pass would require printing Steward Software LLC's
name and Wilmore address on a §170 charitable contribution receipt issued by a
different organization — asserting into existence the precise defect the brief
opens by warning about.

**What was built instead**, in `tests/legal-entity.test.js`: a receipt rendered
from the demo org is asserted to name **the org's** legal name and address, and
to contain **no** occurrence of `Steward Software LLC` or the Wilmore address.
Same guard, correct direction — it is the assertion that actually protects a
gift receipt from naming the wrong entity.

Full detail and the three ways this could be resolved instead are in
**`BLOCKED-fix-legal-entity.md`**. Everything else in Parts 0–3 is complete; this
one assertion is inverted and flagged rather than skipped, so nothing is left
unverified.

---

## PART 3 · Documents that live outside this repo

**owner: Jonathan, in Cowork** — not edited here:

| Document | Note |
|---|---|
| `steward-founding-partner-agreement.md` | names a legal counterparty; needs the LLC name, state and address |
| `steward-data-handling.md` | the customer-facing document. **Source of truth for `client/src/pages/PrivacyPage.jsx`** — the repo copy was filled in this pass; Cowork must match |
| `steward-terms-draft.md` | **Source of truth for `client/src/pages/TermsPage.jsx`** — same; repo copy filled, Cowork must match |
| Cowork artifact "Steward Landing Page" | carries the same `[LEGAL ENTITY NAME]` © line the repo just filled |

**Direction of truth, stated once:** the Cowork documents are authoritative for
*wording*; the repo pages are the *rendered* copies and were filled only by
defining an existing undefined term. If Cowork's wording later diverges, the
repo pages follow Cowork, not the reverse.
