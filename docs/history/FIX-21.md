## FIX-21 · Groups white screen (2026-10-03)

Clicking a group showed about six seconds of a blank page on prod. Measured first: the JS was 0.2 s and
cached; the time was the API. A group page asked for its 22 figures one at a time (five figures, each
computed twice, once for its value and once for its sentence, plus twelve months), and each re-read the
group and re-ran its rule: 51 to 96 sequential queries at about 20 ms a round trip to the database, plus
the aggregates themselves. The list did one count per group. Now the page is one statement for every
figure and month (figureSources.groupFigureValues, footing checked by parity1-groups-journeys), one for
the people, sent side by side, and the list counts every group in one statement. Locally, with the
statistics made stale on purpose, the old code took a 1,000-member page to 35 s: a nested loop on an org
the planner thought had one row. Set-wise reads now go through `querySetwise`, a pool with nested loops
off. The Groups list, the group page and every lazy route draw a skeleton of their own shape while they
load. Guard: tests/smoke-walk.test.js times the list and two 1,000-member group pages against 500 ms.
