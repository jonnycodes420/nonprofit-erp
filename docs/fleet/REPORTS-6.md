# REPORTS-6 · For the fleet

**Surfaces changed:** Reports opens on **Your dashboard** (top of the Dashboards group in the Reports rail) for an org
with no saved reports: nine tiles (Giving this year against last, Retention, LYBUNT, SYBUNT, First-time givers,
Recurring health, Gifts by fund, Gifts by month, Thank-you backlog), each with "Open the report" and a × to take it
off, and **Add a report** (the gallery: every report, one line, a preview, Add it / Take it off). Under every report
on Reports, under a standard or saved report, and under the Report builder's results: **Do something with these N
people** (Add to calls, Make a group, Add to a journey, Start a mailing draft). A standard or saved report's header:
**Send on a schedule** (the schedule dialog: How often, Day, Hour, Send it to, Preview the PDF, Save the schedule; each
schedule's Next send, Change, Remove with Undo). Reports → Board: **Make the board deck** and **Send the deck on a
schedule**. Reports → Board pack → On a schedule: **Send it to people you name**. The Download PDF of a standard or
saved report (now dated, under the org's name, with a last page saying what each column means). The Unsubscribe page a
scheduled report's email links to.

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight.)** Reports → Your dashboard. Each tile's first number: click it; the drawer's count or
   total equals the tile. Click "Open the report" on LYBUNT: the LYBUNT report opens and its headline count equals the
   tile. On Gifts by month the tile's "This year" equals the report's This year total.
2. **(Needs a write: org_stagewalk.)** Your dashboard → × on SYBUNT: "Took SYBUNT off your dashboard." with Undo; press
   Undo: the tile is back in the same place. Add a report → find "Top donors" → Add it → close: the tile is last on the
   dashboard. Add a report again: Top donors reads "Take it off".
3. **(Needs a write.)** Reports → LYBUNT → Do something with these N people → Make a group → Keep it in step → Make the
   group: "Made the group … It keeps in step with LYBUNT by itself: N people today." with Undo. Groups: the group's
   count is N. Press Undo on the toast: the group is gone from Groups.
4. **(Needs a write.)** Reports → Giving summary: the bar reads "Do something with these N people" and beside it "This
   report's rows are totals of gifts, so this acts on the people who made those gifts." N equals the report's Unique
   donors. Retention: no button; the line says it counts people without listing them.
5. **(Needs a write.)** LYBUNT → Do something → Add to calls → step "Call", due a week out → Plan N people: "Planned N
   calls" (or "…; M already had an open step and kept it") with Undo. Home's Thread shows the steps. Undo: the steps
   that were just opened are gone; a step that was already there stays.
6. **(Needs a write.)** LYBUNT → Do something → Start a mailing draft → Start a draft: "Started a mailing draft to N
   people. Nothing is sent…". Email → Drafts has it, addressed to that list; nothing in Sent. Undo removes the draft.
7. **(Needs a write.)** Reports → a standard report (Lost: over 24 months) → Send on a schedule → Add a schedule → type
   a made-up board address and the address of a donor on file → Save: refused, "… is on file as a donor …". Take the
   donor out → Save: the row reads "Every Monday at 7 AM" (or what you chose) and "Next send: <weekday, date>, at 7 AM
   your organization's time." Preview the PDF: a PDF opens with the org's name, "Produced <today>", the rows, and a
   last page "What this report means". Remove → Undo: the schedule is back.
8. **(Read only.)** Reports → Board → Make the board deck: a file `board-deck-<date>.pdf` downloads; 16:9 pages: cover,
   giving this year so far against the same point last year (the same three numbers as the Board's tiles), Retention
   (the Board's), the five biggest gifts this quarter, the pipeline only if Major Gifts is on, Who to thank and who to
   call, then the definitions.
9. **(Off the happy path, needs a write.)** In the schedule dialog pick Monthly and look at Day: only 1 to 28. Pick the
   board pack's "Send it to people you name": How often offers Monthly and Quarterly only.

**What could have broken nearby:** Download PDF of a standard or saved report (new renderer); Groups (a group whose rule
is a report: its page, its count, a campaign or journey naming it); POST /threads/plan (Plan follow-up for a selection);
the journeys' bulk add; the Board dashboard header (two new buttons beside Export PDF); the board pack page; the
/unsubscribe page for the morning and weekly emails (a third staff kind beside them); the Reports rail (a new first item
in Dashboards) and Reports' first open (it now lands on Your dashboard when the org has no saved reports).

**Needs a write:** 2, 3, 5, 6, 7 and 9 must run in org_stagewalk. Nothing here sends to a real address: use made-up
addresses, and staging's walk org has Staff mail off, so a schedule there is saved and previewed but sends nothing.
