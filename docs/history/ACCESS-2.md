# ACCESS-2 · Staff who see only the donors assigned to them (2026-11-10)

A beta customer asked for her campaign cabinet to see only the people assigned to
them. Raiser's Edge (constituent security), Salesforce NPSP (sharing rules) and Bloomerang (limited users) all
have it. On main a Staff member saw every person (reproduced in the walk: a Staff account opened Donors and
saw all six fixture people).

What changed, and why it is built this way:
- **One setting, per person per org.** `users.sees` / `org_memberships.sees` ('everyone' default, or
  'assigned'), with `can_export` and `can_wealth` (`server/db/ddl/access2.js`, additive). A role is per org
  (ACCESS-1), so the scope is too. Admins always see everyone. Set on the invite (copied to the account or the
  membership on accept) and in Settings → Team (`PUT /org/users/:id/access`, an admin's). The Campaign cabinet
  preset is Staff, only assigned, no export, no Wealth Score (`server/org/teamAccess.js`).
- **One predicate.** `visiblePeople` (`server/auth/portfolio.js`): the people the user owns
  (`donors.assigned_to`), and every member of a household whose primary person they own.
- **One door, deny by default.** Editing ~1,300 routes one by one would have left the one somebody forgot.
  `requireAuth` runs the gate after the route has matched (`req.route`, `req.params`), the same door the
  coordinator's allowlist (VOL-1) and the viewer (ACCESS-1) use. Every signed-in route is declared in
  `server/auth/portfolioRoutes.js` as free (no person), param (names one person or a record off one; the gate
  checks it and the handler is unchanged), scoped (a list; the handler adds `visibleSql`) or closed. A route
  nobody declared is closed, and the suite fails on it.
- **"As if they don't exist", literally.** A first cut answered a hidden person with the gate's own 404, whose
  body differed from the route's own not-found ("Donor not found"), so comparing the two told hidden from
  absent. Now a hidden person's id in a path is swapped for an id that can't exist and the ROUTE answers, the
  same answer it gives for nobody and for another org's id (which REDTEAM-1's tenant matrix holds to 404).
  A write naming a hidden person in its body is a 404 from the gate.
- **Open in this build:** the Donors list, its counts and Everyone, `/donors/ids`, pick and lookup, the
  shell's summaries, search and ⌘K (person kinds only), export (off for the cabinet), a person's profile and
  everything on it, writes inside the portfolio (touches, gifts, tasks, pledges, relationships, households),
  Tasks, Top 100 (their rows, still behind the major gifts permission), Atlas (names resolve only among their
  people; a whole-org question or the org's Top 100 is said once and left out), Home's bundle (each part is
  gated as its own route), and the morning email (`server/auth/portfolioMail.js` takes out items about
  anyone else, and the org-wide readouts). A link to someone outside on the profile's relationships is not shown.
  A person a portfolio user creates is theirs whatever the form names. Staff could not reassign before
  (assign is an admin's), and can't reach anyone outside to try.
- **Closed in this build** (404 for a portfolio user, and off their rail: `client/src/lib/portfolioAccess.js`):
  Reports and dashboards, Fundraising and Finance, Calendar, Groups and campaigns, events, journeys, mail,
  imports, grants, volunteers, Insights, the Thread and Drift. Each reads the whole org; each opens once its
  handler reads `visibleSql`. Closed is the strictest scope: none of them can show anyone outside.

Tests: `tests/access2-portfolio.test.js` (the one new suite; it guards donor data). It boots the server
in-process and walks the live router: §1 every signed-in route is declared and every open route's parameters
say what they name; §2 every open person-linked route (131), asked about someone outside, answers exactly as
about nobody (by this suite's own reading of the path, never the declaration), with a plausible body so a
dropped scope writes; §3 every open write (122) with someone outside in its body, all spellings at once and
each person-shaped field the route reads one at a time, and afterwards their rows are unchanged and nothing
points at them; §4 every open read scanned for the hidden person's markers, Home's and the profile's bundles
too; §5 Everyone, the list, search, ⌘K and export are the portfolio exactly, the cabinet's export is off, a new
person is hers, an admin and an everyone-staff member are unaffected, Team's change applies on the next
request; §6 Atlas can't find someone outside, finds her own, and an admin's finds the other.

Planted and watched red: the gifts route declared as naming no person (§2: `POST /donors/:id/gifts → 201
(nobody: 404)`, the gift written, §3 red too); `visibleSql` left out of the Donors list filter (§4, §5 red).
A first §2 took "is this a person parameter" from the declarations and stayed green on the first plant; it
now reads the path itself.

Walk (production build, real clicks, `NODE_ENV=production`): the admin set "Campaign cabinet" in Team (saved
assigned, no export, no wealth) and the invite shows "Sees"; the cabinet member's rail is Home, Tasks, Donors,
Atlas and Settings; Donors reads "Everyone 3", their three people only; another person's profile reads "We
couldn't find this person."; the hidden id and a made-up id answer the same bytes. Found and not fixed here:
on Home "The Thread could not be loaded just now" (the Thread is closed to them, the card reads like an
error), the admin's "Set up Steward" card shows to a staff member, and the closed panels' reads are console
404s. Next build: open the Thread, Calendar, Groups and the reports through `visibleSql`, and make Home
leave closed cards out instead of failing them.
