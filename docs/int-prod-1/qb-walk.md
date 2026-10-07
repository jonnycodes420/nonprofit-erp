# INT-PROD-1 · The QuickBooks walk (10 minutes)

For Jonathan, on **TEST STEWARD** (`org_8065d0d5`, `jonathan@stewardapp.dev`), with a real QuickBooks Online
company you own. Do it after the INT-PROD-1 deploy. Nothing in this walk sends anything to QuickBooks: **do not
press Sync, Sync all, or Turn auto-sync on.** Those are the buttons that write.

## 0 · Turn it on for TEST STEWARD (1 minute)

1. Sign in as yourself and open **/admin**. Find TEST STEWARD.
2. Under its detail, **QuickBooks sync: off** has a **Turn on** button. Press it. It now reads **on**.

This is your switch, not the org's. Only orgs you turn on see a QuickBooks Connect button.

## 1 · Connect (3 minutes)

1. Sign in as TEST STEWARD. Settings, then Connections. Find **QuickBooks Online**.
2. The card should **not** say "Sandbox until Intuit's review is finished" any more. If it does, `INTUIT_API_BASE`
   on Railway is not the production host.
3. Press **Connect**. You land on Intuit's sign-in page (`appcenter.intuit.com`), not a sandbox one.
4. Intuit asks you to allow **Steward** to access one thing: your QuickBooks accounting data
   (the scope `com.intuit.quickbooks.accounting`, the only one Steward asks for). Choose your real company and
   press **Connect**.
5. You come back to `www.stewardapp.dev/oauth/intuit/callback`, which says QuickBooks is connected. Press
   **Back to Connections**.

If it refuses instead, you took longer than 15 minutes, pressed back, or were signed in as someone else in that
browser. Nothing was connected. Press Connect again.

## 2 · What you should see (3 minutes)

The QuickBooks Online sync panel opens under the card.

1. There is **no "Intuit sandbox" label** beside the heading.
2. Under **What Steward can see**, press **Read from QuickBooks**. In a few seconds:
   - one line: *Steward can read **your company's name**: N customers and N payments. It only read them; nothing
     was sent to QuickBooks.*
   - **Latest customers**: up to five names from your company.
   - **Latest payments**: up to five, each with the customer, the date and the amount.
3. Check the company name is the company you picked, and one customer and one payment against QuickBooks itself.
4. **Auto-sync is off** should be the line under the definition. Leave it off.

Optional: **Review the mapping** shows your real chart of accounts in the drop-downs. Opening it reads; closing it
without pressing Save changes nothing.

## 3 · Confirm nothing was written (1 minute)

In QuickBooks, open **Sales**, then **All sales**, and sort by date. There should be no new sales receipt or deposit from
today. Steward only read.

## 4 · Disconnect (2 minutes)

1. Back on the QuickBooks Online sync panel, press **Disconnect**, then **Disconnect** again to confirm.
2. The panel says *Disconnected. Steward will not read or send anything else through QuickBooks Online, and every
   record it already brought in is still here.* The card offers **Connect** again.
3. In QuickBooks: the gear, then **Apps** (or Intuit's **Connected apps** page). Steward should no longer be listed,
   because Steward asked Intuit to revoke its access. If it is still there, press **Disconnect** there too. That is
   harmless.
4. In /admin, turn QuickBooks sync **off** for TEST STEWARD if you do not want the button showing.

## If something goes wrong

Tell the next session the exact sentence on the screen. Every QuickBooks refusal is a sentence, never a code.
The code is kept in the connection's `last_error`, and the server logs `[qbo] GET ... answered 5xx` on Intuit outages.
