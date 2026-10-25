# NUMBERS-1: every money and donor number Steward shows or sends

This is an inventory of every number Steward shows on a screen, prints in a PDF, sends in an email or writes into an export, where that number comes from gifts, pledges, donors or goals. For each one it says where it is computed and whether it is STORED (a column, cache or rollup that a write keeps up to date) or LIVE (added up from `gifts` when it is read). It was built by reading the code on 21 Oct 2026: nothing was run, so line numbers are as of that tree and every finding is from reading, not from a database. File paths are from the repo root. "fs" means `figureSources.js`.

Two baselines the tables refer to:

- **The `gifts` source** (fs:378-407) and **`reportGiftWhere`** (routes/crm.js:22688-22697) count every gift row of a person who is not deleted: sample gifts, refunds (negative rows) and every gift type included.
- **The donor rollup columns** `donors.total_giving`, `gift_count`, `last_gift_date`, `last_gift_amount` are changed in four ways:
  - `recordGift` adds to them (server.js:1204-1217).
  - `recalcDonorSummary` rebuilds them from `gifts` (server.js:3392-3418). It is called by gift edit (crm.js:7229), gift delete (crm.js:7320), Stripe refunds and lost disputes (webhooks.js:997, 1023, 1089), dispute reinstatement (webhooks.js:1179), import reverse (crm.js:9497) and the QuickBooks reversal (qboRead.js:651, 700).
  - `recalcDonorSummaryBatch` rebuilds them too (afterChange.js:53-77). It is called by `afterChange` when recalc is on (afterChange.js:190), import-combined (crm.js:5916), import-history (crm.js:9793), recent-gift import (crm.js:1003) and merge undo (crm.js:9555).
  - `mergePeople` rewrites them inline (routes/dataHealth.js:528-531).

  Donor file imports and the quick-add form write them directly, with no gift rows behind them (crm.js:4960, 5466, 4566). `donors.first_gift_date` is a fifth column with no write-time upkeep (see Suspected disagreements).

## Donor profile header and glance

| Number | Shown on | Computed in | Stored or live | Notes |
|---|---|---|---|---|
| Lifetime | Profile header (ProfileHeaderFigures.jsx:78), glance (ProfileStatus.jsx) | fs `donor-lifetime` (fs:793-824), via crm.js:4266 `donorProfileFigures` and routes/profileStatus.js:217 | LIVE, plus one STORED row | Sum of the person's gift rows. Adds a "Giving before Steward" row when `total_giving` is above that sum (fs:806-821). |
| This year | Profile header (ProfileHeaderFigures.jsx:81) | fs `donor-gifts-between` (fs:1238), Jan 1 to the org's today (crm.js:4279) | LIVE | Calendar year, whatever the org's fiscal year. Refunds come off. |
| Last gift | Profile header, plus the date under it | fs `donor-last-gift` (fs:859-868) | LIVE | Same-day tie broken by `g.id DESC`. |
| Average gift | Profile header (ProfileHeaderFigures.jsx:88), glance | fs `donor-average-gift` (fs:1313-1325), measure `per_gift` (fs:2623-2627); refund and imported notes from profileStatus.js:227-243 | LIVE | Net sum divided by the number of rows above zero. |
| First gift | Profile header "First / Largest" | fs `donor-first-gift` (fs:1287) | LIVE | `amount > 0`, earliest date, tie by id. |
| Largest gift | Profile header | fs `donor-largest-gift` (fs:1297) | LIVE | `amount > 0`. |
| Contact gap, last met, last email, open ask | Profile header | fs `donor-contact-gap`, `donor-last-met`, `donor-last-email`, `donor-open-ask` (fs:869-984) | LIVE | Not money from gifts. Listed because they sit in the same row. |
| Status tags: giving level, lifecycle, retained | Profile tags, Directory filters | donorStatus.js:86 `statusSql`, fs `donors-by-status` (fs:1326) | LIVE | Last 12 months in org time, with cut points of $1,000 and $10,000 (donorStatus.js:26). |
| Highlights: streak, season, "latest is largest", first-at | Profile | routes/profileStatus.js:110-155 | LIVE | Each opens `donor-gifts-between` or `donor-largest-gift`. |
| Rhythm, expected next gift | Profile (crm.js:4404) | `donor_rhythm`, written by afterChange.js:118-165 `rhythmFor` | STORED | Written only by `afterChange`. |
| donor_rhythm `giving_this_year`, `giving_last_year`, `largest_gift` | Nothing reads them | afterChange.js:133-139 | STORED | Positive gifts only. A second "this year" that no screen shows. |
| "Donor since" year | Profile (DonorProfile.jsx:832) | `donors.first_gift_date` | STORED | |
| Generosity and engagement parts | Profile score drawers | engagement.js `partRows`, via fs:830-858 | STORED score; parts LIVE | Lifetime part is "net of refunds". |

## Gifts & pledges tab

| Number | Shown on | Computed in | Stored or live | Notes |
|---|---|---|---|---|
| Tab total | Gifts tab footer (DonorProfile.jsx:2577) | Client sum over GET /donors/:id gifts (crm.js:4324, DonorProfile.jsx:1432-1448) | LIVE, summed in the browser | Float sum in JavaScript, where `donor-lifetime` uses cents. |
| Gift count on tab and footer | Tab label (DonorProfile.jsx:2234), footer | DonorProfile.jsx:1174, `amount > 0` | LIVE | |
| Refunds taken off | Footer (DonorProfile.jsx:2578) | DonorProfile.jsx:1175 | LIVE | |
| Imported history not itemized | Footer note (DonorProfile.jsx:2579-2580) | `donor.total` (stored `total_giving`) minus the client sum | STORED minus LIVE | |
| Pledge paid, balance, surplus, display status | Pledge rows | GET /donors/:id/pledges (crm.js:7348-7373) | LIVE paid, STORED `pledges.status` | `pledges.status`, `surplus_amount` and `fulfilled_gift_id` are kept by `recalcPledgePayment` (server.js:3534-3568). Gift edit (crm.js:7242), delete, refund (webhooks.js:995, 1020), QBO reversal and import reverse call it. |
| Pledged, not yet paid (org) | Fundraising, Ask | fs `pledges-open` (fs:1899-1915) | LIVE | Remainder clamped at zero. No deleted-donor or shell filter. |
| Pledged and paid | Fundraising | fs `pledge-payments` (fs:1916) | LIVE | |
| Late pledge instalments | Home sentence | crm.js:18308 | LIVE, then cached in org_summary | Excludes sample donors (crm.js:18314). |

## Households, organisations and soft credits

| Number | Shown on | Computed in | Stored or live | Notes |
|---|---|---|---|---|
| Hard credit (household panel) | Profile Related tab (DonorProfile.jsx:3018) | GET /donors/:id/soft-credit (crm.js:10227-10229) | STORED `total_giving` | |
| Household soft credit | DonorProfile.jsx:3019 | crm.js:10232-10237; fs `household-giving` except (fs:483-502) | STORED | The household's other members' `total_giving`. A different idea from `gift_soft_credits`. |
| Household combined | Related tab, member rows (DonorProfile.jsx:3031) | fs `household-giving` (fs:483) | STORED | Grouped by `donors.household_id`. |
| Household total (linked) | Related tab banner (DonorProfile.jsx:3042) | fs `linked-household-giving` (fs:504-526), via crm.js:14450-14454 | STORED | Grouped by `donor_relationships` spouse or household, not by `household_id`. |
| "Individually" beside household total | DonorProfile.jsx:3042 | `donor.total` (client/src/api.js:286) | STORED | |
| Their own giving / with soft credit | Profile Gifts tab (DonorProfile.jsx:2542-2543) | crm.js:10229 (hard) plus `gift_soft_credits` rows (crm.js:10255-10264) | STORED hard, LIVE soft | Soft part is summed from at most 200 rows (LIMIT 200 at crm.js:10263). |
| Hard and soft credit totals (census) | Profile census lines | server.js:1687-1697 `donorCreditTotals` | LIVE | Hard is SUM(gifts). |
| Raised for (peer-to-peer soft credit) | Profile | crm.js:10266-10273 | LIVE | Same 200-row cap. |
| Organisation's lifetime | Organisation profile | Same `donor-lifetime` and donor columns as a person | Same as a person | An org is a `donors` row. Employee gifts and matches are separate rows; matches go through an employer pledge (server.js:1655-1672). |
| Top donors with soft credit | Reports > Top donors, `credit=soft` | crm.js:22978-22987 | STORED lifetime plus LIVE soft column | |

## Campaigns, goals, funds, appeals, pages, peer-to-peer and events

| Number | Shown on | Computed in | Stored or live | Notes |
|---|---|---|---|---|
| Campaign raised | CampaignsList.jsx, Fundraising.jsx goal cards, Grants.jsx:80, DonorPortalHub.jsx:69 | crm.js:20544-20621 `fundraisingCampaignRows`; drawer fs `goal-raised` (fs:1929-1947) | LIVE | `campaign_id = c.id OR campaign = c.name`. Net of `cover_fee_amount`, plus awarded grants. No date window, no sample filter, no deleted-donor filter. |
| Campaign raised (briefing card) | Communications.jsx:45-111 | GET /campaigns/:id/progress (crm.js:20430-20468) | LIVE | Same rule. No source. Pledged is not clamped (crm.js:20446). |
| Campaign goal | Every goal card | fs `campaign-goal` (fs:1960), `campaigns.goal_amount` | STORED (typed in) | |
| Goal progress % | Goal cards, Ask | crm.js:20482 `computeFundraisingPace`, fs `goal-progress` (fs:2287) | LIVE | |
| Campaign donors | CampaignsList.jsx:112, Communications.jsx:111 | crm.js:20558, 20439 `COUNT(DISTINCT donor_id)`; drawer fs `campaign-donors` (fs:1990-2006) | LIVE | |
| Campaign grants | Goal cards | fs `campaign-grants` (fs:2007) | LIVE | |
| Parent goal raised and progress | Fundraising.jsx | crm.js:20630-20688; fs `goal-rollup-raised` (fs:2192), `goal-rollup-progress` (fs:2212) | LIVE | Children only. |
| Fundraising overview combined goal | Fundraising.jsx:433-546, Dashboard.jsx | crm.js:20677-20686 | LIVE | Top-level goals that have not ended. |
| "$X raised across all" | Fundraising.jsx:476 | crm.js:20864 | LIVE | Every campaign with a goal, ended ones included. |
| Org goal current amount (Home banner) | Dashboard.jsx:743, 1309, 3277 | GET /goals/active (crm.js:19957-19994) | LIVE | Goal's own period, gross, deleted donors included. |
| Org goal current amount (Fundraising) | Fundraising.jsx:412, 620 | /fundraising/overview (crm.js:20763-20808) | LIVE, then org_summary | Fiscal or calendar period, gross, deleted excluded. Falls back to the contributions budget. |
| Annual goal | Home | crm.js:2047 | LIVE | |
| Raised this period, prior, this week, 12 months, all time | Home hero, Fundraising | crm.js:20714-20737 | LIVE, then org_summary | Gross. Period from `finPeriodBounds` (server.js:5483). |
| Giving page raised (admin) | Fundraising.jsx:1148, Settings.jsx:453 | routes/give.js:1691-1692, fs `page-raised` (fs:552) | LIVE | Net of cover fee. |
| Linked page's campaign raised (admin) | Fundraising.jsx:1149 | routes/give.js:1701-1702 (`goal-raised`) | LIVE | Includes grants. |
| Public page bar raised and campaign raised | Donate.jsx:1260-1261 | crm.js:21556-21559, sentence crm.js:21641-21651 | LIVE | `campaign_raised` has no grants. Page sum has no org filter. |
| Public page donor count | Donate.jsx:1294 | crm.js:21563-21566 | LIVE | `amount > 0`. Deleted donors included. |
| Campaign widget thermometer | Page and portal widgets | server.js:11259-11281 `resolveWidgetsPublic` | LIVE | Net, plus grants. |
| Portal campaign spotlight | Donor portal | routes/give.js:6171-6186 | LIVE | Net, plus grants. |
| Match claimed and remaining | Giving page | server.js:11309-11321 | LIVE | The only campaign figure bounded by a date (`match_started_at`). |
| Page gifts count | Page card | fs `page-gifts` (fs:568) | LIVE | Counts refund rows. |
| P2P fundraiser raised (public, leaderboard, Settings) | Donate.jsx:1357, 498; Settings.jsx:554 | crm.js:21599, 21745, 22116; give.js:2878, 3082 | LIVE | Net of cover fee, refunds in. |
| P2P team raised (board) | Donate.jsx:567 | crm.js:21728-21741 `p2pTeamBoard` | LIVE | Net. |
| P2P team raised (/teams list) | Donate.jsx:147 | crm.js:21884-21887 | LIVE | Gross, `amount > 0`. |
| P2P org screen totals | PeerToPeer.jsx:316 | give.js:2975-3027 | LIVE | Gross, `amount > 0`. |
| P2P manage-your-fundraiser | ManageFundraiser.jsx:135 | give.js:2733-2741, 2786 | LIVE | Gross, `amount > 0`. |
| P2P reports and CSV | PeerToPeer.jsx:378 | crm.js:23864-23895 | LIVE | Gross, `amount > 0`. |
| Event raised (card) | Events list | crm.js:27216-27221 | LIVE | `event_id`, or the linked campaign, or a name match. Also a copied `total_revenue = SUM(ea.gift_amount)`. |
| Event raised (detail) | Event page | crm.js:26890-26893 `EVENT_ROW_SQL.raised` | LIVE | `event_id` only. |
| Appeal "How did it do?" | HowDidItDo.jsx:50 | appealWhy.js:22-30, fs `appeal-why` (fs:1108) | LIVE | Gross, deleted excluded, text match only when `campaign_id` is null, no grants. |
| Emails sent (hub) | Communications.jsx:2220 | shared/campaignKind.js:105-108 sums `campaigns.recipient_count` | STORED | Written once, at send finalize (server.js:5383). Drawer fs `emails-sent` (fs:1010) counts `sent_at` live. |
| Emails sent per campaign | Communications.jsx:2503-2525 | crm.js:20283-20295 | LIVE, falls back to `recipient_count` | |
| Gifts within 30 days of an email | Communications | fs `email-tool-gifts` (fs:1036-1056) | LIVE | |
| Fund balance | Finance.jsx:840, 1787 | routes/finance.js:4407-4415, 365-437, 146-158 | STORED ledger (`fin_transactions`) | Stamped by `recordGift` (server.js:1222-1239). Moved by gift edit (crm.js:7236) and refunds (webhooks.js:1017). |
| Fund "who gave", no-fund gifts, by-fund report | Finance.jsx, Reports | finance.js:390-405, 227-242; crm.js:23103-23108 | LIVE from `gifts.fund_id` | |
| `campaigns.raised_amount` | Nothing (only leaks through `SELECT *` at crm.js:20258, 20317) | Column at db.js:1084; the only writer is the sample seed (crm.js:3679) | STORED, never maintained | No gift path writes it, and no code reads it. |

## Home, Dashboard, Lost & Found, donor list and org summary

| Number | Shown on | Computed in | Stored or live | Notes |
|---|---|---|---|---|
| Gifts YTD (mine) | Home My Portfolio | crm.js:18172 /dashboard/my-stats | LIVE | Deleted donors included. `parseInt` drops cents (crm.js:18192). |
| Gifts YTD drill-down | Home panel | crm.js:18418 | LIVE | Deleted excluded, cents kept. |
| Pipeline value (mine), portfolio value | Home | crm.js:18173, 18245-18249 | STORED `total_giving` | |
| Lapsed count (mine) | Home | crm.js:18174 | STORED `stage` | |
| Re-engaged dollars and donors | Home impact | crm.js:25218 /impact | LIVE, then org_summary | No join to donors, so deleted donors count. |
| Re-engage candidates | Home impact | crm.js:25286 | STORED amount, LIVE last gift | |
| Online giving processed | Home impact | crm.js:25246 | LIVE | |
| Retention % | Home tile, Board, board pack | server.js:11745 `computeRetentionRate`, via crm.js:20091 | LIVE, then org_summary and metric_snapshots | Calendar year. Deleted donors, refunds and samples included. |
| Retention breakdown | Home | crm.js:20182 | LIVE | |
| Stewardship debt | Home chip | server.js:11624-11660 | STORED `total_giving`, `first_gift_date` | Server clock (`Date.now()`). |
| First-touch delay | Home chip | server.js:11664-11695 | STORED `first_gift_date` | |
| Drift count, dollars at risk, list | Home, Drift, morning sentence | crm.js:18948, server.js:6986-7044 | STORED `donor_drift` | Cleared by a statement trigger on gifts (db.js:6963-6985). "Gifted" count reads stored `gift_count` (crm.js:18963). |
| Thread day figures | Home header and badges | shared/threadFigures.js `rowFigure` | LIVE | |
| Gifts not yet thanked | Home, People dashboard | fs `unthanked` (fs:684-696) | LIVE | Excludes sample gifts. |
| Org summary (every cached Home figure) | Home bundle | orgSummary.js `cached()`; triggers orgSummary.js:104-132 | STORED cache | Invalidated by a statement trigger on every table with an `org_id`, and keyed to the org's day. |
| Donor list Lifetime, Last gift, Gift count | Directory, Kanban | crm.js:3947 /donors, 4018 /donors/summaries; DonorDirectory.jsx:734-780 | STORED | |
| Donor list `status` filter (mid, major) | Directory | groups.js:85 reads `donors.status` | STORED | Raised by `recordGift` above $5,000 or $20,000 (server.js:1210-1212) and import (crm.js:9803-9811). Never lowered. |
| Donor counts (lapsed, re-engage) | Directory badges | routes/donorLookups.js:97-108 | STORED | |
| Lost & Found sections | Public audit page | shared/lostAndFound.js:153, shared/lostAndFoundRescue.js | LIVE over the uploaded file, in the browser | Calendar years. Browser UTC date (LostAndFound.jsx:212). |

## Reports, dashboards and the board pack

| Number | Shown on | Computed in | Stored or live | Notes |
|---|---|---|---|---|
| Giving summary total, count, average, median, online split | Reports, CSV | crm.js:22716 `reportGivingSummary`, figures crm.js:22775-22783 (`gifts` source) | LIVE | Average is measure `mean`: sum over all rows (fs:2629-2632). |
| Unique, new and returning donors | Giving summary, Annual | fs `givers` (fs:408-433) | LIVE | "New" is MIN over all rows (fs:420). |
| Same point last year | Giving summary, Board, Goals | crm.js:22752-22755, 2010-2013, 20045-20047 | LIVE, or `historical_totals` when Steward has nothing | |
| Monthly rows, prior period | Giving summary | crm.js:22723, 22768 | LIVE | Raw SQL, not a source. |
| By fund, campaign, page | Reports > By group | crm.js:22818 | LIVE | |
| LYBUNT and SYBUNT count and amount | Reports, CSV | fs `bunt` (fs:439-463); list crm.js:22885 | LIVE predicate, STORED lifetime column (crm.js:22891) | Any row counts as giving. Fiscal year by default. |
| Retention, dollar and first-year retention | Reports > Retention, CSV | crm.js:22914, fs `retention-window*` (fs:1466-1502, 2464-2497) | LIVE | Fiscal by default, `amount > 0`, deleted excluded. |
| Top donors, lifetime | Reports, CSV | crm.js:22969-22976, fs `top-lifetime` (fs:466) | STORED `total_giving`, `gift_count` | |
| Top donors, period (person and household) | Reports | crm.js:22997-23015 | LIVE | |
| Three-year comparison | Reports | crm.js:23025 | LIVE, beside `historical_totals` | |
| Annual report total, count, average, growth, new, retention, by fund, by campaign | Reports > Annual, PDF, CSV | crm.js:23078-23147 | LIVE | Raw SQL partly overwritten by source figures. |
| By month against last year | Reports | crm.js:23936 | LIVE | |
| Report builder people: lifetime, gift count, first and last gift | Report builder, saved reports | shared/reportBuilder.js:42-46 | STORED | Excludes sample donors (reportBuilder.js:30). |
| Report builder gifts entity, "Donors by fund" | Report builder | reportBuilder.js:57-60 | LIVE | Excludes sample gifts. |
| Report builder pledges: paid, remaining | Report builder | reportBuilder.js:94-101 | LIVE | Excludes deleted donors. |
| Old system totals | Reports, reconcile check | fs `historical-totals` (fs:528), oldReports.js, reconcile.js | STORED imported rows | Never added into gifts. |
| Board dashboard: giving this year, last year, change, by designation, by month, people who gave | Board dashboard | crm.js:1761-1793 | LIVE | Fiscal, org time. |
| Fundraising dashboard retention three ways | Fundraising dashboard | crm.js:1886-1902 | LIVE | The calendar option is `computeRetentionRate`. Fiscal and rolling use `retention-window`. |
| Concentration, top givers, drifting | People dashboard | fs `top-givers` / `topGiversSql` (fs:318), `drifting-top` (fs:2324) | LIVE | |
| Board pack: giving, last year, change, count, top gifts, people, retention | Board pack screen, PDF, email | shared/boardPack.js:62-123, crm.js:2376 `composeBoardPack`, PDF crm.js:2719-2730 | LIVE | Last year falls back to `historical_totals` (crm.js:2399-2401). Retention is calendar. |

## Statements, receipts and exports

| Number | Shown on | Computed in | Stored or live | Notes |
|---|---|---|---|---|
| Year-end statement lines, total, deductible total | Statement PDF and email | crm.js:7668-7692 `issueYearEndStatement`, statementTotals.js:21-32 | LIVE | Calendar year, hard-coded (crm.js:7672). Excludes sample gifts and lost disputes. No gift-type filter. |
| Gift receipt amount, deductible, quid pro quo | Receipt PDF and email | server.js:3786-3834 `issueGiftReceipt` | LIVE, then frozen in the receipt | Dispute forced to null (server.js:3800). Quid pro quo is set by `recordGift` (server.js:1173-1175). |
| Bookkeeper file: total, count, by fund, fee, net | Monthly close, CSV (Steward, QuickBooks, Xero layouts) | crm.js:23294 `reportBookkeeper`, bookkeeper.js:37 foot check | LIVE | Leaves out the types in `BOOKKEEPER_EXCLUDED_TYPES` (fs:108). Includes sample gifts. |
| Deposits file | Monthly close, CSV | crm.js:23457, depositsFile.js | LIVE | Same exclusions. |
| Donors CSV: total giving, gift count, last gift | Donors export | crm.js:4136-4149 | STORED | |
| Org export: gift count, first gift date | Full export | crm.js:27849 | STORED | |
| Any figure as CSV | Every drawer | crm.js:2908 /figures/:source/export.csv | Same as the source | |
| Xero and QuickBooks sync totals | Sync | xeroSync.js:137-139, qboSync.js:192-195 | LIVE | `amount > 0`, no sample gifts, no non-cash types (depositsFile.js:34). Credit types not excluded. |

## Ask and staff emails

| Number | Shown on | Computed in | Stored or live | Notes |
|---|---|---|---|---|
| Ask: raised, gift count, donor count, average, median, largest, new, recaptured | Ask box | askEngine.js:114-158 over `giftSet` (askEngine.js:72) | LIVE | All but "raised" use positive rows only (askEngine.js:115). |
| Ask: first-year retention | Ask box | askEngine.js:369-382 | LIVE | Calendar, `amount > 0`. |
| Ask: event revenue, raised in a campaign | Ask box | askEngine.js:45-56, 70 | LIVE | Gross, `event_id` only, deleted excluded. |
| Ask: lapsed, monthly and volunteer lists | Ask box | askEngine.js:86 | STORED `total_giving` per row | |
| Ask query people fields: lifetime, gift count, last gift, first and last gift date | Ask box | askQuery.js:34-44 | STORED | No sample filter. |
| Ask query gifts entity | Ask box | askQuery.js:60 | LIVE | `amount > 0`. |
| Ask query pledges entity | Ask box | askQuery.js:201-207 | LIVE | Excludes shells. Date is `created_at::date`, not org time. |
| Ask: old system's figure | Ask box | askEngine.js:265-273 | STORED `historical_totals` | Shown beside the answer, never substituted. |
| Week in Review: dollar total, gifts received | Weekly staff email | server.js:5745, 5704 (`gifts` source) | LIVE | Deleted excluded, samples included. |
| Officer monthly portfolio value | Monthly staff email | server.js:5797 | STORED `total_giving` | |
| Morning brief thread days | Daily staff email | server.js:6349, 6440 | LIVE | No dollar figures. Prints `daysOpen`. |

## Totals

Totals line: 125 numbers, 35 stored, 90 live. A row counts as stored when its headline value reads a maintained column, cache or ledger, even if part of it is live. Rows that are live and then cached in org_summary count as live.

## Part 2: one way to compute each number (what NUMBERS-1 chose)

The rule: a number is either computed live from `gifts` on every read, or it is stored and recomputed from `gifts` (never added to or subtracted from) on every write that could change it. One function per figure.

| Number | Stored or live | The one function | Who calls it |
|---|---|---|---|
| Profile Lifetime, This year, Last gift | live | `figureSources.js` `donor-lifetime`, `donor-gifts-between`, `donor-last-gift` (Last gift now breaks a same-day tie by `donorSummary.LAST_GIFT_ORDER`) | `donorProfileFigures` (GET /donors/:id), the drawers, the checker |
| Profile First, Largest, Average and its "of N gifts" | live | `numbers.donorGlance` over `donor-first-gift`, `donor-largest-gift`, `donor-average-gift` | GET /donors/:id `figures` (the header now draws all seven tiles from this one read), GET /donors/:id/status `glance`, the checker |
| `donors.total_giving`, `gift_count`, `last_gift_date`, `last_gift_amount` | stored | `donorSummary.DONOR_SUMMARY_UPDATE` (count is gifts above zero; last gift by date, then the one recorded last) | `recalcDonorSummary`, `recalcDonorSummaryBatch`, merge, merge undo, the demo seed. `recordGift` still adds to them, which is what keeps an imported total alive (see next build) |
| Soft credit amounts | stored | `donorSummary.SOFT_CREDIT_RESIZE` (a share stays that share of the gift; a fixed amount never more than it) | gift edit, partial refund |
| Campaign raised and donors (cards, overview, campaign page bar, public widget, portal) | live | `campaignMatch.CAMPAIGN_GIFT_MATCH` (attributed by id, or by name only with no id; donor not deleted; dated inside start and end), summed by `numbers.campaignGiftTotals` | `fundraisingCampaignRows`, `/campaigns/:id/progress`, `goal-raised`, `goal-rollup-raised`, `campaign-donors`, give.js page and portal raised, the match widget, recent gifts widget, the checker |
| Fundraising overview combined goal | live | `fundraisingGoalsPortfolio` (registered as `numbers.screens.fundraisingPortfolio`) | the overview, the checker in the server |
| A campaign a gift may be credited to | write rule | `campaignMatch.campaignWindowRefusal` | POST /donors/:id/gifts (refused with the sentence; a pledge's campaign is not inherited outside its dates), PUT /gifts/:id when the campaign is chosen, the gift form (out-of-window campaigns are shown and disabled) |
| Year-end statement total | live | `statementTotals.statementLines` | statements, the checker |
| `campaigns.raised_amount` | stored, dead | none (nothing reads it for a total) | left for the next build to drop |

The rules the checker holds every org to are in `scripts/check-numbers.js` (`RULES`), each in plain words with the screens it covers.

## Not fixed in NUMBERS-1 (next build)

Everything under "Suspected disagreements" below that is not named in the table above is still open. The biggest: an imported total is erased by the next recompute (1), `first_gift_date` is never kept (3), three definitions of an average and of retention (9, 26), the fiscal year start month ignored on Home and Fundraising (27), and the cover fee net on some screens and gross on others (14). The checker does not assert those yet, so they can still drift unnoticed until a rule is added for each.

## Suspected disagreements

**The stored donor rollup**

- **Imported lifetime giving is erased by the next edit, delete, refund or merge.** `recordGift` adds to `total_giving` (server.js:1206). `recalcDonorSummary` sets it to SUM(gifts) (server.js:3393-3417). So does the merge (routes/dataHealth.js:528-531), and so does the batch recalc after import-history (crm.js:9793). A donor imported with a $5,000 total and no gift rows keeps the $5,000 when a new gift is added. The first time any of their gifts is edited (crm.js:7229), deleted (crm.js:7320) or refunded (webhooks.js:997, 1023), the $5,000 is gone. After that it drops out of the "Giving before Steward" row (fs:806-821), Top donors lifetime (crm.js:22973), the donor list, Pipeline, the donors CSV and household totals. The quick-add form makes the same kind of total, with no gift row (crm.js:4566-4572).
- **The batch recalc never zeroes a donor with no gifts left.** `recalcDonorSummaryBatch` updates `FROM agg` (afterChange.js:58-76), so a donor with no remaining gift rows gets no row and keeps their old total, count and last gift. The single-donor `recalcDonorSummary` does write zeros. Callers that can leave a person with no gifts: merge undo (crm.js:9555) and import-history after orphans are removed.
- **`first_gift_date` is never kept up to date.** The only writer apart from merge (dataHealth.js:505) is a backfill at db.js:1357-1366. That backfill runs only when the schema hash changes (db.js:233-240 skips it otherwise), and only for rows where the column is NULL. Neither `recordGift` nor `recalcDonorSummary` touches it, so a donor whose first gift came after the last schema change has NULL. Deleting a first gift never moves the date forward. Readers:
  - "First-time donors this year" saved report (reportBuilder.js:44, 370)
  - Ask (askQuery.js:44)
  - Anniversaries (server.js:6896-6908)
  - First-touch delay and stewardship debt (server.js:11636, 11671-11676)
  - "Donor since" (DonorProfile.jsx:832)
  - The date on the imported-total row (fs:801, 813)

  The profile's First gift tile reads the gifts live (fs:1287-1295), so the two can disagree on one screen. The backfill also takes MIN(g.date) with no org or amount filter (db.js:1361).
- **Gift edit, gift delete, refunds and merge skip `afterChange`.** PUT /gifts/:id (crm.js:7166-7244), DELETE (crm.js:7248-7337), the Stripe refund branches (webhooks.js:955-1030) and `mergePeople` (dataHealth.js:556) never call it. So `donor_rhythm` (rhythm and expected next gift, shown at crm.js:4404) and group crossings stay as they were before the change. org_summary still invalidates through its triggers.
- **Gift count: refunds counted on one side and not the other.**
  - `donors.gift_count` is COUNT(*) over every row, refunds included (server.js:1207, 3394; afterChange.js:59).
  - The profile counts `amount > 0` (DonorProfile.jsx:1174; fs:2623-2627; profileStatus.js:220).
  - Top donors lifetime and Ask show the stored count (fs:474, askQuery.js:42).
- **Last gift on a same-day tie.** `recalcDonorSummary` picks `created_at DESC` (server.js:3405), so the donor list and `last_gift_amount` follow it. The profile's Last gift picks `g.id DESC` (fs:865). Gift ids are random, so two gifts on one day can show different "last gift" amounts in the list and on the profile.
- **Two giving-level rules.** `donors.status` is set to mid or major on lifetime totals above $5,000 or $20,000 and is never lowered (server.js:1210-1212; crm.js:9803-9811). The Directory's status filter reads it (groups.js:85). The level tags use the last 12 months against $1,000 and $10,000 (donorStatus.js:26).
- **Lifetime is stored in some places and live in others.**
  - Live: the profile header (fs:793), `donorCreditTotals` (server.js:1689).
  - Stored: household hard credit, soft credit and "individually" (crm.js:10229, 10234; DonorProfile.jsx:3042), Top donors lifetime, the LYBUNT lifetime column, the report builder, Ask, the donors CSV and the Directory.

  PROFILE-1 fixed this class for the header line (DonorProfile.jsx:2035-2042), but the household panel on the same profile still reads the column. The census also says hard credit is `donors.total_giving` (shared/numberCensus.js:148, 158), while server.js:1688 sums the gifts.

**Averages, counts, refunds, samples and gift types**

- **Average gift has three definitions.**
  - Giving summary and Annual use `mean`: net sum over all rows, refunds counted as rows (fs:2629-2632; crm.js:22780, 23125).
  - The profile uses `per_gift`: net sum over rows above zero (fs:2623-2627).
  - Ask uses positive sum over positive count (askEngine.js:123-126).
  - Medians differ the same way: all rows (fs:2663) against positive rows (askEngine.js:128).
- **Donor counts and "new donor".**
  - `givers` counts a person whose only row is a refund (fs:421-425). Ask donor_count and retention-window need `amount > 0` (askEngine.js:118; fs:1478).
  - "New" is MIN over all rows in `givers` (fs:420), MIN over positive rows in Ask (askEngine.js:139), and the stored `first_gift_date` in the saved report (reportBuilder.js:370).
- **LYBUNT treats a refund as giving.** The `bunt` source and its list take any gift row (fs:449-458; crm.js:22865-22871). Retention's prior cohort needs `amount > 0` (fs:1478).
- **Sample gifts are included in some places and excluded in others.**
  - Included: the `gifts` and `givers` sources (fs:402, 425), `reportGiftWhere` (crm.js:22689) and so the bookkeeper file, `computeRetentionRate` (server.js:11768), `donors.total_giving` (server.js:3394), campaign raised (crm.js:20560), Week in Review.
  - Excluded: the report builder gifts entity (reportBuilder.js:60), `unthanked` (fs:692), late pledges (crm.js:18314), statements (crm.js:7670; statementTotals.js:22), receipts (server.js:3788), Xero and QuickBooks sync (xeroSync.js:138; qboSync.js:193).
- **Credit-type gift rows ("soft credit", "matching gift credit") count as money everywhere except the bookkeeper file.**
  - The bookkeeper and deposits files leave them out (fs:108-109; crm.js:23297).
  - Lifetime, reports, campaign raised, statements and receipts have no type filter, so a row typed "matching gift credit" prints on a year-end tax statement (statementTotals.js:21-32).
  - Xero and QuickBooks send them but leave out stock and in-kind (xeroSync.js:139; depositsFile.js:34), while the bookkeeper file keeps those as non-cash (crm.js:23341).
  - The credit-type list is written twice and differs: fs:108-109 includes "hard credit reversal", reconcile.js:35 does not.
  - The bookkeeper check uses `LOWER(type)`, while the sync uses `LOWER(TRIM(type))`.
- **Cover fee: gross on one screen, net on another.** Campaign, goal, page and peer-to-peer leaderboard totals subtract `cover_fee_amount` (crm.js:20561; fs:1934; give.js:1691; crm.js:21599). Fundraising "Raised", Reports, Ask, appealWhy, events, the P2P org screen and the P2P CSV are gross (crm.js:20723; appealWhy.js:22-30; give.js:2975; crm.js:23868). So a campaign's row in Reports > By group does not match its goal card. Two P2P comments claim the totals agree (give.js:2960-2961; crm.js:23861-23863), but those figures differ.

**Campaigns, goals and funds**

- **No campaign "raised" respects the campaign's start or end date.** `fundraisingCampaignRows` (crm.js:20544-20621), `goal-raised` (fs:1929-1947) and `/campaigns/:id/progress` (crm.js:20430-20468) have no date window. The only date-bounded campaign figure is the match widget (server.js:11313).
- **Campaign raised also matches gifts by the text name**, `OR g.campaign = c.name` (crm.js:20564 `CAMPAIGN_GIFT_MATCH`; fs `goal-raised`). The `gifts` source drawer with a campaign param matches `campaign_id` only (fs:298), so the Annual by-campaign row (crm.js:23116-23130) can open a drawer that totals less than the row. Renaming a campaign (crm.js:20378, 20983) never rewrites `gifts.campaign`, so name-only gifts drop out of raised, or count toward two campaigns if a name is reused. appealWhy matches by name only when `campaign_id` is null (appealWhy.js:22-30), even though its header says it uses the goal bar's rule (appealWhy.js:4-7).
- **One giving page shows two raised totals.** The bar's `campaign_raised` has no grants (crm.js:21557-21559, Donate.jsx:1260). The campaign widget on the same page (server.js:11263-11268) and the admin card (give.js:1701-1702) add awarded grants.
- **The org goal reads differently on Home and on Fundraising.** `/goals/active` sums over the goal's own period, gross, deleted donors included (crm.js:19989-19993). `/fundraising/overview` uses the fiscal or calendar period with deleted donors excluded (crm.js:20764-20772).
- **Parent goals drop gifts given straight to the parent.** See crm.js:20644 and fs:2203. "Raised across all" includes them, and includes ended goals that the combined goal leaves out (crm.js:20864 against crm.js:20677).
- **Campaign donor count.**
  - The card counts distinct donors over every row, refunds in, with no join to donors (crm.js:20558, 20439).
  - Its drawer inner-joins donors (fs:2000).
  - The public bar counts `amount > 0` (crm.js:21563-21565).
  - appealWhy and the Fundraising period count exclude deleted donors (appealWhy.js:26; crm.js:20728).
- **`campaigns.raised_amount` is a dead stored column.** It is added at db.js:1084, written only by the sample seed (crm.js:3679, 142000), and never recomputed by any gift add, edit, delete, refund, merge or import. It is still returned by `SELECT *` (crm.js:20258, 20317), so a client that reads it would show a stale number.
- **The fund ledger drifts from `gifts.fund_id` on edit.** PUT /gifts/:id sets `gifts.fund_id` to null when the fund is cleared (crm.js:7218-7223). The ledger update uses `fund_id=COALESCE(?, fund_id)` (crm.js:7236-7239), so the old fund keeps the money in fund balances (finance.js:4407-4415). Gift-based fund views (finance.js:397-399; crm.js:23103) move it. `recordGift` puts a no-fund gift in the general fund (server.js:1234), but Finance says no-fund gifts are "not counted in any fund's balance" (finance.js:242, 3971). History imports and orgs with `ledger_posting_enabled = false` (server.js:1227) never stamp the ledger.
- **`campaigns.recipient_count` is stored once, from a counter held in memory** (server.js:5383). A send that dies part-way leaves it at 0 while `campaign_recipients.sent_at` (the live drawer, fs:1010-1033) shows the emails as sent.
- **Imported pledges are never re-checked.** `/donors/import-semantics` links gifts to a new pledge with `UPDATE gifts SET pledge_id` (crm.js:8092-8104) and never calls `recalcPledgePayment` (no call in crm.js:7974-8346). A pledge imported as open and fully paid by those gifts stays `status='open'`. `pledges-open` shows it at $0 remainder (fs:1906), while every count and reminder that reads `pledges.status` still treats it as open.
- **Deleted donors stay in some pledge and goal totals.** `goal-raised`, `pledges-open` and `pledge-payments` use `LEFT JOIN donors` with no `deleted_at` filter (fs:1907, 1923, 1938). The report builder and Ask pledges exclude deleted donors (reportBuilder.js:94; askQuery.js:201). `/campaigns/:id/progress` does not clamp pledged at zero (crm.js:20446), while crm.js:20567 and fs:1906 do.

**Retention, years and clocks**

- **Three retention definitions.**
  - `computeRetentionRate` (Home tile, Board, board pack, Ask) is calendar year, keeps deleted donors and counts any row (server.js:11767-11770).
  - Reports > Retention and Annual use `retention-window`: fiscal by default, `amount > 0`, deleted excluded (fs:1466-1502).
  - donorStatus "Retained" is calendar, positive and deleted excluded (donorStatus.js:105-111).

  reportAnnual overwrites the rate from a source but keeps the raw prior and retained counts (crm.js:23128, 23142), so the rate can fail to equal retained over prior on the same report.
- **The fiscal-year start month is ignored on Home and Fundraising.** `orgTz` returns only the timezone (server.js:239-249), so `orgFiscalStartMonth` falls back to July (orgTime.js:187-192) for every `orgFiscalYearStart(await orgTz(...))` call: crm.js:5702, 9669, 18151, 18355, 18376, 18407. `finPeriodBounds` hard-codes 07-01 (server.js:5490-5494). Reports (crm.js:22648) and Dashboards (crm.js:1677) read `vocabulary_json` and honour it. For an org whose year starts in January, Home "This FY" and Reports' fiscal year are different windows.
- **"This year" means four different things.**
  - Calendar on the profile header (crm.js:4279) and in `donor_rhythm` (afterChange.js:136).
  - Calendar on statements (crm.js:7672).
  - Fiscal, with the start month honoured, in Reports.
  - Fiscal but always July on Home Gifts YTD (crm.js:18151).
- **Gifts YTD headline and its drill-down disagree.** The headline includes deleted donors (crm.js:18172) and is truncated by `parseInt` (crm.js:18192). The drill-down excludes deleted donors (crm.js:18420) and keeps cents.
- **Clocks.** The server clock or UTC is used where the org's day should be: `autoLapseOrg` (server.js:3355), due-for-touch (server.js:5877), stewardship debt `Date.now()` (server.js:11650), at-risk `NOW()` (server.js:6943), the stewardship trend window (crm.js:20101-20102), `email-tool-gifts` (fs:1051-1052), and Ask pledge dates (askQuery.js:202-207). The Directory renders civil dates with `new Date(...)` (DonorDirectory.jsx:737, 780), so a gift on the 1st shows as the month before in US time zones. Lost & Found uses the browser's UTC date (LostAndFound.jsx:212).
- **Six lapse rules.**
  - Stage lapsed at 365 days (server.js:3355).
  - Lifecycle lapsed at 365 days, live (donorStatus.js:79).
  - Drift lapsed at 2.5 times cadence or 730 days (drift.js:25-27).
  - At-risk at 300 days and $5,000 (server.js:6943).
  - Re-engage at 365 days (donorLookups.js:103-108).
  - The Re-engage tab on the browser clock (DonorDirectory.jsx:95).

  `/donors/counts` "lapsed" reads `status='lapsed'` (donorLookups.js:102), which nothing writes. "Quiet" is 180 days at crm.js:809 and 90 days at shared/portfolioShape.js:29.

**Smaller ones**

- The soft-credit total on the profile sums at most 200 rows (crm.js:10263), so "With soft credit" undercounts for a heavy peer-to-peer fundraiser.
- There are two household groupings: `households.household_id` (fs `household-giving`, crm.js:10232) and `donor_relationships` spouse or household (fs `linked-household-giving`). Both appear on the same Related tab (DonorProfile.jsx:3018-3042) and can name different people.
- The merge preview adds the two stored totals (dataHealth.js:589), but the merge writes SUM(gifts) (dataHealth.js:528). They differ for any donor with an imported total.
- In the board pack, "Change on last year" is computed from Steward's gifts only (boardPack.js:73) even when "last year" was filled from `historical_totals` (crm.js:2399-2401).
- A gift receipt freezes the deductible amount with the dispute ignored (server.js:3800). The statement drops lost disputes (statementTotals.js:22), so the receipt and the statement can disagree for that gift.
- The drift "gifted" count reads the stored `gift_count` (crm.js:18963), while the drift engine reads live gifts (server.js:7004).
- The import-combined and import-history recalcs run after commit, and an error there is only logged (crm.js:5916, 9793). Nothing retries, so stored totals can stay behind the gifts.
- `clearSampleData` deletes sample gifts (sampleData.js:256) with no recalc. A real donor holding a sample gift keeps it in `total_giving`.

## NUMBERS-2 outcome (25 Oct 2026)

The "Suspected disagreements" list above has 39 bullets (the brief called it 38). They are numbered here in the order they appear. Fixed means changed and held by `scripts/check-numbers.js` or `tests/numbers2-history.test.js`. Not real means it is not a wrong number, for the reason given. Deferred means it is still open, with the reason.

Dollar figures a director would read out:

1. Imported lifetime erased by the next recompute. **Fixed.** The imported total is its own figure (`donors.imported_*`), and recompute never writes it. Lifetime is the imported total plus the gifts dated after `imported_through`. `recordGift` recomputes rather than adds. A merge folds two imported totals together.
8. Lifetime stored in some places and live in others. **Fixed.** The stored `total_giving` is now computed by the same rule as the live Lifetime, and the checker holds them equal to the cent. The household panel, Top donors, the Directory and exports read a column that agrees with the profile.
9. Three definitions of average gift. **Fixed.** There is one: counted gifts with refunds taken off, divided by the gifts above zero. Credit rows are left out. It is used by Reports, the annual report, Ask, groups, the appeal page and the profile.
26. Three definitions of retention. **Fixed** for every rate shown: the FEP fiscal-year rate, plus a same-dates-last-year version on Home. The per-person "Retained" tag is still calendar (see 31).
27. Fiscal start month ignored on Home and Fundraising. **Fixed.** `orgTz()` now carries the month, and `finPeriodBounds` reads it.
28. "This year" means four different things. **Fixed** for the profile, Home, Fundraising and the Home lead line. Statements stay calendar. **Not real** for statements: the tax year is the calendar year.
29. Gifts YTD headline and its drill-down disagree. **Fixed.** Both now exclude deleted people and keep the cents.
13. Credit-type rows count as money. **Partly fixed.** They are left out of averages, medians and year-end tax statements, and the type check is `LOWER(TRIM())` everywhere. **Deferred** for Lifetime and campaign totals: whether a "matching gift credit" row is the employee's money is a product decision.
14. Cover fee is gross on one screen and net on another. **Deferred.** Both are labelled. Choosing one changes every campaign card or every Fundraising total, and needs Jonathan's call on which is right.
22. Fund ledger drifts when a gift's fund is cleared. **Fixed.** The ledger stamp moves to the general fund, where `recordGift` puts a gift with no fund. **Deferred:** Finance still says no-fund gifts are "not counted in any fund's balance", which is a wording change.
24. Imported pledges are never re-checked. **Fixed.** `recalcPledgePayment` runs after an import links payments. A pledge the file called fulfilled stays fulfilled.
25. Deleted donors stay in pledge and goal totals. **Fixed** for `pledges-open` and `pledge-payments`. `goal-raised` was fixed in NUMBERS-1. **Deferred:** the `/campaigns/:id/progress` pledged clamp.
32. Profile soft credit total is capped at 200 rows. **Fixed.** The total and "raised for" are summed over every row. The list still shows the newest 200.
34. Merge preview disagrees with what the merge writes. **Fixed.** The merge now keeps both Lifetimes, imported totals included, so it writes the preview's sum.
35. Board pack change on last year ignores the old system's figure. **Fixed.** When last year is the old system's figure, the change is worked out against that figure.
39. `clearSampleData` leaves sample money on real donors. **Fixed.** Real people who held a sample gift are recomputed.
36. Receipt and statement disagree on a lost dispute. **Not real.** A receipt records the gift on the day it was given. The statement is the year's record after the dispute was lost. They describe different moments.
15. Campaign raised ignores campaign dates. **Fixed in NUMBERS-1.**
16. Campaigns matched by name. **Fixed in NUMBERS-1** (by name only when there is no id). **Deferred:** a rename does not rewrite `gifts.campaign`.
17. One giving page shows two raised totals. **Deferred.** Whether a public bar should include grants is a product choice.
18. Org goal reads differently on Home and Fundraising. **Deferred.** Home reads the goal's own period and Fundraising reads the fiscal year (now the right one). Making them one needs a decision on which period a goal means.
19. Parent goals drop gifts given straight to the parent. **Deferred.** The roll-up rule ("children only") is a decision, not a bug.
38. Import recalcs run after commit and only log errors. **Deferred.** It needs a retry queue. The nightly checker counts any stored total left behind.

Counts:

2. Batch recalc never zeroes a donor with no gifts. **Fixed in NUMBERS-1.**
3. `first_gift_date` is never kept up to date. **Fixed.** The one statement keeps it on every add, edit, refund, delete, merge and import, with the old system's first gift when that is older. Existing rows are backfilled from gifts above zero in their own org.
5. Gift count includes refunds on one side only. **Fixed in NUMBERS-1.** It is now the imported count plus gifts above zero.
6. Last gift on a same-day tie. **Fixed in NUMBERS-1.**
10. Donor counts and "new donor". **Fixed.** `givers` no longer counts a person whose only rows are refunds, and "new" means their first gift above zero.
11. LYBUNT treats a refund as giving. **Fixed.** `bunt` needs a gift above zero.
12. Sample gifts are included in some places and excluded in others. **Deferred.** FIX-32 has an org clear its sample before importing, and the clear now recomputes. Filtering `is_sample` in every total is a wide change better done on its own.
20. Campaign donor count. **Fixed in NUMBERS-1** for cards, drawers and widgets. **Deferred:** the public bar's `amount > 0`.
23. `recipient_count` is stored once. **Deferred.** It is an email count, not money, and needs a send-path change.
31. Six lapse rules. **Deferred.** Which rule decides "lapsed" is a product decision. The per-person "Retained" tag is in the same family.
37. Drift "gifted" count reads the stored count. **Not real now.** The stored count is kept by the one statement on every write, and the checker holds it to the gifts.

Labels and plumbing:

4. Edit, delete, refund and merge skip `afterChange`. **Deferred.** Rhythm and expected next gift go stale until the next after-change step. Wiring it in fires group crossings and journeys on edits, and that needs its own test.
7. Two giving-level rules. **Deferred.** `donors.status` (lifetime, never lowered) against the 12-month level tags is a naming decision.
21. `campaigns.raised_amount` is a dead column. **Not real.** Nothing reads it for a total. Dropping it is housekeeping.
30. Clocks (server or UTC instead of the org's day). **Deferred.** Each one is off by a day at most, near midnight. They are listed above.
33. Two household groupings. **Deferred.** This is a data-model decision.

Found while building, for the next brief: the profile's lifecycle tags and "Donor since" read the gifts on file only. A donor with $50,000 of imported history and one new gift reads "New: gave once this year" and "Donor since 2026" (see the after screenshot).
