## SPLIT-1 · crm.js becomes the domains it already holds (2026-11-02)

`routes/crm.js` was 30,287 lines and 561 routes, and the file with the most merge collisions (84). It
is now 135 lines that only mount things. The routes and the helpers only they used moved verbatim into
`server/<domain>/` (events, grants, outreach, imports, tasks, reports, majorGifts, memberships, org,
donors), one commit per domain; what two domains share went to `server/shared/`, one file per job
(journeyStart, trash, auditLog, givingPagePayload, csv, grantMilestones, milestoneDrafts, chequeImage,
fileLimiter, and crmCommon for the small rest). ARCHITECTURE.md's 1,500-line rule meant one file per
domain was not possible for six domains, so a domain is a folder: `routes.js` plus siblings named for
what they hold, and `helpers.js` for what its files share. 52 files, the largest 1,485 lines.

How it stayed a move. Every statement in crm.js's `mount()` was cut the way `readSource` cuts one (the
statement with the comments above it) and copied byte for byte by a one-time generator that was not
committed; a helper went where the routes that reach it went. Two things kept behaviour: the routes sit
in sub-routers inside crm.js's own r0 and r1, which server.js still mounts at the same two places, in an
order that keeps every pair of routes that can answer one request in the order they had (36 sub-routers
were enough); and `mount()` mounts the helper modules first, each after the ones it reads, handing back
what the next one reads. The proof is `scripts/ci/route-diff.js`: before and after, the same 1,442 routes
app-wide, the same middleware chain on each, 55 overlapping pairs in order, and the stitched
`readSource("server.js")` byte-identical, at every one of the eleven commits. `readSource` needed one
change for that: it reads crm.js's pieces in crm.js's own order (`splitOrder.json` "routes/crm.js"),
because most of them had been edited since FIX-1 and were placed after the statement above them in
their file, which the split changed.

The rule going forward: a new route goes in its domain's file, `routes/crm.js` registers none
(`crm-routes`, a hard arch-check), and a verbatim move hands its ratchet counts over with
`arch-check --update --moved <file>`, which refuses unless they add up (129 gift-SQL lines and 3
org-specific lines moved, the same totals). Domain folders the brief named that ARCHITECTURE.md's
domain table did not (grants, tasks, reports, majorGifts, memberships, org) are listed under the table.
