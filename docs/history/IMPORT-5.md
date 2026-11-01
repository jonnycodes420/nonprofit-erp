## IMPORT-5 · Dates that are never made up, the guests who didn't give, pledges up front, other systems' exports (2026-10-29)

Seen on Justin's Place: the dinner's date was optional, so 63 gifts landed "No date" and 43 pledges were due from the
import day; 95 guests came and didn't give and nothing showed them; the Kings' $20,000 pledge sat three tabs down; a
Salesforce pair asked which columns were names and amounts. Built: the event date, the gifts' date and the pledges'
due dates are asked and block Import until answered (never the import day; "No set due date" is a NULL due date);
`numbers.eventGuests` lists came-gave / came-didn't-give / invited-didn't-come on the event page, as Home Grow moves
and in Ask; the open pledge sits under the profile header and agrees with Fundraising and Home (a new
`assertSurfacesAgree` check); eleven systems' exports read with no column questions (`shared/exportShapes.js`, two
files as one import); column answers are saved per header set (Settings, Imports); "Alex, Brad Hollins" is a couple,
with a Data health fix for existing rows; and, from Jonathan's addendum on the contacts file, one-column addresses
split, near-duplicate merges counted, and "wrong number" / "returned mail" notes flag the phone or the address.
On the Finding Joy workbook, 66 people came and didn't give (the file's own count). `tests/import5.test.js` is the
build's one new suite (20 of 28 red on main).
