# BUILDER-3 (25 Nov) · For the fleet

## Surfaces changed
- Communications > Templates > a template (the email editor): the top bar (faces of others here, Share, Export, More with Comments and History; Undo and Redo moved to the path line; "Dark" beside Desktop and Phone), "Comment on this part" beside a selected block, the Comments, Share and Export panels, and a **Styles** tab in the left pane.
- The review page: `/review/<token>` (outside reviewer, no sign-in) and `/app/review/<id>` (someone in the org).
- The bell: a line when someone mentions you in a comment, with Dismiss.
- Every email's look: the house style (fonts, sizes, link color, button shape) when an admin sets one.
- Campaigns: a staff member's save that adds a code block is refused (as on templates).

## Clicks to try for the next three nights
1. Two browsers (or two people) open the same template. Right: within 3 seconds each sees the other's face (an initial in emerald or brass) in the top bar; selecting a block shows an outline in that person's color in the other's email.
2. Person A types in a text block; person B clicks the same block. Right: B sees "A is editing this" on the outline and in the right pane, and can't type in it. Off the path: A selects another block and waits; within 30 s B can type in the first.
3. A changes the text, B changes the signature; A saves, then B. Right: within 3 s of A's save B's screen shows A's words with B's own change still there; after B saves, both changes are in the email. Off the path: B presses Undo before saving: only B's change goes, A's stays.
4. Select a block > Comment on this part > @ Mention a colleague > Comment. Right: "Comment added. X will see it in the bell; nobody is emailed."; X's bell lists "… mentioned you on …". Resolve: the thread hides and X's bell line goes.
5. Share > An outside reviewer > With sample values > Make the link. Right: a link and "works for 7 days"; opening it in a private window shows the email, "View only", and (if allowed) a comment box. Off the path: Turn off the link, reload the private window: "This review link has expired or been turned off."
6. Export > Download HTML. Right: a .html file whose footer reads "You are receiving this email from … Unsubscribe".
7. Styles tab (an admin) > Buttons: Pill > Save the house style. Right: every button in the email turns pill-shaped; another template shows it on its next open. A staff member sees the tab with the controls off ("An admin changes it").

## What could have broken nearby
- Every template save now carries the version it started from (a save from an older version is merged); campaign saves and the campaign editor are unchanged apart from the code-block check.
- Every email's rendering reads the house style (preview, test, campaign sends, saved-block pictures): with none set it is unchanged.
- The bell's waiting count includes mentions.
- The editor's top bar: History is under More now.

## Needs a write (org_stagewalk only)
Clicks 1 to 7 all write (presence, saves, comments, links, the house style). Run them in org_stagewalk; Harborlight read only can check that the bar shows Share, Export and More and the Styles tab is there.
