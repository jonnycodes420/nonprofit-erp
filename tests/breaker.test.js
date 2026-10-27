// tests/breaker.test.js: HARDEN-1 item 4. The battery runs `<name>.test.js`;
// the breaker itself is tests/breaker.spec.js. It is a browser leg (Playwright,
// client/dist), so scripts/shard-plan.js pins it to the browser shard.
require("./breaker.spec.js");
