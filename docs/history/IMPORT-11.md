## IMPORT-11 · What comes in through import is what Steward shows everywhere (2026-11-27)

Duet's prod stress test (26–27 Nov, TEST STEWARD org, mail off) found one blocker and four money majors in import.
The blocker: a workbook of Donors and Gifts keyed by Constituent ID read "A list of people with no gifts". The one
reader classed a table of amounts with no name column as "a summary"; IDs were only used to link a gift sheet that
already had names. Now a summary table whose ID column holds the people sheet's IDs is gifts, linked by ID
(`shared/sheetWorkbook.js`), and `wantsAdaptiveReading` keeps such a file in the one reader, which says "60 people
and 136 gifts ($8,005.00) joined on Constituent ID", names every sheet set aside and lets her correct each sheet.

The money majors shared one root: `toCents()` refuses anything over $100,000,000 (MAX_CENTS), and 66 call sites read
stored values as `toCents(x) || 0`, so a $1,000,000,000 gift the importer (which had no cap) wrote was $0 to the
profile, the receipt ("File $0") and the check page ("Your file: $0.00"). Stored values now go through
`storedCents`/`storedCentsOr0`; input over the cap is refused in one sentence; `ck_gifts_amount_within_cap` (NOT VALID)
refuses the write by any door; old rows are listed by `scripts/ops/import11-over-cap.js`.

Every gift row now clears four checks (`shared/importRowChecks.js`): over the cap, an exact copy (every cell; skipped by
default on a dated sheet, imported on an undated one because the real-shaped dinner file's two identical $25 cash rows
are two gifts), far outside the pattern (`shared/numbers/giftOutlier.js`: ≥100× the person's median gift and ≥10× the
org's largest; the form asks with a 409, the preview lists), and future-dated. The walk found two more: the check page
called the scheduled gifts "not explained" (now their own line, read at the time of asking), and the rail listed a
scheduled gift as waiting for a thank-you (the one backlog rule, `thankBacklog.WAITING`, now reads TRUTH-6's DUE).
INPUT-1 (#541) had already held the thank-you draft and task for a scheduled gift; this build only added the Refund
refusal. The truth check's own keys counted a person whose only gift is scheduled as a donor and as owed a thank-you;
both now follow TRUTH-6.
