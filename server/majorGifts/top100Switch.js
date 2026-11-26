// server/majorGifts/top100Switch.js · POLISH-12 item 4. IS THE TOP 100 ON FOR THIS ORG?
//
// Jonathan, 25 Nov: "I don't like the top 100 thing for every org." It is an
// org setting (orgs.top100_enabled, off by default), never an org id in code.
// Off hides the Top 100 tab, the rank and "Add to Top 100" on a profile, and
// Atlas's Top 100 answers and plans. Nothing on the list is deleted, and its
// routes still answer, so turning it back on brings the list back as it was.
"use strict";

const OFF_LINE = "The Top 100 isn't turned on for your organization. An admin can turn it on in Settings, under Major gifts.";

async function top100On(query, orgId) {
  const [o] = await query("SELECT top100_enabled FROM orgs WHERE id=?", [orgId]);
  return !!(o && o.top100_enabled === true);
}

module.exports = { top100On, OFF_LINE };
