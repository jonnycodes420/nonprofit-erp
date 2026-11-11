# FLOWS-5 · Volunteers, events, shifts, Home cards and groups that behave

Why (lead-2026-11-10): a custom hours range read an old end date; a meeting still to come counted as
held; draft shifts showed as upcoming and "Delete draft" said someone was signed up when nobody was;
typing 11:00 into a shift time gave 9:11 AM; one shift opened three different dialogs; Events this
year called past and archived events upcoming; Save as group on the list reports came and went; a
$1 gift's thank-you showed twice on the Calendar; Home's snooze form leaked onto the next card.

What was learned:
- A `return` left above a function's reset lines (Insights.jsx advance) turned them into dead code
  for months; nothing failed loudly, the next card just inherited the old form.
- The db layer reads every `?` as a parameter, regexes included: write `{0,1}`.
- A count a screen calls "held" has to ask for held rows; the one source (meetings.js) had the
  option, the figure never passed it.
- "Who is on this shift" was counted with cancelled sign-ups in it.
- Two screens that list tasks read them with one rule (server/tasks/openTaskRule.js), or they drift.
