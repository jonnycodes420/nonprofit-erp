// shared/numbers · NUMBERS-3. ONE HOME FOR EVERY GIVING NUMBER.
// docs/architecture/ARCHITECTURE.md "One home per number". Each module holds
// one concept: its SQL fragment and, where a screen needs it, its function.
"use strict";
module.exports = {
  fiscalYear: require("./fiscalYear"),
  money: require("./money"),
  lifetime: require("./lifetime"),
  givingBetween: require("./givingBetween"),
  lastGift: require("./lastGift"),
  firstGift: require("./firstGift"),
  retained: require("./retained"),
  deposited: require("./deposited"),
  donorTotals: require("./donorTotals"),
  events: require("./events"),
  lapse: require("./lapse"),
  tags: require("./tags"),
  households: require("./households"),
  everyone: require("./everyone"),   // INTEGRITY-1
  ask: require("./ask"),
  pledges: require("./pledges"),
  fundSplit: require("./fundSplit"),   // LEDGER-2
  fundLines: require("./fundLines"),   // GIFTS-2
  goalPledges: require("./goalPledges"),   // GIFTS-2
  donorLabel: require("./donorLabel"),   // WALKB-2
  bunt: require("./bunt"),   // TRUTH-2
  draftFigures: require("./draftFigures"),   // TRUTH-2
};
