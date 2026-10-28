// tests/perf-giving.test.js: HARDEN-2 item 1. The battery runs `<name>.test.js`;
// the budgets live in tests/perf-giving.spec.js. It is a browser leg (Playwright,
// client/dist), so scripts/shard-plan.js pins it to the browser shard.
require("./perf-giving.spec.js");
