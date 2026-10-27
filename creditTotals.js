// One donor's credit, the profile census lines' two figures. FIX-51: hard is
// their own money and nothing else, the same figure as the profile's Lifetime
// (donor-lifetime: soft and matching credit rows are not in it); soft is the
// profile's Soft credit figure (donor-soft-credit: other people's gifts
// credited to them, and their own credit rows). Each is computed once, by its
// figure source, so the census lines and the header can never disagree. The
// second is never added into the first anywhere except on the line that says
// it is "with soft credit". Its own file so scripts/check-numbers.js can check
// it (server.js cannot be required without booting).
"use strict";
const figureSources = require("./figureSources");

async function donorCreditTotals(orgId, donorId) {
  const [h, s] = await Promise.all([
    figureSources.figureValue(orgId, { key: "donor-lifetime", params: { donor: donorId } }),
    figureSources.figureValue(orgId, { key: "donor-soft-credit", params: { donor: donorId } }),
  ]);
  const hardCents = h.cents || 0, softCents = s.cents || 0;
  return { hardCents, softCents, hardPlusSoftCents: hardCents + softCents, hardCount: h.totalRows, softCount: s.totalRows };
}

module.exports = { donorCreditTotals };
