// shared/numbers/donorLabel.js · WALKB-2 item 2. WHETHER SOMEONE IS A DONOR, ONCE.
//
// Muse's Walk B: an event guest with $40,709 lifetime read "Not a donor yet".
// The attendee row asked `donors.stage`, the major-gifts pipeline column, which
// is empty for most people an import brings in; it never asked whether they
// had given. The profile's rule (PROFILE-3) is the one: a person has given when
// their lifetime (lifetime.js, the old system's total included) is above zero
// or they have a gift on file (money.js GIFT). Only someone with neither is
// "Not a donor yet".
"use strict";
const { LIFETIME } = require("./lifetime");
const { GIFT } = require("./money");

// SQL: whether person `d` has given (boolean).
const HAS_GIVEN = (d = "d") => `(${LIFETIME(d)} > 0 OR EXISTS (SELECT 1 FROM gifts hg
    WHERE hg.org_id = ${d}.org_id AND hg.donor_id = ${d}.id AND ${GIFT("hg")}))`;

const NOT_YET = "Not a donor yet";
// The words for one person on a list: their pipeline stage when they have one
// past Prospect, "Donor" when they have given, else "Not a donor yet".
// `stageName` turns a stage key into its label (the client's, or the key).
function donorLabel({ hasGiven, stage } = {}, stageName = k => k) {
  if (!hasGiven) return { key: "not_yet", label: NOT_YET };
  if (stage && stage !== "prospect") return { key: "stage", stage, label: stageName(stage) };
  return { key: "donor", label: "Donor" };
}

module.exports = { HAS_GIVEN, donorLabel, NOT_YET };
