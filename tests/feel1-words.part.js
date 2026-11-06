// FEEL-1 item 4 · Words, not code. Folded into tests/feel1.test.js.
// Each check fails on main: there was no shared/giftWords.js, GivingTab drew
// the raw key under CSS capitalize ("Pledge_payment"), Communications fell back
// to the raw trigger key, workflowsToJourneys.js wrote "(Was the Workflows
// recipe of the same kind.)", fundSplit said "No fund named" (RecurringGiving
// "General"), numbers.eventStory said "1 came: 0 gave and 1 didn't. …", and
// ReceiptCell offered "Send receipt" on any gift.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

async function wordsChecks({ ok }) {
  let W = null;
  try { W = require("../shared/giftWords.js"); } catch (e) { W = null; }
  ok("§4 the word helpers exist (shared/giftWords.js)", !!W);
  // On main there is no such file: every check below still runs and reads red.
  if (!W) W = new Proxy({}, { get: () => () => undefined });
  ok("§4 a gift type reads as its label: pledge_payment → \"Pledge payment\", credit_card → \"Credit card\", in_kind → \"In-kind\"",
     W.giftTypeLabel("pledge_payment") === "Pledge payment" && W.giftTypeLabel("credit_card") === "Credit card" && W.giftTypeLabel("in_kind") === "In-kind"
     && W.giftTypeLabel("some_new_kind") === "Some new kind", [W.giftTypeLabel("pledge_payment"), W.giftTypeLabel("some_new_kind")]);
  const giving = read("client/src/components/profile/GivingTab.jsx");
  ok("§4 the profile's gift row draws the label, not the key under CSS capitalize",
     giving.includes("{giftTypeLabel(g.type)}") && !/textTransform:"capitalize"}}>\{g\.type/.test(giving));
  ok("§4 an earlier sequence's trigger reads \"First gift\" and \"Lapsed\", never the key",
     W.triggerLabel("first_gift") === "First gift" && W.triggerLabel("lapsed") === "Lapsed"
     && /triggerLabel\(id\)/.test(read("client/src/components/Communications.jsx")), [W.triggerLabel("first_gift"), W.triggerLabel("lapsed")]);
  const note = "(Was the Workflows recipe of the same kind.)";
  ok("§4 no build's note in user copy: the journeys made from Workflows recipes don't say where they came from, and a stored one is cut on read",
     !read("workflowsToJourneys.js").includes(note)
     && W.withoutInternalNotes(`A card did not go through. Help them fix it. ${note}`) === "A card did not go through. Help them fix it."
     && read("server/outreach/journeys.js").includes("withoutInternalNotes(t.description"));
  const fundSplit = require("../shared/numbers/fundSplit.js");   // eslint-disable-line
  ok("§4 a gift with no fund reads \"Unrestricted (no fund)\" everywhere (the profile's split, Recurring, reports)",
     W.fundLabel(null) === "Unrestricted (no fund)" && W.fundLabel("General Operating") === "General Operating" && fundSplit.NO_FUND === "Unrestricted (no fund)"
     && !read("client/src/components/RecurringGiving.jsx").includes('s.fundName || "General"')
     && !/No fund named|'No fund'|"No fund"|[,"]'?\(no fund\)/.test(read("server/reports/handlers.js") + read("shared/reportBuilder.js") + read("routes/finance.js")),
     fundSplit.NO_FUND);
  ok("§4 the event's line reads like a person: \"1 came, and nobody gave yet.\"",
     W.eventStoryText({ attended: 1, cameGave: 0, cameDidntGive: 1, gave: 0, gaveNotCame: 0 }) === "1 came, and nobody gave yet."
     && W.eventStoryText({ attended: 5, cameGave: 2, cameDidntGive: 3, gave: 3, gaveNotCame: 1 }) === "5 came, and 2 of them gave; 3 haven't yet. 1 other gave or pledged without coming."
     && /eventStoryText\(out\)/.test(read("numbers.js")),
     W.eventStoryText({ attended: 1, cameGave: 0, cameDidntGive: 1 }));
  ok("§4 a $0 gift doesn't offer \"Send receipt\" (and the server makes none)",
     W.receiptOffered({ amount: 0 }) === false && W.receiptOffered({ amount: "0.00" }) === false && W.receiptOffered({ amount: 25 }) === true
     && read("client/src/components/profile/ReceiptsAndStatements.jsx").includes("if (!receiptOffered(g))")
     && read("server/donors/gifts.js").includes('error: "zero_gift"'));
}

module.exports = { wordsChecks };

if (require.main === module) {
  let pass = 0, fail = 0;
  const ok = (name, cond, info) => { if (cond) pass++; else fail++; console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : "  " + JSON.stringify(info)}`); };
  wordsChecks({ ok }).then(() => { console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); });
}
