// server/donors/recordsGapSources.js · FLOWS-10 item 14. THE PEOPLE BEHIND BILLING'S GAP LINE.
// Registered into figureSources.js's SOURCES, so "64 people are marked Donor but have no gift on
// file" opens its rows like every other number. The rule is shared/numbers/recordsGap.js's.
"use strict";
const RG = require("../../shared/numbers/recordsGap");

module.exports = function recordsGapSources() {
  return {
    "marked-donor-no-gift": {
      label: "Marked Donor, no gift on file",
      measure: () => "count",
      params: {},
      sentence: () => RG.MARKED_NO_GIFT_SENTENCE,
      sql: (orgId) => RG.markedNoGiftRowsSql(orgId),
    },
  };
};
