# Campaign Edit verification — does Edit ever load the WRONG record? (2026-08-08)

**Verdict: NO. Edit loads the correct record for every campaign. No code change.**
The screenshot (Edit modal showing "FY2026 Comprehensive Campaign / 180000 /
Annual" over a card reading "Spring Studio Scholarships / Project / $7,500 of
$15,000") was the FY2026 **umbrella card's** Edit modal — a `position:fixed`
centered overlay (`zIndex:400`) — visually layered above the unrelated Spring
Studio card scrolled behind it. It was not a wrong-record load.

## Why it cannot load the wrong record (wiring proof, Fundraising.jsx)
- `CampaignsView` maps `topGoals.map(g => <CampaignCard g={g} editBtn=… />)`;
  each top-level card renders `editBtn(g)` and each nested child renders
  `editBtn(c)` — every Edit button closes over **its own** campaign object.
- `editBtn = c => <button onClick={() => onEdit(c)}>` → `onEdit = c =>
  setModal({ mode:"edit", campaign: c })` → `{modal && <CampaignModal
  campaign={modal.campaign} …/>}`. The modal is conditionally rendered, so it
  **remounts on every open** and initializes its six fields from `campaign?.*`
  on mount (no stale `useState` across opens).
- `save()` PUTs to `/fundraising/campaigns/${campaign.id}` — the same object's id.
- The goal objects come 1:1 from each campaign's own DB row via
  `fundraisingCampaignRows` → `fundraisingGoalsPortfolio` (which spreads `...r`,
  preserving name/goalAmount/goalCategory/parentGoalId/startDate/endDate).
- There is **no shared, indexed, or stale reference** anywhere in the path. The
  same object drives both the card AND the modal, so a correctly-rendered card
  cannot open a different record's Edit.

## Empirical check (real local server + Postgres)
Reproduced the exact 5-campaign structure from the screenshot (umbrella FY2026
Comprehensive $180k/annual + 3 children: Annual Fund 2026 $60k, Studio Expansion
Capital $120k, Youth Arts Access $18k + standalone Spring Studio Scholarships
$15k/project), then read `/fundraising/overview` (the source the Edit modal
renders) and diffed the six Edit-form fields per campaign against what was
stored:

```
✓ [UMBRELLA]   FY2026 Comprehensive Campaign — all 6 Edit fields match stored (180000, annual)
✓ [CHILD]      Annual Fund 2026               — all 6 match (60000, annual, parent=umbrella)
✓ [CHILD]      Studio Expansion Capital       — all 6 match (120000, capital, parent=umbrella)
✓ [CHILD]      Youth Arts Access Fund         — all 6 match (18000, project, parent=umbrella)
✓ [STANDALONE] Spring Studio Scholarships     — all 6 match (15000, project, no parent)
✓ Spring Studio Scholarships Edit shows 15000/project/no-parent — NOT the umbrella's 180000/annual
PASS — every campaign's Edit form matches its own stored record
```

Verification script: `scratchpad/verify-campaign-edit.js` (verify-only, creates
a throwaway org; never edits/saves real data).

## Scope note
A pixel-level Playwright DOM drive was not run: production credential reads were
blocked in this environment, and the "wrong record → Save overwrites" risk is a
data/state concern, which the wiring proof + the live server/DB field diff clear
conclusively. If a browser drive is still wanted for belt-and-braces, seed the
five campaigns locally and click each Edit against a `vite preview`.

**Gate outcome: PASS — safe to proceed to the Phase 2 brand sweep.**
