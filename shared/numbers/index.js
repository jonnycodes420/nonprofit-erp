// shared/numbers · NUMBERS-3. ONE HOME FOR EVERY GIVING NUMBER.
// docs/architecture/ARCHITECTURE.md "One home per number". Each module holds
// one concept: its SQL fragment and, where a screen needs it, its function.
"use strict";
module.exports = {
  fiscalYear: require("./fiscalYear"),
  wholeDollars: require("./wholeDollars"),   // PIPE-1
  money: require("./money"),
  lifetime: require("./lifetime"),
  portfolioValue: require("./portfolioValue"),   // FLOWS-13
  givingBetween: require("./givingBetween"),
  lastGift: require("./lastGift"),
  thanks: require("./thanks"),   // FLOWS-14: which gifts wait for a thank-you
  firstGift: require("./firstGift"),
  retained: require("./retained"),
  deposited: require("./deposited"),
  donorTotals: require("./donorTotals"),
  events: require("./events"),
  lapse: require("./lapse"),
  tags: require("./tags"),
  households: require("./households"),
  everyone: require("./everyone"),   // INTEGRITY-1
  trash: require("./trash"),   // INTEGRITY-3
  ask: require("./ask"),
  pledges: require("./pledges"),
  fundSplit: require("./fundSplit"),   // LEDGER-2
  fundLines: require("./fundLines"),   // GIFTS-2
  goalPledges: require("./goalPledges"),   // GIFTS-2
  donorLabel: require("./donorLabel"),   // WALKB-2
  bunt: require("./bunt"),   // TRUTH-2
  journeyCounts: require("./journeyCounts"),   // FLOWS-20
  draftFigures: require("./draftFigures"),   // TRUTH-2
  draftRender: require("./draftRender"),   // TRUTH-3
  giftCount: require("./giftCount"),   // TRUTH-3
  wealthScore: require("./wealthScore"),   // WEALTH-1
  ledgerStatus: require("./ledgerStatus"),   // TRUTH-3
  defaultFund: require("./defaultFund"),   // LEDGER-3: the org's one unrestricted fund
  fundBooks: require("./fundBooks"),   // LEDGER-3: a fund's gifts beside its books
  waitingToPost: require("./waitingToPost"),   // LEDGER-3: the waiting gifts, by deposit
  topDonors: require("./topDonors"),   // TRUTH-4
  atRisk: require("./atRisk"),   // TRUTH-4
  periodAmounts: require("./periodAmounts"),   // TRUTH-5
  scheduled: require("./scheduled"),   // TRUTH-6
  giftFacts: require("./giftFacts"),   // TRUTH-6
  financeBasis: require("./financeBasis"),   // TRUTH-6
  softThrough: require("./softThrough"),   // TRUTH-5
  pickable: require("./pickable"),   // FLOWS-12: erased means erased
  neverGave: require("./neverGave"),   // FLOWS-12: who in an audience never gave
  pledgeSchedule: require("./pledgeSchedule"),   // TRUTH-5
  lapseWords: require("./lapseWords"),   // TRUTH-5
  nextSteps: require("./nextSteps"),   // ACCESS-3
  broughtIn: require("./broughtIn"),   // CONNECT-1
};
