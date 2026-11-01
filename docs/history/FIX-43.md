## FIX-43 · ONBOARD-1's gaps, security first (2026-10-18)

Part 1: every fetch of an address a person typed goes through one helper, `safeFetch.js`. It resolves the name
once, refuses the whole answer if any address is private, loopback, link-local, metadata, multicast or reserved
(IPv4 and IPv6, mapped and embedded forms too), connects the socket to that exact IP with the original Host header
and SNI, follows at most three redirects by hand with the same check on each hop, and caps bytes and time; http and
https on 80 and 443 only. Before, setup's site read and logo fetch checked the name and then let `fetch` resolve it
again (DNS rebinding), the spreadsheet photo queue followed redirects and checked only the final URL's string, and
outgoing webhooks had no private-address check at all. All four are on the helper now
(`tests/fix43-safe-fetch.test.js`, a stand-in resolver and network). Part 2: the gone-quiet journey already fires on
`joined_group` for the LYBUNT group by rule; `onboard1-setup` §7b proves it (and that a paused one starts nobody).
Part 3: an old report among setup's files is set aside before the import, stored and checked through the
old-reports routes (RECONCILE-1), and its one line is on "Steward is ready", opening Reports with `?check=`.
Part 4: a gifts-only file with names on each row imports through setup with the Import screen's own grouping, now
`shared/giftFileDonors.js`. Found on the way: `ensureOrgLedger` bound five values to four placeholders when an org
had accounts but no unrestricted fund, which is where "Undo all of setup" leaves an org, so a second setup crashed.
