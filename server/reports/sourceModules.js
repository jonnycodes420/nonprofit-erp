// server/reports/sourceModules.js · COMMS-3. THE FIGURE SOURCES THAT LIVE IN THEIR OWN MODULES.
// figureSources.js merges these into SOURCES. Moved out of figureSources.js (which sits at its
// big-files ceiling) unchanged: each line is one module's sources, with the brief that added it.
"use strict";

module.exports = function sourceModules({ FigureParamError, query }) {
  return Object.assign({},
    // HISTORY-1: By year (the profile) and Year over year (Reports), in their own module.
    require("./yoySources")({ FigureParamError }),
    require("./ledgerSources")({ FigureParamError }),   // TRUTH-3: the ledger's three figures
    require("../donors/broughtInSources")(), require("../donors/householdSources")(),   // CONNECT-1: who someone brought in; HOUSEHOLD-1: a household row's this year
    require("../donors/recordsGapSources")(),   // FLOWS-10 item 14: who is on the Donors tab and not a record
    require("../onboard/totalsSources")(),   // ONBOARD-3: what explains a year that differs from the old system
    require("../volunteers/volunteerSources")(), require("../donors/givesThroughSources")(),   // VOL-3: the Volunteers header cards open their rows; NUMBERS-8: Gives through
    require("../outreach/audienceSources")({ FigureParamError, query }),   // COMMS-3: Audience's reach bar and cards
    require("../outreach/thanksSources")(),   // NUMBERS-10 item 2: the gifts older than the thank-you window
    require("../majorGifts/plannedSources")(),   // HOME-7: Home's Planned giving card, the people who hold a bequest
  );
};
