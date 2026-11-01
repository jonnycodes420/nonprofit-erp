## NAV-1 — a sidebar you can scan (2026-09-30)

Thirteen items in one flat list, plus a "More" fold. Events and Volunteers shared
one icon and Reports and Dashboards shared another, so the one place an icon has
a job — telling two rows apart at a glance — was the one place it could not do
it. The icons were abstract shapes: a diamond for Home. Tasks and Communications,
both used daily, were behind the fold. Jonathan, 30 September: "I wish we could
organize this" and "make the icons make sense, like an actual house for Home."

**GROUPS, NOT A FOLD.** Five short labelled lists and a pinned pair: Home and
Tasks with no label, then RELATIONSHIPS, RAISE, VOLUNTEERS (its own product, its
own group), MONEY, and Agent and Settings separated at the bottom. Nothing is
behind a disclosure any more, at the same height. The shape moved into one
JSX-free module, `client/src/lib/navGroups.js`, that the desktop rail, the
collapsed rail and the phone's More drawer all read — it used to be three
separately-kept lists, which is how the phone twice came to teach a different
product from the desktop (FIX-9 Part E, BUILD-87 F.3.5).

**DASHBOARDS FOLDED INTO REPORTS.** They were two nav items sharing one glyph and
one question. The four dashboards are the first group of Reports' one rail,
filled from the server's own `/dashboards` list so the rail cannot drift from
what exists, and `Dashboards.jsx` draws no rail of its own in there — two left
rails side by side is the scanning problem this build set out to fix. Nothing is
deleted: `navigateTo("board")` is kept as a synonym, `/dashboards` redirects,
and `smoke-walk` opens the dashboards from inside Reports on every run, so
folding them in did not quietly stop walking them.

**CUSTOMIZE, PER PERSON.** `users.nav_layout` + `/me/nav-layout`, the same shape
and the same three verbs as the Home layout (BUILD-34), per user and not per org
because two people share an organisation and not a job. Hide or reorder within a
group, never across one. Home and Settings cannot be hidden, and the server
refuses it too — the half a stale client cannot get past. A role default applies
only to somebody who has never saved a layout: a volunteer coordinator starts
with Finance hidden, because that role sees no giving anywhere else.

**THE DEFECTS THE WALK FOUND, in the order it found them.** Each of these was
green in the source and wrong on the page or in the product.

1. **A volunteer coordinator could not sign in at all.** Four of the shell's
   seven opening reads are refused for that role by the VOL-1 allowlist,
   correctly and by design, and one rejection threw in `loadData` — so the whole
   app rendered "Failed to connect" with the coordinator's own refusal sentence
   under it. The role had a rail, a hub and a roster and no way to reach any of
   them. `coordinator_scope` is the same KIND of answer as `portal_tier` (the
   server saying "not for you", not the server failing) and now gets the same
   empty fallback. Nobody had walked that login; the brief's one line about that
   role's default is what sent somebody to look.
2. **The expiring-card screen and the expiring-card email read different
   clocks.** The sweep picks candidates in UTC; the two staff counts used
   Postgres `CURRENT_DATE`, which is the DATABASE SESSION's timezone. The
   battery went red at 20:30 local on 30 September — the hours where a non-UTC
   database and UTC disagree about which month it is — meaning Steward emails
   donors about cards the screen counts as zero. Production's Postgres is UTC so
   nothing had gone wrong there, which is exactly why only the scratch Postgres
   (America/New_York) could find it. Both queries read UTC now. Whether the right
   basis is UTC or the ORG's timezone is a later build's question; agreeing with
   the email is not.
3. **The Customize dialog offered to hide a tab the org does not have.** Donor
   Portal is hidden from every CRM org and was listed anyway. The dialog now
   lists what this org's plan HAS — and a save is written against the full
   layout, so a preference about a plan-hidden item is kept rather than dropped.
4. **A reorder that saved nothing.** `queue.shift()` inlined into a `find()`
   callback shifts on every comparison instead of once per slot, which leaves the
   order untouched and looks exactly like a save that did not land.
5. **Two nav lists in the DOM at once.** The mobile bottom bar is `display:none`
   at 1440, not absent, so the first walk read every nav item twice and the
   active-tab assertion matched the wrong button. A walk that queries the page
   has to say WHICH nav it means.
6. **Uppercase in CSS is not uppercase in `textContent`.** The group labels are
   `text-transform: uppercase`; the walk read `textContent` and saw
   "Volunteers". `innerText` is what the reader actually sees. (The same trap
   BUILD-82 recorded, in a new place.)

**WHAT THE RULE ABOUT TESTS BOUGHT.** No new suite. One classification line in
`script-guards`, one leg added to `smoke-walk` so the folded dashboards keep
being opened, and a throwaway walk (`scripts/nav1-walk.js`, 40 assertions at
1440 and 390) that found all six of the above. Five of them were proven by
watching the assertion go red first.
