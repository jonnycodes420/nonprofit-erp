# BUILD-74 — FINDINGS

Landing page trim. Branch `landing-trim`, cut from `261dc73`.

**Deploy ground truth at start** (`node scripts/status.js`):
local HEAD `261dc73` · origin/main `261dc73` · prod backend `261dc73` ·
prod frontend `261dc73`. Aligned.

---

## THE HONESTY NOTE — read this before adding anything to the landing page

BUILD-74 removed **"Who built this."** BUILD-73 Part 4 had already removed
**"Here is what Steward doesn't do"** (see below). Between them, every sentence
on the landing page that stated a limitation out loud is now gone:

- "Steward has no customers yet"
- no events / ticketing / auctions / peer-to-peer
- no track record
- thin integrations
- it is one person
- "I am young for this and I am not going to pretend otherwise"
- "Fifteen minutes, and I will tell you if Steward is wrong for you"

**Those limitations did not stop being true. They moved from the product into
the sales conversation.** The copy is gone; the constraint it described is not.

This is written down because the failure mode is specific and quiet: a future
session reads a page with no "we have no customers yet" on it, concludes the
page is free to imply the opposite, and adds a logo bar, a customer count, a
"trusted by", a "join hundreds of nonprofits", a review score or a testimonial.
None of those would contradict anything on the page any more. **The absence of
the disclaimer is not permission.** Steward's customer count at the time of
writing is zero, and the page must not imply otherwise until that changes and
someone can name the customers.

The guard is `scripts/landing-prod-verify.js` §3, and BUILD-74 deliberately
made it **broader** rather than deleting it with the copy: it asserts on the
whole FAMILY (logo imagery, trusted-by, as-seen-in, join-hundreds-of, star
ratings, "N customers use", testimonials, customer counts) rather than on the
one string that left the page. Asserting on a string that no longer exists
would have passed vacuously forever.

Unchanged and still guarded, for the same reason:

- the FEP attribution, **"full-year 2025" verbatim** — FEP rebased in Q1 2026
  and now headlines a QUARTERLY figure, so dropping those two words silently
  changes what the number means;
- no competitor cited as the authority (Bloomerang republishes FEP's number);
- no "keep 100% of every gift" overclaim — Stripe's own fee still applies;
- no outcome-claim language;
- no pricing anywhere in the rendered text.

---

## PART 1 — WHAT WAS ACTUALLY THERE TO CUT

### "Here is what Steward doesn't do" was ALREADY GONE

The brief asked for two deletions. Only one section existed.

`ee2ed3e` (BUILD-73 Part 4) deleted the four-gap grid on Jonathan's explicit
in-session instruction — its own commit message records it: *"the brief said
keep it verbatim; the instruction was 'get rid of this section BEFORE YOU
ASK.'"* Confirmed three ways before assuming it: no match in `Landing.jsx`, no
match in any test or script, and **no match in the rendered text of deployed
prod** (`https://www.stewardapp.dev/`, checked at `261dc73`).

So BUILD-74 is one deletion, not two. Nothing was silently skipped.

### The brief's post-cut section rhythm was stale

The brief predicted: Nav · Hero · Source strip · One year · Every dot ·
What it does · Closing · Footer.

The built page is: Nav · Hero (`#E8E4DB`) · Source strip (`#F0EDE6`) ·
**Built for orgs like yours (`#E8E4DB`)** · One year (ink) · Every dot
(`#F0EDE6`) · What it does (`#E8E4DB`) · Closing (ink) · Footer (ink).

"Built for orgs like yours" is on the page and stays — BUILD-73 kept it on a
mid-build screenshot instruction, and its commit records that too. The brief's
list simply predates it. Measured on the built page rather than trusted:
**no two adjacent sections share a background**, so nothing needed rebalancing.
(Closing and Footer are both ink by design, separated by a hairline; the brief's
own list has them that way.)

### What went with the founder section

- `PLACEHOLDERS.founderLastName` `[LAST NAME]`, `founderSchool` `[SCHOOL]`,
  `founderPhoto` `[ FOUNDER PHOTO ]` — deleted. `legalEntity`
  `[LEGAL ENTITY NAME]` stays; it is still the © line.
- `.lp-founder` grid, and its entry in the 1080px collapse query.
- The `Placeholder` component's `block` variant — the founder photo slot was
  its only caller.
- The four founder paragraphs, the pulled-out line, the CTA pair, and the
  `landing-prod-verify.js` assertion on *"You didn't take this job to chase
  money."*

`FOUNDER_MAILTO` **stays** — `CalendlyModal` still offers it as the write-
instead-of-book path.

---

## A REAL DEFECT FOUND WHILE IN THE FILE

The `Placeholder` component hardcoded `color: C.ink3` — a warm grey chosen for
the cream grounds. After the founder section went, its **only** surviving
caller is the © line in the **ink footer**, where that grey measured
**2.42:1**. Its dashed border, `rgba(15, 26, 18, 0.32)`, was dark-on-dark and
effectively invisible.

A placeholder nobody can read is exactly the failure that component exists to
prevent: the footer looked like a finished "© 2026" instead of an obviously
unfilled value. Colour and border are now `inherit` / `currentColor`, so it
renders in the footer's sage (6.98:1) and stays legible on whatever ground it
is dropped onto next.

This predates BUILD-74 — it was 3.0:1 before the grey was darkened, so it
failed AA either way. It was found by sweeping every text element rather than
the two the old gate sampled.

---

## THE CONTRAST FLOOR

`C.ink3` **`#6B6560` → `#5A554F`**.

`#6B6560` on `#E8E4DB` measured **4.53:1** — AA, and it read fine on the live
page. The problem was the margin: 0.03 of headroom means a future nudge to
either value drops it under with nothing to catch it. `#5A554F` is **5.81:1**
on the same ground (6.31:1 on `#F0EDE6`), visually near-identical.

`landing-prod-verify.js` §5 previously sampled **two** elements (`h1` and the
lede) at a 4.5 floor. It now sweeps **every visible text element** at a floor
of **5.0**. Measured worst case on the built page: **5.81:1** across 75
elements. Sampling two elements was never the point; having a margin a test can
catch is.

The decorative `01` / `02` / `03` card numerals measure ~1.7:1 and are now
marked `aria-hidden="true"` — they are sequence markers carrying nothing the
heading beneath them does not. The sweep skips `aria-hidden` subtrees, so the
exemption lives in the **markup**, where it is visible, rather than in a
selector exclusion list in the script, where it could quietly grow.

`#5a554f` is allowlisted in `tests/brand-allowlist.test.js` EXTRAS with its
reason. **`T.ink3` in `shared.jsx` is unchanged** — this is a landing-page-only
divergence, and `Landing.jsx` says so at the constant.

---

## THE GUARD COUNT

`landing-prod-verify.js`: **30 → 29**. It now prints the delta on every run and
says out loud that an unchanged count after a section deletion means a stale
guard survived.

Removed / merged:
- the `"You didn't take this job to chase money."` section assertion (list entry);
- the founder placeholders, folded into a single © assertion;
- **two** contrast assertions collapsed into **one** sweep.

Broadened (not added):
- the social-proof family, per the honesty note above.

**Deliberately NOT added**, and recorded here as an accepted gap: a guard for
*"the founder placeholders stayed gone."* It would have put the count back at
30, which is the exact signal this build asked the file to raise. `/pricing`
still resolving as a direct route is likewise verified in-session rather than
guarded, for the same reason. Both are fair candidates for a later build that
is not under a shrink-the-count rule.

---

## VERIFICATION — AGAINST DEPLOYED BYTES

Prod (`main`) has **not** been touched. `vercel.json` sets
`git.deploymentEnabled.main = false`, so main deploys only through the
`deploy-vercel` Actions job — merging is a production deploy of the public
marketing site, and that is Jonathan's call.

What was verified instead is the **branch preview Vercel built from the pushed
commit** — `d005afa`, deployment `dpl_5NeJxdsRVMPUTGnZ2ogTM55v2Pmk`, READY at
`client-git-landing-trim-jonnycodes420s-projects.vercel.app`. Deployed bytes,
not the local build. The preview is SSO-protected, so the committed
`landing-prod-verify.js` ran unmodified against it through a scratch localhost
proxy carrying the preview's `_vercel_jwt` cookie (proxy lives in the session
scratchpad, not the repo — it injects one cookie and changes nothing else).

```
BASE=<preview> node scripts/landing-prod-verify.js
29 passed, 0 failed
29 guards ran — 1 FEWER than BUILD-73's 30.
```

Against that same deployment:

1. **Both sections gone at 1440 and 390** — and at 320, 768, 1024, 1920. No
   match for the founder copy, `WHO BUILT THIS`, `[ FOUNDER PHOTO ]`,
   `[SCHOOL]`, `[LAST NAME]`, or any of the doesn't-do gap copy.
2. **No orphaned constants, no dead anchors, no console errors, no asset 404s.**
   (The two `SyntaxError`s that appear on a LOCAL `vite preview` are its SPA
   fallback serving HTML for `/_vercel/insights/script.js` and
   `/_vercel/speed-insights/script.js`. Deployed, those are real scripts and
   the console is clean — which is why prod was clean at 30/30 too.)
3. **Contrast floor holds at 5.0 on every text element** — 75 elements, worst
   case 5.81:1.
4. **CLS 0.0000** over a full mobile scroll; **no horizontal scroll** at 320,
   390, 768, 1024, 1440, 1920.
5. **Dot field correct** — four fields of 199, hero 74, January 0, June 31,
   December 74, June a genuine subset of December.
6. **Reduced motion** renders all 796 dots at full opacity.
7. **Zero pricing in rendered text**; `/pricing` still resolves for a direct
   link (renders "Two plans, split on a real line."), and no `/pricing` link
   appears in nav or footer.
8. **Fresh captures in `docs/landing/`** at DPR 2, replacing the previous ones:
   `landing-1440.png`, `landing-390.png`, `landing-1440-reduced-motion.png`,
   `year-section-1440.png`, `year-section-390.png`. The stale untracked
   `prod-1440.png` (a BUILD-73 leftover) was removed.

Local gates green as well: `landing-field` 37/37, `landing-reveal` 7/7,
`brand-allowlist` 27/27, `eslint src && vite build` clean, and the full
`bash tests/run-all.sh` at **111 suites / 0 failed** (the pre-push hook ran it
again on the push).

Environment note for whoever picks this up: the scratch stack had been lost to
a reboot and needed rebuilding — Postgres 16 on `:5544` **with SSL enabled**
(`db.js` hardcodes `ssl: { rejectUnauthorized: false }`, so a non-SSL cluster
fails at `initSchema`), and `portal-visual` needs
`scripts/local-preview.js` on `:4173` rather than a plain `vite preview`
(the rewrite table is what lets the portal reach the API same-origin). Both are
in `tests/README.md`; neither is a regression.

---

## PART 2 — NOT BUILT, AWAITING JONATHAN

The build ships without the line above the closing CTA. The captures above are
what the page looks like without it, at both widths, so the call can be made
against the real thing rather than a description.

The seam is real: at 1440 the page runs from the third feature card straight
into "Find out which of yours are gold." with nothing human between them.
Whether that reads as abrupt or as clean is a judgement, and it is not mine.

The proposed line, if wanted: *Built alongside a career development officer.*
One line, above the closing CTA. No name, no photo, no bio, no age.
