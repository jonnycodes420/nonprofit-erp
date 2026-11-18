# For the fleet · SALES-4

The sales CRM lives at /ops → Sales and is **super-admin only**: the fleet's account
(director@harborlight.demo) gets a 404 there by design. These checks are for a super-admin on
staging (Jonathan, or Muse's super-admin sign-in if staging gives one). Any write goes on made-up
records only. Nothing here touches Harborlight or org_stagewalk's donor data.

**Surfaces changed:** /ops → Sales → Now (new, the default sub-tab); Pipeline (new sub-tab, the
board); Organizations, Contacts and Deals lists (default columns); a deal's page (new header);
call mode started from Now (and its new "Needs a number" box); Sales settings → Mailbox (what it
reads / never touches); Forecast (Today's lines and the forecast moved here); Add prospects (new
panel); an organization's page (phone, address, Find contact, ProPublica link).

| Re-check (your clicks) | Expect now |
|---|---|
| /ops → Sales | Opens on **Now**: the week's bar (Dials, Conversations, Meetings, each "N of 50/8/3"), then a numbered list, due rows first. A deal's row shows "$N/mo likely" (value × probability); click it for why the row is in its place. |
| Now → **Start** (or **Start calling · N**) | Call mode titled "Calling: Now" with a phone number as a tap-to-call link, within a second. The first person is the top Call row's. |
| Call mode → **Left voicemail** (no note) | One tap logs it: "Logged: Left voicemail. Next: call again on …". The notes box says "optional". |
| Now → a row's **Accept** on "Proposed next step" | The row leaves Now (its next step is set and not due yet). The deal page's header shows it under Next step. |
| Now → click "Dials" in the bar | The calls behind the number, dated, each with its person. A number with nothing behind it says "None yet this week." |
| Pipeline → drag a card to the next column | A dark bar: "<Org> moved to <Stage>. Undo". **Off the happy path:** press Undo; the card is back in its first column. Drag to Lost: it asks why first. |
| Pipeline → column heads | Each reads its count, probability and monthly total. Later and Lost are a "Later N · Lost N" link under the board; click one to list its deals, or drop a card on the word. |
| A deal page | Four tiles at the top: Stage, Value ($/mo and weighted), Next step, Last touch. Long notes show three lines with More. |
| Organizations list | Columns: Name, Fit, Last touch ("Interested · Nov 2, 2026" or "None yet"), Next step. Nothing else unless you add columns. |
| Sales settings → Mailbox | "What it reads" and "What it never touches" lists. |
| Now when nothing is waiting (empty filter: a fresh CRM) | "No one's waiting. Work the <list> list →", and the arrow opens call mode on that list. |

| Sales → **Add prospects** → KY, Food banks, $100,000 to $2,000,000 → Search ProPublica | A page of organizations with city, revenue, year, "Fits N of M", "Not in ProPublica's data" under Officers, and a ProPublica link. The count line says how many of the page are in the revenue range. |
| Add prospects → pick two → name a new list → Add | "2 added to <list>." **Off the happy path:** search again and add the same two: "0 added… already here by EIN". Their rows read "Already in Sales". |
| Add prospects → Use a CSV instead → a file with Name, City, State, Revenue, Year | The same table from the file. A row with no EIN that matches an existing organization's name and city is "already here by name and city". |
| An organization added from ProPublica | A brass "Needs a number" (the API has no phone), the address, **Find contact** (opens a Google search in a new tab) and a ProPublica · EIN link. |
| Lists → that list → Start calling | Organizations with no phone are not offered; a "Needs a number" box lists them. |

**What could have broken nearby:** /ops → Sales → Forecast (Today's lines and the forecast are
read by the same function as before, now shared with Now); Scoreboard (a calendar meeting counts
as booked when first read, or at its own time if earlier); the Customers board; call mode from a
list (same queue, new optional order).

**Needs a write:** the Start, Accept, drag-and-Undo and voicemail checks write sales records. Use
made-up sales records only.
