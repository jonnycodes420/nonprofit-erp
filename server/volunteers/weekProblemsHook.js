// server/volunteers/weekProblemsHook.js · VOL-3 item 6. This week's short shifts and conflicts are
// worked out by routes/volunteerScheduling.js (weekProblems, over the Schedule's own rows). That
// route registers the function here when it mounts, so the header cards' figure sources
// (volunteerSources.js) open the same rows the Schedule shows instead of a second copy of the rule.
"use strict";
let fn = null;
module.exports = {
  set(f) { fn = f; },
  async get(orgId) {
    if (!fn) throw new Error("weekProblems is not mounted yet");
    return fn(orgId);
  },
};
