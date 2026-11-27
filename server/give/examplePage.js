// server/give/examplePage.js · HONEST-3 item 4 (W-1126-Integrations-04). A DEMO'S PUBLIC PAGES ARE WHOLE.
//
// "Harborlight giving and Harbor Run event pages still say Opens soon with no amounts, mission, EIN,
// name, date, or location." The cause, read on staging: the pages are seeded and open in the seed's
// terms, but a page opens to the public only when the org can take a card (FUNDRAISING-2, SWEEP-4),
// and the demo holds no Stripe account by design. So the demo's pages were closed for good.
//
// A demo org's giving and event pages now draw in full (the mission, the suggested amounts, the
// made-up EIN, the event's name, date and place) with one line saying it is an example, and they
// take nothing: the donate and checkout routes refuse without Stripe as before, and the page's
// button says this line instead of sending. A real org's page that can't take gifts yet says
// "This page isn't published yet" (there is no opening date to promise, so never "Opens soon").
"use strict";

const EXAMPLE = "This is an example page in the Steward demo. It shows what donors see, and it takes no gifts.";
const EXAMPLE_EVENT = "This is an example page in the Steward demo. It shows what guests see, and it sells no tickets.";
const NOT_PUBLISHED = "This page isn't published yet";

async function isDemo(query, orgId) {
  const [o] = await query("SELECT id, org_kind FROM orgs WHERE id=?", [orgId]);
  return require("../../orgKind").isDemoOrg(o || null);
}

module.exports = { EXAMPLE, EXAMPLE_EVENT, NOT_PUBLISHED, isDemo };
