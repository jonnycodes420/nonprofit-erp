# POLISH-11 · The small dead ends from the 25 Nov lead (25 Nov 2026)

Six items from the fleet's 25 Nov lead, each reproduced on staging first (org_stagewalk as the walker for writes,
Harborlight read-only).

1. **Logging a touch asks before it closes the next step** (W-1124-Donors-T4). Staging: the choice showed for a
   Thread step but defaulted to Close it; the dialog looked only at Thread steps, so a person whose next step was a
   task got no choice and the new step took over. Now the dialog reads the person's one next step with the
   profile's rule (`GET /donors/:id/next-step`, server/tasks/nextStep.js), Keep it open is the default, and Close
   it on a task closes that task inside the touch's Undo (`closeTaskId`; write effects can restore `tasks`).
2. **Undo survives leaving the page** (W-1125-Volunteers-T2). Undo lived in component and module state. The record
   now stamps `status_changed_at` and says `undoUntil` (a day); the profile's role line, More menu and the Volunteer
   card read it on return, and Recent changes lists the change (`server/volunteers/statusChanges.js`).
3. **"Create it?" unless the name matches exactly** (W-1125-Finance-T1). Staging: "Spring" beside the draft "Spring
   mwtwyt8w" offered only "Pick … above". The rule is `client/src/lib/attributionMatch.js`: a prefix is a
   suggestion, Create is offered unless a campaign is named exactly that (case and spacing ignored).
4. **Saved views in every org** (W-1124-Donors-T6). Not reproduced: as the walker, Save view, Save as new and
   Delete all answered 200 with the menu updated. Every call already goes through the signed-in client. Closed the
   one silent path: a refused delete only reached the console; it now says why beside the menu.
5. **Imports history says what Undo can still do** (W-1119-Atlas-13). Each row: "Undo available until …", "Undo
   window closed on …", or that the kind of file isn't undone as a whole; the empty state says what will appear.
6. **Settings opens without a blank wait** (W-1121-Atlas-10). Not reproduced on current staging: Brand kit and My
   profile drew in under 0.2 s warm and 0.5 s cold, every read under 0.5 s. What the fleet saw is consistent with
   those two sections drawing only a spinner until their one read answered (`/brand-kit`, `/me/profile`) on a slow
   or cold server; nothing on current staging takes 10 s. Both now draw their frame at once (`SkeletonSection`).
