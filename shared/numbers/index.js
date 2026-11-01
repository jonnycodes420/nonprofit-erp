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
};
