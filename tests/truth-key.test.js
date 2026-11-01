// tests/truth-key.test.js: TRUTH-1. THE ANSWER KEY'S OWN TEST.
// tests/keys/truthKey.js says what every number should be, from rows, with no
// app code. This holds it to a hand-made fixture of eleven gift rows whose
// numbers were worked out by hand, below, before the function was run. If
// the key is wrong, every truth check built on it is wrong, so it is proved
// first. No server, no database.
//
// The fixture, as of Mon 2 Nov 2026, a July fiscal year (FY2026 is
// 2026-07-01 to 2027-06-30; lapsed is a last gift on or before 2025-11-02;
// lapsing is a last gift from 2025-11-03 to 2026-02-02; undeposited looks
// back to 2026-08-04):
//   Ada and Ben share household H1. Cleo, Dov, Gus Co. (a company) and Hal
//   are on their own. Eve is deleted and Fay is a sample row.
//    1  Ada   $100.00  2026-09-01  check, on a deposit run, at the dinner
//    2  Ada    $50.00  2025-08-01  cash
//    3  Ben   $200.00  2026-10-01  "Soft Credit"            recognition
//    4  Cleo  $300.00  2025-01-15  check
//    5  Dov   $400.00  2026-01-10  ACH
//    6  Dov   -$25.00  2026-03-01  a refund
//    7  Eve   $999.00  2026-09-15  deleted: counts toward nothing
//    8  Gus   $500.00  2026-10-15  "Matching Gift", check, deposited_on set
//    9  Cleo  $500.00  2026-10-15  "Matching Gift Credit"   recognition
//   10  Ben    $75.00  2026-10-20  check, on no deposit, at the dinner
//   11  Hal    $60.00  2025-03-01  cash; Hal has an open pledge on schedule
// HOW IT GOES RED: a credit counted as money (total $2,160, not $1,460); a
// refund not taken off ($1,485); the deleted person's gift counted ($2,459);
// a pledge that does not hold (Hal lapsed); a credit counted as giving (Cleo
// gave this year, not lapsed); a household counted per person (6 units); a
// committed file key that no longer matches its file's cells.
"use strict";
const { computeKey } = require("./keys/truthKey");

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const rows = {
  people: [
    { id: "ada", household: "H1" }, { id: "ben", household: "H1" }, { id: "cleo" }, { id: "dov" },
    { id: "eve", deleted: true }, { id: "fay", sample: true }, { id: "gus" }, { id: "hal" },
  ],
  gifts: [
    { id: "g1", person: "ada", amount: 100, date: "2026-09-01", method: "check", depositRun: "dep1", event: "dinner" },
    { id: "g2", person: "ada", amount: 50, date: "2025-08-01", method: "Cash" },
    { id: "g3", person: "ben", amount: 200, date: "2026-10-01", type: "Soft Credit" },
    { id: "g4", person: "cleo", amount: 300, date: "2025-01-15", method: "check" },
    { id: "g5", person: "dov", amount: 400, date: "2026-01-10", method: "ACH" },
    { id: "g6", person: "dov", amount: -25, date: "2026-03-01" },
    { id: "g7", person: "eve", amount: 999, date: "2026-09-15", method: "check" },
    { id: "g8", person: "gus", amount: 500, date: "2026-10-15", type: "Matching Gift", method: "check", depositedOn: "2026-10-20" },
    { id: "g9", person: "cleo", amount: 500, date: "2026-10-15", type: "Matching Gift Credit" },
    { id: "g10", person: "ben", amount: 75, date: "2026-10-20", method: "check", event: "dinner" },
    { id: "g11", person: "hal", amount: 60, date: "2025-03-01", method: "cash" },
  ],
  pledges: [{ id: "p1", person: "hal", amount: 1000, status: "open",
    installments: [{ due: "2027-01-01", amount: 500 }, { due: "2027-06-01", amount: 500 }] }],
  attendance: [
    { id: "a1", event: "dinner", person: "ada", status: "attended" },
    { id: "a2", event: "dinner", person: "ben", status: "attended" },
    { id: "a3", event: "dinner", person: "cleo", status: "registered" },
    { id: "a4", event: "dinner", person: "dov", status: "registered", checkedIn: true },
    { id: "a5", event: "dinner", person: "gus", status: "declined", checkedIn: true },
  ],
};
const K = computeKey(rows, { today: "2026-11-02", fiscalStartMonth: 7 });

console.log("\ntruth-key: the key, worked by hand");
eq("the fiscal year is labelled with its dates", K.fiscalYear, { from: "2026-07-01", to: "2027-06-30", label: "FY2026 (2026-07-01 to 2027-06-30)" });
eq("people: six live (Eve deleted, Fay a sample)", K.people, 6);
eq("households: one (Ada and Ben), two people in it, five units", [K.households, K.peopleInHouseholds, K.units], [1, 2, 5]);
eq("money is hard credit: 8 rows, $1,460.00 (credits out, the refund off, Eve's gift nowhere)", K.gifts, { count: 8, cents: 146000, undated: 0 });
eq("the two credit rows are $700.00 of recognition", [K.credits.rows, K.credits.cents], [2, 70000]);
eq("this fiscal year: rows 1, 8 and 10, $675.00", K.thisFiscalYear, { from: "2026-07-01", to: "2026-11-02", cents: 67500, count: 3 });
eq("by fiscal year: FY2024 $360, FY2025 $425 (the refund off), FY2026 $675", K.byFiscalYear, { FY2026: 67500, FY2025: 42500, FY2024: 36000 });
eq("lifetime per person (hard only)", K.lifetimeById, { ada: 15000, ben: 7500, cleo: 30000, dov: 37500, gus: 50000, hal: 6000 });
eq("lapsed: Cleo (her matching credit is not giving; Hal is held by his pledge)", K.lapsed, ["cleo"]);
eq("lapsing: Dov (last gift Jan 10, 2026)", K.lapsing, ["dov"]);
eq("no pledge is overdue", K.pledgeOverdue, []);
eq("first-time: Ben and Gus in FY2026, Ada and Dov in FY2025", K.firstTime, { FY2026: ["ben", "gus"], FY2025: ["ada", "dov"] });
eq("retained in FY2026: Ada", K.retained, { FY2026: ["ada"] });
eq("deposited: rows 1 and 8, $600.00; undeposited: row 10, $75.00 (rows 2, 4, 5, 11 are older than ninety days)",
  [K.deposits.deposited, { count: K.deposits.undeposited.count, cents: K.deposits.undeposited.cents }], [{ count: 2, cents: 60000 }, { count: 1, cents: 7500 }]);
eq("the dinner: 4 parties, 5 people; came 2 parties (H1, Dov), 3 people; gave 1 party; came and gave 1 party, 2 people; came and didn't 1 party, 1 person",
  K.events.dinner, { parties: 4, people: 5, came: { parties: 2, people: 3 }, gave: { parties: 1 }, cameGave: { parties: 1, people: 2 }, cameNoGift: { parties: 1, people: 1 } });

// Hal's pledge goes overdue: still held (FIX-60: overdue is its own state), and named overdue
const late = computeKey({ ...rows, pledges: [{ ...rows.pledges[0], installments: [{ due: "2026-10-01", amount: 500 }, { due: "2027-06-01", amount: 500 }] }] }, { today: "2026-11-02", fiscalStartMonth: 7 });
eq("an overdue pledge still holds Hal off lapsed, and he is named overdue", [late.lapsed, late.pledgeOverdue], [["cleo"], ["hal"]]);
// no pledge: Hal is lapsed
const none = computeKey({ ...rows, pledges: [] }, { today: "2026-11-02", fiscalStartMonth: 7 });
eq("with no pledge, Hal is lapsed beside Cleo", none.lapsed, ["cleo", "hal"]);
// a January year
const jan = computeKey(rows, { today: "2026-11-02", fiscalStartMonth: 1 });
eq("a January year: 2026 so far is rows 1, 5, 6, 8, 10: $1,050.00", [jan.fiscalYear.from, jan.thisFiscalYear.cents], ["2026-01-01", 105000]);

// The committed file keys are what the files' cells say today (build-keys.js),
// and they are Jonathan's hand keys (expected.json, expected-finding-joy.json).
const BK = require("./keys/build-keys");
for (const name of Object.keys(BK.KEYS)) eq(`tests/keys/${name}.key.json is its file's cells, rebuilt`, BK.load(name), BK.KEYS[name]());
const RS = require("path").join(__dirname, "fixtures", "import", "real-shaped");
const hand = JSON.parse(require("fs").readFileSync(require("path").join(RS, "expected.json"), "utf8"))["jp-gift-history-287.xlsx"];
const fj = JSON.parse(require("fs").readFileSync(require("path").join(RS, "expected-finding-joy.json"), "utf8"));
const gk = BK.load("gift-history-287"), fk = BK.load("finding-joy-443"), ev = fk.events["Finding Joy Dinner"];
eq("the gift file's key is the hand key: 278 gifts, $571,129.93, 9 set aside, 190 names, net $566,183.93",
  [gk.gifts.count, gk.gifts.cents, gk.setAside.count, gk.names, gk.net], [hand.gifts, Math.round(hand.gift_dollars * 100), hand.set_aside, hand.distinct_donor_names, Math.round(hand.file_total * 100)]);
eq("Finding Joy's key is the hand key: 443 rows, 422 invited, 172 came, 104 gave, 77 came and gave, 95 didn't, $45,340 + $78,950",
  [fk.rows, ev.invited, ev.came, ev.gave, ev.cameGave, ev.cameNoGift, fk.gifts.cents, fk.pledged],
  [fj.people, fj.invited, fj.attended, fj.gave, fj.attended_and_gave, fj.attended_no_gift, fj.received * 100, fj.not_yet_received * 100]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
