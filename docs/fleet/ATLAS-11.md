# ATLAS-11 · For the fleet

**Surfaces changed:** the Atlas dialog (its header with AI off, the follow-up box under every answer, "Did you mean"
buttons, Tell me more, Start over, the conversation kept across closing); Atlas's answers to "how is <a campaign> doing",
a person's lifetime in any phrasing, and LYBUNT; Home's goal bar (now drawn by the same function Atlas reads, no change on screen).

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight; Atlas writes a request row, so prefer org_stagewalk with a campaign of its own.)** Open Atlas,
   type "How is the Annual Fund doing?". Right: "Annual Fund 2026 has raised $… of its $… goal (…%)", the pace sentence and
   days left, the same figures as Home's Annual Fund bar. Press Tell me more: "Behind that $…: N gifts from M givers", and the
   givers listed add up to the figure shown.
2. **(Needs a write: org_stagewalk.)** With two campaigns "<Name> 2026" and "<Name> 2025", ask "How's the <Name> going?" (or
   misspell it by one letter). Right: "Did you mean <Name> 2026 or <Name> 2025?" with two buttons; pressing one answers for it.
   Off the path: "How is the capital campaign doing?" with no such campaign lists the closest names, never "doesn't exist".
3. **(Needs a write.)** Ask "<Person>'s total", "lifetime for <Person>", "How much has <Person> given?" and "Brief me on
   <Person>". Right: one lifetime figure in all four. Then Tell me more: contact details and gift history, not the brief again.
4. **(Needs a write.)** "LYBUNT dollars". Right: "N people are LYBUNT, in H households. Together they gave $X last fiscal year",
   each equal to Reports > LYBUNT, then the LYBUNT sentence.
5. **(Needs a write.)** Ask two things, close Atlas (Escape or Done), reopen it: both turns are there, with the follow-up box
   under the last answer. Press Start over: empty. Close and reopen: still empty. Another signed-in person sees only their own.
6. **(Read only.)** With AI off, the header reads "Answers use templates while AI is off" on every answer, and no answer
   repeats it. "Peggy said the kids loved it" says "I can't read that one while AI is off. I can still …".

**What could have broken nearby:** Home's Annual goal bar (`/home/annual-goal` now calls `goalCard`); Ask questions that name a
campaign ("how much did we raise for Year-end" still goes to Ask unless it is shaped "how is X doing"); "Tell me more" and
"List them" after a list or a why answer; Settings > Atlas's reading-off line (unchanged); the bell's Answer on a waiting
request (opens that request, not the conversation).

**Needs a write:** clicks 2, 3, 4, 5 (org_stagewalk). Click 1 in Harborlight writes an Atlas request row; use org_stagewalk if
the baselines must not move.
