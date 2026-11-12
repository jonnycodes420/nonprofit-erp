// tests/fixtures/import/import10/make.cjs · IMPORT-10. A made-up silent-auction
// winners file in the shape of the 11 Nov customer file: every name is invented.
// Two winners' lot names hold the word "Total"; one "Subtotal" row mid-sheet
// and one "Total" row at the bottom both foot. Writes winners.csv beside it.
"use strict";
const fs = require("fs"), path = require("path");
const FIRST = ["Alder", "Briar", "Cedar", "Dahlia", "Elm", "Fern", "Garnet", "Hazel", "Iris", "Juniper", "Kestrel", "Linden"];
const LAST = ["Quarry", "Rook", "Sable", "Thistle", "Umber", "Vale", "Wick", "Yarrow", "Zephyr", "Moss"];
const LOTS = ["Lake Cabin Weekend", "Signed Guitar", "Chef's Dinner for Six", "Pottery Class", "Kayak Rental", "Spa Basket", "Bakery Box", "Garden Tour"];
const head = ["First Name", "Last Name", "Email", "Address", "City", "State", "Zip", "Lot Name", "Winning Bid Amount", "Fair Market Value"];

function build() {
  const rows = [];
  let sub = 0, all = 0;
  const winner = (i, lot, paid, fmv) => {
    const f = FIRST[i % FIRST.length], l = LAST[(i * 7) % LAST.length] + (i > 9 ? String.fromCharCode(97 + (i % 26)) : "");
    rows.push([f, l, `${f}.${l}.${i}@import10.test`.toLowerCase(), `${100 + i} Birch Lane`, "Riverton", "OH", "43001", lot, paid, fmv]);
    sub += paid; all += paid;
  };
  for (let i = 0; i < 20; i++) winner(i, LOTS[i % LOTS.length], 50 + i * 5, 40);
  winner(20, "Total Joint Care Supplement", 120, 90);                 // a person: "Total" opens the lot name
  for (let i = 21; i < 30; i++) winner(i, LOTS[i % LOTS.length], 60 + i, 50);
  rows.push(["Subtotal - Live Auction", "", "", "", "", "", "", "", sub, ""]); sub = 0;
  for (let i = 30; i < 40; i++) winner(i, LOTS[i % LOTS.length], 70 + i, 55);
  winner(40, "Private Wine Class at Total Wine & More", 160, 120);    // a person: "Total" inside the lot name
  for (let i = 41; i < 45; i++) winner(i, LOTS[i % LOTS.length], 80 + i, 60);
  rows.push(["Total", "", "", "", "", "", "", "", all, ""]);
  return { head, rows, winners: 45, paidCents: all * 100 };
}
const csvOf = ({ head, rows }) => [head, ...rows].map(r => r.map(v => /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")).join("\n") + "\n";
module.exports = { build, csvOf };
if (require.main === module) fs.writeFileSync(path.join(__dirname, "winners.csv"), csvOf(build()));
