// shared/numbers/portfolioValue.js · FLOWS-13 item 1 (W-1112-Volunteers-01X).
// AN OFFICER'S PORTFOLIO VALUE.
//
// "At close-out the Dana Reyes officer portfolio was stale by exactly $100,000."
// FLOWS-12 made the officers' board (GET /portfolio/officers) and portfolio
// membership leave erased people out, but three other sums of an officer's
// people still read the stored donors.total_giving with only `deleted_at IS
// NULL`: Home's portfolio value, Home's "your donors" total, and the officer's
// monthly report. An erased person keeps their gifts (TRUTH-2) and their stored
// total, so an erased $100,000 donor stayed in all three until nobody knew why.
//
// One rule now: an officer's people are the ones a picker may offer (not
// deleted, not erased: pickable.js), and the value is each one's Lifetime
// computed live (lifetime.js), never the stored total, so no recompute is
// needed for the next read to be right.
"use strict";

const { PICKABLE } = require("./pickable");
const { LIFETIME } = require("./lifetime");

// SQL: `d` is one of an officer's people (add `d.assigned_to = ?` yourself).
const IN_PORTFOLIO = (d = "d") => PICKABLE(d);
// SQL: the portfolio's value, an aggregate over rows of `d`.
const VALUE = (d = "d") => `COALESCE(SUM(${LIFETIME(d)}),0)`;

module.exports = { IN_PORTFOLIO, VALUE };
