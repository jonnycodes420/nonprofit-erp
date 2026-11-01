## HOME-2 · Home changes with the day (2026-10-21)

Jonathan, 20 Oct: Home looked the same every morning. A lead slot under Ask now holds the one or two things that
matter most today for the person signed in, each with its reason (shared/homeLead.js, routes/homeLead.js, the
approved mockups in docs/home-2/mockups/). Why and What fold into Ask's suggestions unless there is something to
say; the rail reorders; "Not now" learns per person. Two traps: the query helper turns a `?` inside a SQL string
literal into a placeholder (`'year.?end'` silently matched nothing; write `{0,1}`), and campaign dates come back as
Date objects, so read them with to_char. Seed: the lunch with Ansel moves to today at noon, Halvorsen's $7,500
moves to last night with its thank-you drafted, and Priya gets her own coffee (scripts/seed/home2-days.js).
