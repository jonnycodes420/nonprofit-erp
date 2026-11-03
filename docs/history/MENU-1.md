## MENU-1 · The profile's More menu fits on the screen, and linking a business is findable (2026-11-03)

- **Why.** A customer was told to use More → Merge with… and couldn't reach it. The menu was ~18 items in one
  column, `position:absolute`, `overflow:hidden`, no max height; at 1280×720 its bottom sat at 867 px, and
  Merge, Export, Erase and Delete could not be reached by the wheel or by the menu.
- **What.** `MoreMenu` in `ProfileHeader.jsx`: four groups (Reach out, Plan, Know them, Their record), two
  columns from 900 px, max height = room between More and the screen's edge (or the phone's tab bar) less
  12 px, its own scroll, opens upward when there's more room above. Narrow: anchored under More. Arrow keys,
  Home/End, Esc returns focus to More. Every capability/permission condition unchanged.
- **Moved / dropped.** "Add a task" left (the Task button beside More is drawn on the same `onAddTask`
  condition). "Plan a follow-up" stays only while Next step's own button (`dp-next-plan`) isn't on screen.
  "Suggested (n)" wasn't in the brief's lists; it sits under Plan, beside Draft the next move whose output it shows.
- **Linking.** "Link to a person or business" (Their record) opens the same picker; About's link is always
  drawn when not read-only ("Link someone" / "+ Link another"); the picker's type list reads from the record's
  side (`relationshipLabelsFor`). Stored types unchanged.
- **Guard.** `profile1-everything-clicks` §8. Red on main; with the max height removed it stays green at
  1280×720 (two columns already fit) and goes red at 1280×560 and 390×844, so 1280×560 is in the matrix.
