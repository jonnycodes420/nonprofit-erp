# THREAD-2 · two directions for the journey builder

Open `direction-a.html` and `direction-b.html` in a browser (no build step, no
server — `file://` is fine). Screenshots at 1440 and 390 sit beside them.

Both use the real palette and nothing else: ink `#0F1A12`, white, cream
`#F0EDE6`, **one** emerald action `#0D5C3A`, brass `#C9A84C` for late. The
donor profile's ink right rail is kept in both. They share `_shared.css`
deliberately, so any difference you see between them is a difference of
**layout**, never of colour.

Each shows the same four things, so they can be compared like with like:

1. the builder with the **New donor, first year** preset as a timeline
2. the live preview on **Margaret Chen** — a real Harborlight donor, with real
   dates off a first gift of $2,000 on 3 October 2026
3. the onboarding step **"How do you look after a new donor?"**
4. the donor profile showing **Step 3 of 7 · Impact report · due Jan 3** with a
   small done / today / upcoming timeline

## The choice, in one line each

**A · The spine.** The journey is one horizontal line and the line is *time* —
the gap between month 3 and month 4 is visibly bigger than the gap between day
2 and week 1, so "seven touches over seven months" is something you see. You
edit in a drawer under the spine, so the whole shape stays on screen while you
change one step. The journey chip lives in the profile's **right rail**.

**B · The playbook.** The journey is a document you write: one plain sentence
per step, in order, edited in place ("*Three months in, send the impact
report.*"). A compact ruler above gives the shape. The bet is that a fundraiser
does not want a Gantt chart — she wants to read what she has promised to do and
change a word of it. The journey reads as a **sentence in the main column**.

The real split is not decoration: **A treats a journey as a schedule, B treats
it as a promise in words.** That also decides where it lands on the profile.

## What is NOT decided here

Both are static mock-ups. No data model, no routes, no engine — that is being
built in parallel and does not depend on which one you pick, because both
render the same journey.
