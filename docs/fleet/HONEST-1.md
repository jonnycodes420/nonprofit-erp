# HONEST-1 · For the fleet

**Surfaces changed:** Settings → Connections (the summary line over the page, every connection card's badge and line, the
new **Bring in a file** section, the one-line "not available yet" rows for Xero and Constant Contact, each card's
expanded detail and its badge); the QuickBooks detail's new **Before your first gift posts** checklist; Home (a brass line
for each connection that needs a person, with its step); Finance's overview (one QuickBooks line); Mailchimp's **Change
settings** when the connection holds no sign-in; a source's **History**; the marketing footer's **Privacy** link and
/legal/privacy (now a redirect to /privacy); /ops Machine tab (**Connections asked for**).

**Clicks to try for the next three nights:**
1. Harborlight (read only): Settings → Connections. The summary reads "N working, N connected but not flowing yet, 1 needs
   you." Stripe reads **Connected, nothing flowing yet** / "Connected, but giving pages are off, so no one can give yet."
   with a **Turn on giving pages** button that opens the Stripe detail. QuickBooks Online reads "273 gifts ($261,998.91)
   are waiting: 2 funds aren't mapped yet (Building Fund and Youth Arts Access)." (counts move with the data); press the
   dollar figure: the rows open and foot to it. Givebutter reads **Needs you** / "Givebutter hasn't sent a gift in N
   days. Usually about 5.6 a week." with **Check it**.
2. Harborlight: press the summary's "1 needs you": only Givebutter shows. Press it again: every card is back (off the
   happy path: a second click undoes the filter).
3. Harborlight: Home. A brass line "Givebutter hasn't sent a gift in N days. …" with **Check it**, which lands on
   Settings → Connections at the Givebutter card. Finance's overview shows the same QuickBooks sentence as Settings.
4. Harborlight: Settings → Connections → QuickBooks → **Manage**. "Before your first gift posts" lists Fund: Building Fund
   and Fund: Youth Arts Access, and "9 campaigns have no account of their own. That's optional…" with **Show them**.
   Read only: do not press Save on Harborlight.
5. **(Needs a write: org_stagewalk.)** Connect QuickBooks (or use its fixture), leave one fund unmapped, open the checklist,
   press **Choose accounts**, pick an income account for the fund, **Save**. The row leaves the checklist, the card's line
   drops that fund, and the Pending count is unchanged until a Sync.
6. Harborlight: **Bring in a file** lists Donorbox, Cash App, Venmo, Toast and Statement imports, each with **Upload**; none
   has a Connect button. Xero and Constant Contact are one line each: "Xero: not available yet. Tell us you need it".
7. **(Needs a write: org_stagewalk.)** Press **Tell us you need it** on Xero: "Thank you. We've noted that you need it."
   Reload and press it again: "We already have your ask for this one. Thank you." On /ops (super-admin, local), the
   Machine tab's **Connections asked for** shows xero, 1 organization.
8. Harborlight: PayPal → **Manage** → **History**. The first line is dated the same day as "last successful check" above
   it, and no line says "Steward has not checked this one yet".
9. Harborlight: Mailchimp → **Manage** → **Change settings**. It says this is the demonstration file's example connection
   and holds no sign-in; it never says "Mailchimp is not connected".
10. www/staging marketing footer: **Privacy** opens /privacy (the policy with the Google Limited Use paragraph). Type
    /legal/privacy directly: it lands on /privacy.

**What could have broken nearby:** the Connections card builder moved from routes/give.js to
server/connections/cards.js unchanged, so anything reading GET /connections (Settings → Connections, the connection
detail's figures, Check now, History, Does it match?, the Square item mapping and the bookkeeping mappings) should read
as before apart from the badges and lines. The quiet sweep now runs every six hours, so a live org whose source is quiet
gets one task (Tasks). The QuickBooks Pending list and its figure are unchanged. ONBOARD-5's setup Connect step is
unchanged and uses the same "Upload a statement" words.

**Needs a write:** clicks 5 and 7 (org_stagewalk only).
