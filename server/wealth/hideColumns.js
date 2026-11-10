// server/wealth/hideColumns.js · WEALTH-1. THE STORED COLUMN NEVER RIDES ON A ROW.
//
// Many reads answer with `donors.*` (the Donors list, a profile, a search), so
// a new column on donors would reach every signed-in user. The Wealth Score
// must reach only the people who may see it (server/wealth/access.js). This
// is Express's `json replacer`, set once on the app: every JSON answer drops
// these keys, whatever route wrote it. The score leaves the server only by
// the routes that check first, and under their own names (`score`,
// `cells.wealth_score`, a report column), never as `wealth_rating`.
"use strict";
const HIDDEN = new Set(["wealth_rating", "wealth_rating_set_at", "wealth_rating_set_by", "wealth_rating_set_by_name"]);
function replacer(key, value) { return HIDDEN.has(key) ? undefined : value; }
module.exports = { HIDDEN, replacer };
