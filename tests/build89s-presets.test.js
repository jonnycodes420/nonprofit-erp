// BUILD-89S 89d — STATEMENT PRESETS. Run: node tests/build89s-presets.test.js
//
// No real export of any of the three was available when this was built (see
// NEEDS-JONATHAN.md §6), so this suite does the two things that are worth doing
// without one:
//
//   §1  IT PROVES THE TABLE IS LOAD-BEARING. Every candidate spelling declared
//       for every preset is actually read. A wrong guess then fails here by
//       column name instead of importing quietly wrong.
//   §2  IT PROVES THE RULES THAT DO NOT DEPEND ON THE FILE. A statement is a
//       register: money in, money out, lines that are not money. Only the
//       first is a gift, a named non-gift movement is refused whichever way
//       the money went, and the payment method is a fact about the FILE.
//   §3  RE-UPLOADING NEXT MONTH IS SAFE, and the mechanism is the namespaced
//       external id — the SAME string 89a's externalKey builds, so a PayPal
//       CSV row and the PayPal API reading one transaction are ONE gift.
//   §4  THE MAPPING IS IN THE EXISTING MAPPER'S VOCABULARY. A preset is a
//       pre-filled answer, not a second importer.
//   §5  A FILE THAT IS NOT THAT STATEMENT IS REFUSED, and says why.

const { ok, summary } = require("./helpers");

// The three statements as their documented/reported headers, in file order.
const PAYPAL_HEADERS = ["Date", "Time", "TimeZone", "Name", "Type", "Status", "Currency",
  "Gross", "Fee", "Net", "From Email Address", "To Email Address", "Transaction ID",
  "Item Title", "Invoice Number", "Balance"];
const VENMO_HEADERS = ["", "ID", "Datetime", "Type", "Status", "Note", "From", "To",
  "Amount (total)", "Amount (tip)", "Amount (fee)", "Funding Source", "Destination"];
const CASHAPP_HEADERS = ["Transaction ID", "Date", "Transaction Type", "Currency", "Amount",
  "Fee", "Net Amount", "Status", "Notes", "Name of sender/receiver", "Account"];

(async () => {
  const P = await import("../shared/sourcePresets.js");
  const G = await import("../shared/givingSources.js");

  // ══ §1 · THE TABLE IS LOAD-BEARING ═══════════════════════════════════════
  console.log("\n— §1 · every declared spelling is actually read —");
  let proven = 0; const unread = [];
  for (const key of P.PRESET_KEYS) {
    const preset = P.presetFor(key);
    for (const [field, candidates] of Object.entries(preset.columns)) {
      for (const spelling of candidates) {
        // A file whose ONLY column is this spelling must still resolve it.
        const applied = P.applySourcePreset(key, [spelling]);
        if (applied.matched[field] === spelling) proven++;
        else unread.push(`${key}.${field}.${spelling}`);
      }
    }
  }
  ok(`every candidate spelling across all three presets resolves (${proven})`,
    unread.length === 0, unread);
  ok("the header match is case- and spacing-insensitive, like the rest of the mapper",
    P.applySourcePreset("paypal_csv", ["  TRANSACTION   ID  "]).matched.externalId === "  TRANSACTION   ID  ");

  // ══ §2 · WHAT A STATEMENT ROW IS ═════════════════════════════════════════
  console.log("\n— §2 · a statement is a register; only money in is a gift —");
  const pp = P.applySourcePreset("paypal_csv", PAYPAL_HEADERS);
  ok("the PayPal download maps cleanly", pp.ok && !pp.missingRequired.length, pp.missingRequired);

  const ppRow = (over = {}) => ({
    Date: "08/14/2026", Name: "Marta Quill", Type: "Website Payment", Status: "Completed",
    Currency: "USD", Gross: "250.00", Fee: "-7.55", "From Email Address": "marta@example.org",
    "Transaction ID": "8XN12345AB678901C", ...over,
  });
  ok("a completed payment is money coming in",
    P.classifyStatementRow("paypal_csv", ppRow(), pp).kind === P.ROW_INCOMING);
  ok("a withdrawal to the bank is money going out",
    P.classifyStatementRow("paypal_csv", ppRow({ Gross: "-4500.00", Type: "General Withdrawal" }), pp).kind === P.ROW_OUTGOING);
  ok("a fee on its own line is money going out",
    P.classifyStatementRow("paypal_csv", ppRow({ Gross: "-3.20", Type: "Fee" }), pp).kind === P.ROW_OUTGOING);
  ok("a pending payment is not written",
    P.classifyStatementRow("paypal_csv", ppRow({ Status: "Pending" }), pp).kind === P.ROW_NOT_MONEY);
  ok("a balance line is not money at all",
    P.classifyStatementRow("paypal_csv", ppRow({ Type: "Balance", Gross: "1200.00" }), pp).kind === P.ROW_NOT_MONEY);
  ok("a zero line is not a gift",
    P.classifyStatementRow("paypal_csv", ppRow({ Gross: "0.00" }), pp).kind === P.ROW_NOT_MONEY);
  ok("a row with no readable amount is set aside, not guessed at",
    P.classifyStatementRow("paypal_csv", ppRow({ Gross: "" }), pp).kind === P.ROW_NOT_MONEY);

  // THE ORDER OF THE TWO SIGNALS IS THE POINT, and the honest rule is not the
  // obvious one. A "Bank Transfer" is the organisation moving its OWN money:
  // out to the bank, or IN from the bank to fund the balance. A positive one is
  // not a donation just because the number is positive, so a named movement
  // that is never a gift is refused whichever way the money went.
  const transferIn = P.classifyStatementRow("paypal_csv", ppRow({ Gross: "500.00", Type: "Bank Transfer" }), pp);
  ok("a POSITIVE transfer is the org's own money arriving, not a gift",
    transferIn.kind === P.ROW_OUTGOING, transferIn);
  ok("...and so is a negative one",
    P.classifyStatementRow("paypal_csv", ppRow({ Gross: "-500.00", Type: "Bank Transfer" }), pp).kind === P.ROW_OUTGOING);
  ok("but a type word that says nothing useful leaves the SIGN to decide",
    P.classifyStatementRow("paypal_csv", ppRow({ Gross: "500.00", Type: "Website Payment" }), pp).kind === P.ROW_INCOMING
    && P.classifyStatementRow("paypal_csv", ppRow({ Gross: "-500.00", Type: "Website Payment" }), pp).kind === P.ROW_OUTGOING);
  ok("every set-aside row carries a reason a human can read",
    !!P.classifyStatementRow("paypal_csv", ppRow({ Gross: "-1" }), pp).reason);

  // Venmo signs its amounts with a leading + / -, which the one money seam
  // already reads — there is no second parser here.
  const vm = P.applySourcePreset("venmo_csv", VENMO_HEADERS);
  ok("the Venmo statement maps cleanly", vm.ok, vm.missingRequired);
  const vmRow = (over = {}) => ({
    ID: "4012345678901234567", Datetime: "2026-08-14T13:02:00", Type: "Payment",
    Status: "Complete", Note: "Sunday offering", From: "Dana Reyes", To: "Harbor Music",
    "Amount (total)": "+ $50.00", ...over,
  });
  ok('Venmo\'s "+ $50.00" reads as fifty dollars in', P.amountCents("+ $50.00") === 5000);
  ok('and "- $20.00" reads as twenty dollars out', P.amountCents("- $20.00") === -2000);
  ok("a Venmo payment received is a gift",
    P.classifyStatementRow("venmo_csv", vmRow(), vm).kind === P.ROW_INCOMING);
  ok("a Venmo standard transfer to the bank is not",
    P.classifyStatementRow("venmo_csv", vmRow({ "Amount (total)": "- $1,200.00", Type: "Standard Transfer" }), vm).kind
      === P.ROW_OUTGOING);

  const ca = P.applySourcePreset("cashapp_csv", CASHAPP_HEADERS);
  ok("the Cash App statement maps cleanly against its reported shape", ca.ok, ca.missingRequired);
  ok("...and says out loud that the shape is not confirmed",
    ca.confidence === "unconfirmed", ca.confidence);

  // ══ §3 · RE-UPLOADING NEXT MONTH IS SAFE ═════════════════════════════════
  console.log("\n— §3 · the same transaction, two ways, is ONE gift —");
  ok("a preset's external id is namespaced by provider",
    P.presetExternalId("paypal_csv", "8XN12345AB678901C") === "paypal:8XN12345AB678901C");
  // THE ASSERTION THE WHOLE NAMESPACING DECISION EXISTS FOR.
  ok("and it is byte-identical to what the API adapter's key would be",
    P.presetExternalId("paypal_csv", "8XN1") === G.externalKey("paypal", "8XN1"),
    [P.presetExternalId("paypal_csv", "8XN1"), G.externalKey("paypal", "8XN1")]);
  ok("Venmo and Cash App namespace to their own providers",
    P.presetExternalId("venmo_csv", "401") === "venmo:401"
    && P.presetExternalId("cashapp_csv", "c1") === "cashapp:c1");
  ok("a row with no transaction id gets no key rather than a made-up one",
    P.presetExternalId("paypal_csv", "") === null && P.presetExternalId("paypal_csv", null) === null);
  // Two providers reusing a short numeric id can never collide.
  ok("two providers with the same short id do not collide",
    P.presetExternalId("venmo_csv", "1001") !== P.presetExternalId("cashapp_csv", "1001"));

  // ══ §4 · IT IS THE EXISTING MAPPER ═══════════════════════════════════════
  console.log("\n— §4 · a preset is a pre-filled answer, not a second importer —");
  const shape = await import("../shared/importShape.js");
  const mapperFields = Object.keys(shape.autoDetectTxMapping([], []));
  const presetFields = Object.keys(pp.mapping);
  ok("the preset produces the mapper's OWN vocabulary, field for field",
    mapperFields.length === presetFields.length && mapperFields.every(f => presetFields.includes(f)),
    { mapperFields, presetFields });
  ok("the date, amount and transaction id are pre-filled",
    pp.mapping.date === "Date" && pp.mapping.amount === "Gross" && pp.mapping.externalId === "Transaction ID", pp.mapping);
  ok("the donor's name and email are pre-filled",
    pp.mapping.donorName === "Name" && pp.mapping.donorEmail === "From Email Address", pp.mapping);

  // THE PAYMENT METHOD IS A FACT ABOUT THE FILE, NOT A COLUMN.
  ok("the payment method is a constant the preset STATES, never a guess from a row",
    pp.constants.paymentMethod === "PayPal" && pp.mapping.paymentMethod === "", pp.constants);
  ok("...so a Venmo statement's gifts will read Venmo on the bookkeeper's export",
    vm.constants.paymentMethod === "Venmo" && ca.constants.paymentMethod === "Cash App");
  // A fund is never invented from a statement: none of the three carry one.
  ok("no preset pre-fills a fund — a designation is not in a bank statement",
    [pp, vm, ca].every(a => a.mapping.fund === ""));
  ok("a column with no home is REPORTED, not silently dropped",
    pp.unmatchedColumns.includes("To Email Address") && pp.unmatchedColumns.includes("Balance"),
    pp.unmatchedColumns);
  ok("the columns the preset DID use are not listed as homeless",
    !pp.unmatchedColumns.includes("Gross") && !pp.unmatchedColumns.includes("Type"),
    pp.unmatchedColumns);

  // ══ §5 · A FILE THAT IS NOT THAT STATEMENT ═══════════════════════════════
  console.log("\n— §5 · Steward says what it thinks the file is, and can be wrong out loud —");
  const detectedPP = P.detectSourcePreset(PAYPAL_HEADERS);
  ok("a PayPal download is detected as one", detectedPP?.key === "paypal_csv", detectedPP);
  const detectedVM = P.detectSourcePreset(VENMO_HEADERS);
  ok("a Venmo statement is detected as one", detectedVM?.key === "venmo_csv", detectedVM);
  const ordinary = P.detectSourcePreset(["Donor Name", "Email", "Gift Amount", "Gift Date", "Fund"]);
  ok("an ordinary CRM export is NOT claimed as a statement", ordinary === null, ordinary);
  ok("a file missing a required column is refused rather than half-applied",
    P.applySourcePreset("paypal_csv", ["Name", "Gross"]).ok === false
    && P.applySourcePreset("paypal_csv", ["Name", "Gross"]).missingRequired.includes("date"));
  ok("an unknown preset key is refused", P.applySourcePreset("nope", []).ok === false);

  const bad = P.applySourcePreset("paypal_csv", ["Name", "Gross"]);
  ok("the refusal is a sentence naming what was missing, not a code",
    /does not look like/.test(P.presetSentence(bad)) && /date/.test(P.presetSentence(bad)),
    P.presetSentence(bad));
  ok("and a good one says what was filled in and what was left alone",
    /columns mapped/.test(P.presetSentence(pp)) && /"PayPal"/.test(P.presetSentence(pp))
    && /had no home/.test(P.presetSentence(pp)),
    P.presetSentence(pp));
  ok("no sentence carries an em dash (the standing voice rule)",
    ![P.presetSentence(pp), P.presetSentence(vm), P.presetSentence(bad)].some(s => s.includes("—")));

  summary();
})();
