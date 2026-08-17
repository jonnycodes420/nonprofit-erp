# BLOCKED / undecidable — BUILD-60

Items BUILD-60 raised that cannot be resolved from code + sensible defaults alone.

## 1. Auto-renewal / negative-option disclosure is an ATTORNEY item (Part 2)
Pre-selecting a recurring charge and stating a commitment ("$25 every month until
you cancel — $300 a year") is exactly the pattern that state auto-renewal /
negative-option laws regulate, and the rules **vary by state** (California's ARL,
and others, carry specific consent, "clear and conspicuous" disclosure, and
cancel-path requirements). The plain-language disclosure shipped here (on the
button and immediately beside it, restated on the confirmation screen and the
receipt) is the honest default — but whether it satisfies each state's statutory
text is a legal conclusion **code must not make**. Put on the attorney list with
the network legal pass (`BLOCKED-legal-network.md`).

## 2. "Returning donor defaults to their last gift" is UNWIRED — the public give page has no donor identity (Part 2, decision-table row "Returning donor")
The decision table says a recognized returning donor should default to what they
gave last time. **The public `/give/:orgSlug` page is anonymous** — it takes an
email only at submit time, has no donor session, and (correctly, per the org-
blindness wall) the public payload exposes no donor records. So there is no seam
on this page to recognize a returning donor and preselect their prior amount
without either (a) an authenticated donor-portal/giving-account session handing
off into the give flow, or (b) a tokenized "give again" link minted for a known
donor (the recurring-proposal machinery from BUILD-57 is the closest existing
seam). Both are real builds with their own privacy review — you cannot look a
donor up by a typed email on a public page and prefill their history (that would
leak "this email gave $X" to anyone who types it). **Deferred**: wire the
last-gift default only through an *authenticated* entry (portal → give handoff),
never an anonymous email lookup. Everything else in Part 2 (frequency-first,
monthly default, per-frequency org-configurable ladders, middle-tier preselect,
switch re-selects middle, full disclosure) shipped.

## 3. "Middle tier" vs the stated "$50 one-time / $25 monthly" (Part 2, item 4)
The decision table says "middle tier of the active ladder"; the prose gives the
concrete values "$50 one-time, $25 monthly" — which are the **second** tier of
the default 5-item ladders `25/50/100/250/500` and `10/25/50/100/250`, not the
mathematical middle (index 2 = $100 / $50). I honored the **concrete stated
dollar amounts** (second tier — the low-friction ask the prose clearly intends,
and what a reviewer will eyeball) via `defaultTierIndex(ladder) = 1`. If you
actually meant the literal center tier, it's a one-line change in
`Donate.jsx` (`defaultTierIndex`). Flagging because the two readings genuinely
conflict for a 5-item ladder.

## 4. Part 3 (non-destructive crop control) — NOT built this session
A real crop rectangle (drag/resize/zoom, ratio-constrained, non-destructive
normalized coords, across every image slot, preview==render) is a multi-day
build in its own right (editor UI + a normalized-crop storage column per slot +
render plumbing through PortalBanner and every image site + the preview==render
proof). It is scoped, not started — see `audit/BUILD-60-FINDINGS.md` for the
approach. The BUILD-59 focal point remains the current composition control.
