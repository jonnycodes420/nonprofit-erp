// FIX-49 · JONATHAN'S NUMBER DECISIONS (25 Oct 2026), AND THE ATLAS AND
// NUMBERS-2 LEFTOVERS. One suite, one section file per part (tests/fix49/):
//   money-goals       a covered fee counts in full in Lifetime and campaigns and
//                     net in Finance; a soft credit never changes Lifetime or a
//                     campaign; a grant counts on the public bar unless switched
//                     off; a goal's period is its own dates; a parent goal adds
//                     its children and its own gifts, never one twice
//   one-rule          one lapsed and lapsing rule names the same people on every
//                     screen; giving levels and households come from one rule
//   history-ask-mail  an imported donor is not New; Ask's "given this year"
//                     equals the profile's This year; "I went to the Harbor Run"
//                     marks the one that happened; mail-preflight reads the
//                     three mail switches
//   workflows         each running Workflows recipe became a journey and stopped
// Runs against a booted server ($BASE) on the scratch database. Failed on main
// (see the PR for the counts).
const { summary, closeDb } = require("./helpers");

(async () => {
  console.log("fix49-decisions (FIX-49)");
  for (const part of ["money-goals", "one-rule", "history-ask-mail", "workflows"]) {
    try { await require(`./fix49/${part}`)(); }
    catch (e) { require("./helpers").ok(`${part} ran to the end`, false, String(e && e.stack || e).slice(0, 400)); }
  }
  await closeDb().catch(() => {});
  summary();
})();
