# DEFINE-1 · For the fleet

## Surfaces changed
- **Donors > Re-engage**: a line under the tabs, "Re-engage: N people", with its definition written out.
- **Fundraising > Overview, period bar**: the LYBUNT chip now reads "LYBUNT: N people", adds "(M households: each household counted once)" only when the two differ, and the definition is written under it.
- **Groups**: starter cards (LYBUNT, SYBUNT, Lapsing, Lapsed, Monthly givers) show their population's definition; a group by rule whose rule is one of these shows the population name before its count and the definition under it.
- **Communications > Audiences**: All donors, Volunteers and Everyone with an email show the registry name and definition; a saved "Lapsed" audience reads "Lapsing or lapsed"; the Volunteers screen's own group is no longer listed as a second "Volunteers"; a person sharing an email address with someone already in the audience is listed as "share an address with someone already in it, so the email goes once".
- **Donors tab count and Contacts**: a person added by hand who has not given is a Contact, not a Donor, until their first gift.
- **Atlas**: "How many lapsed donors" answers "N people are Lapsed 12+ months" with the registry's definition; LYBUNT and SYBUNT end with the registry's definitions.
- **Fundraising campaigns, Campaigns list, Home goal**: an ended campaign shows "Raised N% of goal", never "Behind pace"; days left and "day N of M" are one count.
- **Donor profile > Giving > pledges**: "Nd overdue" appears only when an installment is past due and unpaid.
- **Donor profile header, About, Giving total line, a figure's breakdown panel**: refunds read "$X returned" and/or "N gifts refunded".
- **Donor profile rail Giving rhythm card and the About closeness line**: the same rhythm words.
- **Settings > Billing, the records line**: the plus is now "people whose giving was imported with no gift row" (they are on Donors because they have given); a person marked Donor who never gave is on neither side. The figure opens those people.
- **Campaign sends to All donors** (`segment.mode: "all"`): a person added as a Donor who has never given is not sent to; they are a Contact. Everyone with an email still reaches them.
- **Communications milestone/anniversary drafts**: an anniversary is due on its day (or up to three days after), never early.

## Clicks to try for the next three nights
1. Donors > Re-engage. See "Re-engage: N people" and its definition under it; N equals the tab badge. Apply a Directory filter: the badge and list narrow, the population line still names the whole population.
2. Fundraising > Overview, press "Last FY" then "This FY". The LYBUNT chip says people; if a households note shows, its number is not more than the people number. Click the chip: Reports > LYBUNT opens and its row count equals the chip's people.
3. Groups. The "Gave last year, not yet this year" starter shows "LYBUNT you can ask: …" under its count. Reports > LYBUNT's count is the same or higher (the difference is the people marked deceased, do not contact or do not solicit).
4. Communications > Audiences. Exactly one audience is named Volunteers; its definition names the roster. Open Volunteers > Roster: the roster count equals the Volunteers audience's people (less any archived volunteer).
5. **Needs a write (org_stagewalk):** Donors > + Add person, name "Wren Test", role Donor, no gift. The Donors count does not go up; Contacts goes up by one; Communications > All donors does not change. Record a $10 gift for Wren: Donors goes up by one, Contacts down by one, All donors up by one. Then delete the gift (undo): back to Contacts.
6. **Needs a write (org_stagewalk):** add two people with the same email address, each with a gift. All donors' people goes up by two; its line lists one under "share an address with someone already in it".
7. **Needs a write (org_stagewalk):** Fundraising > new campaign with an end date of yesterday and a goal. Its card and the Campaigns list say "Raised N% of goal", never "Behind pace". Edit the end date to next month: it shows a pace again.
8. Atlas: ask "How many lapsed donors do we have?" The answer says "Lapsed 12+ months" and its definition, and the count equals Donors > filter Lapsed with deceased left out. Ask "How many LYBUNT donors?": equals Reports > LYBUNT.
9. **Needs a write (org_stagewalk):** a pledge with installments all in the future: no "overdue" on the pledge card. Move one installment's date to last week (unpaid): "Nd overdue" with N days since that installment.
10. **Needs a write (org_stagewalk):** refund part of a gift twice. The profile's line says "$X returned on 1 gift refunded" (not "2").

## What could have broken nearby
- Anything that lists Donors with role=donor: the Donors tab, its export, the portfolio strip ("the officer portfolios add up to the Donors tab"), Settings' billing records gap sentence, Everyone's breakdown.
- Campaign sends: a campaign to an audience now sends one email per address, and All donors no longer includes people who never gave (fewer sends, never more).
- The Volunteers screen's "Volunteers" group still exists under Groups; only the audience listing hides it.
- Home goal hero (days left), Fundraising thermometer, GoalRow, P2P coaching drafts' "N days left".
- Pledge reminders still read the stored overdue mark (not changed; next brief).
