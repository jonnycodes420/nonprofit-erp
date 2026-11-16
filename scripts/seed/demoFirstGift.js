// scripts/seed/demoFirstGift.js · FLOWS-15 item 1. THE DEMO'S FIRST-GIFT VERSION OF ITS YEAR-END
// APPEAL, so the fleet sees the whole path: a never-giver reads these words, a giver the thank-you.
// Harborlight is made up, and these are words written for it by hand, here, once. Steward never
// writes a first-gift version for a real org: scripts/ops/flows15-demo-first-gift.js puts these on
// org_b72demo only.
"use strict";

const HERO = { firstGiftHeading: "This year, there is room for you in it",
  firstGiftSub: "What happened at {{org_name}} this year happened because neighbours chose to stand with young people here." };
const TEXT = "Young people came to our door all year, and we were able to say yes. We would love you to be part of what comes next.\n\n"
  + "If you are able to make a first gift before December 31, it would help us begin the new year ready. Any amount is welcome, and every gift is put to work close to home.";

// The Year-end appeal's blocks with the demo's versions on the hero and on each text block that
// thanks the reader for giving. claimsOf: shared/pastGiving.js's.
function withDemoFirstGift(blocks, claimsOf) {
  const claimed = new Set(claimsOf(blocks).map(c => c.index));
  return blocks.map((b, i) => {
    if (!claimed.has(i)) return b;
    if (b.type === "hero") return { ...b, ...HERO };
    if (b.type === "richtext" && /give once more/i.test(JSON.stringify(b.blocks || []))) return { ...b, firstGift: TEXT };
    if (b.type === "richtext") return { ...b, firstGift: "Whatever you decide, thank you for reading about this work." };
    return b;
  });
}

module.exports = { withDemoFirstGift, HERO, TEXT };
