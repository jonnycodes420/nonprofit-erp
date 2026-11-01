## 0a · THE PROD DEMO IS ONE COMMAND BEHIND (2026-09-28)

MEMBERS-2, EVENTS-2 and BUILD-103 changed it again, and this one is visible
to anybody you show the product to: **`/e/harbor-run` and `/e/harbour-run`
both 404 on production right now**, because the demo org has no 5K with a
public slug on it. The code for all of it is live at `b17a23a`; the demo has
no data for any of it.

After the re-seed Harborlight also has three membership levels and four people
whose "Your page" each shows a different set of sections; the 5K open for
registration with a member price, five entrants and one person on the waiting
list; and the 5K as a peer-to-peer campaign with two teams, five fundraisers
(one deliberately at zero) and twelve gifts with soft credits. "Harbour" is
"Harbor" everywhere, and `/e/harbour-run` redirects to `/e/harbor-run`.

I could not run it. The script writes to the database directly, and this
session's Railway connection returns variable NAMES only, so the production
`DATABASE_URL` is not readable from here. Run it with that set:

    DATABASE_URL=<prod> BASE=https://nonprofit-erp-production.up.railway.app \
      node scripts/ci/seed-demo.js --i-know-this-is-prod

VOL-1 and FIN-1 both changed `scripts/ci/seed-demo.js`, so Harborlight on
production has no volunteer programme and no finance month on it. Everything
they added WORKS on prod; the demo org just has no data for it, which matters
because Harborlight is what you show people.

I did not run this. It DROPS AND RECREATES `org_b72demo`, and dropping the
demo org on production while you are asleep is your call and not mine. It is
deterministic and safe to run any time, including ten minutes before a call:

    node scripts/ci/seed-demo.js --i-know-this-is-prod

Afterwards Harborlight has three volunteer opportunities with seven shifts
(one full with two people waiting), 30 volunteers, a company group, 269 hours,
six people who both give and volunteer, one lapsed background check and one
expiring in eleven days; and three funds with a restricted grant holding
$27,350 against a report due in 41 days.
