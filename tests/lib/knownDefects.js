// tests/lib/knownDefects.js: TRUTH-1. THE DISAGREEMENTS THE TRUTH CHECK
// FOUND AND DID NOT FIX, EACH LOGGED IN docs/defects.md.
//
// The check still computes every one of these and still prints it, every run,
// as "KNOWN <id>": it is never quietened by loosening a comparison. A
// surface's figure is KNOWN only when it is EXACTLY the number its logged
// defect predicts (the key plus the credit rows it wrongly sums, or a gift
// whose only missing mark is deposit_ref); the same surface off by any other
// amount is a new disagreement and fails. So CI can be green while a defect
// waits for the build that folds its duplicate into the shared version
// (NUMBERS-3 onward), and a new defect on that same surface still goes red.
// Remove an entry the day its defect is fixed.
"use strict";
const KNOWN = {
  "D-1": { level: "P1", what: "Fundraising's all-time figure counts soft and matching credit rows as gifts and money (routes/crm.js:22073)" },
  "D-2": { level: "P1", what: "Fundraising's Raised tile counts credit rows as money (routes/crm.js:22050)" },
  "D-3": { level: "P1", what: "Ask and Atlas count credit rows as money (how much raised) and as givers (how many donors) (askEngine.js:46 giftSet)" },
  "D-4": { level: "P1", what: "Finance's money in by month counts credit rows as money (routes/finance.js:214; finFigure moneyInThisMonth :143)" },
  "D-6": { level: "P1", what: "The bookkeeper's file calls a deposited gift \"not matched to a deposit\": it reads deposit_ref, which only Undo writes (routes/crm.js:24988)" },
  "D-7": { level: "P3", what: "The onboarding card's gift count counts credit rows as gifts (routes/crm.js:3318)" },
};

module.exports = { KNOWN };
