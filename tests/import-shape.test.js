// FIX — magical one-file import: shape AUTO-DETECTION + transaction grouping.
// Pure unit test of shared/importShape.js (JSX/React-free), dynamic-
// imported like tests/finance-funds.test.js imports money.js. No server needed.
//
// Covers the three real nonprofit export shapes:
//   - aggregate:   one row per donor (Total Given / Last Gift columns)
//   - transaction: one row per GIFT, donor repeated → group into donors + gifts
//   - wide:        one row per donor, year columns
// plus groupTransactions (the "group a raw gift ledger by donor" core).

const { ok, summary } = require("./helpers");

(async () => {
  const { detectImportShape, groupTransactions, shapeLabel } =
    await import("../shared/importShape.js");

  // ── Shape detection ──────────────────────────────────────────────────────
  // Aggregate: one row per donor with Total Giving + Last Gift columns.
  const agg = detectImportShape(
    ["Name", "Email", "Total Giving", "Last Gift Date"],
    [
      { Name: "Jane Smith", Email: "jane@x.org", "Total Giving": "5000", "Last Gift Date": "2024-11-01" },
      { Name: "Bob Lee",    Email: "bob@x.org",  "Total Giving": "1200", "Last Gift Date": "2023-02-15" },
    ]
  );
  ok("aggregate file → aggregate", agg.shape === "aggregate", agg);

  // Transaction: one row per gift, donors repeat, amount + date, no total.
  const tx = detectImportShape(
    ["Donor Name", "Email", "Amount", "Gift Date"],
    [
      { "Donor Name": "Jane Smith", Email: "jane@x.org", Amount: "100", "Gift Date": "2024-01-05" },
      { "Donor Name": "Jane Smith", Email: "jane@x.org", Amount: "250", "Gift Date": "2024-06-05" },
      { "Donor Name": "Bob Lee",    Email: "bob@x.org",  Amount: "75",  "Gift Date": "2024-03-01" },
    ]
  );
  ok("transaction ledger → transaction", tx.shape === "transaction", tx);
  ok("transaction detects donor repetition", tx.donorRepeats === true, tx);

  // Transaction WITH a total column but repeating donors + amount+date → still
  // a ledger (the donorRepeats branch).
  const txTotal = detectImportShape(
    ["Donor", "Email", "Gift Amount", "Date", "Lifetime Giving"],
    [
      { Donor: "A", Email: "a@x.org", "Gift Amount": "10", Date: "2024-01-01", "Lifetime Giving": "50" },
      { Donor: "A", Email: "a@x.org", "Gift Amount": "40", Date: "2024-02-01", "Lifetime Giving": "50" },
    ]
  );
  ok("amount+date+repeating donors → transaction (even with total col)", txTotal.shape === "transaction", txTotal);

  // Wide: year columns carrying numbers, one row per donor.
  const wide = detectImportShape(
    ["Name", "Email", "2021", "2022 Gift", "2023"],
    [
      { Name: "Jane", Email: "jane@x.org", "2021": "500", "2022 Gift": "750", "2023": "1000" },
      { Name: "Bob",  Email: "bob@x.org",  "2021": "",    "2022 Gift": "200", "2023": "300" },
    ]
  );
  ok("year-column file → wide", wide.shape === "wide", wide);
  ok("wide surfaces its year columns", wide.yearCols.length === 3, wide.yearCols);

  // A single amount+date file with UNIQUE donors and no total is still a ledger.
  const txUnique = detectImportShape(
    ["Name", "Email", "Amount", "Date"],
    [
      { Name: "One", Email: "one@x.org", Amount: "10", Date: "2024-01-01" },
      { Name: "Two", Email: "two@x.org", Amount: "20", Date: "2024-02-01" },
    ]
  );
  ok("amount+date, no total → transaction", txUnique.shape === "transaction", txUnique);

  // Year columns that are all blank/non-numeric do NOT trigger wide.
  const notWide = detectImportShape(
    ["Name", "Email", "2021 Notes", "Total Giving"],
    [{ Name: "X", Email: "x@x.org", "2021 Notes": "called them", "Total Giving": "100" }]
  );
  ok("non-numeric year column → not wide", notWide.shape !== "wide", notWide);

  ok("shapeLabel(transaction) mentions gifts", /gift/i.test(shapeLabel("transaction")), shapeLabel("transaction"));

  // ── groupTransactions ────────────────────────────────────────────────────
  const grouped = groupTransactions([
    { key: "jane@x.org", donor: { name: "Jane Smith", email: "jane@x.org" }, gift: { amount: 100, date: "2024-01-05" } },
    { key: "jane@x.org", donor: { name: "Jane Smith", email: "jane@x.org", phone: "555-1000" }, gift: { amount: 250, date: "2024-06-05" } },
    { key: "bob@x.org",  donor: { name: "Bob Lee", email: "bob@x.org" }, gift: { amount: 75, date: "2024-03-01" } },
    { key: "carol@x.org",donor: { name: "Carol No-Gift", email: "carol@x.org" }, gift: null },
  ]);
  ok("groups 4 rows → 3 unique donors", grouped.donors.length === 3, grouped.donors.map(d => d.name));
  ok("attaches 3 gifts (null gift dropped)", grouped.gifts.length === 3, grouped.gifts);
  const janeIdx = grouped.donors.findIndex(d => d.email === "jane@x.org");
  const janeGifts = grouped.gifts.filter(g => g.donorIndex === janeIdx);
  ok("Jane's two gifts point at her index", janeGifts.length === 2, janeGifts);
  ok("blank field back-filled from a later row (phone)", grouped.donors[janeIdx].phone === "555-1000", grouped.donors[janeIdx]);
  ok("a gift's donorIndex is valid", grouped.gifts.every(g => g.donorIndex >= 0 && g.donorIndex < grouped.donors.length), grouped.gifts);
  const carol = grouped.donors.find(d => d.email === "carol@x.org");
  ok("a donor with no gift is still created", !!carol, grouped.donors.map(d => d.email));

  // First-occurrence donor wins; a later row never overwrites a non-blank name.
  const g2 = groupTransactions([
    { key: "k", donor: { name: "Real Name", email: "k@x.org" }, gift: { amount: 5, date: "2024-01-01" } },
    { key: "k", donor: { name: "Typo Nam",  email: "k@x.org" }, gift: { amount: 6, date: "2024-02-01" } },
  ]);
  ok("first-occurrence name is not clobbered", g2.donors.length === 1 && g2.donors[0].name === "Real Name", g2.donors);

  summary();
})().catch(e => { console.error(e); process.exit(1); });
