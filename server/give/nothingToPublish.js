// server/give/nothingToPublish.js · FLOWS-16 item 6 (W-1116-Fundraising-34X). PUBLISH WITH NOTHING CHANGED.
// The pink banner read only "nothing_to_publish". Now the route answers with a sentence that names
// the version that is live ("Nothing to publish: this page has no changes since Version 4.").
"use strict";
async function nothingToPublish(query, orgId, pageId) {
  const [m] = pageId ? await query("SELECT MAX(number)::int AS n FROM giving_page_versions WHERE org_id=? AND page_id=?", [orgId, pageId]).catch(() => [null]) : [null];
  return m && m.n ? `Nothing to publish: this page has no changes since Version ${m.n}.` : "Nothing to publish: this page has no changes since it was last published.";
}
module.exports = { nothingToPublish };
