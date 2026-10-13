// tests/polish1-trust.test.js · POLISH-1. NOTHING ARGUES WITH ITSELF.
//
// The nine trust breaks Muse found walking the product as a development
// director (docs/polish-1/PREMIUM-1.pdf), one section each, in tests/polish1/:
//   part1-footing    the donor profile foots against the gifts table
//   part2-volunteer  the volunteer link Reach hands out opens and accepts a sign-up
//   part3-ask        Ask asked the same thing three times answers the same way
//   part4-search     Ctrl+K and a click open search
//   part5-money      no bare decimal amount on the main screens
//   part6-reports    the 3-year comparison keeps its headers in view
// Each section makes its own fixture org and removes what it wrote. A section
// that throws is a failure, never a skip. It failed on main (see each file).
//
// Standard scratch stack (tests/README.md); browser legs need client/dist
// built against $BASE and PLAYWRIGHT_DIR, as every browser leg does.
const fs = require("fs");
const path = require("path");
const h = require("./helpers");

const PARTS = ["part1-footing", "part2-volunteer", "part3-ask", "part4-search", "part5-money", "part6-reports"];

(async () => {
  console.log("POLISH-1: nothing argues with itself\n");
  for (const name of PARTS) {
    const file = path.join(__dirname, "polish1", name + ".js");
    if (!fs.existsSync(file)) { h.ok(`${name} is present`, false); continue; }
    console.log(`\n── ${name}`);
    try { await require(file)(h); }
    catch (e) { h.ok(`${name} ran to the end`, false, String(e && e.stack || e).slice(0, 600)); }
  }
  await h.closeDb();
  h.summary();
})();
