# CAMPAIGN-2 (25 Nov) · For the fleet

## Surfaces changed
- Communications > Campaigns > New campaign (or Edit in editor): the campaign editor's **Who it goes to** (now above Subject): the audience kinds, **By tier** (now General, Mid, Major), and the line "N of M can't receive this yet: …".
- Communications > Templates > a template: the template editor's **More** section (Start a campaign from this, Draft with AI) and its answers beside the buttons.
- Communications > Sequences > Earlier sequences > Edit: each step's **Write with AI**.
- Both email editors (template and campaign): the shell. The top bar and the path line never scroll; only the left pane, the email and the right pane scroll. **Preview as** closes on Escape and on a click outside it.

## Clicks to try for the next three nights
1. Campaign editor > Who it goes to > **By stage** > **Lapsed**, then **All donors** three times. Right: the count goes back to every donor on the first click and stays there (Harborlight: 1,119, not 281).
2. **By tier** > press **Major**, **Mid** and **General**. Right: the three together are everyone with a gift in the last 12 months, and Major alone equals Donors > filter Giving level Major. Off the path: press one again to untick it; the count drops by that level's people.
3. With Campaign emails off (Harborlight): the first thing under Who it goes to reads "1,117 of 1,119 can't receive this yet: Campaign emails are off for your organization." with the link to Settings (admin) or "Ask an admin" (staff). Each other reason (no address, unsubscribed, deceased) opens its people when clicked. Nothing is turned on.
4. Templates > a template > **Start a campaign from this** (needs a write). Right: the campaign editor opens on the new draft with a toast "… is a draft …". Off the path: Back, open the same template, press it again: the same draft opens ("already a draft … opened it"), and Campaigns lists one draft, not two.
5. Templates > a template > type a letter in the subject (unsaved) > **Draft with AI**. Right: "Save your changes first …" beside the button and as a toast, with **Save and draft**. On staging (no AI key): "AI drafting is not available on this server, so nothing was drafted." on the first click, beside the button and as a toast.
6. Sequences > Earlier sequences > Edit > **Write with AI** (needs a write only if you save). Right on staging: the step's words stay, a note says why nothing was drafted, with **Use Steward's starting words**; press again: "Tried again (2 times). …".
7. A template with many blocks: scroll the email to the last block (a photo) and click it, at 1440 and at 390. Right: the top bar (Back, the name, Save) stays fully visible under Steward's header and the staging strip; only the email moved.

## What could have broken nearby
- Every campaign's audience count (Communications Overview, the campaigns list's "Who it goes to", the Send button's number): they read the same `resolveSegmentSpec` / `filterBySegment`. A saved campaign "By tier" now reads giving levels; one saved with an old tier name (transformational, small, micro) reaches nobody.
- The giving page and event editors use the same shell (StewardEditor) in its other layout; their rail sections now scroll their own pane when opened from the preview.
- Atlas "Open list" and Groups don't use these segments; Donors' Giving level filter is the definition here, unchanged.

## Needs a write (org_stagewalk only)
Clicks 4, 5 (with Save and draft) and 6 (if saved). Clicks 1, 2, 3, 7 read only and may run in Harborlight.
