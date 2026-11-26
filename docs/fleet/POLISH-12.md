# POLISH-12 · For the fleet

**Surfaces changed:** a person's record → Giving → the By year chart (the year labels under the bars, and each bar's
hover title) and the By year table's Change column. Reports → Year over year (the same chart and Change sentence).
A record's rail → Next step ("Nothing is open for …"). Major Gifts (opens on Pipeline unless the org has the Top 100
on; no Top 100 tab when off). Settings → Major gifts (a new "Top 100" switch above the tab choices). Super admin →
an org → Menu and Major Gifts (the same switch). A record's rail → Plan of care (the rank and "Add to Top 100" only
when on). Donors → tick people → the bulk bar ("Add to Top 100" only when on). Home → the portfolio card ("Next on
your Top 100" only when on). Atlas ("who on my Top 100 hasn't been touched", "add everyone who gave over $1,000 to
my Top 100": refused with a sentence when off).

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Donors → search "Fenwick Holdings" → open "Fenwick Holdings, Inc." → Giving.
   At 1440, 1024 and 390 wide the labels under the 11 bars never touch: "FY17 … FY27" (or every other one on a
   phone), the first and the last year always named. Hover a bar: "$24,000 in FY 2016–17 (Jul 2016 to Jun 2017)".
2. **(Needs a write.)** Same record, the By year table: the row after a $24,000 year reads "down $23,950 (99.8%)",
   never "(100%)". Off the path: record a refund of a whole year's only gift; that row says "refunded, net $0",
   never a percent.
3. **(Needs a write.)** Open a made-up organization whose name ends in "Inc." with nothing open: the rail reads
   "Nothing is open for <name>, Inc." with one period. A person called "Wren" still gets "Nothing is open for Wren."
4. **(Needs a write.)** Major Gifts in org_stagewalk: with the Top 100 off it opens on Pipeline and has no Top 100
   tab. Settings → Major gifts → tick Top 100: "Saved.", the Top 100 tab box appears; Major Gifts now opens on
   Top 100 with its people still there. Untick it again (second click): back to Pipeline, nobody removed.
5. **(Read only, Harborlight.)** Major Gifts opens on Top 100 only if Harborlight has the Top 100 on (it does after
   Jonathan runs the keep script, if it has people on its list); otherwise Pipeline, with no empty "Nobody on your
   Top 100 yet".
6. **(Needs a write.)** With the Top 100 off, ask Atlas "who on my Top 100 hasn't been touched in 60 days?": it says
   the Top 100 isn't turned on and where to turn it on; it never answers from the list.

**What could have broken nearby:** the Fundraising links that used to open Top 100 (`?fr=top100`) now land on
Pipeline when off. Home's Thread rank "#3" on a Top 100 touch (unchanged, only for people on a list). The profile's
Plan of care (still there when off, without the rank). Reports → Year over year's Change column and chart. Atlas's
brief on a person ("Here's what Steward knows about …") and "Start with …" lines. The super admin's org Menu card.
