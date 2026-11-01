## FIX-24 · Make a donor a volunteer, and profile things that read wrong (2026-10-03)

On Creo there was no clear way to make a donor a volunteer from the profile, and Ada Petrossian's
record contradicted itself. Part 1: `makeVolunteer` (server.js) is the one function behind the
profile's More > Make a volunteer, Volunteers > Add a volunteer when it picks somebody on file, and
the Agent's volunteer step (AGENT-2). It keeps one approved `volunteer_applications` row on the
person (new columns `hours_per_week`, `roles`, `via`), which is what the Volunteers group's rule
reads. Part 2: a stage change titled "Meeting" because the timeline's fallback word was Meeting
(now its own type, and a missing stage is "Not set"); the header counted an Agent note as "last
conversation today" (one rule now, `meetings.js conversationsWith`: a note never counts);
Engagement's "the latest 16 days ago" was text baked in on the day the scores ran (worded at read
time now); "Send the proposal" beside "No proposal open" (`shared/nextStepAgree.js`); the Agent
list showed the day asked, not the day run; Volunteers had two hours filters (one now).
