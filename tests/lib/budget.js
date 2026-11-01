// tests/lib/budget.js: ARCH-1 item 4. A speed budget, strict on a laptop and
// a warning on a shared CI runner.
//
// The perf suites failed MAP-1's docs-only PR three times on a busy runner
// (Home at 1003 ms against a 1000 ms budget). A runner's speed moves more
// between runs than the budgets allow, so in CI (CI=true) a time over budget
// prints a WARN line and counts as a pass, and the local battery a build runs
// before it merges keeps the budget strict. What still fails everywhere: the
// thing never drew (`drew` false, or no time at all). Set PERF_STRICT=1 to
// make CI strict again.
const lenient = () => process.env.CI === "true" && process.env.PERF_STRICT !== "1";

function withinBudget(ok) {
  return (name, { drew = true, ms, budget, extra }) => {
    const measured = drew && Number.isFinite(ms) && ms > 0;
    if (!measured || ms < budget || !lenient()) return ok(name, measured && ms < budget, extra === undefined ? ms : extra);
    console.log(`  WARN  ${name}: ${Math.round(ms)} ms over the ${budget} ms budget (CI runner; strict on the local battery)`);
    return ok(name, true);
  };
}

module.exports = { withinBudget, lenient };
