# ACCESS-2B · Home for someone who sees only their own people (2026-11-11)

ACCESS-2's walk found Home reading wrong for a Campaign cabinet member: "The Thread could not be loaded just
now" (the Thread was closed to them), the admin's "Set up Steward 1 of 7" card, and about 140 console 404s
from Home's panels asking routes closed to them. Jonathan asked for the follow-up with ACCESS-2's rules.

What changed, and why:
- **The Thread is open, and theirs.** `composeThreads` takes `visible` (portfolio.js `visibleSql` over `d`)
  on both its reads (threads and the tasks it merges) and its "ever had one" count. `GET /threads` is
  declared scoped, `POST /threads/plan` param; the per-thread routes were already param (a thread names its
  person). A thread they own on someone outside the portfolio is not shown: ownership of a thread and of
  its person can part, and the person decides.
- **No admin cards.** "Set up Steward" reads `/org/setup-status`, now closed to them, so the card never
  draws. "Set your words" was already admin-only.
- **Zero calls to closed routes, by one list.** The app can't guess what is open, and a second hand-kept
  list would drift from the gate. `GET /me/portfolio-routes` sends every route in the router's own order
  with whether it is open to them, made from the live router and the same declarations the gate reads
  (routes behind no sign-in are open: the gate never meets them). The first route that matches a path
  decides, as Express does, because `/donors/birthdays-near` is its own route and not `/donors/:id` (the
  walk caught that). `api.js apiFetchNow`, the one place every `apiFetch` and bundle leaves, asks
  `lib/portfolioRoutes.js` first: a closed route is answered in the browser (404, scope "portfolio") and
  never sent; a bundle's closed parts are taken out. The flag comes on every sign-in answer
  (`user.portfolio`: login, two-step, invite, join, switch) and stays in step through the
  `X-Steward-Portfolio` header (exposed in CORS). `app.html`'s early preloader does not run for them (its
  CSP hash in `vercel.json` changed with it, as prerender.mjs says to). On the server, `/home/bundle`
  answers a closed part 404 without running its route.
- Opened beside it because Home asks them and they carry no one else: Home's birthdays (scoped to their
  people), the page-timing beacon and the AI stream (its prompt is written in the browser from what they
  already see; the server reads no person).

Tests: `tests/access2-portfolio.test.js` §7 (extends ACCESS-2's suite; no new suite): the list agrees with the
live gate on every param-less read; first match decides; an admin gets no list; a bundle answers a closed
part 404 and runs the open one; the Thread holds her person's follow-up and not the one on someone outside;
her sign-in answer carries the flag. §2 and §4 now probe the thread routes with a real hidden thread.
Planted and watched red: the Thread's `visible` dropped (§4 and §7 red, the hidden thread and task named);
the list marking every route open (§7 red, naming `/grants/email-path`, `/org/wealth-scores`, …).

Walk (production build, real clicks, as the cabinet member): Home shows the Thread with their own person's
step and not the one on someone outside, no Set up Steward, no "could not be loaded"; Donors "Everyone 3";
their person's profile; Tasks. Every request to the API was judged against the server's own list: 0 closed
routes asked, 0 closed bundle parts. The only failed loads left were the local preview's missing
`/_vercel/insights` scripts and `/ai/stream` 503 (no AI key locally); every user gets those locally, and
prod has both.
