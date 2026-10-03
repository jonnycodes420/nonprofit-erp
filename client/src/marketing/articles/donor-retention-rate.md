---
title: How to calculate your donor retention rate (and what to do with it)
headline: How to calculate your donor retention rate <b>(and what to do with it).</b>
description: Divide the donors who gave last year and again this year by everyone who gave last year. Here is how to count it right, split it, and act on it.
date: 2026-10-03
author: Jonathan Atkinson
kicker: Retention
minutes: 6
cover: Your retention | rate, worked out
terms: donor-retention-rate, first-year-retention, repeat-donor-retention, lybunt, household, deduplication
sources: fep25, fep24
---
Your donor retention rate is the number of people who gave last year and gave again this year, divided by the number of people who gave last year. You can work it out from a gifts export in under an hour. The harder part is counting the right people, and then deciding what the number tells you to do on Monday.

## The formula
Your [donor retention rate](/glossary/donor-retention-rate) answers one question: of the people who gave in the earlier year, how many came back in the later one?

1. Make a list of every person who gave at least once last year. That is your starting group.
2. Make a list of every person who gave at least once this year.
3. Count the people who appear on both lists.
4. Divide that count by the size of the starting group, then multiply by 100.

```example
Last year 300 donors gave. 126 of them gave again this year.
126 ÷ 300 = 0.42
0.42 × 100 = 42%
```

Notice what the formula leaves out. New donors who gave for the first time this year are not in it at all. They matter, and you should count them, but they are a different number. Retention only asks about the people you already had.

## Count people, not gifts
The most common error is counting gifts instead of donors. A woman who gave four times last year and once this year is one donor who came back. If you count gifts, she looks like four gifts in and one gift out, and your rate is wrong in both directions.

Before you count anything, collapse your export to one line per person. In Excel or Google Sheets, make a pivot table with the donor in the rows and the year in the columns, showing a count of gifts. Anyone with a number under both years is retained. Anyone with a number only under last year is not.

Two cleanups make that pivot honest:

- **Duplicates.** "Bob Smith", "Robert Smith" and "R. Smith" at the same address are probably one person. If they stay separate, you will count one loyal donor as two who left and one who arrived. Spend twenty minutes on [deduplication](/glossary/deduplication) before you trust the result.
- **Households.** If a couple gives from a joint account one year and from her account the next, they look like a lapse and a new donor. Decide whether you count individuals or [households](/glossary/household), then stick with that choice every year.

## Choose your year and keep it
You can measure retention by calendar year or by fiscal year. Neither is wrong. What breaks the number is switching between them, or comparing your fiscal-year rate against someone else's calendar-year rate without saying so.

Most small shops do best with the calendar year, because that is how donors think about their giving and how December appeals land. If your board reads everything on a July to June fiscal year, use that instead. Write the choice at the top of the spreadsheet so the next person who runs it uses the same one.

Also watch for timing. A donor who gave on December 28 one year and January 3 the next gave twice in about a week, yet a calendar count can show them in one year and not the other. If your rate swings sharply, check how many of the "lost" gave in the first two weeks of January.

## Split it in two
One overall rate hides two very different groups.

- **[First-year retention](/glossary/first-year-retention)** is the share of people whose first gift ever was last year and who gave again this year.
- **[Repeat donor retention](/glossary/repeat-donor-retention)** is the share of people who had already given before last year and who gave again this year.

The gap between them is large. In the Fundraising Effectiveness Project's Q4 2024 report, the new donor retention rate was 19.4% retained and the repeat donor retention rate was 69.2% retained. That is why a year with a big wave of new donors can make your overall rate fall even when nothing went wrong. It also tells you where the work is: the second gift.

To split your own number, add one column to your pivot: the year of each person's first gift. Filter to people whose first gift was last year and run the formula. Then filter to everyone else from last year and run it again.

```example
Of last year's 300 donors, 100 were giving for the first time.
24 of those 100 gave again: 24 ÷ 100 × 100 = 24% first-year retention.
The other 200 had given before. 102 gave again: 102 ÷ 200 × 100 = 51% repeat retention.
Together: (24 + 102) ÷ 300 × 100 = 42% overall.
```

## Common mistakes
- Counting gifts or transactions instead of people.
- Leaving duplicates in, so one donor looks like a loss and a gain.
- Running it in October and comparing it to last year's full-year figure. Your current year is not finished. Compare the same date range, or wait until the year closes.
- Including this year's new donors in the top of the fraction. They were never in the starting group.
- Dropping gifts that came through Stripe, PayPal, Givebutter or Square because they live in a different export. Merge every source first.
- Changing between calendar and fiscal year from one report to the next.

## What to do with the number
For context, the Fundraising Effectiveness Project's Q4 2025 report says overall retention edged up from 43.1% to 43.3%. That is a sector-wide figure from thousands of nonprofits. It is useful as a rough sense of the ground, and not much more. Your mission, your donor mix and your size all move your rate.

Your own trend matters far more. Run the same calculation, the same way, for each of the last three years. If the line is flat or falling, something in the first year of a donor's experience is not working. If first-year retention is low and repeat retention is steady, put your hours into new donors: a thank-you call within two days, a short note in the first month about what the gift did, and a renewal ask near the anniversary of the first gift.

Then turn the number into names. The people in your starting group who have not given yet this year are your [LYBUNT](/glossary/lybunt) list. Sort it by last year's gift, largest first. That sorted list is what your retention rate looks like when it has faces.

If you want to see what a small lift is worth in dollars, the free [Keep Rate calculator](/tools/retention) takes last year's donors, how many gave again and your average yearly gift, and shows your rate beside the national figure. For a fuller walk through the benchmark, read [how to read your retention rate](/articles/read-retention).

## In Steward
Under Reports, the "Who stopped giving" group holds LYBUNT, SYBUNT, lapsed donors and retention. Every figure comes with the sentence that defines it, and clicking it shows the donors behind it. On Home, [drift](/features/drift) lists donors who have gone quiet past their own giving pattern.

This week, pull the export, build the pivot, and write down three numbers: overall, first-year and repeat. Then open the list of people who gave last year and have not given yet, and look at the top ten names. You will know most of them. Those ten are where you start, because a rate only changes one person at a time, and the first step is seeing who is slipping.
