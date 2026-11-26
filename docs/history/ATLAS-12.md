# ATLAS-12 · The same question gets the same number, whatever the wording

26 Nov 2026. From Jarvis's lead for Thu 26 Nov (Area 5 graded C). Each item was reproduced on staging (c2e96c9) with real
clicks as the walker (org_stagewalk) before it was changed. Staging's AI is off, so the AI-on shapes were read from code.

- **One definition per population.** Several phrasings of LYBUNT and SYBUNT fell past the population reader ("haven't
  given since last year" answered retention; "gave before but not this year" and "gave last calendar year but not this
  year" were can't-answer lines). With AI on they went to Ask, whose planner prompt said "'This year' is the calendar
  year" while its code reads "this year" as the fiscal year: the likely source of "LYBUNT 251 calendar vs 309". The reader
  now knows those phrasings, "calendar" reads Reports > LYBUNT in calendar years and says so, any question part that names
  a population reads the registry before Ask, the planner prompt says fiscal, and Ask's lapsed count reads the registry's rule.
- **A surname matching two people.** The giving question asked "Which L1rrlrq?" with no amounts and no way to want both.
  It now says "Two people match: A ($X) and B ($Y). Which one?" with a Both button, and sums only on Both.
- **How much is left on the goal.** Home's goal bar was ignored whenever several goals were running ("5 goals are running…
  Which one?"); "are we on pace?" was a can't-answer; "and the Annual Fund 2025?" after a campaign answer was the AI-off
  refusal. Atlas now answers from Home's goal card, and a campaign follow-up stays on campaigns.
- **A call note with a future gift.** The forecast guard read "she said she will give $5,000" as a request to forecast.
  It now refuses only when she asks Atlas to predict; with AI off, "I called <name>…" is read in code and proposed as a
  call (her words) plus a follow-up on the day she named, saved only by her Save.
- **What Steward can't know; stopped monthly.** "…and what's his favorite color?" (a pronoun) fell to a generic line; it is
  now "Steward doesn't know <name>'s favorite color." Stopped monthly read only Home's Recurring card; it now also lists
  canceled and overdue plans and Home's Drifting monthly givers (two fixture givers on staging were Drifting, Atlas said nobody).
- **A brief as a brief.** "Brief me on Fenwick Holdings, Inc." said it couldn't find them (the reader stopped at the comma);
  "Brief on…" and "Prep me for my call with…" failed too. Any brief wording now finds any name on file, and the brief opens
  with plain sentences, saying "No conversation logged yet." when there is none. The eval's off-3 failed because the group
  reader took "the New donor, first year journey" as a group of new donors (and the eval's journeys were Draft).
- **Item 2's prod case (two "Atkinson" givers summed) was not reproduced on staging** (AI off asks which). The new question
  and Both close the shape; re-walk on prod after Ship.
