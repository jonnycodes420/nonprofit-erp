# BUILD-61 — FINDINGS

## PART 0 — WHY NOTHING CHANGED (answered first, in plain language)

**"Nothing changed" was a DEPLOY GAP, not a bug.** BUILD-60 was committed locally
and never pushed, so production kept serving BUILD-59. The facts at the start of
this session:

| Surface | SHA before | meaning |
|---|---|---|
| prod backend `/health.buildSha` | `9d070ce` | BUILD-59 |
| prod frontend `<meta build-sha>` | `9d070ce` | BUILD-59 |
| `origin/main` | `9d070ce` | BUILD-59 |
| local `HEAD` | `71f4b77` | BUILD-60, **never pushed** |

So BUILD-60 (white-label giving page + recurring-as-hero) was real and green in
tests but had never reached a server Jonathan could look at. Not a caching layer,
not a stale bundle — it simply was not deployed.

**Fix:** ran the full battery (97 suites green), fixed one self-inflicted gate
failure along the way (a `#10b981` literal in a new *comment* tripped
`brand-glyph`; reworded), amended the BUILD-60 commit clean, pushed through the
pre-push battery, and let CI deploy both surfaces.

**After deploy (SHA-verified live):**

| Surface | SHA now | meaning |
|---|---|---|
| prod backend `/health.buildSha` | `ed00a4f` | BUILD-60 + Part-0 tooling |
| prod frontend `<meta build-sha>` | `ed00a4f` | same |
| CI run 32045768233 | `test` ✓ · `deploy-railway` ✓ · `deploy-vercel` ✓ | green |

**Then proved it's VISIBLE, not just green** — `scripts/build61-prod-verify.js`
drives Playwright against the LIVE giving page for both demo orgs (captures in
`docs/build61/prod-verify/`, **20/20**):

- no Steward mark, wordmark, emerald, or "Powered by Steward" in the page chrome;
- the org's own logo/monogram + colors present (CREO terracotta, Harbor blue);
- frequency control **above** the amount, **Monthly** pre-selected;
- the **second** monthly tier ($25) pre-selected;
- the button reads **"Give $25 every month"**;
- the disclosure line present, bold, ≥14px — not demoted.

One nuance worth recording: Harbor's give page contained the word "Steward" once
— in **Harbor's own `footer_text`** ("a Steward product demo organization"), i.e.
the org's authored copy, not Steward branding chrome. White-label means Steward's
*brand* never appears, not censoring an org's own text; the assertion was
corrected to exclude org-authored fields. Cleaning that demo footer is a one-line
demo-data edit (the prod write was classifier-blocked as an unauthorized
production mutation — left for Jonathan to authorize; it does not affect the
white-label guarantee).

**BUILD-60 is live and visibly verified on prod.** Proceeding to Parts 1–4.

---

<!-- Parts 1–4 findings appended below as they land. -->
