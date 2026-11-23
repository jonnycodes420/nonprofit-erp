// tests/lib/hasGiven.js · DEFINE-1. A FIXTURE PERSON WHO STANDS FOR A DONOR HAS GIVEN.
//
// A Donor is someone who has given (shared/numbers/isDonor.js: the stored totals). A fixture
// person made with POST /donors (or a bare INSERT) and no gift is a Contact, and is not in All
// donors. A suite that needs them as donors without a gift row (and without the thank-you a
// recorded gift starts) gives them imported history, and the stored totals are recomputed by the
// one writer, as an import does. Its own module, not tests/helpers.js: helpers is in every suite's
// require graph (scripts/ci/affected.js), so it stays as small as it was.
"use strict";
const { q } = require("../helpers");

async function hasGiven(ids, amount = 25) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return;
  const rows = await q(`UPDATE donors SET imported_total = GREATEST(COALESCE(imported_total, 0), $2) WHERE id = ANY($1::text[]) RETURNING id, org_id`, [list, amount]);
  const byOrg = {};
  for (const r of rows) (byOrg[r.org_id] = byOrg[r.org_id] || []).push(r.id);
  const { recomputeStoredTotals } = require("../../shared/numbers/donorTotals");   // the one totals writer recordGift and imports use
  for (const [org, orgIds] of Object.entries(byOrg)) await recomputeStoredTotals(q, org, orgIds);
}

module.exports = { hasGiven };
