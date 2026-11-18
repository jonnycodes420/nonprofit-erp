# For the fleet · EDIT-2

What changed on staging with EDIT-2, and what to check for the next three nights. Harborlight is read only; any check
marked **Needs a write** runs in org_stagewalk.

## Surfaces changed
- A person's profile: **Coming up**, the **Tasks** tab, and the **Timeline** / **List** views (task order).
- A person's profile: the rail's **Next step** and the header's **Next:** line.
- **Major gifts → Portfolio** (the Next step column) and **Major gifts → Top 100** (the Next step column).
- **Home → the Thread** (one row per person, and its "N open · M overdue").
- **Donors → selection bar → Log a touch** (new dialog), and **Donors → Log a touch** (the picker now takes several people).
- **Donors → Filters → Touch titled · has had / hasn't had** (new condition; Groups built from a filter get it too).
- **Recent changes**: a batch shows as one line.

## Clicks to try (next three nights)
| Check | Clicks | Right when |
|---|---|---|
| Task order | Donors → Meridian Foundation → Tasks tab | Open tasks soonest first: "Proposal due · Tomorrow" (Nov 19), then Dec 1, then Dec 15; done ones after, newest first. Never Dec 15 on top. The Timeline view leads with the same open tasks in the same order. |
| Coming up | Same profile, Activity | Coming up lists the same open tasks in the same order as the Tasks tab. |
| Next step, everywhere | Meridian Foundation's profile rail and "Next:" line; Major gifts → Top 100 (if Meridian is on it); Home's Thread | Each names the same step: the soonest one due today or later. A step shown as overdue only when nothing on the person is due today or later. |
| **Needs a write** · Next step, May vs December | In org_stagewalk: a person with a task due in May (made first) and one due in December (made second) → their profile, Major gifts → Portfolio, Top 100, Home | December everywhere, whether May is May 2026 (overdue) or May 2027. Mark December done → May shows, labelled overdue (portfolio: "· overdue, due May …"; Top 100: "Overdue · …"). |
| **Needs a write** · Bulk Log a touch | In org_stagewalk: Donors → tick 3 people → Log a touch → Event invite, title "Fleet invite test", Log to 3 people | Toast "Logged to 3 people" with Undo. Each of the three has one Event invite touch titled "Fleet invite test" on their timeline. No email anywhere, no task (Tasks unchanged). |
| **Needs a write** · Undo (off the happy path) | Press Undo on that toast | All three touches are gone from all three timelines. Recent changes shows the log as one line and the undo as one line, never three. Pressing Undo again on an old toast says it was already undone. |
| **Needs a write** · Who's already had it | Donors → tick the same 3 plus 2 more → Log a touch → title "fleet invite test" (any case) | The dialog warns "3 of these 5 already have a touch titled …" with "Skip them" ticked; the button reads "Log to 2 people". |
| Filter | Donors → Filters → Touch titled → hasn't had → "Fleet invite test" (org_stagewalk) or any made-up title (Harborlight) | With a made-up title, everyone; in org_stagewalk after the batch, everyone except those who got it. An empty title says "Type the touch's title." |
| **Needs a write** · Deleted touch | Delete one of the batch's touches from a timeline, then re-run the hasn't-had filter | That person is back in "hasn't had". |
| Picker | Donors → Log a touch | Clicking a name still opens Log a touch for that one person. Ticking two or more shows "Log one touch to N people". |
| Cap | Donors → select all matching on a list over 2,000 → Log a touch | "A batch is at most 2,000 people…", nothing logged. |

## What could have broken nearby
- Home's Thread: a person whose next step is ahead but who carries an overdue task still counts in "M overdue".
- The Tasks page keeps its own order (high priority first, then due). Calendar is unchanged.
- The profile rail's step editing (Edit / Mark done on the rail's first item): the first item may now be a task, not the
  Thread's step, when a task is sooner.
- Top 100's Next step cell: when the next step is a plain task (not a plan touch) its date is read only, as a Thread step's is.
- Log a touch from a profile is unchanged (one person).
