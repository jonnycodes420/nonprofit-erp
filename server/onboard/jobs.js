// server/onboard/jobs.js · ONBOARD-2. THE WORKER'S ONBOARDING JOB.
//
// Every 15 minutes (so nightly too): ask Stripe about any org whose own
// account has not said charges_enabled yet, recompute every onboarding row
// from its signals, and after 7 AM New York send Jonathan the day's first-month
// lines (day 14 with no first gift, a failed payment) once. Queued, so it runs
// on the worker, never in a request.
"use strict";
const BOARD = require("./board");

function define(ctx) {
  const { query, run, stripeChargesEnabled = null, opsAlert = null } = ctx;
  require("../../jobQueue").define("onboardingRecompute", { everyMs: 15 * 60 * 1000, firstMs: 60000,
    run: async () => {
      await BOARD.recompute({ query, run, stripeCheck: stripeChargesEnabled });
      await BOARD.sendMorning({ query, run, opsMail: opsAlert ? (subject, body) => opsAlert("onboarding_morning", subject, body) : null });
    } });
}

module.exports = { define };
