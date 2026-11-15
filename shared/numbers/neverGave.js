// shared/numbers/neverGave.js · FLOWS-12 item 1 (W-1114-Fundraising-17).
// WHO IN AN AUDIENCE HAS NEVER GIVEN. One rule, the one POLISH-9's
// audienceNoGift and the Preview as finder's gave=0 already used: a person
// whose lifetime giving (donors.total_giving, the old system's total
// included) is not above zero. The campaign editor's "212 people in this
// audience have never given" and the preview's flag both count with this.
"use strict";

const neverGave = d => !(Number(d && d.total_giving) > 0);
const countNeverGave = rows => (rows || []).filter(neverGave).length;
// SQL: `d` has never given.
const NEVER_GAVE = (d = "d") => `COALESCE(${d}.total_giving, 0) <= 0`;

module.exports = { neverGave, countNeverGave, NEVER_GAVE };
