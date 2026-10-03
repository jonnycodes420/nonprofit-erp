---
title: How to move your donor list off a spreadsheet in a day
headline: How to move your donor list <b>off a spreadsheet in a day.</b>
description: A one-day plan to move a donor spreadsheet into a donor system: clean the columns, fix dates and money, test 20 rows, import, then check totals to the cent.
date: 2026-10-03
author: Jonathan Atkinson
kicker: Moving
minutes: 6
cover: One day, | one clean list
terms: deduplication, household, restricted-gift
---
You can move a donor spreadsheet into a real donor system in one working day. Spend the morning cleaning a copy of the sheet, test 20 rows before lunch, run the full import in the afternoon, and finish by checking that the gift totals match the sheet to the cent. The original sheet stays untouched, as a read-only backup.

## Before you start
Block the whole day and tell your team the sheet is frozen from this morning. Any gift that arrives today goes on a sticky note, not in the sheet. Then make two copies: one you will never touch again, and one you will clean. Rename the clean copy so nobody confuses them.

If your list lives in several tabs or several files, gather them into one folder now. Most spreadsheets that grew over years have a donor tab, a gifts tab, an event tab someone added in 2019, and a column of notes that matters more than anything else in the file. You want to see all of it before you decide what moves.

## Morning: decide the shape
The first question is what one row means.

- **One row per person.** Each donor appears once, with a total or a last gift date. This is easy to read and loses the history: you know someone gave $1,200 in total, but not when or how.
- **One row per gift.** Each gift is its own row, with the donor's name repeated. This is the shape a donor system wants, because it keeps every date and amount.

If you have a gifts tab, that is your main file. If you only have one row per person with columns like "2023" and "2024", that still works: each year with an amount becomes a gift. If all you have is a lifetime total, import it, and start keeping one row per gift from today.

## Morning: keep the columns that matter
Delete nothing yet. Instead, mark the columns you will bring across. For most small shops, that is eight:

1. Name (first and last in separate columns if you can)
2. Email
3. Address (street, city, state, ZIP in their own columns)
4. Gift date
5. Amount
6. Fund or designation
7. Payment method (check, card, cash, online)
8. Notes

The fund column matters more than it looks. If a gift was given for a specific program, it is a [restricted gift](/glossary/restricted-gift), and your books need to know that. Make every fund name consistent: "Food Pantry", not "food pantry" in one row and "Pantry" in the next.

Everything else, such as a T-shirt size or a volunteer interest, can come along as a custom field or stay behind in the backup. Decide each one on purpose.

## Late morning: households and duplicates
Spreadsheets hide the same person three times. Sort by last name, then by email, and look down the list.

For [deduplication](/glossary/deduplication), use this order: the same email is almost always the same person. The same name and address usually is. The same name alone is a question, not an answer, because two different people called John Smith can both give to you. Merge the obvious ones in the clean copy and flag the doubtful ones with a note.

Then look for couples. "Tom and Ana Reyes" on one row and "Ana Reyes" on another is one [household](/glossary/household) with two people in it. Split joint names into two people at the same address where you can, and keep each gift on the person whose card or check it came from.

## Late morning: fix dates and money
These two columns cause most failed imports.

- **Dates.** Pick one format and use it in every row. 03/04/2025 means March 4 in the US and 3 April in much of the world, so if your sheet has been touched by more than one person, check a few rows where the day is above 12. Replace "Spring 2023" and "about June" with a real date or leave the gift out and note why.
- **Money.** Amounts should be numbers. Remove words like "pledge" or "in-kind" from the amount column and put them in notes. Watch for refunds written as (50.00) or -50, and for cells that are formulas.

Now total the amount column in the clean copy and write the number down, to the cent. Count the rows too. These two numbers are how you will know, at the end of the day, that nothing went missing.

```example
Clean copy, before import
Gift rows: 1,846
Sum of Amount column: $412,907.50
Distinct donors (by email, then name): 611
Gifts with no fund named: 37 (left blank, will land as unrestricted)
```

## Before lunch: a test import of 20 rows
Copy 20 rows into a new file and import only those. Choose them on purpose: a donor with many gifts, a couple, a gift to a restricted fund, a refund, an address with an apartment number, a name with an accent. Then open each person in the new system and compare against the sheet, line by line.

If anything is wrong, it is wrong in a way you can see in 20 rows. Fix the clean copy, delete the test, and test again. This half hour saves an afternoon.

## Afternoon: the full import
Import the whole clean copy. Map each column once, and for anything you are not bringing across, choose to discard it rather than letting it slide. Read the summary at the end before you click anything else: how many people were created, how many were matched to existing people, how many gifts landed, and which rows were set aside and why.

## Afternoon: check it to the cent
Compare three numbers against what you wrote down this morning.

```example
                         Sheet         Donor system
Gift rows                1,846         1,844 + 2 set aside (no amount)
Total given              $412,907.50   $412,907.50
Donors                   611           611
```

If the totals match, you are done with the hard part. If they are off, the difference is a clue. Off by the amount of one gift usually means one row was set aside. Off by a round number often means a duplicate. Find the row, fix it, and import only that gift.

## In Steward
The import reads the file's shape, whether one row per person or one row per gift, and says what it detected. Every column you have not mapped waits for you to store it or discard it. When it finishes, the Move Report puts the count and the dollars from your file beside what landed, and a difference in cents shows as a finding rather than being rounded away. Duplicates are matched to people already on file, and each merge has an Undo. The [spreadsheet move page](/move/spreadsheet) has a starter CSV template with the columns above.

## Keep the sheet, but lock it
Do not delete the original. Set it to view-only, move it to a folder named "Archive", and write today's date in the file name. For the next month, any time a number in the new system looks odd, open the sheet and compare. After that, you will rarely need it, and that is the sign the move is done. Starting tomorrow, every new gift goes into one place only, and your list finally has one version of the truth.
