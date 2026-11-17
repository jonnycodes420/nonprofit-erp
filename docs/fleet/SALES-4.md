# For the fleet · SALES-4

The sales CRM lives at /ops → Sales and is **super-admin only**: the fleet's account
(director@harborlight.demo) gets a 404 there by design. These checks are for a super-admin on
staging (Jonathan, or Muse's super-admin sign-in if staging gives one). Any write goes on made-up
records only. Nothing here touches Harborlight or org_stagewalk's donor data.

**Surfaces changed:** /ops → Sales → Now (new, the default sub-tab); Pipeline (new sub-tab, the
board); Organizations, Contacts and Deals lists (default columns); a deal's page (new header);
call mode started from Now; Sales settings → Mailbox (what it reads / never touches); Forecast
(Today's lines and the forecast moved here).

| Re-check (your clicks) | Expect now |
|---|---|
| /ops → Sales | Opens on **Now**: the week's bar (Dials, Conversations, Meetings, each "N of 50/8/3"), then a numbered list. Due rows first, each reading "due first"; then rows with "score N". Click a "score N": the sum reads "$V × P% × D days = N". |
| Now → **Start** (or **Start calling · N**) | Call mode titled "Calling: Now" with a phone number as a tap-to-call link, within a second. The first person is the top Call row's. |
| Call mode → **Left voicemail** (no note) | One tap logs it: "Logged: Left voicemail. Next: call again on …". The notes box says "optional". |
| Now → a row's **Accept** on "Proposed next step" | The row leaves Now (its next step is set and not due yet). The deal page's header shows it under Next step. |
| Now → click "Dials" in the bar | The calls behind the number, dated, each with its person. A number with nothing behind it says "None yet this week." |
| Pipeline → drag a card to the next column | A dark bar: "<Org> moved to <Stage>. Undo". **Off the happy path:** press Undo; the card is back in its first column. Drag to Lost: it asks why first. |
| Pipeline → column heads | Each reads its count, its probability and its monthly total; the total equals the sum of its cards' $/mo. |
| A deal page | Four tiles at the top: Stage, Value ($/mo and weighted), Next step, Last touch. Long notes show three lines with More. |
| Organizations list | Columns: Name, Fit, Last touch ("Interested · Nov 2, 2026" or "None yet"), Next step. Nothing else unless you add columns. |
| Sales settings → Mailbox | "What it reads" and "What it never touches" lists. |
| Now when nothing is waiting (empty filter: a fresh CRM) | "No one's waiting. Work the <list> list →", and the arrow opens call mode on that list. |

**What could have broken nearby:** /ops → Sales → Forecast (Today's lines and the forecast are
read by the same function as before, now shared with Now); Scoreboard (a calendar meeting counts
as booked when first read, or at its own time if earlier); the Customers board; call mode from a
list (same queue, new optional order).

**Needs a write:** the Start, Accept, drag-and-Undo and voicemail checks write sales records. Use
made-up sales records only.
