# SALES-5 · For the fleet

**Surfaces changed:** /ops → Sales → **Pipeline** (each card's price and each column's monthly total); a deal's page
header (the **Price** tile, with where the price came from, and a new **ARR** tile); a deal's or organization's
**Steward org** box (the **MRR** row now reads "Not billing yet · $299/mo agreed, first charge Jan 1, 2027" for a
customer not billing yet, and an **ARR** row); the **Value (MRR)** field on a deal (a "Change the order too?" box when
the deal has a signed order, an accepted quote or live billing); **Forecast** (a new "won, billing starts" figure, an
**ARR now** figure, and a "Won, billing starts" column in the month table); **Scoreboard** → MRR added.

**Note:** /ops is for super-admins. The staging walker gets 403 there, so these checks run on a local production build
or with a super-admin sign-in; on staging, mark them OPEN if you cannot sign in as one.

**Clicks to try for the next three nights:**
1. **(Needs a write, a super-admin.)** Sales → Pipeline. Open any open deal with no order, click **Value (MRR)**, type
   250, Save. Without reloading: the header's Price tile reads $250/mo and ARR $3,000; go back to Pipeline: the card
   reads $250/mo and its column total went up by the difference.
2. **(Needs a write.)** Make an order for a Steward org linked to a won deal and sign it ($299/mo, first charge next
   month). The deal's header reads "$299/mo · from the signed order; Stripe starts billing <date>" whatever the deal's
   own value was, and the Steward org box reads "Not billing yet · $299/mo agreed, first charge <date>".
3. **(Needs a write.)** On that deal, change **Value (MRR)** to 400 and Save. It does not save: "This changes the
   pipeline value only. The signed order says $299/mo, and every screen shows that price. Change the order too?" Press
   Cancel: nothing changed. Do it again and press **Change the pipeline value only**: it saves, and every screen still
   reads $299/mo, with "the deal's own value $400 is not used" in the header.
4. **(Read only.)** Forecast: "won, billing starts" counts the deal in 2 in its first charge month's "Won, billing
   starts" column, and "MRR now + all of it" for that month includes it once. ARR now is MRR now × 12.
5. **(Off the happy path.)** A won deal with no close date and no order: it is in no month, and the forecast's
   sentence says "Not counted: 1 won deal with no first charge date…".

**What could have broken nearby:** the Deals list (sorting by Value still sorts the deal's own value), Now and Today
(they read the same deal rows), the Customers board (still its own price; next build), the Onboarding tab (read, not
changed), Partners' payouts (unchanged: what Stripe bills), and any page that hears LIVE-2's changes (a new `sales`
topic; no org screen listens for it).

**Needs a write:** 1 to 3 change deals and orders: only in a test org on a local build, never Harborlight.
