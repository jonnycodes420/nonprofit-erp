# Computed rate / percentage / conversion denominators — enumeration (2026-08-08)

Deliverable for Item 2. After fixing the solicitations **win rate** (it counted
open asks in the denominator), every other computed rate/percentage/conversion
figure in the app was enumerated and its denominator checked. **The win rate was
the only instance of the "undecided items in the denominator" bug.** The closest
analog — the failed-card recovery rate — was already correct.

| # | Figure | Location (server.js) | Numerator ÷ **Denominator** | Verdict |
|---|--------|----------------------|------------------------------|---------|
| 1 | **Officer win rate** | `reportSolicitations` ~10513 | won ÷ **(won + lost)** — decided asks only | **FIXED** (was won ÷ (won+open); open asks aren't losses). null when 0 decided. |
| 2 | Recovery rate | `computeRecoveryRate` | recovered ÷ **(recovered + canceled)** over 90d | ✅ correct — the same decided-only shape as the fixed win rate. null when 0 decided. |
| 3 | Retention rate | `computeRetentionRate` ~15087; reports 10303/10455; annual 8343; board 9769 | retained ÷ **donors who gave in the prior year** | ✅ correct (BUILD-33 definition). null/0 when no prior-year donors. |
| 4 | Dollar retention rate | reports 10305 | retained donors' current-yr $ ÷ **ALL prior-year $** | ✅ correct — can exceed 100% by design. |
| 5 | First-year retention rate | reports 10307 | first-yr retained ÷ **donors whose first gift was the prior year** | ✅ correct. |
| 6 | Growth % (period / org / 3-yr change) | growthPct 10452, orgGrowthPct 10392, changePct 10381, qChange 9942 | (cur − prior) ÷ **prior period total** | ✅ correct. null when prior = 0 (new money has no base). |
| 7 | Goal % / rawPercent / pace / goalPct | 6729/6732, 7603/7604, 7760/7761, 8355 | raised ÷ **goal amount** | ✅ correct. `percent` capped at 100 (bar width), `rawPercent` uncapped. |
| 8 | Share-of-total % (by fund / campaign / page; fund affinity; contribution %) | 5497, 6870, 10238, 10456/10457 | part ÷ **total giving / grand total** | ✅ correct (a share of the whole). |
| 9 | Program-expense ratio | 5993 | program expenses ÷ **YTD total expenses** | ✅ correct. |
| 10 | Avg email open rate | board report 9787 | mean over campaigns of open_count ÷ **recipient_count** | ✅ per-campaign denom is recipients. NB it's an *unweighted mean of rates*, not pooled opens÷recipients — a documented stylistic choice, not a defect. |
| 11 | Fee-elsewhere estimate % | 13239 `feeAssumptionPct` | fixed 3% assumption, labeled inline | ✅ not a computed rate — a stated counterfactual. |

**Client-side:** the win rate, retention, goal %, and shares above are all
computed server-side and merely rendered by `Reports.jsx` / `Dashboard.jsx` /
`Fundraising.jsx`; no independent rate math lives in the client. The
stage-weighted forecast (`byStage.weighted`) is a weighted **sum** (ask ×
STAGE_WEIGHT), not a rate.

**Conclusion:** one genuine denominator bug (win rate), now fixed and pinned by
`tests/solicitations-winrate.test.js`. The pattern "did we count undecided
items as failures?" was checked against every rate; the only other decided-vs-
undecided rate (recovery) already excludes still-at-risk subscriptions.
