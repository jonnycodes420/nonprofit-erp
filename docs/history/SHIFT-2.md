# SHIFT-2: main goes green, then Home stops moving for good (2026-11-03)

Main (7ed7ead) was red on CI only on perf-app's Home phone CLS: 0.045 against
0.02, intermittent (main's tree had passed 3 of 3 on CI earlier). Step 1 (#314)
made that check warn in CI like the other perf budgets, which turned main green
and let both deploys run. Step 2 found the shift and made the check strict again.

**What moved was Ask's "Try:" row, not the date or the queue.** On a 412 px
phone its two suggestion chips wrap to two lines: 58 px, plus a 12 px gap,
minus 2 px margin, is CI's 68 px (Your moves y 313→381, h 510→442). Its words
are `GET /home/lead`. App waits at most 800 ms for that read (`HOME_SHAPE_MS`,
lib/bootReads.js). When it misses the first bundle it is asked for alone, and on
CI's slower runner on slow 4G it lands one round trip after Home paints (CI:
paint about 4.0 s, shift 5.07 s). The hour played no part: the failing run read
0.045 at 08:00, 14:00 and 20:00 alike. DEPLOY-1's theory, that org_perf25k's
queue jobs slow the Home leg, does not hold: that org is wiped at the end of its
own leg, and locally neither lanes on nor the queue held (WORKER=off), at 4x or
8x CPU with score jobs queued during the leg, moved anything (0.004 every
time). Dropping `/home/lead` from the bundle and holding its own fetch 1.5 s
reproduced 0.045 exactly.

Two more pieces of Home's header arrived after the first paint by design. The
agent's daily line is a mount-effect fetch: an org with drafts waiting moved
every load, and the fixture org has none, so nothing caught it. A new org's
setup card (`setupStatus`) is also set after paint.

**The fix.** The Try row and the line under Ask are each one line of fixed
height, there before their words: the chips scroll sideways, as the moves tabs
do, and the agent's line ends in an ellipsis. The cost is one 17 px line under
Try that stays empty when there is no agent line. The setup status is taken
from the rail bundle's parked answer at mount, so it is in the first frame when
the rail landed first. When it hasn't, it still comes after (left below).

**The date.** At a 292 px column, 95 of the 2,604 weekday, month and day
strings wrap differently in DM Serif Display and its Georgia fallback. No single
size-adjust fixes that: Georgia's width runs 0.92 to 1.00 of the serif's from
string to string, and the best value (97%) still mismatches 2.4% of date and
width pairs from 280 to 420 px. So the day has its own face: the same woff2,
`font-display: optional`, over a Georgia fallback sized on the dates (97%).
On a warm visit it is the serif from the first frame. On a cold one the
fallback stays for the visit, and nothing swaps. No preload, no extra bytes.
`text-wrap: balance` keeps "2" off a line of its own.

**The guard.** perf-app has a fourth phone load at 08:00: lateHeader() drops
`/home/lead` from the first bundle, holds its own fetch 1.5 s, and gives the
agent's line words. On main it read 0.108 (the agent line +44 px, then Try
+68 px). With only the Try row's fix undone it read 0.045, CI's number. Fixed:
0.004. The CLS check is strict in CI again.

**Left for the next brief.** A new org whose rail bundle is slower than Home's
first paint still gets its setup card after paint. Dashboard's `useState(() =>
takeParked(...))` consumes a parked answer, so a render React discards loses
it, and the read goes to the network after paint (homeDay, the deck's data and
now setupStatus all follow this pattern). That is one way `/home/lead` misses on
CI; it isn't proven to be the way.
