# Money sums outside shared/numbers (NUMBERS-4 inventory)

Every hand-written SQL `SUM(` over a money column in server code outside `shared/numbers/`, with what it sums and whether it is a total a person sees. The rule for money in a total is `shared/numbers/money.js`: `MONEY(g)` (hard credit only, so soft and matching credit rows are out through `NOT_CREDIT`; refund rows are negative and come off) and `GIFT(g)` (money above zero). See `docs/architecture/ARCHITECTURE.md`, "One home per number".

## Totals

NUMBERS-5: the 52 below that were not on the rule are all on it now ("Moved onto shared/numbers in NUMBERS-5"); (a) is 123 on the rule, 0 partial, 0 not. The inventory's line numbers are NUMBERS-4's.

- **248 money sums** in 31 files.
- **(a) a total a person sees: 123.** On the rule: 71. Partly on it: 2. Not on it: 50.
- **(b) a legitimate own sum: 125.**

| | Count |
|---|---|
| (a) rule: yes | 71 |
| (a) rule: partial | 2 |
| (a) rule: no | 50 |
| (b) | 125 |
| **All money sums** | **248** |

"Rule: yes" means the sum applies `NOT_CREDIT` (directly, or through `MONEY`, `GIFT`, `IN_SPAN`, `CAMPAIGN_GIFT_MATCH`, `EVENT_GIFT_MATCH` or `reportGiftWhere`) and lets refunds come off, or reads the stored `donors.total_giving` that `donorSummary.js` keeps on the rule. "Partial" is `GIFT()` used where a total wants `MONEY()` (credits out, but refunds left out instead of taken off). "No" names what it gets wrong: "credits counted" (no `NOT_CREDIT`), "refunds ignored" (`amount > 0` on a total, so a refund never comes off).

## How this was counted

Server code is every tracked `.js`, `.cjs` and `.mjs` file except `client/`, `tests/`, `scripts/`, `docs/`, `node_modules/` and `shared/numbers/` (339 files; the rest of `shared/` is included). The search:

```
git ls-files '*.js' '*.cjs' '*.mjs' \
  | grep -vE '^(client|tests|scripts|docs|node_modules)/|^shared/numbers/' \
  | xargs grep -noiE 'SUM\s*\('
```

It finds 341 occurrences (case-insensitive, one per `SUM(`, so a query with three `SUM(` is three). Each one was read in its query and sorted. Taken out before the table:

- 46 not money: volunteer hours, ticket quantities, role places, form views and starts, draft and send counts, gift counts.
- 27 JavaScript, not SQL: local `sum()` helpers and the `pledgeSum(` builder name in `numbers.js`.
- 15 in comments, and 3 inside strings that describe a computation (`shared/numberCensus.js`) or match a spreadsheet formula (`shared/importShape.js`).
- 2 in `capture.js` (685, 688): the thank-you clock aliases a day count as `amount`; it is not money.

That leaves 248. This is more than the 153 `SUM(amount)` counted on main because it counts every money column (`total_giving`, `target_amount`, `gift_amount`, ledger `fin_transactions.amount`, subscription amounts, cents columns) and every occurrence, including an `ORDER BY` that repeats a sum and a sum nested inside another.

Line numbers are from the worktree `nonprofit-erp-numbers4` (branch numbers-4, HEAD 12b7bf4) as it stood at 2026-11-01 22:20, after NUMBERS-4's moves (regenerated from the code; the classification was read by hand).

## The inventory, by file

### routes/crm.js (104: 55 a, 49 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `routes/crm.js:4503` | Stage counts: lifetime of the people in each stage | a | yes (reads stored total_giving) | Sum of the stored lifetime. |
| `routes/crm.js:6358` | Import receipt: gifts and cash the import wrote | b | — | Import footing over the rows the import wrote, every row on purpose. |
| `routes/crm.js:7866` | Profile pledges tab: installments due this year | b | — | Pledge installment amounts, not gifts. |
| `routes/crm.js:9065` | Import history: first payments an old spreadsheet import wrote | b | — | Import receipt arithmetic. |
| `routes/crm.js:9411` | Data move: gifts and cents the move holds | b | — | Import footing (move file vs Steward). |
| `routes/crm.js:9417` | Data move: cents per year | b | — | Import footing. |
| `routes/crm.js:9436` | Data move: top 25 donors by cents | b | — | Import footing against the file's top donors. |
| `routes/crm.js:9959` | Spreadsheet import: read-back of what landed | b | — | Import footing check. |
| `routes/crm.js:10848` | Households list: combined giving | a | yes (sum of stored total_giving) | The arch names figure source household-giving as the home; this is a second copy. |
| `routes/crm.js:11008` | Profile: household combined and soft credit | a | yes (sum of stored total_giving) | Same as above. |
| `routes/crm.js:11041` | Profile: soft credit totals by role and page | b | — | The Soft credit figure: recognition by design (gift_soft_credits), never money. |
| `routes/crm.js:11615` | Portfolio officers: portfolio giving | a | yes (sum of stored total_giving) | Sum of the stored lifetime. |
| `routes/crm.js:11729` | Pipeline board: open asks per donor | b | — | Pipeline. |
| `routes/crm.js:11795` | Pipeline board: won this year | b | — | Opportunity gift_amount, not gift rows. |
| `routes/crm.js:12491` | Portfolio: open ask per person | b | — | Pipeline. |
| `routes/crm.js:12533` | Portfolio: committed this fiscal year vs target | b | — | Opportunity amounts. |
| `routes/crm.js:13714` | Thread event "p2p goal reached" | b | — | Peer page raised against its goal (a trigger, not a shown total). |
| `routes/crm.js:15487` | Major gifts dashboard: pipeline by stage | b | — | Pipeline. |
| `routes/crm.js:15488` | Major gifts dashboard: weighted pipeline | b | — | Pipeline. |
| `routes/crm.js:15494` | Major gifts dashboard: due this quarter | b | — | Pipeline. |
| `routes/crm.js:15502` | Major gifts dashboard: asked this year | b | — | Pipeline. |
| `routes/crm.js:15507` | Major gifts dashboard: committed this year | b | — | Opportunity amounts. |
| `routes/crm.js:15594` | Officer activity: asks made | b | — | Pipeline. |
| `routes/crm.js:15596` | Officer activity: won | b | — | Opportunity amounts. |
| `routes/crm.js:15890` | Profile fund affinity: total per fund | a | yes (moved in NUMBERS-4) | Shown on the profile. |
| `routes/crm.js:15945` | Grant: received against the award pledge | a | yes (moved in NUMBERS-4) | A grant's received figure; money only now. |
| `routes/crm.js:16213` | Funders list: open requested | b | — | grants.amount_requested, not gift rows. |
| `routes/crm.js:16214` | Funders list: awarded | b | — | grants.amount_awarded. |
| `routes/crm.js:17569` | Grant report facts for the AI: each giver's total to the fund | a | no (credits counted) | A fact line handed to the model, which may state it. |
| `routes/crm.js:17573` | Same, as the ORDER BY | a | no (credits counted) | Same sum, used to rank. |
| `routes/crm.js:19393` | My stats: my portfolio's giving this fiscal year | a | yes (IN_SPAN) | On the rule. |
| `routes/crm.js:19394` | My stats: pipeline value (stored lifetime) | a | yes (sum of stored total_giving) | Sum of the stored lifetime. |
| `routes/crm.js:19468` | Home: my portfolio count and value | a | yes (sum of stored total_giving) | Sum of the stored lifetime. |
| `routes/crm.js:19470` | Home: scope portfolio value | a | yes (sum of stored total_giving) | Same. |
| `routes/crm.js:19471` | Home: portfolio value by stage | a | yes (sum of stored total_giving) | Same. |
| `routes/crm.js:19474` | Home: open asks | b | — | Pipeline. |
| `routes/crm.js:19643` | My stats drill-down: total | a | yes (IN_SPAN) | On the rule. |
| `routes/crm.js:19673` | My stats pipeline drill-down: total | a | yes (sum of stored total_giving) | Sum of the stored lifetime. |
| `routes/crm.js:20475` | Thread list rank: open asks per donor | b | — | Pipeline. |
| `routes/crm.js:21232` | Org goal raised: lapsed-recovery goal | a | yes (NOT_CREDIT; refunds come off) | orgGoalRaised, the goal's one function. |
| `routes/crm.js:21243` | Org goal raised: any other goal | a | yes (NOT_CREDIT) | Same. |
| `routes/crm.js:21289` | Goal progress: last 7 days, lapsed-recovery | a | no (credits counted; deleted people counted) | The goal's "recent" line; does not match orgGoalRaised beside it. |
| `routes/crm.js:21301` | Goal progress: last 7 days, any goal | a | no (credits counted; deleted people counted) | Same. |
| `routes/crm.js:21770` | Campaign progress: raised from gifts | a | yes (CAMPAIGN_GIFT_MATCH) | Written again beside numbers.campaignGiftTotals. |
| `routes/crm.js:21779` | Campaign progress: open pledges still to come | a | yes (moved in NUMBERS-4) | A pledge figure written again. |
| `routes/crm.js:21784` | Campaign progress: awarded grants | b | — | grants.amount; note it does not read PUBLIC_BAR_GRANTS. |
| `routes/crm.js:21901` | Fundraising campaigns: pledged per campaign | a | yes (moved in NUMBERS-4) | Pledge figure. |
| `routes/crm.js:21910` | Fundraising campaigns: awarded grants per campaign | b | — | grants.amount. |
| `routes/crm.js:21920` | Fundraising campaigns: gifts given before a goal starts | a | no (credits counted) | Shown on a goal that has not started. |
| `routes/crm.js:22116` | Fundraising overview: each giving page's raised | b | — | One giving page's raised; this copy applies MONEY, the Giving pages list in routes/give.js does not. |
| `routes/crm.js:22121` | Fundraising overview: all-time total | a | yes (NOT_CREDIT; refunds come off) | On the rule. |
| `routes/crm.js:22156` | Fundraising overview: contributions budget as the goal | b | — | Budget lines. |
| `routes/crm.js:22203` | Fundraising lead: top givers to the campaign this month | a | yes (CAMPAIGN_GIFT_MATCH) | On the rule. |
| `routes/crm.js:22207` | Same, as the ORDER BY | a | yes (CAMPAIGN_GIFT_MATCH) | Same sum, used to rank. |
| `routes/crm.js:23064` | Public giving page: the page's raised | b | — | One giving page's raised (donor-facing); no NOT_CREDIT, refunds come off. |
| `routes/crm.js:23173` | Public giving page: each fundraiser's raised | b | — | Peer page raised. |
| `routes/crm.js:23314` | P2P team board: raised | b | — | Peer team raised; this copy has no amount > 0. |
| `routes/crm.js:23327` | P2P individual board: raised | b | — | Peer page raised; no amount > 0. |
| `routes/crm.js:23468` | Public P2P teams: raised | b | — | Peer team raised. |
| `routes/crm.js:23698` | Public fundraiser page: raised | b | — | Peer page raised. |
| `routes/crm.js:23860` | Board report: ledger this year by type | b | — | Ledger. |
| `routes/crm.js:23861` | Board report: ledger all time by type | b | — | Ledger. |
| `routes/crm.js:23863` | Board report: top expenses | b | — | Ledger. |
| `routes/crm.js:23870` | Board report: budget vs actual | b | — | Budget against ledger. |
| `routes/crm.js:24335` | Giving summary report: by month | a | yes (reportGiftWhere applies NOT_CREDIT) | On the rule. |
| `routes/crm.js:24379` | Giving summary report: the prior span | a | yes (reportGiftWhere) | On the rule. |
| `routes/crm.js:24449` | By-group report: total per group | a | yes (reportGiftWhere) | On the rule. |
| `routes/crm.js:24509` | LYBUNT/SYBUNT report: prior year total | a | no (credits counted; refunds come off) | A report column. |
| `routes/crm.js:24543` | Retention report: each prior-year donor's dollars | a | no (credits counted; a refund-only row makes a donor) | Dollar retention; retained.js is the home. |
| `routes/crm.js:24545` | Retention report: each current-year donor's dollars | a | no (credits counted) | Same. |
| `routes/crm.js:24550` | Retention report: prior dollars | a | no (inherits the prior CTE) | Sum over the CTE. |
| `routes/crm.js:24551` | Retention report: retained dollars | a | no (inherits the current CTE) | Sum over the CTE. |
| `routes/crm.js:24597` | Top donors report: soft credit column | b | — | The Soft credit figure (gift_soft_credits), recognition by design. |
| `routes/crm.js:24625` | Top donors report: household view | a | yes (reportGiftWhere) | On the rule. |
| `routes/crm.js:24637` | Top donors report: period view | a | yes (reportGiftWhere) | On the rule. |
| `routes/crm.js:24675` | Three-year report: year 0 | a | no (credits counted) | No NOT_CREDIT in this query. |
| `routes/crm.js:24676` | Three-year report: year 1 | a | no (credits counted) | Same. |
| `routes/crm.js:24677` | Three-year report: year 2 | a | no (credits counted) | Same. |
| `routes/crm.js:24681` | Three-year report: ORDER BY year 0 | a | no (credits counted) | Same sums, used to rank. |
| `routes/crm.js:24682` | Three-year report: ORDER BY year 1 | a | no (credits counted) | Same. |
| `routes/crm.js:24683` | Three-year report: ORDER BY year 2 | a | no (credits counted) | Same. |
| `routes/crm.js:24732` | Annual report: total this year | a | yes (NOT_CREDIT) | On the rule. |
| `routes/crm.js:24739` | Annual report: prior span total | a | yes (NOT_CREDIT) | On the rule. |
| `routes/crm.js:24757` | Annual report: by fund | a | yes (NOT_CREDIT) | On the rule. |
| `routes/crm.js:24763` | Annual report: by campaign | a | yes (NOT_CREDIT) | On the rule. |
| `routes/crm.js:24806` | Solicitations report: open asks by stage | b | — | Pipeline. |
| `routes/crm.js:24821` | Solicitations report: open asks by officer | b | — | Pipeline. |
| `routes/crm.js:24824` | Solicitations report: asks made by officer | b | — | Pipeline. |
| `routes/crm.js:24828` | Solicitations report: won by officer | b | — | Opportunity amounts. |
| `routes/crm.js:24834` | Solicitations report: lost by officer | b | — | Pipeline. |
| `routes/crm.js:24871` | Solicitations report: open pledges still to come | a | yes (moved in NUMBERS-4) | Pledge figure written again. |
| `routes/crm.js:24985` | Bookkeeper report: the database's own total | b | — | The bookkeeper file's footing check, against its own rows; applies MONEY. |
| `routes/crm.js:25452` | Members by level report: membership revenue | a | no (credits counted; deleted people counted) | A report money column. |
| `routes/crm.js:25508` | Membership revenue report: membership cents by month | a | no (credits counted) | Report column. |
| `routes/crm.js:25509` | Membership revenue report: donation cents by month | a | no (credits counted) | Report column beside it; a donation total. |
| `routes/crm.js:25527` | P2P fundraisers report: raised | b | — | Peer page raised. |
| `routes/crm.js:25545` | P2P teams report: raised | b | — | Peer team raised. |
| `routes/crm.js:26865` | Impact: recovered payments | b | — | payment_recovery_events amounts, a recurring-recovery figure. |
| `routes/crm.js:26893` | Impact: re-engaged donors, gifts per day | a | no (credits counted) | Feeds the "won back" total and list. |
| `routes/crm.js:26898` | Impact: re-engaged donors, per person | a | no (inherits the per-day sum) | Same. |
| `routes/crm.js:26902` | Impact: re-engaged donors, total | a | no (inherits the per-day sum) | Same. |
| `routes/crm.js:26917` | Impact: online giving processed (fees-kept base) | b | — | The base of a fee figure (Stripe gifts); note no NOT_CREDIT. Unsure: it is stated on the Impact page. |
| `routes/crm.js:29181` | Event page: each guest's gift at the event | a | yes (EVENT_GIVERS_SQL uses EVENT_GIFT_MATCH, which applies MONEY) | On the rule. |
| `routes/crm.js:15904` | profile fund affinity, unrestricted share | a | yes (moved in NUMBERS-4) | Rewritten onto shared/numbers in NUMBERS-4. |

### routes/give.js (31: 6 a, 25 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `routes/give.js:219` | POS mapping: what each register item sold | b | — | Point-of-sale revenue, not gift rows. |
| `routes/give.js:288` | POS "buys, never given": spent at the register | b | — | Point-of-sale revenue. |
| `routes/give.js:590` | Connections card: bookkeeping deposits sent | b | — | Bookkeeping deposits, net. |
| `routes/give.js:613` | Connections card: Xero sync rows in 30 days | b | — | Sync rows. |
| `routes/give.js:1664` | Giving pages list: a page's raised | b | — | One giving page's raised as its own figure; note no NOT_CREDIT and refunds come off. |
| `routes/give.js:1666` | Giving pages list: the linked campaign's raised | a | yes (CAMPAIGN_GIFT_MATCH) | A campaign total, written again beside numbers.campaignGiftTotals; grants not added here. |
| `routes/give.js:1860` | Giving page update: the page's raised | b | — | One page's raised, as in the Giving pages list. |
| `routes/give.js:2134` | Giving page funnel: completed cents from form events | b | — | Form analytics counters, not gift rows. |
| `routes/give.js:2751` | P2P_RAISED fragment (amount > 0) | b | — | The peer-to-peer page rule, its own defined figure. |
| `routes/give.js:2754` | A fundraiser's raised | b | — | Peer page raised. |
| `routes/give.js:2759` | A team's raised | b | — | Peer team raised. |
| `routes/give.js:2806` | A team's members' raised | b | — | Peer page raised. |
| `routes/give.js:2898` | Fundraisers on a page: raised (admin) | b | — | Peer page raised; note no amount > 0 here, unlike fundraiserRaisedCents. |
| `routes/give.js:2916` | Teams on a page: raised (admin) | b | — | Peer team raised. |
| `routes/give.js:3000` | P2P overview: all gifts to the page | b | — | Page raised (amount > 0). |
| `routes/give.js:3001` | P2P overview: through fundraisers | b | — | Page raised split. |
| `routes/give.js:3002` | P2P overview: direct | b | — | Page raised split. |
| `routes/give.js:3009` | P2P overview: each fundraiser's raised | b | — | Peer page raised. |
| `routes/give.js:3018` | P2P overview: each team's raised | b | — | Peer team raised. |
| `routes/give.js:3102` | Fundraiser update: raised | b | — | Peer page raised. |
| `routes/give.js:3925` | Home notice: gift starts not finished | b | — | gift_starts amounts (abandoned checkouts), not gifts. |
| `routes/give.js:4231` | Recurring roster: total given per subscription | a | no (credits counted) | Shown per subscription; refunds come off. Credit rows are unlikely to carry a subscription id, so the effect is small. Unsure-ish. |
| `routes/give.js:4295` | Recurring movement: MRR | b | — | Subscription amounts, not gifts. |
| `routes/give.js:4342` | Recurring movement: cards expiring, MRR | b | — | Subscription amounts. |
| `routes/give.js:4522` | Reconnect sends: monthly amount back | b | — | Reconnect records' amounts. |
| `routes/give.js:5055` | Recurring health: MRR at risk | b | — | Subscription amounts. |
| `routes/give.js:5096` | Recurring health: cards expiring, MRR | b | — | Subscription amounts. |
| `routes/give.js:6182` | Donor portal: paid and balance on each of her pledges | a | yes (moved in NUMBERS-4) | Donor-facing; the pledge home is numbers.pledgeSummary, and donorTotals.js is the face home. |
| `routes/give.js:6194` | Donor portal: household combined giving | a | yes (MONEY) | Donor-facing; household-giving is the named source. |
| `routes/give.js:6228` | Donor portal: campaign raised on a public thermometer | a | yes (CAMPAIGN_GIFT_MATCH + PUBLIC_BAR_GRANTS) | A copy of numbers.publicBarRaised's SQL rather than a call. |
| `routes/give.js:7903` | Donor account: tax summary, total per year per org | a | no (deleted-person and undated rows not handled; credit rows out since NUMBERS-4) | Donor-facing, tax records; soft and matching credit rows would be stated as her giving. |

### routes/finance.js (25: 8 a, 17 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `routes/finance.js:160` | Finance figure "Money in this month" | a | yes (MONEY) | Plus the Not-a-gift ledger rows, by design. |
| `routes/finance.js:167` | Finance: restricted/unrestricted fund balance (rows) | b | — | Ledger, fin_transactions income less expense. |
| `routes/finance.js:169` | Finance: restricted/unrestricted fund balance (total) | b | — | Ledger. |
| `routes/finance.js:188` | Finance figure "Not yet on a deposit" | a | yes (MONEY with deposited.js BANKED) | Deposit figure on the shared predicates. |
| `routes/finance.js:214` | Finance overview: money in by month | a | yes (MONEY) | Bars that open their gifts. |
| `routes/finance.js:222` | Finance overview: Not-a-gift ledger rows by month | b | — | Ledger rows marked Not a gift. |
| `routes/finance.js:247` | Finance "needs you": gifts with no fund in the last year | a | no (credits counted; uses CURRENT_DATE, not the org's today) | A money figure on Finance. |
| `routes/finance.js:249` | Finance "needs you": the year's giving it is a share of | a | no (credits counted; CURRENT_DATE) | The denominator of the same sentence. |
| `routes/finance.js:386` | Finance: imported gifts on no deposit, by import | a | yes (BANKED_UNDEPOSITED includes MONEY) | Deposit figure. |
| `routes/finance.js:460` | Funds detail: in, all time | b | — | Ledger. |
| `routes/finance.js:461` | Funds detail: out, all time | b | — | Ledger. |
| `routes/finance.js:462` | Funds detail: in, this period | b | — | Ledger. |
| `routes/finance.js:463` | Funds detail: out, this period | b | — | Ledger. |
| `routes/finance.js:481` | Funds detail: restricted money by grant | b | — | Ledger income tied to a grant. |
| `routes/finance.js:486` | Funds detail: restricted money by donor (gifts to a fund) | a | no (credits counted) | Where a fund's restriction came from, in dollars per donor. |
| `routes/finance.js:491` | Funds detail: restricted money by ledger payer | b | — | Ledger. |
| `routes/finance.js:4149` | Month close: the bookkeeper's file, gifts and cents | b | — | Bookkeeping checklist item; note it sums every gift row in the month while the bookkeeper's file leaves out BOOKKEEPER_EXCLUDED_TYPES, so the count it shows may differ from the file. Unsure. |
| `routes/finance.js:4455` | Budgets: actuals by account and fund | b | — | Budget lines against the ledger. |
| `routes/finance.js:4589` | Finance summary: income same point last year | b | — | Ledger. |
| `routes/finance.js:4591` | Finance summary: this year by type | b | — | Ledger. |
| `routes/finance.js:4593` | Finance summary: prior year by type | b | — | Ledger. |
| `routes/finance.js:4595` | Finance summary: all time by type | b | — | Ledger. |
| `routes/finance.js:4599` | Finance summary: fund balances | b | — | Ledger. |
| `routes/finance.js:4617` | Finance summary: the whole giving history (vs the ledger) | a | no (credits counted) | Shown so the gap to the ledger is explained; says it equals Reports, which applies NOT_CREDIT. |
| `routes/finance.js:4618` | Finance summary: gift income on the ledger | b | — | Ledger. |

### figureSources.js (12: 9 a, 3 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `figureSources.js:265` | Person's activity: a peer page's raised in a window | b | — | A peer-to-peer page's own raised, read into a person's activity rows; no NOT_CREDIT, refunds come off. |
| `figureSources.js:426` | top-givers (90% set): each giver's window total | a | no (credits counted; refunds come off) | No NOT_CREDIT in the window. |
| `figureSources.js:431` | top-givers: running total before each giver | a | no (inherits the per-giver sum above) | Window sum over the per-giver totals. |
| `figureSources.js:432` | top-givers: the window's grand total | a | no (inherits the per-giver sum above) | Same. |
| `figureSources.js:538` | givers source: each giver's total in a window | a | yes (NOT_CREDIT added to the WHERE; refunds come off) | Figure source behind giving summaries. |
| `figureSources.js:570` | lybunt/sybunt source: what they gave in the earlier year | a | no (credits counted; refunds come off) | The subquery has no NOT_CREDIT. |
| `figureSources.js:1633` | retention-window-prior: dollars in the earlier window | a | no (credits counted; refunds ignored: amount > 0) | Dollar retention; retained.js is the home and is not read here. |
| `figureSources.js:1649` | retention-window-kept: dollars in the later window | a | no (credits counted; refunds ignored: amount > 0) | Same. |
| `figureSources.js:2007` | auction-bidders: each bidder's winning bids | b | — | Auction bids, not gift rows. |
| `figureSources.js:2383` | campaign-donors: each person's total to a campaign | a | yes (CAMPAIGN_GIFT_MATCH applies NOT_CREDIT) | Campaign figure source. |
| `figureSources.js:3070` | Figure engine: the total of any SQL source's rows | b | — | Generic aggregator: sums the rows each source defines, so the rule is the source's; rows listed separately above. |
| `figureSources.js:3238` | Group page in one read: group-gifts total / count / average | a | no (credit rows counted in total and count; excluded only for the average) | The gx rows carry a credit flag but only the average kind filters it. |

### server.js (11: 7 a, 4 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `server.js:4309` | grantMoneyRows: received on a grant's award pledge | a | no (credits counted) | Restricted balance and grant pages read this. |
| `server.js:4311` | grantMoneyRows: spent against a grant | b | — | grant_spend entries, not gifts. |
| `server.js:5817` | Report builder: column totals | a | no (the gifts entity's base has no NOT_CREDIT, so a gift-amount total counts credits) | Generic: sums each money field; correct only where the field or base applies the rule. |
| `server.js:5821` | Report builder: totals per group | a | no (same as the column totals) | Same, grouped. |
| `server.js:6025` | Officer monthly report: asks made, amount | b | — | Pipeline asks (opportunities.target_amount). |
| `server.js:6031` | Officer monthly report: won, amount | b | — | Opportunity gift_amount as recorded on the ask, not gift rows. |
| `server.js:6034` | Officer monthly report: portfolio value | a | yes (reads stored total_giving) | Sum of the stored lifetime. |
| `server.js:6502` | Thread nudge rank: open asks per donor | b | — | Pipeline, a ranking signal. |
| `server.js:11943` | Public giving page: campaign raised for the bar | a | yes (CAMPAIGN_GIFT_MATCH + PUBLIC_BAR_GRANTS) | Donor-facing; a copy of numbers.publicBarRaised's SQL rather than a call. |
| `server.js:11988` | Public giving page: what is left of a match pot | a | yes (CAMPAIGN_GIFT_MATCH) | Donor-facing match figure. |
| `server.js:3738` | recalcPledgePayment paid and status | a | yes (moved in NUMBERS-4) | Rewritten onto shared/numbers in NUMBERS-4. |

### reconcile.js (9: 4 a, 5 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `reconcile.js:216` | Old-report check: Steward's gifts per import in the period | b | — | A diagnostic breaking a difference down by import (every row, on purpose). |
| `reconcile.js:314` | Old-report check: each named person's Steward total | a | no (credits counted; refunds come off) | Shown as Steward's figure for the person against the report's; should match the shared rule or the check misreports. |
| `reconcile.js:381` | Old-report check: a person's soft credits | b | — | Diagnostic that sums soft credits on purpose, to explain a difference. |
| `reconcile.js:384` | Old-report check: a person's refunds | b | — | Diagnostic. |
| `reconcile.js:402` | Old-report check: credit rows in the period | b | — | Diagnostic that sums credit rows on purpose. |
| `reconcile.js:403` | Old-report check: refunds in the period | b | — | Diagnostic. |
| `reconcile.js:463` | Old-report check: Steward's total this year for a person | a | no (credits counted; refunds come off) | Stated in the why-sentence ("Steward has $X from them"). |
| `reconcile.js:464` | Old-report check: last year for a person | a | no (credits counted) | Same. |
| `reconcile.js:465` | Old-report check: before this year for a person | a | no (credits counted) | Same. |

### numbers.js (8: 6 a, 2 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `numbers.js:47` | Profile glance: refunded total | a | yes (moved in NUMBERS-4) | Refund figure beside the average. |
| `numbers.js:48` | Profile glance: "itemized" sum of every row | b | — | Selected but never read (dead column); flag for removal rather than a move. |
| `numbers.js:67` | Profile glance: undated gifts' total | a | yes (moved in NUMBERS-4) | Shown beside Lifetime and the average. |
| `numbers.js:105` | campaignGiftTotals: raised per campaign | a | yes (CAMPAIGN_GIFT_MATCH applies NOT_CREDIT; refunds come off) | The one campaign total. |
| `numbers.js:133` | goalRollupGiftTotals: raised per parent goal | a | yes (CAMPAIGN_GIFT_MATCH) | The one goal roll-up. |
| `numbers.js:146` | publicBarRaised: a campaign's public bar | a | yes (CAMPAIGN_GIFT_MATCH) | The one public-bar function. |
| `numbers.js:202` | eventsRaised: open pledge installments at an event | b | — | Pledge installment amounts, not gifts. |
| `numbers.js:207` | eventsRaised: received at an event | a | yes (EVENT_GIFT_MATCH applies MONEY) | Event received. |

### routes/homeLead.js (5: 4 a, 1 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `routes/homeLead.js:167` | Home lead: the season campaign's raised | a | yes (moved in NUMBERS-4) | Home's lead card; numbers.campaignGiftTotals / publicBarRaised are the homes. |
| `routes/homeLead.js:169` | Home lead: everything given in the same season last year | a | yes (moved in NUMBERS-4) | Comparison figure on Home. |
| `routes/homeLead.js:176` | Home lead: December givers who lapsed, their amounts | a | yes (moved in NUMBERS-4) | List amounts and their total on Home. |
| `routes/homeLead.js:180` | Home lead: the same, as the ORDER BY | a | no (credits counted) | Same sum, used to rank. |
| `routes/homeLead.js:198` | Home lead: unpaid registration gifts at the next event | b | — | event_attendees.gift_amount (promised at registration), not gift rows. events.js is the event home; unsure whether it belongs there. |

### donorList.js (4: 4 a, 0 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `donorList.js:297` | Donors list "This year" filter/column SQL | a | yes (moved in NUMBERS-4) | THIS_YEAR_SQL has no NOT_CREDIT; should be IN_SPAN(). |
| `donorList.js:484` | Donors list "This year" cell | a | yes (moved in NUMBERS-4) | Same rule as THIS_YEAR_SQL, written a second time. |
| `donorList.js:488` | Donors list pledge balance cell: remaining | a | yes (moved in NUMBERS-4) | Second copy of the pledge balance. |
| `donorList.js:298` | donors list pledge balance (PAID_OF) | a | yes (moved in NUMBERS-4) | Rewritten onto shared/numbers in NUMBERS-4. |

### shared/reportBuilder.js (4: 3 a, 1 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `shared/reportBuilder.js:100` | Report builder pledges: Paid | a | no (credits counted) | Pledge figure; numbers.pledgeSummary is the home. |
| `shared/reportBuilder.js:101` | Report builder pledges: Still to come | a | no (credits counted) | Same. |
| `shared/reportBuilder.js:153` | Report builder grants: Received | a | no (credits counted) | Same sum as grantMoneyRows. |
| `shared/reportBuilder.js:157` | Report builder grants: Spent | b | — | grant_spend entries. |

### askQuery.js (3: 3 a, 0 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `askQuery.js:455` | Ask: "gave at least $X" related-entity threshold | a | yes (moved in NUMBERS-4) | Generic Ask filter; for gifts it sums g.amount over the gift entity's base, which lacks NOT_CREDIT. |
| `askQuery.js:465` | Ask: the measured sum for any entity (gifts, pledges, asks, events...) | a | yes (moved in NUMBERS-4) | Generic measure; the gift entity is the giving case and does not apply MONEY(); other entities are their own figures. |
| `askQuery.js:506` | Ask: per-person total in a "count people" list | a | yes (moved in NUMBERS-4) | Same gift entity base as above. |

### why.js (3: 3 a, 0 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `why.js:278` | Ask why: what a person you meet tomorrow gave in 12 months | a | yes (moved in NUMBERS-4) | Stated in the sentence; IN_SPAN() is the home. |
| `why.js:285` | Ask why: gave last year this month and nothing since | a | yes (moved in NUMBERS-4) | Stated in the sentence. |
| `why.js:566` | Ask why: first-time donors' first gift | a | yes (moved in NUMBERS-4) | A credit row can make a "first-time donor". |

### askEngine.js (2: 2 a, 0 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `askEngine.js:393` | Ask: first-year retention, prior-year cohort's dollars | a | partial (GIFT used: credits out, refunds not taken off) | Ask answer row amount; GIFT() keeps refunds out of the sum instead of taking them off. |
| `askEngine.js:399` | Ask: first-year retention, dollars given again | a | partial (GIFT used: credits out, refunds not taken off) | Same answer, the "gave again" side. |

### db.js (2: 0 a, 2 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `db.js:2424` | Migration: recompute every pledge's paid/surplus/status | b | — | One-off schema migration over all gifts with a pledge_id (credits not excluded). |
| `db.js:9030` | Migration keepEarlierTotals: imported_total = total_giving - SUM(gifts) | b | — | Migration; note it subtracts every gift row including credit rows, while LIFETIME() adds back only MONEY() rows, so an org with credit rows after the import would be off by those rows. |

### donorSummary.js (2: 1 a, 1 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `donorSummary.js:59` | Stored lifetime: gifts after the imported total | a | yes (NOT_CREDIT; refunds come off) | The named home of donors.total_giving. |
| `donorSummary.js:135` | Keep imported total: is total_giving above the gifts on file | b | — | Write-path guard deciding whether to keep an imported total; uses NOT_CREDIT already. |

### groups.js (2: 2 a, 0 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `groups.js:255` | Groups filter "gave more than $X" | a | yes (moved in NUMBERS-4) | A filter threshold over a giving total. |
| `groups.js:357` | Groups filter "gave more this year than last" | a | yes (moved in NUMBERS-4) | Compares two span totals with no NOT_CREDIT. |

### qboRead.js (2: 0 a, 2 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `qboRead.js:449` | QuickBooks read: lines by bucket | b | — | Bookkeeping import review, QuickBooks' own lines. |
| `qboRead.js:455` | QuickBooks read: lines by account | b | — | Same. |

### qboSync.js (2: 0 a, 2 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `qboSync.js:239` | QuickBooks: undated gifts held from sending | b | — | Bookkeeping sync; uses its own non-cash list. |
| `qboSync.js:789` | QuickBooks: what was sent | b | — | Sync rows, gift_bookkeeping_syncs. |

### routes/dataHealth.js (2: 1 a, 1 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `routes/dataHealth.js:607` | Merge: a person's gift cents, for the footing check | b | — | An invariant check (cents before = cents after), every row on purpose. |
| `routes/dataHealth.js:740` | Merge: gifts after the covered day, to refold the imported total | a | no (credits counted) | Writes imported_total; LIFETIME() adds back only MONEY() rows, so a merged person with credit rows after the day reads short. Unsure whether to call this (a) or (b): it is a write, but it sets part of Lifetime. |

### routes/insights.js (2: 2 a, 0 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `routes/insights.js:159` | Insights "what worked": cents that followed, per kind | a | no (inherits the lateral sum below) | Outer sum of the lateral below. |
| `routes/insights.js:161` | Insights "what worked": gifts within N days of a card | a | no (credits counted; refunds ignored: amount > 0) | Shown as how much followed. |

### routes/oldReports.js (2: 0 a, 2 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `routes/oldReports.js:210` | Old reports: a stored report's total | b | — | historical_totals read from an old system's report, not gift rows. |
| `routes/oldReports.js:211` | Old reports: the part that counts as giving | b | — | Same. |

### xeroSync.js (2: 0 a, 2 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `xeroSync.js:168` | Xero: undated gifts held from sending | b | — | Bookkeeping sync. |
| `xeroSync.js:417` | Xero: what was sent | b | — | Sync rows. |

### campaignMatch.js (1: 0 a, 1 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `campaignMatch.js:41` | Awarded grants toward a campaign's public bar | b | — | Sums grants.amount, not gift rows; MONEY() does not apply. This module is the campaign-total home. |

### donorStatus.js (1: 1 a, 0 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `donorStatus.js:153` | Status SQL: last 12 months' giving (Major tag input) | a | yes (NOT_CREDIT in WHERE; refunds come off) | donorStatus.statusSql is the named home for Major and the computed tags. |

### engagement.js (1: 0 a, 1 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `engagement.js:127` | Engagement touch: a peer page's raised | b | — | A peer-to-peer page's own raised (amount > 0, no NOT_CREDIT); shown as a touch detail. |

### insightsData.js (1: 0 a, 1 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `insightsData.js:61` | Insights cache fingerprint (count:sum:max) | b | — | A change detector for the memo, never shown. |

### routes/agent.js (1: 0 a, 1 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `routes/agent.js:1074` | Atlas context: a person's peer page raised | b | — | A peer-to-peer page's own raised (amount > 0, no NOT_CREDIT), given to Atlas as context. |

### routes/billing.js (1: 0 a, 1 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `routes/billing.js:2279` | Platform billing: payments per org | b | — | Steward's own platform billing, not donor money. |

### routes/grantSystem.js (1: 1 a, 0 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `routes/grantSystem.js:359` | Grant award plan: received against the award pledge | a | yes (moved in NUMBERS-4) | Shown as received of awarded; grantMoneyRows is the same sum written again. |

### routes/supporter.js (1: 0 a, 1 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `routes/supporter.js:153` | Supporter page: their peer page's raised | b | — | A peer page's own raised; note this one has no org scope, no amount > 0 and no NOT_DELETED, unlike the other peer sums. Supporter-facing. |

### setup.js (1: 1 a, 0 b)

| Where | Sums | Class | Rule | Why |
|---|---|---|---|---|
| `setup.js:659` | Setup readout: "N gifts ($X) are in Steward" | a | no (credits counted) | Shown as what her imports brought in; arguably a row inventory, so unsure. |

## Moved onto shared/numbers in NUMBERS-5

All 52 (50 "no", 2 "partial") moved; none was reclassed as a legitimate own sum. One was on the rule already: `routes/homeLead.js:180` repeats a sum whose query already had `MONEY()` in its WHERE, so the ORDER BY now names the column, and its "gave this season" test reads `GIFT()`. NUMBERS-5 added the sums themselves to `shared/numbers/`, with the credit rule inside, so a caller cannot forget it: `money.js` `MONEY_SUM(g, where)` and `MONEY_CENTS(g, where)`, `givingBetween.js` `SPAN_SUM(g)` and `SPAN_CENTS(g)` (two placeholders, from then to), `pledges.js` `GRANT_RECEIVED(gr)`. `route-gift-sql` went from 348 lines to 296. Guarded by `tests/numbers5-money-sums.test.js` (16 of 18 red on main) and `tests/numbers-home.test.js`. Where each now lives (SPLIT-1 had moved most of `routes/crm.js` into `server/`):

| Was (NUMBERS-4) | Now | Reads |
|---|---|---|
| `routes/give.js:7903` tax summary | `routes/give.js` `/account/tax-summary` | `MONEY_SUM`; a deleted record and an undated gift are in no year; the count is gifts above zero |
| `shared/reportBuilder.js:100,101` Paid, Still to come | the same | `pledges.PAID_OF` (the builder is an ES module only the server loads; it imports `shared/numbers`) |
| `shared/reportBuilder.js:153`, `server.js:4309` grant received | the same | `pledges.GRANT_RECEIVED`; the grant's payment rows (`/grants/:id/restricted`, the grant report facts) leave credit rows out too, so the figure foots |
| `server.js:5817,5821` builder column and group totals | `shared/reportBuilder.js` gifts entity | its base reads `MONEY("g")`: a credit row is not a gift in any builder report |
| `routes/homeLead.js:180` | the same | on the rule (see above) |
| `routes/crm.js:21920` gifts before a goal starts | `server/reports/helpers.js` | `MONEY_SUM`, count of gifts above zero |
| `routes/crm.js:21289,21301` goal's last seven days | `server/reports/fundraising.js` `goalGiftsBetween` | the goal's own rule (`orgGoalRaised`), over the last seven days: credit rows and deleted people out |
| `routes/finance.js:4617` whole giving history | the same | `MONEY_SUM`, rows that are money |
| `routes/finance.js:247,249` no fund, and the year it is a share of | the same, and its rows (`/finance/overview/rows?key=noFund`) | `MONEY_CENTS` (the window is `TODAY(org) - 365`, the org's day already) |
| `routes/finance.js:486` restricted money by donor | the same | `MONEY_CENTS` |
| `routes/crm.js:24675-24683` three-year report | `server/reports/handlers.js` `reportThreeYear` | `SPAN_SUM` per year; the person columns now foot to the year totals the report shows (the `gifts` source) |
| `routes/crm.js:24543-24551` retention report | `reportRetention` | `MONEY_SUM` in each year; a donor is someone with a gift (a refund or credit row alone is not), as `retained.js` and the sources say |
| `routes/crm.js:24509` LYBUNT/SYBUNT prior-year total | `reportBuntList` | `SPAN_SUM` |
| `routes/crm.js:25452` members by level revenue | `reportMembersByLevel` | `SPAN_CENTS`, deleted people out |
| `routes/crm.js:25508,25509` membership revenue | `reportMembershipRevenue` | `MONEY_CENTS` beside `IN_SPAN` |
| `figureSources.js:426-432` top-givers | the same | `MONEY_SUM` with `IN_SPAN` |
| `figureSources.js:570` bunt source amount | the same | `SPAN_SUM` |
| `figureSources.js:1633,1649` retention windows | the same | people with a gift (`GIFT`), their money `MONEY_SUM` |
| `figureSources.js:3238` group page in one read | the same, and `group-gifts` | credit rows out of total, count and average alike |
| `askEngine.js:393,399` first-year retention | the same | chosen by gifts, amount `MONEY_SUM` (a refund comes off) |
| `routes/crm.js:17569,17573` grant report facts | `server/grants/routes.js` | `MONEY_SUM`; the fund's gift lines are money too |
| `routes/crm.js:26893-26902` re-engaged | `server/reports/impact.js` | `MONEY_SUM`, and a credit row is neither a return nor an earlier gift |
| `routes/insights.js:159,161` what worked | the same | `MONEY_CENTS`; who gave is a gift above zero |
| `routes/give.js:4231` recurring roster | the same | `MONEY_SUM`, count of gifts |
| `setup.js:659` setup readout | the same | `MONEY_CENTS`, count of gifts |
| `reconcile.js:314,463-465` old-report check | the same | `MONEY_SUM` / `SPAN_SUM`; the "Steward counts matching gifts" cause now counts matching gifts (money), not credit rows, which are in neither side |
| `routes/dataHealth.js:740` merge refold | the same | `MONEY_SUM`: the recompute adds back money rows only, so the fold takes off money rows only |

## Moved onto shared/numbers in NUMBERS-4

These sums were in the files when the inventory started and NUMBERS-4 rewrote them onto `shared/numbers/` (a pledge's paid is now `pledges.js`; the rest call `money.js`, `lifetime.js`, `lastGift.js` or `givingBetween.js`). Rows marked "yes (moved in NUMBERS-4)" above were moved in place. They are not in the counts above.

| Was at | Sums | Class | Rule then |
|---|---|---|---|
| `donorList.js:297` | Donors list pledge balance filter: open pledges' remaining | a | no (paid side counts credit rows) |
| `donorList.js:297` | Donors list pledge balance filter: paid on each pledge | a | no (credits counted) |
| `donorList.js:488` | Donors list pledge balance cell: paid per pledge | a | no (credits counted) |
| `figureSources.js:347` | pledges-due / overdue sources: paid on a pledge with no schedule | a | no (credits counted) |
| `figureSources.js:2066` | pledges-open source: paid on each open pledge | a | no (credits counted) |
| `insightsData.js:30` | Insights input: paid on each pledge | a | no (credits counted) |
| `prospectBrief.js:24` | Prospect brief: lifetime of gifts on file | a | no (credits counted; refunds ignored: amount > 0; imported total not added) |
| `server.js:3029` | Late-pledge reminder drafts: paid on the pledge | a | no (credits counted; the gifts subquery is not org-scoped) |
| `server.js:3738` | recalcPledgePayment: paid, balance, surplus, status | a | no (credits counted) |
| `server.js:3772` | OPEN_PLEDGE_REMAINING_JOIN: paid per pledge | a | no (credits counted) |
| `server.js:9259` | pledge_due workflow: paid on the pledge | a | no (credits counted) |
| `setup.js:509` | Setup finish: "gave $X in all" for the first calls | a | no (credits counted; refunds come off; imported total not added) |
| `setup.js:513` | Setup finish: the same sum as the ORDER BY | a | no (credits counted) |
| `routes/crm.js:7626` | Pledge payment response: paid, balance, surplus | a | no (credits counted) |
| `routes/crm.js:7854` | Profile pledges tab: paid, balance, surplus | a | no (credits counted) |
| `routes/crm.js:11237` | Gift extras: paid on the matching pledge | a | no (credits counted) |
| `routes/crm.js:21777` | Campaign progress: paid per pledge | a | no (credits counted) |
| `routes/crm.js:21900` | Fundraising campaigns: paid per pledge | a | no (credits counted) |
| `routes/crm.js:22312` | Fundraising pledges list: paid and balance | a | no (credits counted) |
| `routes/crm.js:23891` | Board report: gifts this quarter | a | no (credits counted; deleted people counted) |
| `routes/crm.js:23892` | Board report: gifts same quarter last year | a | no (credits counted; deleted people counted) |
| `routes/crm.js:24857` | Solicitations report: paid per pledge | a | no (credits counted) |

## Worth a look, not counted as (a)

These are (b) by the definitions above, but each has something a reviewer may want to decide on:

- `numbers.js` "itemized" (the second sum in `donorGlance`) is selected and never read.
- `routes/finance.js` month close: the bookkeeper's file count sums every gift row, while the file itself leaves out `BOOKKEEPER_EXCLUDED_TYPES`.
- `db.js` `keepEarlierTotals`: the imported total subtracts every gift row, credit rows included, but `LIFETIME()` adds back only `MONEY()` rows.
- Giving-page and peer-to-peer raised are written about twenty times (`routes/give.js`, `routes/crm.js`, `routes/supporter.js`, `routes/agent.js`, `engagement.js`, `figureSources.js`) with three different rules: `amount > 0` (`P2P_RAISED`), every row (`raised_amount`), and `MONEY()` (the Fundraising overview). `routes/supporter.js` has no org scope on its gifts subquery.
- `server.js` and `routes/give.js` copy `numbers.publicBarRaised`'s SQL for the public and portal thermometers instead of calling it; they are on the rule today.
- `routes/homeLead.js` registration gifts promised at the next event read `event_attendees.gift_amount`, not `shared/numbers/events.js`.

## LEDGER-1 (2026-11-04)

- `server/donors/gifts.js` profile pledges: its own `due_this_year` (unpaid installments, then capped) is gone; it reads `shared/numbers/pledges.js` `dueOf`.
- `server/reports/fundraising.js` `/fundraising/pledges` rows: their own due and overdue are gone; `dueOf`.
- `figureSources.js` `pledgesDueSql` (pledges-due, pledges-overdue): whole unpaid installments → `pledges.js` `DUE_SQL`.
- `server/reports/handlers.js` `reportBuntList` and `figureSources.js` `bunt`: last year's `SPAN_SUM` → `givingBetween.js` `LAST_YEAR_SUM` (the last year they gave).
- `afterChange.js` `rhythmFor`: calendar this/last year → the fiscal year (`fiscalYear.js` `startYearOf`).
- `route-gift-sql` baseline lowered by one.
