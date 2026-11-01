## REPORTS-3 · saved dashboards and the board pack (2026-10-02)

The ED stops rebuilding the same report every month, and the board gets the same numbers on the same day
without anyone exporting anything.

**A saved dashboard is tiles she picked.** A tile is one of three things the product already had: a number
(any of the 44 named sources in `figureSources.js`), the one chart (`givingByMonth`), or a list (any standard
or saved report). It is a DECLARATION validated by `shared/boardPack.js`, never SQL, exactly as a saved report
is. Nothing on it is a number computed beside its rows: every figure carries the `source` it came from, so it
opens, and the rows foot to it. The date range, fund, campaign and owner save with the dashboard and live in
the URL. They sit in the Dashboards group of Reports' one rail, prefixed `sdash:`, beside the board pack and
the tile picker. No second list, no second button: FIX-2 B took those out of Reports and this build did not
put them back.

**The board pack is one composition.** `composeBoardPack` builds the pack as data and `renderBoardPackPdf`
draws that same object, so the screen and the paper cannot disagree. Six sections: giving this period against
last year, donors and retention, top gifts, campaign progress, volunteer hours, and a page defining every
number on it, under the org's own name and logo with page numbers, the period and the day it was produced.
Volunteer hours needed two new sources (`volunteer-hours`, `volunteers-served`) because the only place hours
had ever existed was a report-builder column, which cannot be opened and cannot be footed.

**Its definitions are written for an arbitrary period, and that is deliberate.** The first instinct was to
reuse the dashboard metrics' definitions rather than keep a second copy of each sentence. They cannot be
reused: they are written for the fiscal year ("between the first day of your fiscal year and today"), and a
pack's period is a month or a quarter. Printing the fiscal-year sentence over a quarter's number would put a
definition on the definitions page that the number does not obey, which is the one thing that page is for.

**The schedule is off until somebody turns it on.** One row per org, monthly or quarterly, on a day between
1 and 28 (29, 30 and 31 do not exist in every month, and a pack that silently skips February is a pack
nobody trusts). It reports on the last COMPLETE period through `orgPeriodBounds(org, period, -1)` — a pack
sent on the 5th is about the month that finished. It reserves `board_pack_sends` before the first send and
releases it when nothing was accepted, and it rides the existing 5-minute tick. Recipients are the org's own
`board_pack_emails` from Settings, and the server refuses an address that is on file as a donor: "your staff
and board, never a donor" is the rule the list exists under, and a typo would otherwise mail a major donor the
organisation's retention figures. "Send a test to me" goes to the caller alone and reserves nothing.

**The one test reads the numbers back out of the PDF.** A board pack is a document that leaves the building:
attached, forwarded, printed, read at a meeting six weeks later by people who cannot click anything on it. So
`tests/reports3-board-pack.test.js` does not check the composer against itself. The renderer passes
`compress: false`, the suite pulls every text run out of the file, and each number is footed against
`GET /figures/:source/rows` — the live report's own rows, paged, summed in integer cents. Proven able to fail
three times: a figure one cent off its rows, a `source` naming a window one day off from the number it
describes, and the renderer printing every money figure a cent high.

### What this build got wrong first

- **An uncompressed pdfkit PDF writes text as a kerned array (`[<hex> -20 <hex>] TJ`), not as `(…) Tj`.** The
  first reader looked only for the second form, found nothing, and every "is this printed" assertion passed
  vacuously — an extractor that returns nothing agrees with everything. §6 now checks the reader can tell
  $7,477.80 from $7,477.81 before anything it says is believed.
- **"Somewhere on the page" is not where a number belongs.** With every money figure printed a cent high, only
  one of six was caught: the right value still appeared elsewhere in the document, because the Top gifts total
  is the same number as giving this period. A figure's value must appear beside its own LABEL.
- **A ratio source has no `measure` function.** `retention` is computed from its two parts, so
  `sDef.measure(p)` threw — and because one tile's crash was the whole composition's crash it took the entire
  dashboard down: a blank screen with a 500 behind it. Found by opening the seeded dashboard in a browser on
  the first walk, not by any server test, because the default pack is all sums and counts. One tile's failure
  now costs that tile, and §7 covers all three tile kinds.
- **A screen that swaps itself for a spinner unmounts the control being typed in.** The saved dashboard
  returned a bare spinner on every filter change, destroying the date input mid-keystroke: the filters could
  not be typed at all. Found by typing a date in a browser; no server test can see it.
- **The Settings card followed the wrong card's pattern** and landed under Giving Pages instead of
  Organization, because `TimezoneCard` lives there. The walk found it missing from the tab the product links to.
- **A stale server held the port.** `kill` on the boot wrapper left its `node` child listening, the new server
  never bound, and twelve new routes answered 404 while the file plainly declared them. Kill the PID that is
  listening, not the shell that started it.
