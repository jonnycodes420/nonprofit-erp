// NUMBERS-6 · ORGS A SUITE LEAVES WITH A STALE STORED TOTAL, ON PURPOSE.
//
// scripts/ci/after-battery-numbers.js fails a CI shard when an org the suites
// made is left with a stored total (donors.total_giving and the rest), a
// First/Largest/Last or a removed-gift row that disagrees with its gifts. A
// suite that plants one deliberately (to prove a screen reads the gifts and
// not the stored figure, or that the nightly check sees it) names its org
// here, with the suite and why. Anything not here that is left wrong is a
// write path leaving totals stale, and the build that brought it in is red.
"use strict";
// A key ending in "*" names every org whose id starts with the rest (a suite
// that makes its org id with a random suffix).
const FIXTURE_SQL = "its fixture INSERTs gifts straight into the table (no app path, no recompute), so the stored totals are the fixture's, not a write path's";
module.exports = {
  "org_asks2_*": `asks2: ${FIXTURE_SQL}`,
  "org_fix59_health": `fix59-data-health: ${FIXTURE_SQL}`,
  "org_j4trig": `journeys4-triggers: ${FIXTURE_SQL}`,
  "org_p4show": `parity4-show-me: ${FIXTURE_SQL}`,
  "org_sendgate": `send-gate: ${FIXTURE_SQL}; its people carry stated totals to be judged on`,
  "org_speed3list": `speed3: ${FIXTURE_SQL}, then sets the totals in its own SQL for a 2,000-person list`,
  "org_pr1t2": `prospect1-who-sees: ${FIXTURE_SQL}`,
  "org_wealth1t": `wealth1: ${FIXTURE_SQL}`,
  "org_flows9": `flows9-truth: ${FIXTURE_SQL}`,
  "org_home2t": `home2-living: ${FIXTURE_SQL}, then sets the totals in its own SQL`,
  "org_hf1prof": `hotfix1-profile: ${FIXTURE_SQL}; its people are inserted with stated totals`,
  "org_t100a": "top100-plan-of-care: its people are inserted with stated totals and no gifts, for the Top 100 ranking",
  "org_touch1": "touch1-log-a-touch: its people are inserted with stated totals and no gifts",
  "org_sendgate2": "send-gate-2: its people are inserted with stated totals and no gifts",
  "org_p1clicks": "profile1-everything-clicks: sets stored totals in its own SQL",
  "org_import7_gifts": "import7: its cleanup deletes the 5,010 imported gifts in SQL in one pass and leaves the people (the import itself is checked inside the suite: `off` is 0)",
  "org_feel1_*": "feel1: plants a stored total that has not caught up (999), to prove the screens read the gifts",
  "org_truth3_*": "truth3-money-truth: plants stale stored totals on purpose (its §1 turns red on them)",
  "org_ldg2money": "ledger2-money-figures: plants a stored first_gift_date some write left behind, to prove Donor since reads the gifts",
  // A removed-gift row a suite leaves by deleting in SQL (the gift's ledger stamp stays behind).
  "org_gi_a": "gift-idempotency: deletes a person's gifts in SQL to set up its replay, leaving their ledger stamps",
  "org_acc2p": "access2-portfolio: its reset deletes people and gifts in SQL, leaving a ledger stamp",
  "org_mopup1decoy": "mopup1-leftovers: plants ft_mop1_decoy, a ledger line pointing at a gift that never existed, on purpose",
  "org_list5big": "list5-fast-list: plants stored totals that disagree on purpose, to prove the list reads the gifts, not the stored figure",
};
module.exports.lookup = id => module.exports[id] || Object.entries(module.exports).find(([k]) => k.endsWith("*") && id.startsWith(k.slice(0, -1)))?.[1] || null;
