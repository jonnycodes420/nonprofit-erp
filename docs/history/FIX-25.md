## FIX-25 · What Muse's walk found (2026-10-04)

Muse's walk of Harborlight on 4 Oct. **Change of address was dead twice over:** the file route set
`X-Row-Count` but never exposed it to CORS, so the app on another origin read 0; and behind that the demo
seed's bulk insert wrote a street for nobody, so only 34 of 1,217 people were mailable. The route exposes
the header, the seed gives each North Shore person a tidy, unique street and ZIP (1,158 mailable;
duplicates, addresses to tidy and unreachable unchanged at 8, 15, 3), "Bring in the results" is a real
button, and a demo org gets a sample results file sent through the same import. **Meeting Undo** could not
be reproduced: the same build shows the toast at 1440 and 390. It was fragile, not absent: the profile and
Major gifts drew their own toast inside their screen, and ten seconds ran while a slow observer looked.
Every delete now uses the one body-level host and the clock stops on hover, focus and a hidden tab;
smoke-walk deletes a demo meeting and presses Undo. **The campaign builder** was fixed at inset 0 under a
z-250 top bar that covered Save draft; it and the New Event drawer use the takeover convention (top 52).
Also: a write forgets reads in flight (`api.js`), the volunteer record leads with hours a week, a demo
org's mail attachment says it is a demo, Ask why's matchers take plain rewordings, and Auctions,
Peer-to-peer and Memberships are on the rail and in search. Sitemap: prod was already right (200,
application/xml to Googlebot, robots.txt points to it); the likely cause is a non-www submission.
