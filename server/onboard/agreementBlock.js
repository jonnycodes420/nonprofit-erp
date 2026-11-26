// server/onboard/agreementBlock.js · SALES-6 item 2. THE PAPER SIGNATURE BLOCK, ON SCREEN AND ON PAPER.
//
// legal/customer-agreement.md ends with a block for a pen ("Organization ____ / Signed ____ Date
// ____ / Name and title ____ / For Steward Software LLC: ____"). On a web page it sat directly above
// the real online fields and read as a second signature. So:
//   · bodyOf(text) is the agreement without that closing block: what the web page shows, and what
//     an order made from a quote carries in its snapshot (so its hash is of the text she saw);
//   · filledLines(...) is the same block with every blank filled, drawn only on the signed PDF.
// The file itself is unchanged, so its version and the signup click-through's sha256 stay as they are.
"use strict";

const STEWARD_SIGNS = "Jonathan Atkinson, signed on issue";

// The block starts at the last "---" rule that is followed by "**Organization**". Text without it is
// returned whole.
function bodyOf(text) {
  const s = String(text == null ? "" : text);
  const m = s.match(/\n-{3,}\s*\n+\s*\*\*Organization\*\*[\s\S]*$/);
  if (!m) return { body: s, hadBlock: false };
  return { body: s.slice(0, m.index).replace(/\s+$/, "") + "\n", hadBlock: true };
}

// "Nov 26, 2026 at 9:14 AM ET", always Eastern, like the order stamp.
function stampWords(at) {
  const d = new Date(at);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `${day} at ${time} ET`;
}

// The closing block, filled: [label, value] pairs, in the document's order.
function filledLines({ orgName, name, title, signedAt }) {
  return [
    ["Organization", orgName || ""],
    ["Signed", `${name} (typed online)`],
    ["Date", stampWords(signedAt)],
    ["Name and title", `${name}${title ? `, ${title}` : ""}`],
    ["For Steward Software LLC", STEWARD_SIGNS],
  ];
}

module.exports = { bodyOf, filledLines, stampWords, STEWARD_SIGNS };
