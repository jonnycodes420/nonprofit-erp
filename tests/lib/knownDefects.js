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
// NUMBERS-3 (1 Nov 2026) fixed D-3, D-4, D-6 and D-7 (shared/numbers/), so
// nothing is known today. A new entry needs its line in docs/defects.md.
const KNOWN = {};

module.exports = { KNOWN };
