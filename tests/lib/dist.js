// tests/lib/dist.js: CI-2. WHICH BUILT CLIENT THIS SUITE'S BROWSER WALKS.
//
// The browser legs used to share one client/dist, built against one shard's
// API, so every browser suite had to sit in that one shard (it carried 2,095 s
// of PR #294's 2,770 s). Now each shard that holds a browser suite gets a dist
// built for its own API (tests/run-all.sh), and says where in STEWARD_DIST.
// Unset, it is client/dist, exactly as before: a suite run by hand, the
// pre-push hook and a serial run are unchanged.
const path = require("path");
module.exports = { DIST: process.env.STEWARD_DIST ? path.resolve(process.env.STEWARD_DIST) : path.join(__dirname, "..", "..", "client", "dist") };
